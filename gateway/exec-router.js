// gateway/exec-router.js
// Internal HTTP surface of the Gateway, listening on INTERNAL_PORT (3091).
// Reachable ONLY from the docker network (never published to the host).
//
//   POST /internal/exec   -> lazy-spawn tool container + docker exec, JSON result
//   GET  /internal/status -> orchestrator diagnostics (admin token required)
//
// Security:
//  - Every request must carry the shared secret: header "x-dsh-internal-token"
//    (or Authorization: Bearer <token>). Missing/mismatch -> 401.
//  - The caller identity is taken from the authenticated session fields the
//    gateway injects (userId/username/role) — never from client-controlled input.
//  - The manifest RBAC check happens inside the container runner; this layer
//    additionally refuses admin-only tool names for non-admin roles.

import { execTool, listToolContainers, getToolLastUse, getActiveExecCount } from './orchestrator.js';

const ADMIN_ONLY_TOOL_RE = /^admin_/;

function parseBody(req, limitBytes = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limitBytes) { reject(new Error('Request body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { reject(new Error('Invalid JSON body: ' + e.message)); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, data) {
  if (res.headersSent) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

export function checkInternalToken(req, expectedToken) {
  const hdr = req.headers['x-dsh-internal-token'] || '';
  const auth = req.headers['authorization'] || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const provided = String(hdr || bearer);
  if (!expectedToken) return { ok: false, reason: 'INTERNAL_TOKEN is not configured on the gateway' };
  if (!provided) return { ok: false, reason: 'Missing x-dsh-internal-token' };
  // constant-time compare
  if (provided.length !== expectedToken.length) return { ok: false, reason: 'Invalid internal token' };
  let diff = 0;
  for (let i = 0; i < provided.length; i++) diff |= provided.charCodeAt(i) ^ expectedToken.charCodeAt(i);
  return diff === 0 ? { ok: true } : { ok: false, reason: 'Invalid internal token' };
}

/**
 * Build the /internal/* request handler.
 * @param {object} deps
 * @param {string} deps.internalToken
 * @param {(userId: string|number) => Promise<{id,username,role,status}|null>} [deps.lookupUser]
 *        Trusted identity resolver (SQLite lookup). When the exec request names a
 *        userId that no longer exists / is not active, the call is refused.
 */
export function createInternalHandler({ internalToken, lookupUser }) {
  return async function handleInternal(req, res) {
    const url = new URL(req.url, 'http://internal.local');
    const pathname = url.pathname;

    if (pathname === '/internal/health' && req.method === 'GET') {
      return sendJson(res, 200, { service: 'dsh-gateway-internal', status: 'healthy' });
    }

    const auth = checkInternalToken(req, internalToken);
    if (!auth.ok) return sendJson(res, 401, { ok: false, error: auth.reason, code: 'INTERNAL_UNAUTHORIZED' });

    if (pathname === '/internal/exec' && req.method === 'POST') {
      let body;
      try { body = await parseBody(req); }
      catch (e) { return sendJson(res, 400, { ok: false, error: e.message, code: 'BAD_REQUEST' }); }

      const { tool, userId, role = 'user' } = body;
      const args = body.args && typeof body.args === 'object' ? body.args : {};

      if (!tool || typeof tool !== 'string') {
        return sendJson(res, 400, { ok: false, error: 'Thiếu tên tool.', code: 'BAD_REQUEST' });
      }
      if (userId === undefined || userId === null || userId === '') {
        return sendJson(res, 400, { ok: false, error: 'Thiếu userId (tenant).', code: 'BAD_REQUEST' });
      }
      if (ADMIN_ONLY_TOOL_RE.test(tool) && role !== 'admin') {
        return sendJson(res, 403, {
          ok: false,
          error: `Tool "${tool}" is admin-only.`,
          code: 'TOOL_NOT_ALLOWED'
        });
      }

      // Authoritative identity: gateway DB wins over caller-supplied username.
      let identity = { userId: String(userId), username: String(body.username || `user${userId}`), role: String(role) };
      if (lookupUser) {
        const u = await lookupUser(userId).catch(() => null);
        if (!u || u.status !== 'active') {
          return sendJson(res, 403, { ok: false, error: 'User not found or inactive.', code: 'UNKNOWN_USER' });
        }
        identity = { userId: String(u.id), username: String(u.username), role: String(u.role) };
        if (ADMIN_ONLY_TOOL_RE.test(tool) && identity.role !== 'admin') {
          return sendJson(res, 403, { ok: false, error: `Tool "${tool}" is admin-only.`, code: 'TOOL_NOT_ALLOWED' });
        }
      }

      const timeoutMs = Math.min(120000, Math.max(1000, Number(body.timeoutMs) || 60000));
      const ac = new AbortController();
      req.on('close', () => ac.abort());

      try {
        const result = await execTool({
          ...identity,
          tool,
          args,
          workspace: body.workspace,
          cwd: body.cwd,
          timeoutMs,
          signal: ac.signal,
          token: internalToken
        });
        return sendJson(res, result.ok ? 200 : 500, { ...result, userId: identity.userId });
      } catch (e) {
        console.error('[exec-router] /internal/exec failed:', e.message);
        return sendJson(res, 502, { ok: false, error: e.message, code: 'EXEC_SPAWN_FAILED' });
      }
    }

    if (pathname === '/internal/status' && req.method === 'GET') {
      const containers = await listToolContainers({ all: true }).catch(() => []);
      return sendJson(res, 200, {
        ok: true,
        toolIdleMinutes: parseFloat(process.env.TOOL_IDLE_MINUTES || '15'),
        containers: containers.map((c) => ({ ...c, lastToolUse: getToolLastUse(c.userId) ?? null, activeExecs: getActiveExecCount(c.userId) }))
      });
    }

    return sendJson(res, 404, { ok: false, error: 'Not found', code: 'NOT_FOUND' });
  };
}
