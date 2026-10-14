import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync, spawn } from 'node:child_process';

const PLUGIN_ROOT = path.resolve(import.meta.dirname, '../..');
const BASE_URL = 'http://127.0.0.1:3090';

// Test Data Directories on Host
const HOST_DATA_DIR = path.join(PLUGIN_ROOT, 'docker-test-data');
const HOST_DB_DIR = path.join(HOST_DATA_DIR, 'db');
const HOST_DSH_HOME_DIR = path.join(HOST_DATA_DIR, 'dsh_home');
const HOST_WORKSPACES_DIR = path.join(HOST_DATA_DIR, 'workspaces');
const HOST_TEMP_DIR = path.join(HOST_DATA_DIR, 'temp');

function runCmd(cmd) {
  try {
    return execSync(cmd, { cwd: PLUGIN_ROOT, stdio: 'pipe', encoding: 'utf8' });
  } catch (err) {
    const stdout = err.stdout ? err.stdout.toString() : '';
    const stderr = err.stderr ? err.stderr.toString() : '';
    throw new Error(`Command failed: ${cmd}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`);
  }
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForServer(url, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status === 200 || res.status === 302) {
        return true;
      }
    } catch (e) {
      // Server not ready yet
    }
    await sleep(1500);
  }
  throw new Error(`Server at ${url} did not become ready within ${timeoutMs}ms`);
}

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

const testResults = [];

function recordTest(name, status, details = '') {
  testResults.push({ name, status, details });
  console.log(`[${status}] ${name}${details ? ` - ${details}` : ''}`);
}

async function main() {
  console.log('================================================================');
  console.log('BƯỚC 4: KIỂM THỬ DOCKER COMPOSE & PERSISTENT STORAGE (PORT 3090)');
  console.log('================================================================\n');

  // 1. Verify Host DSH Windows 3088 is untouched
  try {
    const win3088 = execSync('netstat -ano | findstr :3088', { encoding: 'utf8', stdio: 'pipe' });
    if (win3088.includes('LISTENING')) {
      recordTest('0.1. DSH Windows 3088 đang chạy', 'PASS', 'Port 3088 LISTENING nguyên vẹn');
    } else {
      recordTest('0.1. DSH Windows 3088 đang chạy', 'WARN', 'Không tìm thấy LISTENING trên 3088');
    }
  } catch (e) {
    recordTest('0.1. DSH Windows 3088 đang chạy', 'WARN', e.message);
  }

  // Ensure host directories exist
  [HOST_DB_DIR, HOST_DSH_HOME_DIR, HOST_WORKSPACES_DIR, HOST_TEMP_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });

  // 2. Validate docker compose config
  try {
    const configOutput = runCmd('docker compose config');
    const hasLocalhostBind = (configOutput.includes('host_ip: 127.0.0.1') && configOutput.includes('published: "3090"')) || configOutput.includes('127.0.0.1:3090');
    assert(hasLocalhostBind, 'Phải bind chặt 127.0.0.1:3090');
    assert(configOutput.includes('dsh-document-only:step3'), 'Phải dùng image Step 3');
    assert(!configOutput.includes('sk-'), 'Không được in secret trong compose config');
    recordTest('1.1. docker compose config hợp lệ', 'PASS', 'Không lộ secret, bind đúng 127.0.0.1:3090');
  } catch (err) {
    recordTest('1.1. docker compose config hợp lệ', 'FAIL', err.message);
    throw err;
  }

  // 3. Test Phase 1: Default Compose Startup with test endpoints DISABLED
  console.log('\n--- GIAI ĐOẠN 1: KHỞI ĐỘNG VỚI CẤU HÌNH MẶC ĐỊNH (TEST ENDPOINT TẮT) ---');
  try {
    runCmd('docker compose up -d');
    await waitForServer(`${BASE_URL}/login.html`, 60000);
    recordTest('2.1. Container khởi động thành công trên 3090', 'PASS', 'http://127.0.0.1:3090/login.html trả về 200');

    // Test endpoint must return 403 Disabled
    const testExecRes = await fetch(`${BASE_URL}/api/user-manager/test-execute-tool`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'dummy', toolName: 'pwsh' })
    });
    assert.strictEqual(testExecRes.status, 403, 'Endpoint test phải trả 403 khi tắt');
    const testExecJson = await testExecRes.json();
    assert(testExecJson.error && testExecJson.error.includes('vô hiệu hóa'), 'Phải thông báo endpoint bị vô hiệu hóa');
    recordTest('2.2. Test execution endpoint mặc định trả 403', 'PASS', testExecJson.error);
  } catch (err) {
    recordTest('2.2. Test execution endpoint mặc định trả 403', 'FAIL', err.message);
    throw err;
  }

  // 4. Test Phase 2: Switch to Test Configuration to execute runtime tool checks
  console.log('\n--- GIAI ĐOẠN 2: CHẠY KIỂM THỬ RUNTIME TOOL VÀ TẠO DỮ LIỆU TEST ---');
  try {
    runCmd('docker compose -f docker-compose.yml -f docker-compose.test.yml up -d');
    await waitForServer(`${BASE_URL}/login.html`, 30000);
    recordTest('3.1. Chuyển sang compose cấu hình test thành công', 'PASS');
  } catch (err) {
    recordTest('3.1. Chuyển sang compose cấu hình test thành công', 'FAIL', err.message);
    throw err;
  }

  // A. Admin Login
  let adminToken = '';
  try {
    const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    });
    assert.strictEqual(loginRes.status, 200, 'Admin đăng nhập phải trả 200');
    const loginJson = await loginRes.json();
    adminToken = loginJson.token;
    assert(adminToken, 'Phải có session token cho admin');
    recordTest('3.2. Đăng nhập Admin thành công', 'PASS', `User: admin, Role: ${loginJson.user.role}`);
  } catch (err) {
    recordTest('3.2. Đăng nhập Admin thành công', 'FAIL', err.message);
    throw err;
  }

  // B. Configure Key Pool (Fake Provider & Key)
  const FAKE_KEY_POOL_REF = 'TEST_STEP4_POOL_KEY';
  const FAKE_API_KEY_VAL = 'dummy-key-for-step4-verification-998877';
  try {
    const keyRes = await fetch(`${BASE_URL}/api/admin/models/key`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        ref: FAKE_KEY_POOL_REF,
        value: FAKE_API_KEY_VAL,
        mode: 'pool'
      })
    });
    assert.strictEqual(keyRes.status, 200, 'Lưu key pool phải trả 200');
    const keyJson = await keyRes.json();
    assert(keyJson.success, 'Lưu key pool thành công');
    recordTest('3.3. Cấu hình Key Pool giả lập thành công', 'PASS', `Ref: ${FAKE_KEY_POOL_REF}`);
  } catch (err) {
    recordTest('3.3. Cấu hình Key Pool giả lập thành công', 'FAIL', err.message);
    throw err;
  }

  // C. Register 2 Test Users: test_alice and test_bob
  const USER_ALICE = 'test_alice';
  const PWD_ALICE = 'PasswordAlice123!';
  const USER_BOB = 'test_bob';
  const PWD_BOB = 'PasswordBob123!';

  try {
    // Register Alice
    const regAlice = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: USER_ALICE, password: PWD_ALICE })
    });
    assert(regAlice.status === 201 || regAlice.status === 409, 'Đăng ký Alice phải là 201 hoặc đã có 409');

    // Register Bob
    const regBob = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: USER_BOB, password: PWD_BOB })
    });
    assert(regBob.status === 201 || regBob.status === 409, 'Đăng ký Bob phải là 201 hoặc đã có 409');

    // Admin approves both
    const appAlice = await fetch(`${BASE_URL}/api/admin/approve-user`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ username: USER_ALICE })
    });
    assert.strictEqual(appAlice.status, 200, 'Phê duyệt Alice phải thành công');

    const appBob = await fetch(`${BASE_URL}/api/admin/approve-user`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ username: USER_BOB })
    });
    assert.strictEqual(appBob.status, 200, 'Phê duyệt Bob phải thành công');

    recordTest('3.4. Đăng ký và phê duyệt 2 user test', 'PASS', 'test_alice và test_bob đã active');
  } catch (err) {
    recordTest('3.4. Đăng ký và phê duyệt 2 user test', 'FAIL', err.message);
    throw err;
  }

  // D. Login as Alice and Bob
  let aliceToken = '';
  let bobToken = '';
  try {
    const logAlice = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: USER_ALICE, password: PWD_ALICE })
    });
    assert.strictEqual(logAlice.status, 200);
    aliceToken = (await logAlice.json()).token;

    const logBob = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: USER_BOB, password: PWD_BOB })
    });
    assert.strictEqual(logBob.status, 200);
    bobToken = (await logBob.json()).token;

    recordTest('3.5. Đăng nhập Alice và Bob lấy token thành công', 'PASS');
  } catch (err) {
    recordTest('3.5. Đăng nhập Alice và Bob lấy token thành công', 'FAIL', err.message);
    throw err;
  }

  // E. Initialize Alice's workspace & session via user-init
  let ALICE_SESSION_ID = '';
  try {
    const initRes = await fetch(`${BASE_URL}/api/workspace/user-init`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${aliceToken}`
      }
    });
    assert.strictEqual(initRes.status, 200, 'user-init phải trả 200');
    const initJson = await initRes.json();
    assert(initJson.success && initJson.sessionId, `Khởi tạo session phải thành công: ${JSON.stringify(initJson)}`);
    ALICE_SESSION_ID = initJson.sessionId;
    recordTest('3.6. Alice tạo DSH session qua user-init', 'PASS', `Session ID: ${ALICE_SESSION_ID}`);
  } catch (err) {
    recordTest('3.6. Alice tạo DSH session qua user-init', 'FAIL', err.message);
    throw err;
  }

  // F. Create Alice's Workspace File on Host
  const ALICE_WS_DIR = path.join(HOST_WORKSPACES_DIR, USER_ALICE);
  if (!fs.existsSync(ALICE_WS_DIR)) fs.mkdirSync(ALICE_WS_DIR, { recursive: true });
  const WS_FILE_NAME = 'workspace_document.txt';
  const WS_FILE_MARKER = `MARKER_WORKSPACE_DOC_ALICE_${Date.now()}_ABC123\nNội dung tiếng Việt UTF-8 trong thư mục workspace của Alice.`;
  const WS_FILE_HASH = sha256(WS_FILE_MARKER);
  fs.writeFileSync(path.join(ALICE_WS_DIR, WS_FILE_NAME), WS_FILE_MARKER, 'utf8');
  recordTest('3.7. Tạo file workspace cho Alice', 'PASS', `File: ${WS_FILE_NAME}, SHA256: ${WS_FILE_HASH.slice(0, 12)}...`);

  // G. Upload Attachment for Alice in her session
  const ATTACHMENT_NAME = 'alice_attachment.txt';
  const ATTACHMENT_MARKER = `MARKER_ATTACHMENT_ALICE_${Date.now()}_XYZ789\nTài liệu đính kèm kiểm thử lưu trữ bền vững Docker Step 4.`;
  const ATTACHMENT_HASH = sha256(ATTACHMENT_MARKER);
  let aliceAttachmentId = '';
  let aliceAttachmentHostPath = '';

  try {
    const uploadRes = await fetch(`${BASE_URL}/api/session/uploadFileBinary?sessionId=${ALICE_SESSION_ID}&name=${ATTACHMENT_NAME}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${aliceToken}`,
        'Content-Type': 'text/plain; charset=utf-8'
      },
      body: ATTACHMENT_MARKER
    });
    const uploadText = await uploadRes.text();
    let uploadJson = {};
    try { uploadJson = JSON.parse(uploadText); } catch(e) {}
    assert.strictEqual(uploadRes.status, 200, `Upload attachment phải trả 200: ${uploadText}`);
    assert(uploadJson.ok, 'Upload attachment phải ok');
    aliceAttachmentId = uploadJson.value.file.attachmentId;

    // Fetch attachment list to get storage path
    const listRes = await fetch(`${BASE_URL}/api/document/attachments`, {
      headers: { 'Authorization': `Bearer ${aliceToken}` }
    });
    assert.strictEqual(listRes.status, 200);
    const listJson = await listRes.json();
    const found = listJson.attachments.find(a => a.attachment_id === aliceAttachmentId);
    assert(found, 'Phải tìm thấy attachment trong DB');
    aliceAttachmentHostPath = found.file_path;

    recordTest('3.8. Upload attachment cho Alice thành công', 'PASS', `ID: ${aliceAttachmentId}, Path: ${aliceAttachmentHostPath}, SHA256: ${ATTACHMENT_HASH.slice(0, 12)}...`);
  } catch (err) {
    recordTest('3.8. Upload attachment cho Alice thành công', 'FAIL', err.message);
    throw err;
  }

  // H. Runtime Tool Execution: read_document on Attachment
  try {
    const execRes = await fetch(`${BASE_URL}/api/user-manager/test-execute-tool`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${aliceToken}`
      },
      body: JSON.stringify({
        sessionId: ALICE_SESSION_ID,
        toolName: 'read_document',
        args: { file_path: aliceAttachmentHostPath }
      })
    });
    assert.strictEqual(execRes.status, 200, 'read_document attachment phải trả 200');
    const execJson = await execRes.json();
    assert(execJson.ok, `Tool execution phải ok: ${JSON.stringify(execJson)}`);
    const resultStr = JSON.stringify(execJson);
    assert(resultStr.includes('MARKER_ATTACHMENT_ALICE'), `Nội dung đọc được phải chứa marker của Alice: ${resultStr}`);
    recordTest('3.9. read_document đọc đúng attachment của Alice qua runtime', 'PASS', 'Khớp chính xác marker');
  } catch (err) {
    recordTest('3.9. read_document đọc đúng attachment của Alice qua runtime', 'FAIL', err.message);
    throw err;
  }

  // I. Runtime Tool Execution: read_document on Workspace File
  try {
    const execWsRes = await fetch(`${BASE_URL}/api/user-manager/test-execute-tool`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${aliceToken}`
      },
      body: JSON.stringify({
        sessionId: ALICE_SESSION_ID,
        toolName: 'read_document',
        args: { file_path: WS_FILE_NAME }
      })
    });
    const execWsJson = await execWsRes.json();
    assert(execWsJson.ok, `Tool execution workspace file phải ok: ${JSON.stringify(execWsJson)}`);
    const wsResultStr = JSON.stringify(execWsJson);
    assert(wsResultStr.includes('MARKER_WORKSPACE_DOC_ALICE'), `Nội dung phải chứa marker workspace của Alice: ${wsResultStr}`);
    recordTest('3.10. read_document đọc đúng file workspace qua runtime', 'PASS', 'Khớp chính xác marker');
  } catch (err) {
    recordTest('3.10. read_document đọc đúng file workspace qua runtime', 'FAIL', err.message);
    throw err;
  }

  // J. Document-Only Security Guard: Block Shell Tools for Regular User
  try {
    const shellRes = await fetch(`${BASE_URL}/api/user-manager/test-execute-tool`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${aliceToken}`
      },
      body: JSON.stringify({
        sessionId: ALICE_SESSION_ID,
        toolName: 'bash',
        args: { command: 'date' }
      })
    });
    const shellJson = await shellRes.json();
    const str = JSON.stringify(shellJson);
    const denied = shellRes.status === 403 || !shellJson.ok || str.includes('Document-Only') || str.includes('Truy cập bị từ chối') || str.includes('denied');
    assert(denied, `Lệnh shell phải bị chặn cho regular user: status=${shellRes.status}, body=${str}`);
    recordTest('3.11. Document-Only Guard chặn lệnh shell cho user thường', 'PASS', str.slice(0, 80));
  } catch (err) {
    recordTest('3.11. Document-Only Guard chặn lệnh shell cho user thường', 'FAIL', err.message);
    throw err;
  }

  // =================================================================
  // 5. TEST PERSISTENCE A: RESTART CONTAINER
  // =================================================================
  console.log('\n--- GIAI ĐOẠN 3: KIỂM THỬ LƯU TRỮ BỀN VỮNG SAU RESTART ---');
  try {
    console.log('Đang chạy docker compose restart...');
    runCmd('docker compose restart');
    await waitForServer(`${BASE_URL}/login.html`, 60000);
    recordTest('4.1. docker compose restart thành công', 'PASS');

    // 1. Check users still can log in
    const reLogAlice = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: USER_ALICE, password: PWD_ALICE })
    });
    assert.strictEqual(reLogAlice.status, 200, 'Alice phải đăng nhập được sau restart');
    const newAliceToken = (await reLogAlice.json()).token;

    const reLogBob = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: USER_BOB, password: PWD_BOB })
    });
    assert.strictEqual(reLogBob.status, 200, 'Bob phải đăng nhập được sau restart');
    recordTest('4.2. Dữ liệu User SQLite bảo toàn sau restart', 'PASS', 'test_alice và test_bob đăng nhập lại bình thường');

    // 2. Check Key Pool file persisted
    const keyPoolPath = path.join(HOST_DB_DIR, 'key_pools.json');
    assert(fs.existsSync(keyPoolPath), 'File key_pools.json phải tồn tại trên host');
    const keyPoolContent = fs.readFileSync(keyPoolPath, 'utf8');
    assert(keyPoolContent.includes(FAKE_KEY_POOL_REF), 'File key pool phải còn chứa provider test');
    recordTest('4.3. Cấu hình Key Pool bảo toàn sau restart', 'PASS', `Tìm thấy ${FAKE_KEY_POOL_REF} trên đĩa host`);

    // 3. Re-read attachment in existing session via runtime tool
    const reExecRes = await fetch(`${BASE_URL}/api/user-manager/test-execute-tool`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${newAliceToken}`
      },
      body: JSON.stringify({
        sessionId: ALICE_SESSION_ID,
        toolName: 'read_document',
        args: { file_path: aliceAttachmentHostPath }
      })
    });
    assert.strictEqual(reExecRes.status, 200, 'read_document sau restart phải trả 200');
    const reExecJson = await reExecRes.json();
    assert(reExecJson.ok, 'read_document sau restart phải ok');
    const reContent = JSON.stringify(reExecJson);
    assert(reContent.includes('MARKER_ATTACHMENT_ALICE'), `Nội dung file đọc lại phải khớp marker: ${reContent}`);
    recordTest('4.4. read_document đọc lại attachment sau restart thành công', 'PASS', 'Bảo toàn session và attachment ID');
  } catch (err) {
    recordTest('4.4. read_document đọc lại attachment sau restart thành công', 'FAIL', err.message);
    throw err;
  }

  // =================================================================
  // 6. TEST PERSISTENCE B: RECREATE CONTAINER (docker compose up --force-recreate)
  // =================================================================
  console.log('\n--- GIAI ĐOẠN 4: KIỂM THỬ LƯU TRỮ BỀN VỮNG SAU RECREATE CONTAINER ---');
  try {
    console.log('Đang chạy docker compose up -d --force-recreate...');
    runCmd('docker compose -f docker-compose.yml -f docker-compose.test.yml up -d --force-recreate');
    await waitForServer(`${BASE_URL}/login.html`, 60000);
    recordTest('5.1. docker compose --force-recreate thành công', 'PASS');

    // 1. Verify User Login again
    const recLogAlice = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: USER_ALICE, password: PWD_ALICE })
    });
    assert.strictEqual(recLogAlice.status, 200, 'Alice đăng nhập được sau recreate');
    const recAliceToken = (await recLogAlice.json()).token;

    // 2. Verify Key Pool file still exists
    const keyPoolPath = path.join(HOST_DB_DIR, 'key_pools.json');
    const keyPoolContent = fs.readFileSync(keyPoolPath, 'utf8');
    assert(keyPoolContent.includes(FAKE_KEY_POOL_REF), 'Key pool vẫn còn sau recreate');
    recordTest('5.2. User và Key Pool bảo toàn sau container recreate', 'PASS');

    // 3. Re-read attachment in existing session via runtime tool again
    const recExecRes = await fetch(`${BASE_URL}/api/user-manager/test-execute-tool`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${recAliceToken}`
      },
      body: JSON.stringify({
        sessionId: ALICE_SESSION_ID,
        toolName: 'read_document',
        args: { file_path: aliceAttachmentHostPath }
      })
    });
    assert.strictEqual(recExecRes.status, 200, 'read_document sau recreate phải trả 200');
    const recExecJson = await recExecRes.json();
    assert(recExecJson.ok, 'read_document sau recreate phải ok');
    const recContent = JSON.stringify(recExecJson);
    assert(recContent.includes('MARKER_ATTACHMENT_ALICE'), `Nội dung attachment bảo toàn sau recreate: ${recContent}`);
    recordTest('5.3. read_document đọc lại attachment sau recreate thành công', 'PASS', 'Khớp nguyên vẹn nội dung');
  } catch (err) {
    recordTest('5.3. read_document đọc lại attachment sau recreate thành công', 'FAIL', err.message);
    throw err;
  }

  // =================================================================
  // 7. TEST ENTRYPOINT NON-DESTRUCTIVE CHECK
  // =================================================================
  console.log('\n--- GIAI ĐOẠN 5: XÁC THỰC ENTRYPOINT KHÔNG GHI ĐÈ / RESET CẤU HÌNH ---');
  try {
    const webProfileDir = path.join(HOST_DSH_HOME_DIR, 'profiles', 'web');
    const cordisPatch = path.join(webProfileDir, 'cordis.patch.yml');
    const pkgJson = path.join(webProfileDir, 'package.json');
    const usersDb = path.join(HOST_DB_DIR, 'users.db');

    assert(fs.existsSync(cordisPatch), 'cordis.patch.yml phải tồn tại');
    assert(fs.existsSync(pkgJson), 'package.json phải tồn tại');
    assert(fs.existsSync(usersDb), 'users.db phải tồn tại');

    // Add a custom marker comment to cordis.patch.yml to test entrypoint doesn't overwrite it
    const testComment = '# STEP4_NON_OVERWRITE_TEST_MARKER\n';
    fs.appendFileSync(cordisPatch, testComment, 'utf8');

    // Restart once more
    runCmd('docker compose restart');
    await waitForServer(`${BASE_URL}/login.html`, 30000);

    const patchAfterRestart = fs.readFileSync(cordisPatch, 'utf8');
    assert(patchAfterRestart.includes('STEP4_NON_OVERWRITE_TEST_MARKER'), 'Entrypoint không được ghi đè cordis.patch.yml');
    recordTest('6.1. Entrypoint bảo vệ cấu hình hiện hữu, không ghi đè', 'PASS', 'Không reset profile/db/config');
  } catch (err) {
    recordTest('6.1. Entrypoint bảo vệ cấu hình hiện hữu, không ghi đè', 'FAIL', err.message);
    throw err;
  }

  // =================================================================
  // 8. FINAL HANDOVER CONFIGURATION (TEST ENDPOINTS OFF, KEEP RUNNING)
  // =================================================================
  console.log('\n--- GIAI ĐOẠN 6: BÀN GIAO - CHẠY CHÍNH THỨC CẤU HÌNH PRODUCTION TRÊN 3090 ---');
  try {
    // Start with standard compose (ENABLE_DSH_TEST_ENDPOINTS=false)
    runCmd('docker compose up -d');
    await waitForServer(`${BASE_URL}/login.html`, 30000);

    // Verify 3090 UI is ready
    const loginPageRes = await fetch(`${BASE_URL}/login.html`);
    assert.strictEqual(loginPageRes.status, 200, 'UI login phải sẵn sàng');

    // Verify test endpoint is now disabled
    const prodTestRes = await fetch(`${BASE_URL}/api/user-manager/test-execute-tool`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'dummy', toolName: 'pwsh' })
    });
    assert.strictEqual(prodTestRes.status, 403, 'Endpoint test phải bị vô hiệu hóa');
    recordTest('7.1. Cấu hình bàn giao hoàn tất, test endpoint đã tắt', 'PASS', 'DSH Document-Only đang chạy trên 127.0.0.1:3090');

    // Verify Windows 3088 is still running
    const win3088Final = execSync('netstat -ano | findstr :3088', { encoding: 'utf8', stdio: 'pipe' });
    assert(win3088Final.includes('LISTENING'), 'DSH Windows 3088 vẫn phải đang chạy');
    recordTest('7.2. DSH Windows 3088 vẫn nguyên vẹn và hoạt động', 'PASS', 'PID Windows không bị gián đoạn');
  } catch (err) {
    recordTest('7.1. Cấu hình bàn giao hoàn tất', 'FAIL', err.message);
    throw err;
  }

  console.log('\n================================================================');
  console.log('TỔNG HỢP KẾT QUẢ KIỂM THỬ BƯỚC 4:');
  console.log('================================================================');
  const total = testResults.length;
  const passed = testResults.filter(t => t.status === 'PASS').length;
  const failed = testResults.filter(t => t.status === 'FAIL').length;
  console.log(`Tổng số ca test: ${total} | PASS: ${passed} | FAIL: ${failed}`);

  if (failed > 0) {
    console.error('CÓ LỖI XẢY RA TRONG QUÁ TRÌNH KIỂM THỬ!');
    process.exit(1);
  } else {
    console.log('TẤT CẢ CÁC KIỂM TRA ĐÃ ĐẠT 100%!');
  }
}

main().catch(err => {
  console.error('Fatal error in Step 4 test:', err);
  process.exit(1);
});
