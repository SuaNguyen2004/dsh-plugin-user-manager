import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert';
import { keyPool } from '../../lib/admin/key-pool.js';
import { setupModelCredentialsGuard, runWithAdminPrivileges, registerModelManagementRoutes, readProvidersFromPatch } from '../../lib/admin/model-guard.js';
import { getNativeInjectionMarkup } from '../../lib/ui/ui-injection.js';
import { initDatabase, closeDatabase, createUser, approveUser, findUserByUsername } from '../../lib/common/db.js';
import { createSession } from '../../lib/common/db.js';
import { registerAuthRoutes } from '../../lib/common/auth.js';

// Setup isolated environment for model-guard test so production DB, YAML, and pools are never touched
const TEST_ROOT = path.resolve(import.meta.dirname, '../../.tmp-test-suite/model-guard-test');
if (!fs.existsSync(TEST_ROOT)) {
  fs.mkdirSync(TEST_ROOT, { recursive: true });
}
const TEST_DB_PATH = path.join(TEST_ROOT, 'test_users.db');
const TEST_POOLS_PATH = path.join(TEST_ROOT, 'test_key_pools.json');
const TEST_DSH_HOME = path.join(TEST_ROOT, 'dsh_home');

process.env.USERS_DB_PATH = TEST_DB_PATH;
process.env.DSH_HOME = TEST_DSH_HOME;
process.env.DSH_KEY_POOLS_FILE = TEST_POOLS_PATH;

// Setup test patch file in TEST_DSH_HOME
const testPatchDir = path.join(TEST_DSH_HOME, 'profiles', 'web');
if (!fs.existsSync(testPatchDir)) {
  fs.mkdirSync(testPatchDir, { recursive: true });
}
const realDshHome = path.join(process.env.USERPROFILE || 'C:\\Users\\Admin', '.dsh-multiuser');
const realPatchFile = path.join(realDshHome, 'profiles', 'web', 'cordis.patch.yml');
const srcPatchFile = path.resolve(import.meta.dirname, '../../cordis.patch.yml');
if (fs.existsSync(realPatchFile)) {
  fs.copyFileSync(realPatchFile, path.join(testPatchDir, 'cordis.patch.yml'));
} else if (fs.existsSync(srcPatchFile)) {
  fs.copyFileSync(srcPatchFile, path.join(testPatchDir, 'cordis.patch.yml'));
}

// Reset keyPool to test file
keyPool.customFilePath = TEST_POOLS_PATH;
keyPool.pools.clear();
keyPool.currentIndices.clear();
keyPool.initialized = false;

class MockWebServer {
  constructor() {
    this.routes = [];
    this.server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);

      const matched = this.routes.find(r => {
        if (r.kind === 'exact') return r.path === url.pathname;
        if (r.kind === 'prefix') return url.pathname.startsWith(r.path);
        return false;
      });

      if (matched) {
        matched.handler(req, res);
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not Found' }));
      }
    });
  }

  register(route) {
    this.routes.push(route);
  }

  listen(port) {
    return new Promise((resolve) => {
      this.server.listen(port, '127.0.0.1', () => resolve());
    });
  }

  close() {
    return new Promise((resolve) => {
      this.server.close(() => resolve());
    });
  }
}

async function request(port, method, path, data = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const postData = data ? JSON.stringify(data) : null;
    const reqHeaders = { ...headers };
    if (postData) {
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(postData);
    }

    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: reqHeaders
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(body);
        } catch {
          json = body;
        }
        resolve({ status: res.statusCode, data: json, headers: res.headers });
      });
    });

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function runTests() {
  console.log('--- TEST 1: setupModelCredentialsGuard Direct Access Checks ---');
  const mockStorage = new Map();
  const mockCredentials = {
    async set(ref, val) {
      mockStorage.set(ref, val);
      return { success: true };
    },
    async unset(ref) {
      mockStorage.delete(ref);
      return { success: true };
    }
  };

  const mockCtx = { credentials: mockCredentials };
  setupModelCredentialsGuard(mockCtx);

  // Non-admin direct set attempt must be blocked
  let setBlocked = false;
  try {
    await mockCtx.credentials.set('HACKED_KEY', 'stolen-token');
  } catch (err) {
    setBlocked = true;
    assert(err.message.includes('Chỉ Quản trị viên (Admin) mới có quyền'), 'Unexpected error message');
  }
  assert.strictEqual(setBlocked, true, 'Non-admin credentials.set must throw error');
  assert.strictEqual(mockStorage.has('HACKED_KEY'), false, 'Credential must not be set');

  // Non-admin direct unset attempt must be blocked
  let unsetBlocked = false;
  try {
    await mockCtx.credentials.unset('GEMINI_API_KEY');
  } catch (err) {
    unsetBlocked = true;
    assert(err.message.includes('Chỉ Quản trị viên (Admin) mới có quyền'), 'Unexpected error message');
  }
  assert.strictEqual(unsetBlocked, true, 'Non-admin credentials.unset must throw error');

  // Authorized Admin scope set attempt must succeed
  await runWithAdminPrivileges(async () => {
    await mockCtx.credentials.set('GEMINI_API_KEY', 'valid-admin-gemini-key');
  });
  assert.strictEqual(mockStorage.get('GEMINI_API_KEY'), 'valid-admin-gemini-key', 'Admin set must succeed');

  // Authorized Admin scope unset attempt must succeed
  await runWithAdminPrivileges(async () => {
    await mockCtx.credentials.unset('GEMINI_API_KEY');
  });
  assert.strictEqual(mockStorage.has('GEMINI_API_KEY'), false, 'Admin unset must succeed');
  console.log('✅ TEST 1 PASSED: Model & Credentials Guard blocks direct non-admin alterations and permits admin.');

  console.log('--- TEST 2: REST API Authentication & Role Authorization ---');
  await initDatabase(TEST_DB_PATH);

  // Create a regular test user and an admin user
  const regularUsername = 'user_model_test_' + Date.now();
  await createUser(regularUsername, 'hash123', 'user', 0);
  await approveUser(regularUsername);

  const regularUser = await findUserByUsername(regularUsername);
  assert(regularUser, 'Regular user must exist in DB');
  const regularToken = createSession(regularUser.id).token;

  const adminUsername = 'admin';
  const adminUser = await findUserByUsername(adminUsername);
  assert(adminUser, 'Admin user must exist in DB');
  const adminToken = createSession(adminUser.id).token;

  const webServer = new MockWebServer();
  registerAuthRoutes(webServer);
  registerModelManagementRoutes(webServer, mockCtx);

  const port = process.env.TEST_PORT || 34158;
  await webServer.listen(port);

  try {
    // 2.1: Unauthenticated request to /api/admin/models/config -> 401
    const unauthConfig = await request(port, 'GET', '/api/admin/models/config');
    assert.strictEqual(unauthConfig.status, 401, 'Unauthenticated config request must return 401');

    // 2.2: Regular user request to /api/admin/models/config -> 403
    const regularConfig = await request(port, 'GET', '/api/admin/models/config', null, {
      'Authorization': `Bearer ${regularToken}`
    });
    assert.strictEqual(regularConfig.status, 403, 'Regular user config request must return 403');
    assert(regularConfig.data.error.includes('Yêu cầu quyền Quản trị viên'), 'Must indicate admin required');

    // 2.3: Regular user POST to /api/admin/models/key -> 403
    const regularKeyPost = await request(port, 'POST', '/api/admin/models/key', {
      ref: 'OPENROUTER_API_KEY',
      value: 'sk-user-test'
    }, {
      'Authorization': `Bearer ${regularToken}`
    });
    assert.strictEqual(regularKeyPost.status, 403, 'Regular user key update must return 403');

    // 2.4: Regular user POST to /api/admin/models/delete-key -> 403
    const regularKeyDelete = await request(port, 'POST', '/api/admin/models/delete-key', {
      ref: 'OPENROUTER_API_KEY'
    }, {
      'Authorization': `Bearer ${regularToken}`
    });
    assert.strictEqual(regularKeyDelete.status, 403, 'Regular user key delete must return 403');

    // 2.5: Admin request to /api/admin/models/config -> 200
    const adminConfig = await request(port, 'GET', '/api/admin/models/config', null, {
      'Authorization': `Bearer ${adminToken}`
    });
    assert.strictEqual(adminConfig.status, 200, 'Admin config request must return 200');
    assert.strictEqual(adminConfig.data.success, true);
    assert.strictEqual(adminConfig.data.sharedMode, true);
    assert.strictEqual(adminConfig.data.managedByAdmin, true);
    assert(Array.isArray(adminConfig.data.providers), 'Providers must be an array');
    console.log(`   Found ${adminConfig.data.providers.length} providers in patch configuration.`);

    // Check that keys are masked in response (never leak raw keys)
    for (const p of adminConfig.data.providers) {
      if (p.isConfigured) {
        assert(p.maskedKey.includes('••••••••'), `Masked key for ${p.id} must be masked`);
        assert(!p.maskedKey.includes('sk-mock-raw-key-placeholder'), 'Raw key must not be exposed');
      }
    }

    // 2.6: Admin POST to /api/admin/models/key with missing data -> 400
    const badKeyReq = await request(port, 'POST', '/api/admin/models/key', {
      ref: ''
    }, {
      'Authorization': `Bearer ${adminToken}`
    });
    assert.strictEqual(badKeyReq.status, 400, 'Empty ref must return 400');

    // 2.7: Admin POST to /api/admin/models/key with valid data -> 200
    const updateKeyReq = await request(port, 'POST', '/api/admin/models/key', {
      ref: 'GEMINI_API_KEY',
      value: 'AQ.TestAdminUpdatedKey1234567890'
    }, {
      'Authorization': `Bearer ${adminToken}`
    });
    assert.strictEqual(updateKeyReq.status, 200, 'Valid key update by admin must return 200');
    assert.strictEqual(updateKeyReq.data.success, true);
    assert.strictEqual(mockStorage.get('GEMINI_API_KEY'), 'AQ.TestAdminUpdatedKey1234567890');
    assert(updateKeyReq.data.maskedKey.includes('••••••••'), 'Returned masked key must be masked');

    // 2.8: Admin POST to /api/admin/models/delete-key -> 200
    const deleteKeyReq = await request(port, 'POST', '/api/admin/models/delete-key', {
      ref: 'GEMINI_API_KEY'
    }, {
      'Authorization': `Bearer ${adminToken}`
    });
    assert.strictEqual(deleteKeyReq.status, 200, 'Key delete by admin must return 200');
    assert.strictEqual(deleteKeyReq.data.success, true);
    assert.strictEqual(mockStorage.has('GEMINI_API_KEY'), false);

    // 2.9: Admin POST to /api/admin/models/remove-key (single key delete)
    await request(port, 'POST', '/api/admin/models/key', {
      ref: 'TEST_SINGLE_REF',
      value: 'key1\nkey2\nkey3'
    }, { 'Authorization': `Bearer ${adminToken}` });

    const removeSingleReq = await request(port, 'POST', '/api/admin/models/remove-key', {
      ref: 'TEST_SINGLE_REF',
      index: 1
    }, {
      'Authorization': `Bearer ${adminToken}`
    });
    assert.strictEqual(removeSingleReq.status, 200, 'Remove single key must return 200');
    assert.strictEqual(removeSingleReq.data.poolSummary.total, 2, 'Remaining keys must be 2');

    // 2.10: Regular user POST to /api/admin/models/remove-key -> 403
    const forbiddenRemove = await request(port, 'POST', '/api/admin/models/remove-key', {
      ref: 'TEST_SINGLE_REF',
      index: 0
    }, {
      'Authorization': `Bearer ${regularToken}`
    });
    assert.strictEqual(forbiddenRemove.status, 403, 'Regular user remove-key must return 403');

    // 2.11: Admin POST to /api/admin/models/delete-provider -> 200
    const delProviderReq = await request(port, 'POST', '/api/admin/models/delete-provider', {
      providerId: 'test_fake_prov',
      apiKeyEnv: 'TEST_SINGLE_REF'
    }, {
      'Authorization': `Bearer ${adminToken}`
    });
    assert.strictEqual(delProviderReq.status, 200, 'Delete provider by admin must return 200');
    assert.strictEqual(delProviderReq.data.success, true);

    // 2.12: Admin POST to /api/admin/models/key with mode: 'append'
    const appendKeyReq = await request(port, 'POST', '/api/admin/models/key', {
      ref: 'TEST_APPEND_ENDPOINT_REF',
      value: 'seed_key1'
    }, { 'Authorization': `Bearer ${adminToken}` });
    assert.strictEqual(appendKeyReq.status, 200);
    assert.strictEqual(appendKeyReq.data.poolSummary.total, 1);

    const appendMoreReq = await request(port, 'POST', '/api/admin/models/key', {
      ref: 'TEST_APPEND_ENDPOINT_REF',
      value: 'seed_key2\nseed_key3',
      mode: 'append'
    }, { 'Authorization': `Bearer ${adminToken}` });
    assert.strictEqual(appendMoreReq.status, 200);
    assert.strictEqual(appendMoreReq.data.poolSummary.total, 3, 'Must append without overwriting previous keys');

    console.log('✅ TEST 2 PASSED: REST API enforces 401 for unauth, 403 for regular users, 200 with masked keys for Admin.');
  } finally {
    await webServer.close();
    try {
      const db = (await import('../../lib/common/db.js')).getDb();
      if (regularUser) {
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(regularUser.id);
        db.prepare('DELETE FROM users WHERE id = ?').run(regularUser.id);
      }
      const fsModule = await import('node:fs');
      const pathModule = await import('node:path');
      const wsDir = pathModule.join('workspaces', regularUsername);
      if (fsModule.existsSync(wsDir)) {
        fsModule.rmSync(wsDir, { recursive: true, force: true });
      }
      closeDatabase();
    } catch (_) {}
  }

  console.log('--- TEST 3: UI Injection Verification for Model Management ---');
  const markup = getNativeInjectionMarkup();
  assert(markup.includes('dsh-um-tab-models'), 'Markup must include Models tab button');
  assert(markup.includes('dsh-um-models-container'), 'Markup must include Models container');
  assert(markup.includes('body.dsh-um-role-user [class*="addModelButton"]'), 'Markup must include CSS hiding addModelButton for regular users');
  assert(markup.includes('dshUmLoadModelsConfig'), 'Markup must include client loader function');
  assert(markup.includes('dshUmSaveApiKey'), 'Markup must include client save key function');
  assert(markup.includes('dshUmDeleteApiKey'), 'Markup must include client delete key function');
  console.log('✅ TEST 3 PASSED: Native UI markup includes Admin tab, provider management controls, and regular user CSS restrictions.');

  console.log('\n========================================');
  console.log('🎉 ALL MODEL GUARD & MANAGEMENT TESTS PASSED!');
  console.log('========================================');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
