// gateway/orchestrator.js
// Shared-Brain Tool Sandbox Orchestrator (replaces legacy "1 user = 1 DSH container").
// - Lazy spawn: tool container dsh-tool-<username> only created on the FIRST tool call.
// - Exec Router core: every operation runs via `docker exec node /opt/dsh-tool/runner.js`.
// - Idle Sweeper: containers idle > TOOL_IDLE_MINUTES (and no running exec) are stopped+removed.
// - Reconcile on boot: already-running managed containers get lastToolUse = now.
// Volumes are never deleted; they persist across container removal.

import Docker from 'dockerode';

export const docker = new Docker(
  process.platform === 'win32'
    ? { socketPath: '//./pipe/docker_engine' }
    : { socketPath: '/var/run/docker.sock' }
);

export const TOOL_IMAGE = process.env.DSH_TOOL_IMAGE || 'dsh-tool:latest';
const TOOL_RAM_MB = parseInt(process.env.TOOL_RAM_MB || '256', 10);
const TOOL_CPU_CORES = parseFloat(process.env.TOOL_CPU_CORES || '0.5', 10);
const TOOL_PIDS_LIMIT = parseInt(process.env.TOOL_PIDS_LIMIT || '128', 10);
const TOOL_NETWORK_DISABLED = (process.env.TOOL_NETWORK_DISABLED || 'true').toLowerCase() !== 'false';
const TOOL_READY_TIMEOUT_MS = 15000;
const MAX_EXEC_OUTPUT_BYTES = 8 * 1024 * 1024;

const lastToolUse = new Map();   // userId(string) -> epoch ms  (ONLY tool calls update this)
const activeExecs = new Map();   // userId(string) -> number of execs currently running
const spawnTails = new Map();    // userId(string) -> Promise (per-user mutex for creation)

export function sanitizeSegment(raw, fallback = 'user') {
  const cleaned = String(raw ?? '').toLowerCase().replace(/[^a-z0-9_-]/g, '_').replace(/^\.+/, '');
  return cleaned || fallback;
}

export function toolContainerName(username) {
  return `dsh-tool-${sanitizeSegment(username, 'user')}`;
}

export function toolVolumeName(userId, role) {
  return (role === 'admin' || Number(userId) === 1) ? 'dsh-vol-admin' : `dsh-vol-user${userId}`;
}

export function recordToolUse(userId) {
  lastToolUse.set(String(userId), Date.now());
}

/** Testing/diagnostics helper: explicitly age a user's last tool-use timestamp. */
export function setToolLastUse(userId, ts) {
  lastToolUse.set(String(userId), Number(ts));
}

export function getToolLastUse(userId) {
  return lastToolUse.get(String(userId));
}

export function getActiveExecCount(userId) {
  return activeExecs.get(String(userId)) || 0;
}

/** Resolve the gateway's own docker network (containers join it unless network is disabled). */
export async function getGatewayNetwork() {
  if (process.env.DOCKER_NETWORK) return process.env.DOCKER_NETWORK;
  try {
    const self = await docker.getContainer(process.env.HOSTNAME || 'dsh-gateway').inspect();
    const nets = Object.keys(self?.NetworkSettings?.Networks || {});
    if (nets.length > 0) return nets[0];
  } catch {}
  return 'bridge';
}

/** Per-user mutex: two concurrent tool calls must never create two containers. */
async function withUserLock(userId, fn) {
  const key = String(userId);
  const tail = spawnTails.get(key) || Promise.resolve();
  const run = tail.then(fn, fn);
  spawnTails.set(key, run.then(() => {}, () => {}));
  return run;
}

async function findToolContainer(userId) {
  try {
    const list = await docker.listContainers({
      all: true,
      filters: { label: [`dsh.userId=${userId}`] }
    });
    if (list.length > 0) return docker.getContainer(list[0].Id);
  } catch {}
  try {
    const legacy = docker.getContainer(`dsh-user-${userId}`);
    await legacy.inspect();
    return legacy;
  } catch {
    return null;
  }
}

async function ensureVolume(userId, username, role) {
  const Name = toolVolumeName(userId, role);
  try {
    await docker.createVolume({
      Name,
      Labels: { 'dsh.managed': 'true', 'dsh.userId': String(userId), 'dsh.username': sanitizeSegment(username) }
    });
  } catch (e) {
    if (!/already exists|409/i.test(String(e?.message || e))) throw e;
  }
  return Name;
}

/** Admin tool containers additionally mount every existing user volume read-only. */
async function collectAdminRoBinds() {
  const binds = [];
  try {
    const { Volumes = [] } = await docker.listVolumes({});
    for (const v of Volumes) {
      if (!/^dsh-vol-user/.test(v.Name)) continue;
      const id = v.Labels?.['dsh.userId'] || v.Name.replace(/^dsh-vol-user/, '');
      const uname = v.Labels?.['dsh.username'] || `user${id}`;
      binds.push(`${v.Name}:/data/all_users_ro/${id}-${uname}:ro`);
    }
  } catch (e) {
    console.warn('[orchestrator] Could not enumerate user volumes for admin RO mounts:', e.message);
  }
  return binds;
}

async function waitForToolReady(container) {
  const deadline = Date.now() + TOOL_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const exec = await container.exec({
        Cmd: ['test', '-f', '/run/dsh-tool/ready'],
        AttachStdout: false, AttachStderr: false
      });
      const stream = await exec.start({});
      await new Promise((resolve, reject) => {
        stream.on('end', resolve);
        stream.on('error', reject);
      });
      const info = await exec.inspect();
      if (info.ExitCode === 0) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

/**
 * Lazy-spawn or reuse the tool container for a user. Serialized per userId (mutex).
 */
export async function ensureToolContainer(userId, username, role = 'user') {
  return withUserLock(userId, async () => {
    const t0 = Date.now();
    let container = await findToolContainer(userId);
    if (container) {
      const inspect = await container.inspect().catch(() => null);
      if (inspect && inspect.State.Running) {
        return { containerId: inspect.Id, name: inspect.Name.replace(/^\//, ''), reused: true, coldStartMs: Date.now() - t0 };
      }
      if (inspect) {
        await container.start().catch(() => {});
        const ok = await waitForToolReady(container);
        if (!ok) throw new Error(`Tool container restarted but never became ready (dsh-tool-${username})`);
        recordToolUse(userId);
        return { containerId: inspect.Id, name: toolContainerName(username), reused: true, restarted: true, coldStartMs: Date.now() - t0 };
      }
      container = null;
    }

    const cleanUser = sanitizeSegment(username);
    const vol = await ensureVolume(userId, cleanUser, role);
    const binds = [`${vol}:/data/workspace:rw`];
    if (role === 'admin') binds.push(...(await collectAdminRoBinds()));

    const networkMode = TOOL_NETWORK_DISABLED ? 'none' : await getGatewayNetwork();

    const created = await docker.createContainer({
      Image: TOOL_IMAGE,
      name: toolContainerName(cleanUser),
      Env: [`DSH_ROLE=${role}`, `DSH_USERNAME=${cleanUser}`, `DSH_USER_ID=${String(userId)}`],
      Labels: {
        'dsh.managed': 'true',
        'dsh.role': role,
        'dsh.userId': String(userId),
        'dsh.username': cleanUser,
        'dsh.container_kind': 'tool',
        'dsh.created_at': String(Date.now())
      },
      HostConfig: {
        Binds: binds,
        Memory: TOOL_RAM_MB * 1024 * 1024,
        MemorySwap: TOOL_RAM_MB * 1024 * 1024,
        NanoCpus: Math.round(TOOL_CPU_CORES * 1e9),
        PidsLimit: TOOL_PIDS_LIMIT,
        CapDrop: ['ALL'],
        SecurityOpt: ['no-new-privileges:true'],
        NetworkMode: networkMode,
        RestartPolicy: { Name: 'no' }
      }
    });

    await created.start();
    const ok = await waitForToolReady(created);
    if (!ok) {
      try { await created.stop({ t: 1 }); } catch {}
      throw new Error(`Tool container for ${cleanUser} did not become ready within ${TOOL_READY_TIMEOUT_MS}ms`);
    }
    recordToolUse(userId);
    const coldStartMs = Date.now() - t0;
    console.log(`[orchestrator] Cold-started tool container ${toolContainerName(cleanUser)} in ${coldStartMs}ms`);
    const inspect = await created.inspect();
    return { containerId: inspect.Id, name: toolContainerName(cleanUser), reused: false, coldStartMs };
  });
}

function readStreamToString(stream, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let truncated = false;
    stream.on('data', (c) => {
      if (truncated) return;
      chunks.push(c);
      size += c.length;
      if (size > limit) { truncated = true; resolve({ text: Buffer.concat(chunks).toString('utf8'), truncated }); }
    });
    stream.on('end', () => resolve({ text: Buffer.concat(chunks).toString('utf8'), truncated }));
    stream.on('error', reject);
  });
}

/**
 * Run one tool call: lazy-spawn container if needed, then docker exec the runner
 * with a JSON payload on stdin, collect one JSON line from stdout.
 * Completion listeners are registered BEFORE writing stdin so the multiplexed
 * exec stream can never deadlock on an already-fired `end` event.
 */
export async function execTool({ userId, username, role = 'user', tool, args = {}, workspace, cwd, timeoutMs = 60000, signal, token }) {
  const { containerId } = await ensureToolContainer(userId, username, role);
  const container = docker.getContainer(containerId);

  activeExecs.set(String(userId), getActiveExecCount(userId) + 1);
  try {
    // Prefer the argv (--b64) channel: no stdin pipe, avoids exec-stream deadlock
    // on Docker Desktop for Windows. Falls back gracefully if payload is huge.
    const payload = JSON.stringify({ tool, args, userId, username: String(username), role, workspace, cwd, timeoutMs, token });
    const useArgv = Buffer.byteLength(payload) < 100 * 1024; // keep within typical CreateProcess cmdline limits

    const Cmd = useArgv
      ? ['node', '/opt/dsh-tool/runner.js', '--b64', Buffer.from(payload, 'utf8').toString('base64')]
      : ['node', '/opt/dsh-tool/runner.js'];

    const exec = await container.exec({
      Cmd,
      AttachStdin: !useArgv, AttachStdout: true, AttachStderr: true, Tty: false
    });
    const stream = await exec.start({ hijack: true, stdin: !useArgv });

    // Register completion listeners FIRST (before consuming/writing) to avoid a
    // deadlock where `end` fires once and a later await would never resolve.
    const finished = new Promise((resolve) => {
      const done = () => resolve();
      stream.once('end', done);
      stream.once('close', done);
      stream.once('error', done);
    });
    const outP = readStreamToString(stream, MAX_EXEC_OUTPUT_BYTES);

    if (!useArgv) {
      stream.write(payload);
      stream.end();
    }

    const killed = { value: false };
    const timer = setTimeout(async () => {
      try { const i = await exec.inspect(); if (i.Running) { killed.value = true; await exec.kill().catch(() => {}); } } catch {}
    }, Math.max(1000, Number(timeoutMs) || 60000));

    const onAbort = async () => {
      try { const i = await exec.inspect(); if (i.Running) { killed.value = true; await exec.kill().catch(() => {}); } } catch {}
    };
    if (signal) {
      if (signal.aborted) await onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }

    await finished;
    clearTimeout(timer);
    if (signal) signal.removeEventListener?.('abort', onAbort);

    const info = await exec.inspect().catch(() => ({ ExitCode: 1 }));
    const { text, truncated } = await outP;
    recordToolUse(userId);

    if (killed.value || info.ExitCode === 137) {
      return { ok: false, error: `Tool execution exceeded ${timeoutMs}ms and was terminated.`, code: 'TOOL_TIMEOUT', tool };
    }
    const line = String(text || '').trim().split('\n').filter(Boolean).pop();
    let parsed = null;
    try { parsed = line ? JSON.parse(line) : null; } catch {}
    if (!parsed) {
      return {
        ok: false,
        error: `Tool runner exited (${info.ExitCode}) without a JSON result: ${truncated ? String(text).slice(0, 512) : String(line ?? text).slice(0, 512)}`,
        code: 'TOOL_EXEC_FAILED',
        tool
      };
    }
    return { ...parsed, tool, containerId, exitCode: info.ExitCode, outputTruncated: Boolean(truncated) };
  } finally {
    activeExecs.set(String(userId), Math.max(0, getActiveExecCount(userId) - 1));
  }
}

export async function listToolContainers({ all = true } = {}) {
  const containers = await docker.listContainers({
    all,
    filters: { label: ['dsh.managed=true', 'dsh.container_kind=tool'] }
  });
  const now = Date.now();
  return containers.map((c) => {
    const userId = c.Labels['dsh.userId'];
    const last = getToolLastUse(userId);
    return {
      containerId: c.Id,
      name: (c.Names?.[0] || '').replace(/^\//, ''),
      userId,
      username: c.Labels['dsh.username'],
      role: c.Labels['dsh.role'],
      state: c.State,
      lastToolUse: last ?? null,
      idleSeconds: last ? Math.round((now - last) / 1000) : null,
      activeExecs: getActiveExecCount(userId)
    };
  });
}

/** Remove the user's tool container (stop + rm). Volume and data stay untouched. */
export async function killToolContainer(userId) {
  const container = await findToolContainer(userId);
  if (!container) return false;
  try {
    const inspect = await container.inspect();
    if (inspect.State.Running) await container.stop({ t: 3 }).catch(() => container.kill());
    await container.remove({ force: true });
    return true;
  } catch (err) {
    console.error(`[orchestrator] Error removing tool container for user ${userId}:`, err.message);
    return false;
  }
}

export async function cleanupIdleToolContainers(idleMinutes) {
  const minutes = Number.isFinite(idleMinutes) ? idleMinutes : parseFloat(process.env.TOOL_IDLE_MINUTES || '15');
  const idleMs = minutes * 60 * 1000;
  const now = Date.now();
  const killed = [];
  for (const c of await listToolContainers({ all: false })) {
    const userId = c.userId;
    if (getActiveExecCount(userId) > 0) continue;
    const last = getToolLastUse(userId);
    const idle = last === undefined ? Infinity : now - last;
    if (idle >= idleMs) {
      console.log(`[orchestrator] Tool container ${c.name} idle for ${last === undefined ? 'unknown' : Math.round(idle / 1000) + 's'} (>${minutes}m). Removing (volume kept)...`);
      if (await killToolContainer(userId)) killed.push({ userId, name: c.name });
    }
  }
  return killed;
}

let sweeperInterval = null;
export function startToolIdleSweeper(intervalMs = 60000) {
  stopToolIdleSweeper();
  sweeperInterval = setInterval(() => {
    cleanupIdleToolContainers().catch((e) => console.error('[orchestrator] idle sweep error:', e.message));
  }, intervalMs);
  if (sweeperInterval.unref) sweeperInterval.unref();
}

export function stopToolIdleSweeper() {
  if (sweeperInterval) { clearInterval(sweeperInterval); sweeperInterval = null; }
}

/** Gateway restart: surviving tool containers count as "just used" so they are not swept instantly. */
export async function reconcileOnBoot() {
  try {
    const running = await listToolContainers({ all: false });
    for (const c of running) recordToolUse(c.userId);
    if (running.length > 0) {
      console.log(`[orchestrator] Reconciled ${running.length} running tool container(s) after gateway boot (lastToolUse = now).`);
    }
    return running.length;
  } catch (e) {
    console.warn('[orchestrator] reconcile failed:', e.message);
    return 0;
  }
}
