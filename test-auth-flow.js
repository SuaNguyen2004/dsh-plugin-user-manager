import http from 'node:http';
import { getDb } from './lib/db.js';

function request(options, data = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: body
        });
      });
    });
    req.on('error', reject);
    if (data) {
      req.write(typeof data === 'string' ? data : JSON.stringify(data));
    }
    req.end();
  });
}

async function runTests() {
  console.log('--- STARTING MULTI-USER AUTH & WORKSPACE VALIDATION ---');
  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`[PASS] ${message}`);
      passed++;
    } else {
      console.error(`[FAIL] ${message}`);
      failed++;
    }
  }

  // Test 1: Unauthenticated visit to root / must 302 redirect to /login
  try {
    const res1 = await request({
      hostname: '127.0.0.1',
      port: 3088,
      path: '/',
      method: 'GET'
    });
    assert(res1.statusCode === 302, `Unauthenticated GET / returns 302 (got ${res1.statusCode})`);
    assert(res1.headers.location === '/login', `Redirect location is /login (got ${res1.headers.location})`);
  } catch (e) {
    assert(false, `Test 1 failed: ${e.message}`);
  }

  // Test 2: GET /login must return 200 and serve HTML
  try {
    const res2 = await request({
      hostname: '127.0.0.1',
      port: 3088,
      path: '/login',
      method: 'GET'
    });
    assert(res2.statusCode === 200, `GET /login returns 200 (got ${res2.statusCode})`);
    assert(res2.body.includes('DeepSeek Harness'), 'GET /login contains "DeepSeek Harness"');
    assert(res2.body.includes('form-login'), 'GET /login contains login form');
  } catch (e) {
    assert(false, `Test 2 failed: ${e.message}`);
  }

  // Test 3: POST /api/auth/login with invalid credentials returns 401
  try {
    const res3 = await request({
      hostname: '127.0.0.1',
      port: 3088,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { username: 'admin', password: 'wrongpassword' });
    assert(res3.statusCode === 401, `Invalid login returns 401 (got ${res3.statusCode})`);
  } catch (e) {
    assert(false, `Test 3 failed: ${e.message}`);
  }

  // Test 4: Register new user test_user_flow
  const testUser = 'test_flow_' + Math.random().toString(36).substring(2, 7);
  try {
    const res4 = await request({
      hostname: '127.0.0.1',
      port: 3088,
      path: '/api/auth/register',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { username: testUser, password: 'password123' });
    assert(res4.statusCode === 201, `Register returns 201 Created (got ${res4.statusCode})`);
    const data4 = JSON.parse(res4.body);
    assert(data4.user && data4.user.status === 'pending', 'New registered user is pending approval');
  } catch (e) {
    assert(false, `Test 4 failed: ${e.message}`);
  }

  // Test 5: Pending user login is blocked with 403
  try {
    const res5 = await request({
      hostname: '127.0.0.1',
      port: 3088,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { username: testUser, password: 'password123' });
    assert(res5.statusCode === 403, `Pending user login blocked with 403 (got ${res5.statusCode})`);
  } catch (e) {
    assert(false, `Test 5 failed: ${e.message}`);
  }

  // Test 6: Admin login succeeds with token
  let adminToken = '';
  try {
    const res6 = await request({
      hostname: '127.0.0.1',
      port: 3088,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { username: 'admin', password: 'admin123' });
    assert(res6.statusCode === 200, `Admin login returns 200 OK (got ${res6.statusCode})`);
    const data6 = JSON.parse(res6.body);
    adminToken = data6.token;
    assert(!!adminToken, 'Admin token returned');
    assert(res6.headers['set-cookie'] && res6.headers['set-cookie'].some(c => c.includes('dsh_user_token=')), 'Set-Cookie contains dsh_user_token');
  } catch (e) {
    assert(false, `Test 6 failed: ${e.message}`);
  }

  // Test 7: Admin pending-users lists pending user
  try {
    const res7 = await request({
      hostname: '127.0.0.1',
      port: 3088,
      path: '/api/admin/pending-users',
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + adminToken }
    });
    assert(res7.statusCode === 200, `Admin pending-users returns 200 (got ${res7.statusCode})`);
    const data7 = JSON.parse(res7.body);
    const hasUser = data7.pending_users && data7.pending_users.some(u => u.username === testUser);
    assert(hasUser, `Pending list contains ${testUser}`);
  } catch (e) {
    assert(false, `Test 7 failed: ${e.message}`);
  }

  // Test 8: Admin approve user
  try {
    const res8 = await request({
      hostname: '127.0.0.1',
      port: 3088,
      path: '/api/admin/approve-user',
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + adminToken, 'Content-Type': 'application/json' }
    }, { username: testUser });
    assert(res8.statusCode === 200, `Admin approve-user returns 200 (got ${res8.statusCode})`);
  } catch (e) {
    assert(false, `Test 8 failed: ${e.message}`);
  }

  // Test 9: Approved user can now log in
  let testUserToken = '';
  try {
    const res9 = await request({
      hostname: '127.0.0.1',
      port: 3088,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { username: testUser, password: 'password123' });
    assert(res9.statusCode === 200, `Approved user login returns 200 OK (got ${res9.statusCode})`);
    const data9 = JSON.parse(res9.body);
    testUserToken = data9.token;
    assert(!!testUserToken, 'User token returned');
  } catch (e) {
    assert(false, `Test 9 failed: ${e.message}`);
  }

  // Test 10: Authenticated request to / with cookie returns 200
  try {
    const res10 = await request({
      hostname: '127.0.0.1',
      port: 3088,
      path: '/',
      method: 'GET',
      headers: { 'Cookie': `dsh_user_token=${testUserToken}` }
    });
    assert(res10.statusCode === 200, `Authenticated GET / returns 200 index.html (got ${res10.statusCode})`);
  } catch (e) {
    assert(false, `Test 10 failed: ${e.message}`);
  }

  // Test 11: Cleanup test user
  try {
    const res11 = await request({
      hostname: '127.0.0.1',
      port: 3088,
      path: '/api/admin/reject-user',
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + adminToken, 'Content-Type': 'application/json' }
    }, { username: testUser });
    assert(res11.statusCode === 200, `Admin reject/clean user returns 200 (got ${res11.statusCode})`);
    try {
      getDb().prepare('DELETE FROM users WHERE username = ?').run(testUser);
    } catch (err) {}
  } catch (e) {
    assert(false, `Test 11 failed: ${e.message}`);
  }

  // Test 12: Verify user accounts nvs and nva exist and are active
  try {
    const { findUserByUsername } = await import('./lib/db.js');
    const uNvs = findUserByUsername('nvs');
    const uNva = findUserByUsername('nva');
    assert(uNvs && uNvs.status === 'active', 'User nvs exists and is active');
    assert(uNva && uNva.status === 'active', 'User nva exists and is active');
  } catch (e) {
    assert(false, `Test 12 failed: ${e.message}`);
  }

  // Test 13: Verify that no guest workspaces or files exist
  try {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const wsDir = path.resolve('workspaces');
    const wsFolders = fs.readdirSync(wsDir);
    const hasGuest = wsFolders.some(f => f.toLowerCase().includes('guest'));
    assert(!hasGuest, 'No guest folders exist in workspaces/ (found: ' + wsFolders.join(', ') + ')');

    const wsJson = JSON.parse(fs.readFileSync('C:\\Users\\Admin\\.dsh-multiuser\\storages\\workspace.json', 'utf8'));
    const wsJsonIds = Object.keys(wsJson.tables.workspaces);
    const hasGuestJson = wsJsonIds.some(id => id.toLowerCase().includes('guest'));
    assert(!hasGuestJson, 'No guest entries exist in workspace.json (found: ' + wsJsonIds.join(', ') + ')');
  } catch (e) {
    assert(false, `Test 13 failed: ${e.message}`);
  }

  console.log(`\n========================================`);
  console.log(`RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log(`========================================\n`);

  process.exit(failed > 0 ? 1 : 0);
}

runTests();
