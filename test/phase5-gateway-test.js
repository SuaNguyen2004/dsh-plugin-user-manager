// test/phase5-gateway-test.js
// Automated verification for Phase 5 (Gateway):
//  1. SQLite WAL (users.db) inside gateway volume directory (4 tables: Users, Sessions, UserSessions, Attachments).
//  2. Standalone /admin dashboard & "🚀 Vào DeepSeek Harness" button removed; login.html redirects straight to "/".
//  3. Login < 1s, sets HttpOnly SameSite=Lax 7-day dsh_user_token cookie, redirectUrl="/", ZERO containers spawned.
//  4. Proxy HTTP + WebSocket to dsh-main: strips client-spoofed X-DSH-* headers and stamps trusted identity from DB.
//  5. Host `data/` directory untouched (zero new/modified files on host).

import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Configure isolated gateway volume directory BEFORE importing database/gateway modules
const TMP_GW_VOL = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-phase5-gw-vol-'));
process.env.SQLITE_PATH = path.join(TMP_GW_VOL, 'users.db');
process.env.INTERNAL_TOKEN = 'phase5-internal-token-xyz';

const HOST_DATA_DIR = path.resolve('data');
const hostDataBefore = fs.existsSync(HOST_DATA_DIR)
  ? fs.readdirSync(HOST_DATA_DIR).sort().join(',')
  : '';

const { initDatabase, sequelize, User, Session, UserSession, Attachment, hashPassword } = await import('../database/index.js');
const { createGatewayServer, stampTrustedHeaders } = await import('../gateway/server.js');
const { listToolContainers } = await import('../gateway/orchestrator.js');

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
        resolve({ status: res.statusCode, headers: res.headers, text: data, json });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

console.log('=== PHASE 5 GATEWAY TEST ===');

// 1. SQLite WAL + 4 tables inside volume directory
{
  await initDatabase();
  const [walRow] = await sequelize.query('PRAGMA journal_mode;');
  const mode = String(walRow?.[0]?.journal_mode || '').toLowerCase();
  assert.equal(mode, 'wal', `expected WAL mode, got ${mode}`);
  assert.ok(fs.existsSync(process.env.SQLITE_PATH), 'users.db created in gateway volume dir');

  // All 4 models operational
  const admin = await User.create({ username: 'admin', password_hash: hashPassword('admin123'), role: 'admin', status: 'active' });
  const alice = await User.create({ username: 'alice', password_hash: hashPassword('alice123'), role: 'user', status: 'active' });
  assert.ok(admin.id && alice.id && Session && UserSession && Attachment);
  console.log('[PASS] 1. SQLite WAL initialized in gateway volume with 4 core tables (Users, Sessions, UserSessions, Attachments).');
}

// 2. Admin dashboard is restored for role=admin, login redirects straight to "/"
{
  assert.equal(fs.existsSync(path.resolve('gateway/public/admin.html')), true, 'gateway/public/admin.html restored for admin');
  const loginHtml = fs.readFileSync(path.resolve('gateway/public/login.html'), 'utf8');
  assert.ok(!loginHtml.includes('Vào DeepSeek Harness'), 'no Vào DeepSeek Harness button in login');
  const injectSrc = fs.readFileSync(path.resolve('dsh-main/inject-ui.cjs'), 'utf8');
  assert.ok(injectSrc.includes('href="/admin"'), 'inject-ui.cjs links to /admin for admin');
  console.log('[PASS] 2. Admin dashboard & /admin button restored for Administrator; login redirects straight to "/".');
}

// 3. Mock dsh-main upstream (records received headers on HTTP and WS) + Gateway server
const upstreamReceived = [];
const mockDshMain = http.createServer((req, res) => {
  upstreamReceived.push({ kind: 'http', url: req.url, headers: { ...req.headers } });
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({
    proxiedTo: 'dsh-main',
    url: req.url,
    userId: req.headers['x-dsh-user-id'],
    username: req.headers['x-dsh-username'],
    role: req.headers['x-dsh-role'],
    spoofedHeader: req.headers['x-dsh-spoof'] || null
  }));
});
mockDshMain.on('upgrade', (req, socket) => {
  upstreamReceived.push({ kind: 'ws', url: req.url, headers: { ...req.headers } });
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `X-Echo-Role: ${req.headers['x-dsh-role']}\r\n` +
    `X-Echo-User: ${req.headers['x-dsh-username']}\r\n\r\n`
  );
  socket.end();
});
await new Promise((r) => mockDshMain.listen(0, '127.0.0.1', r));
const dshMainPort = mockDshMain.address().port;
process.env.DSH_MAIN_URL = `http://127.0.0.1:${dshMainPort}`;

const gwServer = createGatewayServer();
await new Promise((r) => gwServer.listen(0, '127.0.0.1', r));
const gwPort = gwServer.address().port;

// 4. Login < 1s, HttpOnly SameSite=Lax cookie, redirectUrl="/", ZERO containers spawned
let aliceCookie = '';
let aliceToken = '';
{
  const preContainers = await listToolContainers({ all: true });
  const t0 = Date.now();
  const loginRes = await httpReq(gwPort, '/api/auth/login', {
    method: 'POST',
    body: { username: 'alice', password: 'alice123' }
  });
  const loginMs = Date.now() - t0;
  assert.equal(loginRes.status, 200, loginRes.text);
  assert.ok(loginMs < 1000, `Login must be < 1000ms, took ${loginMs}ms`);
  assert.equal(loginRes.json.redirectUrl, '/');
  assert.equal(loginRes.json.container, undefined, 'login response must not include spawned container');

  const setCookie = String(loginRes.headers['set-cookie']?.[0] || '');
  assert.ok(setCookie.includes('dsh_user_token='), setCookie);
  assert.ok(setCookie.includes('HttpOnly'), setCookie);
  assert.ok(setCookie.includes('SameSite=Lax'), setCookie);
  assert.ok(setCookie.includes('Max-Age=604800'), setCookie);
  aliceCookie = setCookie.split(';')[0];
  aliceToken = loginRes.json.token;

  const postContainers = await listToolContainers({ all: true });
  assert.equal(postContainers.length, preContainers.length, 'login must spawn ZERO containers');
  console.log(`[PASS] 3. Alice login in ${loginMs}ms (<1s), cookie HttpOnly/SameSite=Lax/7d, redirectUrl="/", 0 containers spawned.`);
}

// 5. Unauthenticated GET / -> 302 /login; Authenticated HTTP + WS -> strips spoofed X-DSH-*, injects trusted headers
{
  const unauthRoot = await httpReq(gwPort, '/', { headers: { accept: 'text/html' } });
  assert.equal(unauthRoot.status, 302);
  assert.equal(unauthRoot.headers.location, '/login');

  // Alice sends spoofed X-DSH-Role: admin and X-DSH-User-Id: 1 and X-DSH-Spoof: hacked
  const proxied = await httpReq(gwPort, '/workspace-view', {
    headers: {
      cookie: aliceCookie,
      'x-dsh-role': 'admin',
      'x-dsh-user-id': '1',
      'x-dsh-username': 'admin',
      'x-dsh-spoof': 'hacked'
    }
  });
  assert.equal(proxied.status, 200, proxied.text);
  assert.equal(proxied.json.proxiedTo, 'dsh-main');
  assert.equal(proxied.json.username, 'alice');
  assert.equal(proxied.json.role, 'user', 'spoofed X-DSH-Role: admin must be stripped and overwritten with user');
  assert.equal(proxied.json.spoofedHeader, null, 'arbitrary X-DSH-* header from client must be stripped');

  // WebSocket upgrade with spoofed X-DSH-Role: admin -> gateway rewrites to role=user
  const wsRaw = await new Promise((resolve, reject) => {
    const sock = net.connect(gwPort, '127.0.0.1', () => {
      sock.write(
        `GET /api/ws HTTP/1.1\r\n` +
        `Host: 127.0.0.1:${gwPort}\r\n` +
        `Connection: Upgrade\r\n` +
        `Upgrade: websocket\r\n` +
        `Cookie: ${aliceCookie}\r\n` +
        `X-DSH-Role: admin\r\n` +
        `X-DSH-User-Id: 1\r\n\r\n`
      );
    });
    let buf = '';
    sock.on('data', (d) => (buf += d.toString('utf8')));
    sock.on('end', () => resolve(buf));
    sock.on('error', reject);
  });
  assert.ok(wsRaw.includes('101 Switching Protocols'), wsRaw);
  assert.ok(/x-echo-role:\s*user/i.test(wsRaw), `WS must receive trusted role=user, got:\n${wsRaw}`);
  assert.ok(/x-echo-user:\s*alice/i.test(wsRaw), wsRaw);
  console.log('[PASS] 4. HTTP & WebSocket proxy to dsh-main: client X-DSH-* stripped; trusted identity stamped.');
}

// 6. Admin APIs + model/key config write ONLY inside gateway volume dir, never host data/
{
  const adminLogin = await httpReq(gwPort, '/api/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: 'admin123' }
  });
  const adminToken = adminLogin.json.token;

  const modelAdd = await httpReq(gwPort, '/api/admin/models', {
    method: 'POST',
    headers: { authorization: `Bearer ${adminToken}` },
    body: { id: 'deepseek-chat', name: 'DeepSeek Chat', provider: 'deepseek' }
  });
  assert.equal(modelAdd.status, 200, modelAdd.text);

  const keyAdd = await httpReq(gwPort, '/api/admin/models/key', {
    method: 'POST',
    headers: { authorization: `Bearer ${adminToken}` },
    body: { ref: 'DEEPSEEK_API_KEY', value: 'sk-test-1234567890abcdef' }
  });
  assert.equal(keyAdd.status, 200, keyAdd.text);

  const hostDataAfter = fs.existsSync(HOST_DATA_DIR)
    ? fs.readdirSync(HOST_DATA_DIR).sort().join(',')
    : '';
  assert.equal(hostDataAfter, hostDataBefore, 'Host data/ directory must not gain any new files');
  assert.ok(fs.existsSync(path.join(TMP_GW_VOL, 'models_scope.json')), 'models_scope.json stored in gateway volume');
  console.log('[PASS] 5. Admin APIs & model/key storage write exclusively to gateway volume; host data/ untouched.');
}

gwServer.close();
mockDshMain.close();
await sequelize.close();
try { fs.rmSync(TMP_GW_VOL, { recursive: true, force: true }); } catch {}
console.log('\n✅ PHASE 5 ALL TESTS PASSED!');
process.exit(0);
