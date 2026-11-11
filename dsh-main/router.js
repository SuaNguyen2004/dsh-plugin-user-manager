// dsh-main/router.js
// Shared multi-tenant DSH core (Approach B): ONE dsh-main container (:3090, internal only),
// one lightweight DSH child process per tenant, isolated by DSH_HOME under dsh-homes.
//
//   Browser --(Gateway strips client X-DSH-*, injects trusted ones)--> dsh-main:3090 (router)
//     router: identity = X-DSH-User-Id / X-DSH-Username / X-DSH-Role ONLY (never cookies/paths)
//     -> lazy-spawn child `dsh web --port <ephemeral>` with DSH_HOME=/data/dsh_homes/user-<id>-<name>
//     -> reverse-proxy HTTP + WebSocket to that child
//     -> idle children killed after DSH_CHILD_IDLE_MINUTES (their DSH_HOME persists in the volume)
//
// Security: a request with no trusted identity header is refused 401. Because dsh-main publishes
// no port to the host (compose) and the gateway only ever adds these headers after JWT auth,
// neither a direct host hit to :3090 nor a browser-forged X-DSH-Role can reach another tenant.
// dsh-main mounts NO workspace volume: every file/tool operation is routed to dsh-tool via the
// gateway /internal/exec seam (see patch-dsh-host.cjs Patch 10 + lib/index.js).

import http from 'node:http';
import { spawn } from 'node:child_process';
import httpProxy from 'http-proxy';
import path from 'node:path';
import fs from 'node:fs';

const HOMES_ROOT = process.env.DSH_HOMES_ROOT || '/data/dsh_homes';
const PORT_BASE = parseInt(process.env.DSH_CHILD_PORT_BASE || '3300', 10);
const IDLE_MS = parseFloat(process.env.DSH_CHILD_IDLE_MINUTES || '30') * 60 * 1000;
const BOOT_TIMEOUT_MS = parseInt(process.env.DSH_CHILD_BOOT_TIMEOUT_MS || '20000', 10);
const DSH_LAUNCH = (process.env.DSH_CHILD_CMD || 'dsh web --no-open').trim().split(/\s+/);

export function sanitizeSegment(raw, fallback = 'user') {
  const cleaned = String(raw ?? '').toLowerCase().replace(/[^a-z0-9_-]/g, '_').replace(/^\.+/, '');
  return cleaned || fallback;
}

export function homeDirFor(userId, username) {
  const homesRoot = process.env.DSH_HOMES_ROOT || HOMES_ROOT;
  return path.posix.join(homesRoot, `user-${userId}-${sanitizeSegment(username)}`);
}

/** Trusted identity from gateway-injected headers. Missing user id => null (unauthenticated). */
export function identityFrom(req) {
  const id = req.headers['x-dsh-user-id'];
  if (id === undefined || id === null || id === '') return null;
  return {
    userId: String(id),
    username: sanitizeSegment(req.headers['x-dsh-username'] || `user${id}`, 'user'),
    role: String(req.headers['x-dsh-role'] || 'user').toLowerCase() === 'admin' ? 'admin' : 'user'
  };
}

// ---- pluggable child backend (real spawn by default; injectable for deterministic tests) ----
let childFactory = defaultChildFactory;
export function _setChildFactory(fn) { childFactory = fn || defaultChildFactory; }

function waitForHttpReady(port, host, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get({ host, port, path: '/', timeout: 1500 }, (res) => {
        res.resume();
        if (res.statusCode === 200) return resolve();
        if (Date.now() >= deadline) return reject(new Error(`child on :${port} returned ${res.statusCode} after ${timeoutMs}ms`));
        setTimeout(tick, 150);
      });
      req.on('error', () => {
        req.destroy();
        if (Date.now() >= deadline) return reject(new Error(`child on :${port} did not become HTTP-ready within ${timeoutMs}ms`));
        setTimeout(tick, 150);
      });
    };
    tick();
  });
}

/** Default: spawn a real DSH child bound to 127.0.0.1 only, isolated home, no workspace mount. */
function defaultChildFactory({ userId, username, role, port }) {
  const home = homeDirFor(userId, username);
  ensureHomeProfile(home, { userId, username, role });
  const cwd = path.posix.join(home, 'workspaces', 'default-workspace');
  fs.mkdirSync(cwd, { recursive: true });
  fs.mkdirSync('/data/temp', { recursive: true });
  const args = [...DSH_LAUNCH];
  if (!args.includes('--port')) args.push('--port', String(port));
  const proc = spawn(args[0], args.slice(1), {
    cwd,
    env: {
      ...process.env,
      DSH_HOME: home,
      DSH_USER_ID: String(userId),
      DSH_USER_NAME: username,
      DSH_USER_ROLE: role,
      DSH_CHILD_PORT: String(port)
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  proc.stdout.on('data', (c) => process.stdout.write(`[dsh-${username}] ${c}`));
  proc.stderr.on('data', (c) => process.stderr.write(`[dsh-${username}!] ${c}`));
  return {
    port,
    home,
    ready: waitForHttpReady(port, '127.0.0.1', BOOT_TIMEOUT_MS).then(() => true),
    close: () => { try { proc.kill('SIGTERM'); } catch {} }
  };
}

/**
 * Scaffold one tenant home so `dsh web` boots with:
 *  - the enterprise tenant plugin linked in (remote tools via exec router),
 *  - the local fs/bash/pwsh/search tool rows DISABLED (no file execution in dsh-main),
 *  - a private default workspace directory (DSH rejects workspaces whose path is missing).
 */
export function ensureHomeProfile(home, identity) {
  const profileDir = path.posix.join(home, 'profiles', 'web');
  const pkgPath = path.posix.join(profileDir, 'package.json');
  const patchPath = path.posix.join(profileDir, 'cordis.patch.yml');
  const nm = path.posix.join(profileDir, 'node_modules');
  fs.mkdirSync(nm, { recursive: true });
  try {
    const linkTarget = process.env.DSH_PLUGIN_DIR || '/app';
    const linkPath = path.posix.join(nm, 'dsh-user-container-plugin');
    if (!fs.existsSync(linkPath)) fs.symlinkSync(linkTarget, linkPath, 'dir');
    const marketLink = path.posix.join(nm, 'dshmarket');
    if (!fs.existsSync(marketLink)) fs.symlinkSync('/usr/local/lib/node_modules/dshmarket', marketLink, 'dir');
  } catch {}
  if (!fs.existsSync(pkgPath)) {
    fs.writeFileSync(pkgPath, JSON.stringify({
      name: 'dsh-profile-web',
      private: true,
      dependencies: { dshmarket: '1.66.45', 'dsh-user-container-plugin': 'link:/app' },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dshmarket', 'dsh-user-container-plugin'] } }
    }, null, 2) + '\n', 'utf8');
  }
  const requiredLines = [
    '- id: webserver',
    '  config:',
    '    host: 127.0.0.1',
    '    port: !!js (ctx.webStartup.port ?? 3090)',
    '- id: user-container-plugin',
    '  name: "dsh-user-container-plugin"',
    '  disabled: false',
    '- id: dsh-market',
    '  name: "dshmarket"',
    '  disabled: false',
    '# Sandbox boundary: dsh-main has no workspace volume. Local file/shell tools are',
    '# disabled at the composition layer; the tenant plugin re-registers remote variants',
    '# that route through POST /internal/exec into dsh-tool-<username>.',
    '- id: tool-fs',
    '  disabled: true',
    '- id: tool-fs-search',
    '  disabled: true',
    '- id: tool-bash',
    '  disabled: true',
    '- id: tool-pwsh',
    '  disabled: true',
    ''
  ].join('\n');
  if (!fs.existsSync(patchPath)) {
    fs.writeFileSync(patchPath, requiredLines, 'utf8');
  } else {
    const existing = fs.readFileSync(patchPath, 'utf8');
    if (!existing.includes('- id: tool-fs')) {
      fs.writeFileSync(patchPath, existing.trimEnd() + '\n' + [
        '- id: user-container-plugin',
        '  name: "dsh-user-container-plugin"',
        '  disabled: false',
        '- id: tool-fs',
        '  disabled: true',
        '- id: tool-fs-search',
        '  disabled: true',
        '- id: tool-bash',
        '  disabled: true',
        '- id: tool-pwsh',
        '  disabled: true',
        ''
      ].join('\n'), 'utf8');
    }
  }
  return { home, profileDir };
}

// ---- registry: userId -> { identity, backend, lastUse, promise } ----
const children = new Map();
let portCursor = 0;
function nextPort() { return PORT_BASE + (portCursor++); }

async function getOrCreateChild(identity) {
  const key = identity.userId;
  const existing = children.get(key);
  if (existing && !existing.dead) {
    existing.lastUse = Date.now();
    await existing.backend.ready;
    return existing.backend;
  }
  const rec = { identity, lastUse: Date.now(), dead: false };
  const port = nextPort();
  const backend = childFactory({ ...identity, port });
  rec.backend = backend;
  children.set(key, rec);
  try {
    await backend.ready;
  } catch (e) {
    rec.dead = true; children.delete(key);
    try { backend.close(); } catch {}
    throw e;
  }
  return backend;
}

export function touchChild(userId) { const r = children.get(String(userId)); if (r) r.lastUse = Date.now(); }

export function sweepIdleChildren(now = Date.now()) {
  const removed = [];
  for (const [key, rec] of children) {
    if (now - rec.lastUse >= IDLE_MS) {
      try { rec.backend.close(); } catch {}
      children.delete(key);
      removed.push({ userId: key, home: rec.backend.home });
    }
  }
  return removed;
}

let sweepTimer = null;
export function startIdleSweeper(intervalMs = 60000) {
  stopIdleSweeper();
  sweepTimer = setInterval(() => {
    const r = sweepIdleChildren();
    if (r.length) console.log(`[dsh-main] swept ${r.length} idle child DSH process(es); homes kept.`);
  }, intervalMs);
  if (sweepTimer.unref) sweepTimer.unref();
}
export function stopIdleSweeper() { if (sweepTimer) { clearInterval(sweepTimer); sweepTimer = null; } }

export function listChildren() {
  const now = Date.now();
  return [...children.values()].map((r) => ({
    userId: r.identity.userId, username: r.identity.username, role: r.identity.role,
    port: r.backend.port, idleSeconds: Math.round((now - r.lastUse) / 1000)
  }));
}

/**
 * Build the router request handler. `opts.lookupUser`, when given, is consulted to reject
 * identities the gateway should never have forwarded (defence in depth against a bug in
 * header injection). It is async (userId) => {status}|null.
 */
export function createRouterHandler(opts = {}) {
  const proxy = httpProxy.createProxyServer({ ws: true, xfwd: false, ignorePath: false });
  proxy.on('error', (err, req, res) => {
    if (res && typeof res.writeHead === 'function' && !res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: `tenant backend unavailable: ${err.message}`, code: 'TENANT_BACKEND_ERROR' }));
    }
  });

  const handler = async (req, res) => {
    if (req.url === '/healthz' || req.url === '/internal/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ service: 'dsh-main-router', status: 'healthy', children: listChildren() }));
    }
    if (req.url === '/internal/reload-user-children' && req.method === 'POST') {
      const removed = [];
      for (const [key, rec] of children) {
        if (rec.identity.role !== 'admin') {
          try { rec.backend.close(); } catch {}
          children.delete(key);
          removed.push({ userId: key, username: rec.identity.username });
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, swept: removed.length, removed }));
    }
    const identity = identityFrom(req);
    if (!identity) {
      // No trusted identity => this is a direct/unproxied hit. Refuse without revealing DSH.
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: 'Missing trusted gateway identity.', code: 'UNAUTHENTICATED' }));
    }
    if (opts.lookupUser) {
      const u = await Promise.resolve(opts.lookupUser(identity.userId)).catch(() => null);
      if (!u || (u.status && u.status !== 'active')) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'Unknown or inactive tenant.', code: 'UNKNOWN_TENANT' }));
      }
    }
    try {
      const backend = await getOrCreateChild(identity);
      touchChild(identity.userId);
      // Never forward the gateway's internal control headers to the DSH child.
      delete req.headers['x-dsh-internal-token'];
      return proxy.web(req, res, { target: `http://127.0.0.1:${backend.port}` });
    } catch (e) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: e.message, code: 'TENANT_BOOT_FAILED' }));
    }
  };

  handler.upgrade = (req, socket, head) => {
    const identity = identityFrom(req);
    if (!identity) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); return socket.destroy(); }
    getOrCreateChild(identity).then((backend) => {
      touchChild(identity.userId);
      proxy.ws(req, socket, head, { target: `http://127.0.0.1:${backend.port}` });
    }).catch(() => socket.destroy());
  };
  return handler;
}

export function startRouter(port = parseInt(process.env.PORT || '3090', 10)) {
  const handler = createRouterHandler();
  const server = http.createServer(handler);
  server.on('upgrade', (req, socket, head) => handler.upgrade(req, socket, head));
  startIdleSweeper();
  return new Promise((resolve) => server.listen(port, '0.0.0.0', () => resolve(server)));
}

if (process.argv[1] && process.argv[1].endsWith('router.js')) {
  startRouter().then((server) => {
    console.log(`[dsh-main] Shared Brain router listening on :${server.address().port} (children spawned lazily per authenticated tenant)`);
  });
}
