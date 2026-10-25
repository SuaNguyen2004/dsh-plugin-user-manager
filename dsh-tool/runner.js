// dsh-tool/runner.js
// Entry point executed via `docker exec dsh-tool-<user> node /opt/dsh-tool/runner.js`
// Request payload (one JSON object) is read from EITHER:
//   argv:   node runner.js --b64 <base64(json)>   (preferred: no stdin pipe needed)
//   stdin:  echo json | node runner.js
// Request shape:
//   { tool, args, userId, username, role, workspace, cwd, timeoutMs }
// Validates against the ACTIVE MANIFEST chosen by DSH_ROLE at container creation
// (a user container can never invoke admin-only tools and vice versa), executes,
// and writes ONE JSON response to stdout:
//   { ok, result } | { ok: false, error, code }

import fs from 'node:fs';
import path from 'node:path';

const MANIFEST_FILE = '/run/dsh-tool/active-manifest.json';

function fail(error, code = 'RUNNER_ERROR') {
  process.stdout.write(JSON.stringify({ ok: false, error: String(error), code }) + '\n');
  process.exit(0);
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      buf += chunk;
      if (buf.length > 32 * 1024 * 1024) reject(new Error('stdin payload exceeds 32MB'));
    });
    process.stdin.on('end', () => resolve(buf));
    process.stdin.on('error', reject);
    // If stdin is not a TTY-less pipe (no data flowing), fall back to argv only.
    if (process.stdin.isTTY) resolve('');
  });
}

/** Decode payload from `--b64 <base64>` argv if present, otherwise read stdin. */
async function readRequest() {
  const argv = process.argv.slice(2);
  const idx = argv.indexOf('--b64');
  if (idx !== -1 && argv[idx + 1]) {
    return Buffer.from(argv[idx + 1], 'base64').toString('utf8');
  }
  return readStdin();
}

async function main() {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
  } catch (e) {
    return fail(`Active manifest unavailable at ${MANIFEST_FILE}: ${e.message}`, 'MANIFEST_MISSING');
  }

  let req;
  try {
    const raw = await readRequest();
    req = JSON.parse(raw);
  } catch (e) {
    return fail(`Invalid request payload: ${e.message}`, 'BAD_REQUEST');
  }

  const { tool, args = {}, username, userId, role } = req;
  if (!tool || typeof tool !== 'string') return fail('Thiếu tên tool.', 'BAD_REQUEST');

  // RBAC ENFORCEMENT: tool must exist in THIS container's manifest for THIS role.
  // User containers load manifest.user.json — admin-only tools are simply absent,
  // so a call to them is rejected here regardless of any gateway-level mistake.
  const def = manifest.tools?.[tool];
  if (!def) {
    return fail(
      `Tool "${tool}" not allowed for role "${manifest.role}" (container was provisioned with role-scoped manifest).`,
      'TOOL_NOT_ALLOWED'
    );
  }

  const ctx = {
    username: username || process.env.DSH_USERNAME || 'unknown',
    userId: userId ?? process.env.DSH_USER_ID ?? '0',
    role: role || manifest.role,
    workspace: req.workspace || 'default-workspace',
    cwd: req.cwd || undefined,
    timeoutMs: req.timeoutMs || 60000
  };

  const modulePath = path.posix.join(manifest.toolsDir, def.module);
  if (!fs.existsSync(modulePath)) {
    return fail(`Tool module missing: ${modulePath}`, 'MODULE_MISSING');
  }

  try {
    const mod = await import(modulePath);
    const handler = mod[def.handler];
    if (typeof handler !== 'function') {
      return fail(`Handler "${def.handler}" not found in ${modulePath}`, 'HANDLER_MISSING');
    }
    const result = await handler(args, ctx);
    process.stdout.write(JSON.stringify({ ok: true, result }) + '\n');
  } catch (err) {
    process.stdout.write(JSON.stringify({
      ok: false,
      error: err?.message || String(err),
      code: err?.code || 'TOOL_EXEC_ERROR'
    }) + '\n');
  }
  process.exit(0);
}

main().catch((err) => fail(err?.message || String(err)));
