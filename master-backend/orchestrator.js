// master-backend/orchestrator.js
// Docker Orchestrator for Multi-tenant Isolated User Sandboxes ("1 User = 1 Docker Container")

import Docker from 'dockerode';
import path from 'node:path';
import fs from 'node:fs';
import net from 'node:net';
import { execSync } from 'node:child_process';
import { masterModelManager } from './model-manager.js';

// Initialize Dockerode instance (Named Pipe on Windows, Unix Socket on Linux)
export const docker = new Docker(
  process.platform === 'win32'
    ? { socketPath: '//./pipe/docker_engine' }
    : { socketPath: '/var/run/docker.sock' }
);

export const BASE_IMAGE = 'dsh-user-base-image:latest';
export const CONTAINER_RAM_LIMIT = 256 * 1024 * 1024; // 256 MB in bytes
export const CONTAINER_CPU_LIMIT = 500000000;        // 0.5 CPU in nanoCPUs

// Map to track user last activity timestamp in memory { [userId]: number }
const userLastActivityMap = new Map();

// Map to track allocated host ports for containers
const allocatedPorts = new Set();
let nextPortCandidate = 3100;

export function toHostBindPath(targetPath) {
  const hostProject = process.env.HOST_PROJECT_PATH;
  if (!hostProject) return targetPath;

  const resolved = path.resolve(targetPath);
  const appPrefix = path.resolve('/app');
  if (resolved.startsWith(appPrefix)) {
    const rel = resolved.slice(appPrefix.length).replace(/^[/\\]+/, '');
    return path.posix.join(hostProject.replace(/\\/g, '/'), rel.replace(/\\/g, '/'));
  }
  return targetPath;
}

/**
 * Allocate a free port on localhost
 */
export async function allocatePort() {
  const containers = await docker.listContainers({ all: true }).catch(() => []);
  const usedPorts = new Set(allocatedPorts);
  for (const c of containers) {
    if (c.Ports) {
      for (const p of c.Ports) {
        if (p.PublicPort) usedPorts.add(p.PublicPort);
      }
    }
    const hostPort = c.Labels?.['dsh.host_port'];
    if (hostPort) usedPorts.add(Number(hostPort));
  }

  for (let port = nextPortCandidate; port < 3999; port++) {
    if (!usedPorts.has(port)) {
      allocatedPorts.add(port);
      nextPortCandidate = port + 1;
      if (nextPortCandidate > 3990) nextPortCandidate = 3100;
      return port;
    }
  }
  throw new Error('No available port in range 3100-3999 for user containers');
}

/**
 * Release an allocated port
 */
export function releasePort(port) {
  if (port) {
    allocatedPorts.delete(Number(port));
  }
}

/**
 * Poll until the container port is actively accepting connections
 */
export async function waitForPort(port, timeoutMs = 12000, targetHost = null) {
  const host = targetHost || (process.platform === 'win32' ? '127.0.0.1' : (process.env.HOST_GATEWAY || 'host.docker.internal'));
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const isReady = await new Promise(resolve => {
      const socket = new net.Socket();
      socket.setTimeout(600);
      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.on('error', () => {
        socket.destroy();
        resolve(false);
      });
      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });
      socket.connect(port, host);
    });
    if (isReady) return true;
    await new Promise(r => setTimeout(r, 400));
  }
  return false;
}

/**
 * Ensure workspace directory on host exists
 */
export function ensureUserWorkspaceDir(userId, username) {
  const root = process.env.USERS_WORKSPACES_ROOT || path.resolve(process.cwd(), 'data', 'workspaces');
  const userDir = path.join(root, `${userId}_${username}`);
  if (!fs.existsSync(userDir)) {
    fs.mkdirSync(userDir, { recursive: true });
  }
  return userDir;
}

/**
 * Record API activity for a user
 */
export function recordUserActivity(userId) {
  userLastActivityMap.set(String(userId), Date.now());
}

/**
 * Get last activity time for a user
 */
export function getUserLastActivity(userId) {
  return userLastActivityMap.get(String(userId)) || Date.now();
}

/**
 * Helper to compute clear container name including user ID and username
 */
export function getContainerName(userId, username) {
  if (username) {
    const cleanUsername = String(username).toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    return `dsh-user-${userId}-${cleanUsername}`;
  }
  return `dsh-user-${userId}`;
}

/**
 * Extract launch token from container startup logs (with retry for freshly started containers)
 */
export async function getContainerLaunchToken(userId, maxWaitMs = 3000) {
  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    try {
      const container = await findUserContainer(userId);
      if (!container) return null;
      const inspect = await container.inspect();
      const containerName = inspect.Name?.replace(/^\//, '') || inspect.Id;

      try {
        const out = execSync(`docker logs --tail 200 ${containerName}`, {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 2000
        });
        const match = out.match(/token=([a-zA-Z0-9_\-]+)/);
        if (match) return match[1];
      } catch {}

      const logs = await container.logs({ stdout: true, stderr: true, tail: 200 });
      const logStr = logs.toString('utf-8');
      const tokenMatch = logStr.match(/token=([a-zA-Z0-9_\-]+)/);
      if (tokenMatch) return tokenMatch[1];
    } catch {}

    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}

/**
 * Spawn or reuse a dedicated Docker sandbox container for a user
 * @param {number|string} userId
 * @param {string} username
 * @param {string} [role='user']
 * @returns {Promise<{containerId: string, name: string, port: number, launchToken: string|null, status: string, reused: boolean}>}
 */
export async function spawnUserContainer(userId, username, role = 'user') {
  const containerName = getContainerName(userId, username);
  recordUserActivity(userId);

  // 1. Check if container already exists
  const existingContainer = await findUserContainer(userId);
  if (existingContainer) {
    const inspect = await existingContainer.inspect();
    const port = extractHostPort(inspect);
    const launchToken = await getContainerLaunchToken(userId);
    const existingName = inspect.Name?.replace(/^\//, '') || containerName;

    if (inspect.State.Running) {
      return {
        containerId: inspect.Id,
        name: existingName,
        ip: extractContainerIP(inspect),
        internalPort: 3090,
        port,
        launchToken,
        launchUrl: launchToken ? `/?token=${launchToken}` : '/',
        status: 'running',
        reused: true
      };
    } else {
      // Container exists but stopped -> start it
      await existingContainer.start();
      const reinspect = await existingContainer.inspect();
      return {
        containerId: inspect.Id,
        name: existingName,
        ip: extractContainerIP(reinspect),
        internalPort: 3090,
        port,
        launchToken,
        launchUrl: launchToken ? `/?token=${launchToken}` : '/',
        status: 'restarted',
        reused: true
      };
    }
  }

  // 2. Prepare user isolated workspace directory and persistent DSH home on host
  const hostWorkspaceDir = ensureUserWorkspaceDir(userId, username);
  const userDshHomeDir = masterModelManager.prepareUserDshHome(userId, username, role);
  const workspacesRoot = process.env.USERS_WORKSPACES_ROOT || path.resolve(process.cwd(), 'data', 'workspaces');
  if (!fs.existsSync(workspacesRoot)) {
    fs.mkdirSync(workspacesRoot, { recursive: true });
  }

  // 3. Allocate unique host port for this container
  const hostPort = await allocatePort();

  const binds = [
    // Mount host workspace directory into container /data/workspace
    `${toHostBindPath(hostWorkspaceDir)}:/data/workspace:rw`,
    // Mount host persistent DSH home into container /data/dsh_home
    `${toHostBindPath(userDshHomeDir)}:/data/dsh_home:rw`
  ];

  if (role === 'admin') {
    // Mount all user workspaces directory as Read-Only inside admin container
    binds.push(`${toHostBindPath(workspacesRoot)}:/data/all_users_ro:ro`);
    // Mount all user dsh_homes directory as Read-Only inside admin container
    const dshHomesRoot = process.env.DSH_USER_HOMES_DIR || path.resolve(process.cwd(), 'data/dsh_homes');
    if (!fs.existsSync(dshHomesRoot)) fs.mkdirSync(dshHomesRoot, { recursive: true });
    binds.push(`${toHostBindPath(dshHomesRoot)}:/data/all_dsh_homes_ro:ro`);
  }

  // 4. Create new container with strict hardware limits
  const container = await docker.createContainer({
    Image: BASE_IMAGE,
    name: containerName,
    Env: [
      `DSH_USER_NAME=${username}`,
      `DSH_USER_ID=${userId}`,
      `DSH_USER_ROLE=${role}`,
      `DSH_PORT=3090`,
      `PORT=3090`,
      ...masterModelManager.getContainerEnvForUser(role)
    ],
    Labels: {
      'dsh.managed': 'true',
      'dsh.user_id': String(userId),
      'dsh.username': String(username),
      'dsh.user_role': String(role),
      'dsh.host_port': String(hostPort),
      'dsh.created_at': String(Date.now())
    },
    HostConfig: {
      Memory: CONTAINER_RAM_LIMIT,       // 256 MB Limit
      MemorySwap: CONTAINER_RAM_LIMIT,   // Disable swap beyond RAM
      NanoCpus: CONTAINER_CPU_LIMIT,     // 0.5 CPU Limit
      Binds: binds,
      PortBindings: {
        '3090/tcp': [{ HostPort: String(hostPort), HostIp: '0.0.0.0' }]
      },
      RestartPolicy: {
        Name: 'no'
      }
    }
  });

  // 5. Start container
  await container.start();

  // Wait until port is accepting connections
  await waitForPort(hostPort);

  const inspect = await container.inspect();

  // Capture launch token (poll up to 15s to allow DSH web server to print token)
  let launchToken = null;
  for (let attempt = 0; attempt < 25; attempt++) {
    await new Promise(r => setTimeout(r, 500));
    launchToken = await getContainerLaunchToken(userId);
    if (launchToken) break;
  }

  return {
    containerId: inspect.Id,
    name: containerName,
    ip: extractContainerIP(inspect),
    internalPort: 3090,
    port: hostPort,
    launchToken,
    launchUrl: launchToken ? `/?token=${launchToken}` : '/',
    status: 'running',
    reused: false
  };
}

/**
 * Find container instance by userId (searches by dsh.user_id label or container name)
 */
export async function findUserContainer(userId) {
  try {
    const containers = await docker.listContainers({
      all: true,
      filters: {
        label: [`dsh.user_id=${userId}`]
      }
    });
    if (containers.length > 0) {
      return docker.getContainer(containers[0].Id);
    }
  } catch {}

  // Fallback: try direct legacy name
  try {
    const legacy = docker.getContainer(`dsh-user-${userId}`);
    await legacy.inspect();
    return legacy;
  } catch {
    return null;
  }
}

/**
 * Helper to extract container IP across Docker network modes
 */
export function extractContainerIP(inspect) {
  if (inspect?.NetworkSettings?.IPAddress) {
    return inspect.NetworkSettings.IPAddress;
  }
  const networks = inspect?.NetworkSettings?.Networks;
  if (networks) {
    for (const netName of Object.keys(networks)) {
      if (networks[netName]?.IPAddress) {
        return networks[netName].IPAddress;
      }
    }
  }
  return '127.0.0.1';
}

/**
 * Helper to extract host mapped port
 */
function extractHostPort(inspect) {
  try {
    const ports = inspect.NetworkSettings?.Ports || inspect.HostConfig?.PortBindings;
    const binding = ports['3090/tcp'];
    if (binding && binding[0]) {
      return Number(binding[0].HostPort);
    }
  } catch {}
  return null;
}

/**
 * Force kill and remove a user's container (Kill Switch / Logout)
 */
export async function killUserContainer(userId) {
  const container = await findUserContainer(userId);
  if (!container) return false;

  try {
    const inspect = await container.inspect();
    const port = extractHostPort(inspect);
    if (port) releasePort(port);

    if (inspect.State.Running) {
      await container.kill();
    }
    await container.remove({ force: true });
    userLastActivityMap.delete(String(userId));
    return true;
  } catch (err) {
    console.error(`[Orchestrator] Error killing container for user ${userId}:`, err.message);
    return false;
  }
}

/**
 * List all active DSH-managed user containers with metrics
 */
export async function listUserContainers() {
  const containers = await docker.listContainers({
    all: true,
    filters: {
      label: ['dsh.managed=true']
    }
  });

  const now = Date.now();

  return containers.map(c => {
    const userId = c.Labels['dsh.user_id'];
    const username = c.Labels['dsh.username'];
    const hostPort = c.Labels['dsh.host_port'] || null;
    const lastActive = getUserLastActivity(userId);
    const idleSeconds = Math.round((now - lastActive) / 1000);

    return {
      containerId: c.Id,
      name: c.Names[0]?.replace(/^\//, ''),
      userId,
      username,
      state: c.State,
      status: c.Status,
      port: hostPort,
      lastActive,
      idleSeconds
    };
  });
}

/**
 * Scan and clean up containers that have been idle longer than threshold
 * @param {number} idleTimeoutMinutes
 */
export async function cleanupIdleContainers(idleTimeoutMinutes = 30) {
  const containers = await listUserContainers();
  const idleTimeoutMs = idleTimeoutMinutes * 60 * 1000;
  const now = Date.now();
  const killed = [];

  for (const c of containers) {
    const lastActive = getUserLastActivity(c.userId);
    const idleMs = now - lastActive;

    if (idleMs >= idleTimeoutMs) {
      console.log(`[Orchestrator] Container ${c.name} idle for ${Math.round(idleMs / 1000)}s (> ${idleTimeoutMinutes}m). Terminating...`);
      await killUserContainer(c.userId);
      killed.push({ userId: c.userId, name: c.name, idleMinutes: Math.round(idleMs / 60000) });
    }
  }

  return killed;
}

// Background idle sweeper timer handle
let sweeperInterval = null;

export function startIdleSweeper(intervalMs = 60000, idleTimeoutMinutes = 30) {
  if (sweeperInterval) clearInterval(sweeperInterval);
  sweeperInterval = setInterval(async () => {
    try {
      await cleanupIdleContainers(idleTimeoutMinutes);
    } catch (e) {
      console.error('[Orchestrator] Error during idle container sweep:', e.message);
    }
  }, intervalMs);
  if (sweeperInterval.unref) sweeperInterval.unref();
}

export function stopIdleSweeper() {
  if (sweeperInterval) {
    clearInterval(sweeperInterval);
    sweeperInterval = null;
  }
}

/**
 * Clean up all user sandbox containers on server boot so containers only run on-demand upon login
 */
export async function cleanupStaleUserContainersOnBoot() {
  try {
    const containers = await docker.listContainers({
      all: true,
      filters: { label: ['dsh.managed=true'] }
    });
    for (const c of containers) {
      try {
        const container = docker.getContainer(c.Id);
        await container.stop({ t: 1 }).catch(() => {});
        await container.remove({ force: true }).catch(() => {});
      } catch {}
    }
    if (containers.length > 0) {
      console.log(`[Orchestrator] Đã dọn dẹp ${containers.length} sandbox container cũ. Sandbox sẽ chỉ khởi động khi người dùng đăng nhập.`);
    }
  } catch (err) {
    console.warn('[Orchestrator] Cảnh báo dọn dẹp container khi boot:', err.message);
  }
}
