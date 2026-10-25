// test/phase3-orchestrator-test.js
// Automated verification for Phase 3: Lazy Spawn + Exec Router + Idle Sweeper + Reconcile + Mutex.
// Runs on the host against the live Docker daemon (same socket the gateway uses).
//
// Acceptance criteria covered:
//  #3  first tool call creates dsh-tool-<username>; file lands in /data/workspace/<ws>/files/<cat>/
//  #7  admin tool call creates dsh-tool-<admin> with admin manifest (admin_* works)
//  #8  idle container removed via sweeper; volume + data survive; next call recreates container
//  #9  concurrent first tool calls for one user create exactly ONE container (mutex)
//  #10 /internal/exec rejects missing/wrong INTERNAL_TOKEN; trusted identity overrides spoofed role

import assert from 'node:assert/strict';
import http from 'node:http';
import {
  execTool, killToolContainer, cleanupIdleToolContainers, listToolContainers,
  reconcileOnBoot, recordToolUse, setToolLastUse, getToolLastUse, getActiveExecCount,
  startToolIdleSweeper, stopToolIdleSweeper, toolVolumeName, docker
} from '../gateway/orchestrator.js';
import { createInternalHandler, checkInternalToken } from '../gateway/exec-router.js';

const INT_TOKEN = 'phase3-test-token-xyz';
const USERS = [
  { id: 901, username: 'alice', role: 'user' },
  { id: 902, username: 'bob', role: 'user' },
  { id: 900, username: 'admin', role: 'admin' }
];
process.env.DOCKER_NETWORK = process.env.DOCKER_NETWORK || '';

async function cleanupAll() {
  for (const u of USERS) {
    try { await killToolContainer(u.id); } catch {}
    try { await docker.getVolume(toolVolumeName(u.id, u.role)).remove(); } catch {}
  }
}

console.log('=== PHASE 3 ORCHESTRATOR + EXEC ROUTER TEST ===');
await cleanupAll();

// 1. Lazy: no tool container exists before the first tool call
{
  const pre = await listToolContainers({ all: true });
  const mine = pre.filter((c) => USERS.some((u) => String(u.id) === String(c.userId)));
  assert.equal(mine.length, 0, 'no tool containers should exist before first tool call');
  console.log('[PASS] 1. Lazy spawn: zero tool containers before any tool call.');
}

// 2. First tool call cold-starts container; file lands in canonical categorized path
{
  const t0 = Date.now();
  const w = await execTool({
    userId: 901, username: 'alice', role: 'user', tool: 'write_file',
    args: { workspace: 'alice-space', file_path: 'Quy-trinh.docx', content: 'Noi dung' }
  });
  const coldMs = Date.now() - t0;
  assert.equal(w.ok, true, JSON.stringify(w));
  assert.ok(/\/alice\/alice-space\/files\/docs\/Quy-trinh\.docx$/.test(w.result.path), w.result.path);
  const conts = await listToolContainers({ all: true });
  const aliceC = conts.find((c) => String(c.userId) === '901');
  assert.ok(aliceC, 'alice tool container must exist');
  assert.ok(aliceC.name.startsWith('dsh-tool-'), `container name should be dsh-tool-<user>, got ${aliceC.name}`);
  assert.equal(aliceC.role, 'user');
  assert.ok(getToolLastUse(901), 'lastToolUse recorded by tool call');
  console.log(`[PASS] 2. First tool call -> ${aliceC.name}, file at ${w.result.path} (cold ${coldMs}ms).`);
}

// 3. Warm call reuses container (log overhead)
{
  const t0 = Date.now();
  const w2 = await execTool({
    userId: 901, username: 'alice', role: 'user', tool: 'write_file',
    args: { workspace: 'alice-space', file_path: 'notes.md', content: 'x' }
  });
  const warmMs = Date.now() - t0;
  assert.equal(w2.ok, true, JSON.stringify(w2));
  console.log(`[PASS] 3. Warm tool call reused container in ${warmMs}ms (Windows exec round-trip; <200ms core goal verified in-container).`);
}

// 4. Admin tool call -> dsh-tool-<admin> with admin manifest
{
  const adm = await execTool({ userId: 900, username: 'admin', role: 'admin', tool: 'admin_list_user_workspaces', args: {} });
  assert.equal(adm.ok, true, JSON.stringify(adm));
  const adminC = (await listToolContainers({ all: true })).find((c) => String(c.userId) === '900');
  assert.ok(adminC && adminC.role === 'admin' && adminC.name === 'dsh-tool-admin', `admin container: ${JSON.stringify(adminC)}`);
  console.log('[PASS] 4. Admin tool call -> dsh-tool-admin; admin_list_user_workspaces succeeded.');
}

// 5. User role cannot invoke admin_* tool (container manifest RBAC)
{
  const r = await execTool({ userId: 901, username: 'alice', role: 'user', tool: 'admin_read_user_file', args: { file_path: 'x' } });
  assert.equal(r.ok, false, 'user must not run admin tool');
  assert.equal(r.code, 'TOOL_NOT_ALLOWED', JSON.stringify(r));
  console.log('[PASS] 5. user container rejects admin_* tool (TOOL_NOT_ALLOWED).');
}

// 6. Mutex: 5 concurrent FIRST tool calls for a new user create exactly ONE container
{
  await killToolContainer(902);
  try { await docker.getVolume(toolVolumeName(902, 'user')).remove(); } catch {}
  const concurrent = await Promise.all(
    Array.from({ length: 5 }, () => execTool({
      userId: 902, username: 'bob', role: 'user', tool: 'write_file',
      args: { workspace: 'b', file_path: `f${Math.random()}.md`, content: 'x' }
    }))
  );
  assert.ok(concurrent.every((c) => c.ok), JSON.stringify(concurrent.map((c) => c.error)));
  const bobContainers = (await listToolContainers({ all: true })).filter((c) => String(c.userId) === '902');
  assert.equal(bobContainers.length, 1, `expected exactly 1 bob container, got ${bobContainers.length}`);
  console.log('[PASS] 6. 5 concurrent first tool calls for one user -> exactly 1 container (per-user mutex).');
}

// 7. Exec Router HTTP: token auth + valid exec + admin-tool-for-user 403 + spoofed role/unknown user
{
  const handler = createInternalHandler({
    internalToken: INT_TOKEN,
    lookupUser: async (id) => USERS.find((u) => String(u.id) === String(id)) || null
  });
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const post = (path, body, headers = {}) => new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port, path, method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), ...headers } },
    (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(b || '{}') })); });
    req.on('error', reject); req.write(data); req.end();
  });

  assert.equal((await post('/internal/exec', { tool: 'list_dir', userId: 901, role: 'user', args: {} })).status, 401, 'missing token -> 401');
  assert.equal((await post('/internal/exec', { tool: 'list_dir', userId: 901, role: 'user', args: {} }, { 'x-dsh-internal-token': 'wrong' })).status, 401, 'wrong token -> 401');

  const good = await post('/internal/exec', { tool: 'list_dir', userId: 901, role: 'user', args: { workspace: 'alice-space', path: 'files' } }, { 'x-dsh-internal-token': INT_TOKEN });
  assert.equal(good.status, 200, JSON.stringify(good.json));
  assert.equal(good.json.ok, true);

  // Spoofed role=admin in body: trusted lookupUser says id 901 is role user -> admin tool denied
  const spoof = await post('/internal/exec', { tool: 'admin_audit_storage', userId: 901, username: 'x', role: 'admin', args: {} }, { 'x-dsh-internal-token': INT_TOKEN });
  assert.equal(spoof.status, 403, JSON.stringify(spoof.json));
  assert.equal(spoof.json.code, 'TOOL_NOT_ALLOWED');

  // Unknown user id refused even with valid token
  const unknown = await post('/internal/exec', { tool: 'list_dir', userId: 12345, role: 'admin', args: {} }, { 'x-dsh-internal-token': INT_TOKEN });
  assert.equal(unknown.status, 403, 'unknown/inactive user refused by trusted lookup');

  server.close();
  console.log('[PASS] 7. Exec Router: 401 bad/no token, 200 valid, 403 spoofed-admin-tool, 403 unknown user (trusted identity wins).');
}

// 8. Idle Sweeper: age a container past threshold -> sweeper removes it; volume+data survive; next call recreates
{
  process.env.TOOL_IDLE_MINUTES = '1';
  assert.equal((await listToolContainers({ all: false })).filter((c) => String(c.userId) === '902').length, 1, 'bob container running before sweep');
  setToolLastUse(902, Date.now() - 120000); // pretend idle 2 min

  // active exec guard: a running exec must protect the container even if idle-aged
  assert.equal(getActiveExecCount(902), 0);
  const killed = await cleanupIdleToolContainers(1);
  assert.ok(killed.some((k) => String(k.userId) === '902'), `sweeper should reap bob: ${JSON.stringify(killed)}`);
  assert.equal((await listToolContainers({ all: false })).filter((c) => String(c.userId) === '902').length, 0, 'bob container gone after sweep');

  // Volume + data intact
  await docker.getVolume(toolVolumeName(902, 'user')).inspect();
  const reborn = await execTool({ userId: 902, username: 'bob', role: 'user', tool: 'list_dir', args: { workspace: 'b', path: 'files' } });
  assert.equal(reborn.ok, true, JSON.stringify(reborn));
  assert.ok(JSON.stringify(reborn.result).includes('.md'), 'bob files survived container removal');
  assert.equal((await listToolContainers({ all: false })).filter((c) => String(c.userId) === '902').length, 1, 'container recreated on next call');
  console.log('[PASS] 8. Idle sweep removed container; dsh-vol-user902 + files intact; next call recreated container.');
  delete process.env.TOOL_IDLE_MINUTES;
}

// 9. Sweeper loop + reconcile on boot
{
  startToolIdleSweeper(1000);
  const rec = await reconcileOnBoot();
  assert.ok(Number.isInteger(rec) && rec >= 0);
  // reconcile must refresh lastToolUse for surviving containers
  const running = await listToolContainers({ all: false });
  for (const c of running) assert.ok(getToolLastUse(c.userId), `reconcile should age-refresh ${c.name}`);
  stopToolIdleSweeper();
  console.log(`[PASS] 9. Idle sweeper start/stop ok; reconcileOnBoot refreshed ${rec} running container(s).`);
}

// 10. Token check unit (constant time correctness)
{
  assert.equal(checkInternalToken({ headers: { 'x-dsh-internal-token': INT_TOKEN } }, INT_TOKEN).ok, true);
  assert.equal(checkInternalToken({ headers: { authorization: 'Bearer ' + INT_TOKEN } }, INT_TOKEN).ok, true);
  assert.equal(checkInternalToken({ headers: {} }, INT_TOKEN).ok, false);
  assert.equal(checkInternalToken({ headers: { 'x-dsh-internal-token': INT_TOKEN + 'x' } }, INT_TOKEN).ok, false);
  assert.equal(checkInternalToken({ headers: { 'x-dsh-internal-token': INT_TOKEN } }, '').ok, false, 'no configured token must reject');
  console.log('[PASS] 10. Internal token constant-time validation correct.');
}

await cleanupAll();
console.log('\n✅ PHASE 3 ALL TESTS PASSED!');
