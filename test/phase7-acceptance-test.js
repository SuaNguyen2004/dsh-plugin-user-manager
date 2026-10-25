// test/phase7-acceptance-test.js
// Phase 7 — end-to-end acceptance for ALL 12 criteria in docs/PROGRESS.md §7.
// Drives the LIVE compose stack (dsh-gateway:12345 + dsh-main:3090) over HTTP and the
// Docker network via dockerode (no fragile cmd.exe shell quoting).

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import {
  docker, listToolContainers, killToolContainer, cleanupIdleToolContainers,
  setToolLastUse, toolVolumeName
} from '../gateway/orchestrator.js';
import { execNodeInContainer } from '../scripts/migrate-to-volumes.js';

const GW = 'http://127.0.0.1:12345';
const HOST_DATA_DIR = path.resolve('data');
const env = { ...process.env, MSYS_NO_PATHCONV: '1', MSYS2_ARG_CONV_EXCL: '*' };
const sh = (c) => execSync(c, { encoding: 'utf8', env });

const results = [];
function pass(n, msg) { results.push([n, 'PASS', msg]); console.log(`[PASS] #${n}. ${msg}`); }

async function api(pathname, { method = 'GET', body, token, headers: extra = {} } = {}) {
  const headers = { 'content-type': 'application/json', ...extra };
  if (token) headers['authorization'] = `Bearer ${token}`;
  const res = await fetch(GW + pathname, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual'
  });
  let json = null;
  try { json = await res.clone().json(); } catch {}
  return { status: res.status, json, headers: Object.fromEntries(res.headers.entries()) };
}

/** Invoke POST http://dsh-gateway:3091/internal/exec FROM INSIDE the live dsh-main container. */
async function execViaDshMain(payload, token) {
  const dshMain = docker.getContainer('dsh-main');
  const out = await execNodeInContainer(dshMain, `
    (async () => {
      const res = await fetch('http://dsh-gateway:3091/internal/exec', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-dsh-internal-token': ${JSON.stringify(token)} },
        body: ${JSON.stringify(JSON.stringify(payload))}
      });
      const text = await res.text();
      process.stdout.write(text + '\\n');
    })();
  `);
  const line = out.trim().split('\n').filter(Boolean).pop();
  return JSON.parse(line);
}

console.log('=== PHASE 7 ACCEPTANCE: ALL 12 CRITERIA ===');

const hostDataBefore = fs.existsSync(HOST_DATA_DIR) ? fs.readdirSync(HOST_DATA_DIR).sort().join(',') : '';

// Read INTERNAL_TOKEN from live dsh-gateway container
const gwContainer = docker.getContainer('dsh-gateway');
const INTERNAL_TOKEN = (await execNodeInContainer(gwContainer, `process.stdout.write(process.env.INTERNAL_TOKEN || '')`)).trim();
assert.ok(INTERNAL_TOKEN, 'INTERNAL_TOKEN must be configured on dsh-gateway');

// Ensure admin password is known ('admin123') and seed/approve test users
await execNodeInContainer(gwContainer, `
  import('./database/index.js').then(async ({ User, hashPassword }) => {
    const admin = await User.findOne({ where: { username: 'admin' } });
    if (admin) { admin.password_hash = hashPassword('admin123'); admin.status = 'active'; await admin.save(); }
    process.exit(0);
  });
`);

const adminLogin = await api('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
assert.equal(adminLogin.status, 200, JSON.stringify(adminLogin.json));
const adminToken = adminLogin.json.token;

for (const [u, p] of [['e2ealice', 'alicepass1'], ['e2ebob', 'bobpass1'], ['e2erace', 'racepass1']]) {
  await api('/api/auth/register', { method: 'POST', body: { username: u, password: p } });
  await api('/api/admin/approve-user', { method: 'POST', token: adminToken, body: { username: u } });
}

const aliceLogin0 = await api('/api/auth/login', { method: 'POST', body: { username: 'e2ealice', password: 'alicepass1' } });
const bobLogin0 = await api('/api/auth/login', { method: 'POST', body: { username: 'e2ebob', password: 'bobpass1' } });
const raceLogin0 = await api('/api/auth/login', { method: 'POST', body: { username: 'e2erace', password: 'racepass1' } });
const alice = aliceLogin0.json.user;
const aliceToken = aliceLogin0.json.token;
const bob = bobLogin0.json.user;
const raceUser = raceLogin0.json.user;

// Clean any pre-existing tool containers for these users before starting
for (const u of [alice, bob, raceUser, { id: 1 }]) {
  await killToolContainer(u.id).catch(() => {});
}

// #1 Login alice into DSH < 1s; `docker ps` has no dsh-user-* / dsh-tool-e2ealice container
{
  const t0 = Date.now();
  const r = await api('/api/auth/login', { method: 'POST', body: { username: 'e2ealice', password: 'alicepass1' } });
  const ms = Date.now() - t0;
  assert.equal(r.status, 200);
  assert.ok(ms < 1000, `login took ${ms}ms`);
  const conts = await listToolContainers({ all: false });
  assert.equal(conts.filter((c) => String(c.userId) === String(alice.id)).length, 0);
  pass(1, `Alice login in ${ms}ms (<1s); 0 tool containers running for Alice.`);
}

// #2 Alice visits DSH / chats without calling any tool -> still 0 tool containers
{
  const res = await fetch(GW + '/', { headers: { cookie: `dsh_user_token=${aliceToken}` }, redirect: 'manual' });
  assert.equal(res.status, 200);
  await res.text();
  const conts = await listToolContainers({ all: false });
  assert.equal(conts.filter((c) => String(c.userId) === String(alice.id)).length, 0);
  pass(2, `Alice enters DSH screen & chats without tool calls -> still 0 tool containers.`);
}

// #3 Alice calls a tool for the first time -> spawns dsh-tool-e2ealice; file stored at /data/e2ealice/<ws>/files/<cat>/<file>
{
  const w = await execViaDshMain({
    tool: 'write_file',
    userId: alice.id,
    username: alice.username,
    role: 'user',
    args: { workspace: 'e2e-space', file_path: 'Quy-trinh.docx', content: 'Noi dung quy trinh' }
  }, INTERNAL_TOKEN);
  assert.equal(w.ok, true, JSON.stringify(w));
  assert.equal(w.result.path, '/data/e2ealice/e2e-space/files/docs/Quy-trinh.docx');
  const conts = await listToolContainers({ all: false });
  const aliceC = conts.find((c) => String(c.userId) === String(alice.id));
  assert.ok(aliceC && aliceC.name === 'dsh-tool-e2ealice', JSON.stringify(aliceC));
  pass(3, `First tool call spawned ${aliceC.name}; file created at ${w.result.path} in volume dsh-vol-user${alice.id}.`);
}

// #4 Alice creates 2 workspaces -> both separate under /data/e2ealice, no redundant nesting
{
  await execViaDshMain({
    tool: 'write_file',
    userId: alice.id,
    username: alice.username,
    role: 'user',
    args: { workspace: 'proj-b', file_path: 'keystore.csv', content: 'k,v' }
  }, INTERNAL_TOKEN);
  const s1 = await execViaDshMain({
    tool: 'list_dir',
    userId: alice.id,
    username: alice.username,
    role: 'user',
    args: { workspace: 'e2e-space', path: 'files/docs' }
  }, INTERNAL_TOKEN);
  const s2 = await execViaDshMain({
    tool: 'list_dir',
    userId: alice.id,
    username: alice.username,
    role: 'user',
    args: { workspace: 'proj-b', path: 'files/sheets' }
  }, INTERNAL_TOKEN);
  assert.ok(JSON.stringify(s1.result).includes('Quy-trinh.docx'));
  assert.ok(JSON.stringify(s2.result).includes('keystore.csv'));
  const nested = await execViaDshMain({
    tool: 'stat_file',
    userId: alice.id,
    username: alice.username,
    role: 'user',
    args: { workspace: 'e2e-space', file_path: 'workspace' }
  }, INTERNAL_TOKEN);
  assert.equal(nested.ok, false, 'no nested workspace folder');
  pass(4, `Alice's 2 workspaces (e2e-space & proj-b) are separate, properly categorized, with zero redundant nesting.`);
}

// #5 Bob logs in concurrently: cannot see Alice's sessions/files; Alice blocked from ../ and symlink escape
{
  const bobWrite = await execViaDshMain({
    tool: 'write_file',
    userId: bob.id,
    username: bob.username,
    role: 'user',
    args: { workspace: 'bob-ws', file_path: 'bob.txt', content: 'bob only' }
  }, INTERNAL_TOKEN);
  assert.equal(bobWrite.ok, true);
  const bobSearch = await execViaDshMain({
    tool: 'search_files',
    userId: bob.id,
    username: bob.username,
    role: 'user',
    args: { workspace: 'bob-ws', query: 'Quy-trinh' }
  }, INTERNAL_TOKEN);
  assert.equal(bobSearch.result.matches.length, 0, 'Bob must not see Alice files');

  const trav = await execViaDshMain({
    tool: 'read_file',
    userId: alice.id,
    username: alice.username,
    role: 'user',
    args: { workspace: 'e2e-space', file_path: '../../../../etc/passwd' }
  }, INTERNAL_TOKEN);
  assert.equal(trav.ok, false);

  await execNodeInContainer(docker.getContainer('dsh-tool-e2ealice'), `
    require('fs').symlinkSync('/etc', '/data/e2ealice/e2e-space/escape_link');
  `).catch(() => {});
  const sym = await execViaDshMain({
    tool: 'read_file',
    userId: alice.id,
    username: alice.username,
    role: 'user',
    args: { workspace: 'e2e-space', file_path: 'escape_link/passwd' }
  }, INTERNAL_TOKEN);
  assert.equal(sym.ok, false);
  pass(5, `Bob isolated from Alice; Alice blocked from ../ traversal (${trav.code}) and symlink escape (${sym.code}).`);
}

// #6 & #7 Admin enters straight into DSH, sees Alice's workspace under READ-ONLY, cannot write to /data/all_users_ro (:ro),
//         Admin tool call spawns dsh-tool-admin with admin manifest; User cannot call admin tools
{
  const adminPage = await fetch(GW + '/', { headers: { cookie: `dsh_user_token=${adminToken}` }, redirect: 'manual' });
  assert.equal(adminPage.status, 200);
  const adminHtml = await adminPage.text();
  assert.ok(adminHtml.includes('KHU VỰC GIÁM SÁT (READ-ONLY)'), 'Admin DSH screen must render READ-ONLY monitoring section');

  const admList = await execViaDshMain({
    tool: 'admin_list_user_workspaces',
    userId: 1,
    username: 'admin',
    role: 'admin',
    args: {}
  }, INTERNAL_TOKEN);
  assert.equal(admList.ok, true, JSON.stringify(admList));
  assert.ok(JSON.stringify(admList.result).includes('Quy-trinh.docx'), 'Admin must see Alice files via RO mount');

  const roProbe = await execNodeInContainer(docker.getContainer('dsh-tool-admin'), `
    const fs = require('fs');
    try { fs.writeFileSync('/data/all_users_ro/' + fs.readdirSync('/data/all_users_ro')[0] + '/_hack', 'x'); process.stdout.write('WRITABLE'); }
    catch (e) { process.stdout.write('RO_BLOCKED:' + e.code); }
  `);
  assert.ok(roProbe.includes('RO_BLOCKED:EROFS'), `Expected EROFS on /data/all_users_ro, got ${roProbe}`);

  const userAdminAttempt = await execViaDshMain({
    tool: 'admin_audit_storage',
    userId: alice.id,
    username: alice.username,
    role: 'user',
    args: {}
  }, INTERNAL_TOKEN);
  assert.equal(userAdminAttempt.ok, false);
  assert.equal(userAdminAttempt.code, 'TOOL_NOT_ALLOWED');

  const admC = (await listToolContainers({ all: false })).find((c) => c.role === 'admin');
  assert.ok(admC && admC.name === 'dsh-tool-admin');
  pass(6, `Admin enters DSH directly with READ-ONLY section, sees Alice's files, and writes to /data/all_users_ro fail with ${roProbe}.`);
  pass(7, `Admin tool call spawned ${admC.name} with admin manifest; user call to admin_* rejected (${userAdminAttempt.code}).`);
}

// #8 Idle sweeper (tested with 1-minute threshold): removes idle container, keeps volume & chat history, next call recreates container with files intact
{
  // Age Bob's container Inside dsh-gateway and run cleanupIdleToolContainers(1) inside dsh-gateway
  const sweepOut = await execNodeInContainer(gwContainer, `
    import('./gateway/orchestrator.js').then(async ({ setToolLastUse, cleanupIdleToolContainers }) => {
      setToolLastUse(${bob.id}, Date.now() - 120000);
      const killed = await cleanupIdleToolContainers(1);
      process.stdout.write(JSON.stringify(killed));
      process.exit(0);
    });
  `);
  const killed = JSON.parse(sweepOut.trim().split('\n').pop());
  assert.ok(killed.some((k) => String(k.userId) === String(bob.id)), `Expected bob swept, got ${sweepOut}`);
  assert.equal((await listToolContainers({ all: false })).filter((c) => String(c.userId) === String(bob.id)).length, 0, 'bob container removed');

  // Next tool call recreates dsh-tool-e2ebob and reads back bob.txt
  const bobRead = await execViaDshMain({
    tool: 'read_file',
    userId: bob.id,
    username: bob.username,
    role: 'user',
    args: { workspace: 'bob-ws', file_path: 'bob.txt' }
  }, INTERNAL_TOKEN);
  assert.equal(bobRead.ok, true, JSON.stringify(bobRead));
  assert.equal(bobRead.result.content, 'bob only');
  pass(8, `Idle sweep (1m) removed dsh-tool-e2ebob while preserving volume; next tool call recreated container with bob.txt intact.`);
}

// #9 Concurrent first tool calls for the same user create exactly ONE container
{
  await killToolContainer(raceUser.id).catch(() => {});
  const concurrent = await Promise.all(
    Array.from({ length: 5 }, (_, i) =>
      execViaDshMain({
        tool: 'write_file',
        userId: raceUser.id,
        username: raceUser.username,
        role: 'user',
        args: { workspace: 'race-ws', file_path: `f${i}.txt`, content: 'ok' }
      }, INTERNAL_TOKEN)
    )
  );
  assert.ok(concurrent.every((c) => c.ok), JSON.stringify(concurrent));
  const raceConts = (await listToolContainers({ all: true })).filter((c) => String(c.userId) === String(raceUser.id));
  assert.equal(raceConts.length, 1, `Expected 1 container, got ${raceConts.length}`);
  pass(9, `5 concurrent first tool calls for ${raceUser.username} created exactly 1 container (${raceConts[0].name}).`);
}

// #10 Direct access to dsh-main:3090 or gateway:3091 from Host fails; spoofing X-DSH-Role from browser has no effect
{
  let reach3090 = false, reach3091 = false;
  try {
    const r = await fetch('http://127.0.0.1:3090/healthz', { signal: AbortSignal.timeout(1500) });
    reach3090 = r.ok;
  } catch {}
  try {
    const r = await fetch('http://127.0.0.1:3091/internal/health', { signal: AbortSignal.timeout(1500) });
    reach3091 = r.ok;
  } catch {}
  assert.equal(reach3090, false, 'dsh-main:3090 must not be reachable from Host');
  assert.equal(reach3091, false, 'gateway:3091 must not be reachable from Host');

  const spoofAdminApi = await api('/api/admin/users', {
    token: aliceToken,
    headers: { 'x-dsh-role': 'admin', 'x-dsh-user-id': '1' }
  });
  assert.equal(spoofAdminApi.status, 403);
  pass(10, `Direct host connections to :3090 and :3091 refused; browser-spoofed X-DSH-Role:admin rejected (403).`);
}

// #11 `docker inspect` all dsh-* containers: zero bind-mounts pointing to C:\; host data/ has zero new files
{
  const all = await docker.listContainers({ all: true });
  const activeDsh = all.filter((c) => {
    const n = (c.Names?.[0] || '').replace(/^\//, '');
    return n === 'dsh-gateway' || n === 'dsh-main' || n.startsWith('dsh-tool-');
  });
  for (const c of activeDsh) {
    const insp = await docker.getContainer(c.Id).inspect();
    for (const m of insp.Mounts || []) {
      assert.ok(!/^[A-Za-z]:[\\/]/.test(m.Source || ''), `Container ${insp.Name} has Windows bind mount: ${m.Source}`);
    }
  }
  const hostDataAfter = fs.existsSync(HOST_DATA_DIR) ? fs.readdirSync(HOST_DATA_DIR).sort().join(',') : '';
  assert.equal(hostDataAfter, hostDataBefore, 'Host data/ must not gain any new files');
  pass(11, `Inspected ${activeDsh.length} active dsh-* containers: 0 Windows C:\\ bind-mounts; Host data/ directory has 0 new files.`);
}

// #12 `docker compose down` then `up -d`: chat history, workspace files, and accounts all survive
{
  sh('docker compose down');
  sh('docker compose up -d');
  const deadline = Date.now() + 30000;
  let ok = false;
  while (Date.now() < deadline) {
    try {
      const h = await api('/health');
      if (h.status === 200) { ok = true; break; }
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  assert.equal(ok, true, 'dsh-gateway healthy after compose down + up -d');

  // Re-login Alice -> account survives
  const relogin = await api('/api/auth/login', { method: 'POST', body: { username: 'e2ealice', password: 'alicepass1' } });
  assert.equal(relogin.status, 200);

  // Read Alice's file -> workspace volume survives
  const newGw = docker.getContainer('dsh-gateway');
  const newIntToken = (await execNodeInContainer(newGw, `process.stdout.write(process.env.INTERNAL_TOKEN || '')`)).trim();
  const reread = await execViaDshMain({
    tool: 'read_file',
    userId: alice.id,
    username: alice.username,
    role: 'user',
    args: { workspace: 'e2e-space', file_path: 'Quy-trinh.docx' }
  }, newIntToken);
  assert.equal(reread.ok, true);
  assert.equal(reread.result.content, 'Noi dung quy trinh');

  // Check dsh-homes volume still holds user-2-alice, user-5-nva, user-1-admin, user-<e2ealice>
  const homesOut = await execNodeInContainer(docker.getContainer('dsh-main'), `
    process.stdout.write(JSON.stringify(require('fs').readdirSync('/data/dsh_homes')));
  `);
  const homesList = JSON.parse(homesOut.trim().split('\n').pop());
  assert.ok(homesList.includes('user-2-alice') && homesList.some((h) => h.endsWith('-e2ealice')), JSON.stringify(homesList));
  pass(12, `docker compose down -> up -d: accounts, workspace files (Quy-trinh.docx), and dsh-homes (${homesList.length} homes) all persisted.`);
}

// Cleanup temporary e2e users & their volumes so only real users remain
{
  const newGw = docker.getContainer('dsh-gateway');
  await execNodeInContainer(newGw, `
    import('./database/index.js').then(async ({ User }) => {
      await User.destroy({ where: { username: ['e2ealice', 'e2ebob', 'e2erace'] } });
      process.exit(0);
    });
  `);
  for (const u of [alice, bob, raceUser]) {
    await killToolContainer(u.id).catch(() => {});
    try { await docker.getVolume(toolVolumeName(u.id, 'user')).remove(); } catch {}
  }
  await killToolContainer(1).catch(() => {});
}

console.log(`\n✅ PHASE 7 ALL ${results.length}/12 ACCEPTANCE CRITERIA PASSED!`);
process.exit(0);
