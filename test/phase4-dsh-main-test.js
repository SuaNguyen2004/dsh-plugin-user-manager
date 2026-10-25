// test/phase4-dsh-main-test.js
// Automated verification for Phase 4 (dsh-main):
//  1. Shared Brain router (:3090): 401 without trusted X-DSH-User-Id; per-tenant child process
//     lazy-spawned with isolated DSH_HOME=/data/dsh_homes/user-<id>-<name>; idle sweep keeps home.
//  2. Login / visiting DSH / pure chat spawns ZERO dsh-tool-* containers.
//  3. Profile scaffolding disables local fs/bash/pwsh/search rows in cordis.patch.yml.
//  4. Remote tool hook (lib/index.js + lib/exec-client.js) routes write/read/edit/list_dir/bash/
//     read_document/search_files through Gateway /internal/exec -> lazy-spawns dsh-tool-<username>
//     -> files land at /data/<username>/<ws>/files/<category>/<file>.
//  5. Role-scoped tools & UI injection: user hides Models tab and has no admin_* tools;
//     admin registers admin_* tools and injects "KHU VỰC GIÁM SÁT (READ-ONLY)".
//  6. Admin Read-Only monitoring syncs other users' workspaces & sessions from dsh-homes volume
//     and marks foreign sessions read-only (session/read-only protection).

import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

import {
  homeDirFor, identityFrom, ensureHomeProfile, createRouterHandler,
  _setChildFactory, listChildren, sweepIdleChildren
} from '../dsh-main/router.js';
import { syncContainerWorkspace, isReadOnlyUserSession } from '../dsh-main/lib/user/workspace.js';
import { createInternalHandler } from '../gateway/exec-router.js';
import { killToolContainer, listToolContainers, toolVolumeName, docker } from '../gateway/orchestrator.js';

const require = createRequire(import.meta.url);
const { injectIntoHtml } = require('../dsh-main/inject-ui.cjs');

const TMP_HOMES = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-phase4-homes-')).replace(/\\/g, '/');
process.env.DSH_HOMES_ROOT = TMP_HOMES;
process.env.DSH_PLUGIN_DIR = path.resolve('dsh-main').replace(/\\/g, '/');

const INT_TOKEN = 'phase4-internal-token-secret';
const USERS = [
  { id: 901, username: 'alice', role: 'user', status: 'active' },
  { id: 902, username: 'bob', role: 'user', status: 'active' },
  { id: 900, username: 'admin', role: 'admin', status: 'active' }
];

async function cleanupDocker() {
  for (const u of USERS) {
    try { await killToolContainer(u.id); } catch {}
    if (u.role !== 'admin') {
      try { await docker.getVolume(toolVolumeName(u.id, u.role)).remove(); } catch {}
    }
  }
}

function httpReq(port, reqPath, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: reqPath,
      method,
      headers: payload
        ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload), ...headers }
        : headers
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch {}
        resolve({ status: res.statusCode, text: data, json });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

console.log('=== PHASE 4 DSH-MAIN MULTI-TENANT + TOOL HOOK TEST ===');
await cleanupDocker();

// 1. Router auth + multi-tenant child isolation + zero tool containers on visit/chat
{
  const childServers = [];
  _setChildFactory(({ userId, username, role, port }) => {
    const home = `${TMP_HOMES}/user-${userId}-${username}`;
    ensureHomeProfile(home, { userId, username, role });
    const srv = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ tenant: username, userId, role, home, url: req.url }));
    });
    const ready = new Promise((r) => srv.listen(port, '127.0.0.1', r));
    childServers.push(srv);
    return { port, home, ready, close: () => srv.close() };
  });

  const routerHandler = createRouterHandler({
    lookupUser: async (id) => USERS.find((u) => String(u.id) === String(id)) || null
  });
  const routerSrv = http.createServer(routerHandler);
  await new Promise((r) => routerSrv.listen(0, '127.0.0.1', r));
  const rPort = routerSrv.address().port;

  // Direct hit without X-DSH-User-Id -> 401
  const unauth = await httpReq(rPort, '/');
  assert.equal(unauth.status, 401);
  assert.equal(unauth.json?.code, 'UNAUTHENTICATED');

  // Healthz works without auth
  const hz = await httpReq(rPort, '/healthz');
  assert.equal(hz.status, 200);
  assert.equal(hz.json?.status, 'healthy');

  // Alice and Bob concurrently hit dsh-main -> routed to distinct homes & child ports
  const [aliceRes, bobRes] = await Promise.all([
    httpReq(rPort, '/chat', { headers: { 'x-dsh-user-id': '901', 'x-dsh-username': 'alice', 'x-dsh-role': 'user' } }),
    httpReq(rPort, '/chat', { headers: { 'x-dsh-user-id': '902', 'x-dsh-username': 'bob', 'x-dsh-role': 'user' } })
  ]);
  assert.equal(aliceRes.status, 200);
  assert.equal(bobRes.status, 200);
  assert.equal(aliceRes.json.tenant, 'alice');
  assert.equal(bobRes.json.tenant, 'bob');
  assert.notEqual(aliceRes.json.home, bobRes.json.home);
  assert.equal(listChildren().length, 2);

  // Visiting DSH / pure chat MUST NOT spawn any dsh-tool container
  const toolConts = (await listToolContainers({ all: true })).filter((c) => USERS.some((u) => String(u.id) === String(c.userId)));
  assert.equal(toolConts.length, 0, 'visiting dsh-main must not spawn any tool container');

  // Profile cordis.patch.yml disables local fs/bash/pwsh/search tools
  const patchYml = fs.readFileSync(`${aliceRes.json.home}/profiles/web/cordis.patch.yml`, 'utf8');
  for (const id of ['tool-fs', 'tool-fs-search', 'tool-bash', 'tool-pwsh']) {
    assert.ok(patchYml.includes(`- id: ${id}\n  disabled: true`), `expected ${id} disabled in cordis.patch.yml`);
  }

  // Idle sweep closes child processes but preserves DSH_HOME on disk
  const swept = sweepIdleChildren(Date.now() + 60 * 60 * 1000);
  assert.equal(swept.length, 2);
  assert.ok(fs.existsSync(aliceRes.json.home), 'alice DSH_HOME must survive child process sweep');

  routerSrv.close();
  for (const s of childServers) { try { s.close(); } catch {} }
  _setChildFactory(null);
  console.log('[PASS] 1. Router 401 unauth, multi-tenant child isolation, 0 tool containers on chat, local tools disabled.');
}

// 2. Role-scoped UI injection (user hides Models tab; admin shows KHU VỰC GIÁM SÁT (READ-ONLY))
{
  const baseHtml = '<!doctype html><html><head></head><body><div id="app"></div></body></html>';
  const userHtml = injectIntoHtml(baseHtml, { username: 'alice', role: 'user' });
  const adminHtml = injectIntoHtml(baseHtml, { username: 'admin', role: 'admin' });

  assert.ok(userHtml.includes('[data-key="models"]'), 'user UI must hide models tab');
  assert.ok(!userHtml.includes('KHU VỰC GIÁM SÁT (READ-ONLY)'), 'user UI must not include admin monitoring script');
  assert.ok(adminHtml.includes('KHU VỰC GIÁM SÁT (READ-ONLY)'), 'admin UI must include read-only monitoring section');
  assert.ok(adminHtml.includes('dsh-role-admin'), 'admin UI badge');
  console.log('[PASS] 2. Role-scoped UI injection: user hides Models tab; admin renders KHU VỰC GIÁM SÁT (READ-ONLY).');
}

// 3. Admin Read-Only workspace + session sync from /data/dsh_homes + session/read-only detection
{
  const aliceHome = `${TMP_HOMES}/user-901-alice`;
  const adminHome = `${TMP_HOMES}/user-900-admin`;

  // Seed Alice's workspace & session log inside her DSH_HOME
  process.env.DSH_HOME = aliceHome;
  process.env.DSH_USER_ID = '901';
  process.env.DSH_USER_NAME = 'alice';
  process.env.DSH_USER_ROLE = 'user';
  const aliceWsData = syncContainerWorkspace('alice', 'user');
  const aliceWsId = 'user-workspace-alice';
  const aliceSid = 'session-alice-ro-test-001';
  aliceWsData.tables.workspaces[aliceWsId].sessionIds.push(aliceSid);
  fs.writeFileSync(`${aliceHome}/storages/workspace.json`, JSON.stringify(aliceWsData, null, 2));

  const aliceSessionDir = `${aliceHome}/sessions/--data-workspace--/${aliceSid}`;
  fs.mkdirSync(aliceSessionDir, { recursive: true });
  fs.writeFileSync(`${aliceSessionDir}/session.v4.jsonl`, '{"id":"session-alice-ro-test-001"}\n');

  // Now sync Admin's workspace -> must import Alice's workspace + symlink session as RO
  process.env.DSH_HOME = adminHome;
  process.env.DSH_USER_ID = '900';
  process.env.DSH_USER_NAME = 'admin';
  process.env.DSH_USER_ROLE = 'admin';
  const adminWsData = syncContainerWorkspace('admin', 'admin');
  const roEntry = Object.entries(adminWsData.tables.workspaces).find(([k]) => k.startsWith('ro-alice-'));
  assert.ok(roEntry, 'Admin workspace.json must contain ro-alice-* entry');
  assert.ok(roEntry[1].title.endsWith('(alice)'), `Expected (alice) suffix, got ${roEntry[1].title}`);
  assert.ok(roEntry[1].sessionIds.includes(aliceSid), 'Admin RO workspace must include Alice sessionId');
  assert.equal(isReadOnlyUserSession(aliceSid, adminHome), true, 'Alice session must be detected as read-only for Admin');
  assert.equal(isReadOnlyUserSession('session-admin-own', adminHome), false, 'Admin own session is writable');
  console.log('[PASS] 3. Admin workspace sync imports Alice workspace "(alice)" & flags her session read-only.');
}

// 4. Remote Tool Hook end-to-end: plugin registers tools -> calls Gateway /internal/exec -> spawns dsh-tool-<user/admin>
{
  const gwHandler = createInternalHandler({
    internalToken: INT_TOKEN,
    lookupUser: async (id) => USERS.find((u) => String(u.id) === String(id)) || null
  });
  const gwServer = http.createServer(gwHandler);
  await new Promise((r) => gwServer.listen(0, '127.0.0.1', r));
  const gwPort = gwServer.address().port;

  process.env.GATEWAY_INTERNAL_URL = `http://127.0.0.1:${gwPort}`;
  process.env.INTERNAL_TOKEN = INT_TOKEN;
  process.env.DSH_USER_ID = '901';
  process.env.DSH_USER_NAME = 'alice';
  process.env.DSH_USER_ROLE = 'user';
  process.env.DSH_WORKSPACE = 'alice-space';
  process.env.DSH_HOME = `${TMP_HOMES}/user-901-alice`;

  // Dynamically import plugin with Alice's env and capture registered tools
  const registered = new Map();
  const fakeCtx = {
    tools: {
      register(def) { registered.set(def.name, def); return () => registered.delete(def.name); }
    },
    systemPrompt: {
      getSectionOrder: () => 50,
      section: () => {}
    },
    inject: () => {}
  };
  const pluginMod = await import(`../dsh-main/lib/index.js?t=${Date.now()}`);
  await pluginMod.apply(fakeCtx);

  assert.ok(registered.has('write') && registered.has('read') && registered.has('bash') && registered.has('read_document'));
  assert.ok(!registered.has('admin_list_user_workspaces'), 'user role must NOT register admin_* tools');

  // Still 0 tool containers before first tool.execute()!
  assert.equal((await listToolContainers({ all: true })).filter((c) => String(c.userId) === '901').length, 0, 'no container before first tool call');

  // Execute `write` tool -> lazy-spawns dsh-tool-alice and writes to /data/alice/alice-space/files/docs/plan.txt
  const writeOut = await registered.get('write').execute({ file_path: 'plan.txt', content: 'Phase 4 OK' });
  assert.ok(writeOut.path.endsWith('/data/alice/alice-space/files/docs/plan.txt'), JSON.stringify(writeOut));

  const aliceCont = (await listToolContainers({ all: true })).find((c) => String(c.userId) === '901');
  assert.ok(aliceCont && aliceCont.name === 'dsh-tool-alice', `expected dsh-tool-alice, got ${JSON.stringify(aliceCont)}`);

  // Execute `read` tool -> reads back from sandbox
  const readOut = await registered.get('read').execute({ file_path: 'plan.txt' });
  assert.equal(readOut.text, 'Phase 4 OK');

  // Execute `bash` tool -> runs inside sandbox workspace
  const bashOut = await registered.get('bash').execute({ command: 'pwd && ls files/docs' });
  assert.ok(bashOut.text.includes('/data/alice/alice-space') && bashOut.text.includes('plan.txt'), bashOut.text);

  gwServer.close();
  console.log('[PASS] 4. Remote tool hook: write/read/bash routed via /internal/exec -> dsh-tool-alice -> /data/alice/alice-space/files/docs/plan.txt.');
}

await cleanupDocker();
try { fs.rmSync(TMP_HOMES, { recursive: true, force: true }); } catch {}
console.log('\n✅ PHASE 4 ALL TESTS PASSED!');
process.exit(0);
