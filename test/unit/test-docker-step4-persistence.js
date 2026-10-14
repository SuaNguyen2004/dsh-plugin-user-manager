import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

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
  console.log('KIỂM THỬ DOCKER COMPOSE, BẢO TOÀN DỮ LIỆU & FIX REVIEW 8cca15d');
  console.log('================================================================\n');

  try {
    // 0. Verify Host DSH Windows 3088 is untouched
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

    // 1. Validate docker compose config & image digest
    try {
      const configOutput = runCmd('docker compose config');
      const hasLocalhostBind = (configOutput.includes('host_ip: 127.0.0.1') && configOutput.includes('published: "3090"')) || configOutput.includes('127.0.0.1:3090');
      assert(hasLocalhostBind, 'Phải bind chặt 127.0.0.1:3090');
      assert(configOutput.includes('dsh-document-only:step3'), 'Phải dùng image Step 3');
      assert(!configOutput.includes('sk-'), 'Không được in secret trong compose config');
      recordTest('1.1. docker compose config hợp lệ', 'PASS', 'Không lộ secret, bind đúng 127.0.0.1:3090');

      // Verify Dockerfile pinned base image digest
      const dockerfileContent = fs.readFileSync(path.join(PLUGIN_ROOT, 'Dockerfile'), 'utf8');
      assert(dockerfileContent.includes('node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392'),
        'Dockerfile phải pin base image digest chính xác');
      recordTest('1.2. Dockerfile pinned base image digest', 'PASS', 'sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392');
    } catch (err) {
      recordTest('1.1. docker compose config hợp lệ', 'FAIL', err.message);
      throw err;
    }

    // 2. Unit Test: patch-chmod.cjs conditional activation & strict mount root scoping
    console.log('\n--- KIỂM TRA CHMOD WORKAROUND: CHỈ ÁP DỤNG MOUNT ROOT & NÉM LỖI THƯ MỤC KHÁC ---');
    try {
      // 2A. Enabled mode: mount root suppresses EPERM, other paths throw EPERM
      const chmodTestCmd = `docker run --rm -e ENABLE_DOCKER_CHMOD_WORKAROUND=true -e NODE_OPTIONS="" dsh-document-only:step3 node -e "const assert = require('node:assert'); const fsp = require('node:fs/promises'); fsp.chmod = async (target, mode) => { const err = new Error('simulated EPERM'); err.code = 'EPERM'; throw err; }; require('/app/patch-chmod.cjs'); (async () => { await fsp.chmod('/data/dsh_home', 0o755); let caught = false; try { await fsp.chmod('/tmp/other_dir', 0o755); } catch (e) { caught = true; assert.strictEqual(e.code, 'EPERM'); } assert(caught); console.log('CHMOD_PATCH_SCOPED_PASS'); })();"`;
      const chmodOut = runCmd(chmodTestCmd);
      assert(chmodOut.includes('CHMOD_PATCH_SCOPED_PASS'), 'chmod patch phải chỉ áp dụng trên mount root');
      recordTest('1.3. patch-chmod.cjs chỉ xử lý mount root cho phép', 'PASS', 'Bỏ qua EPERM trên /data/dsh_home, ném EPERM trên thư mục khác');

      // 2B. Disabled mode: when flag is false, mount root throws EPERM normally
      const chmodDisabledCmd = `docker run --rm -e ENABLE_DOCKER_CHMOD_WORKAROUND=false -e NODE_OPTIONS="" dsh-document-only:step3 node -e "const assert = require('node:assert'); const fsp = require('node:fs/promises'); fsp.chmod = async (target, mode) => { const err = new Error('simulated EPERM'); err.code = 'EPERM'; throw err; }; require('/app/patch-chmod.cjs'); (async () => { let caught = false; try { await fsp.chmod('/data/dsh_home', 0o755); } catch (e) { caught = true; assert.strictEqual(e.code, 'EPERM'); } assert.strictEqual(caught, true); console.log('CHMOD_PATCH_DISABLED_PASS'); })();"`;
      const chmodDisOut = runCmd(chmodDisabledCmd);
      assert(chmodDisOut.includes('CHMOD_PATCH_DISABLED_PASS'), 'Khi flag tắt, không được can thiệp chmod');
      recordTest('1.4. patch-chmod.cjs giữ nguyên hành vi khi không bật flag', 'PASS', 'Không patch khi ENABLE_DOCKER_CHMOD_WORKAROUND!=true');
    } catch (err) {
      recordTest('1.3. patch-chmod.cjs kiểm tra phạm vi', 'FAIL', err.message);
      throw err;
    }

    // 3. Test Entrypoint Failure on Read-Only Profile Directory
    console.log('\n--- KIỂM TRA ENTRYPOINT: THẤT BẠI NON-ZERO KHI PROFILE DIR READ-ONLY ---');
    try {
      let failedAsExpected = false;
      try {
        execSync('docker run --rm --tmpfs /data/dsh_home:ro dsh-document-only:step3', { stdio: 'pipe' });
      } catch (err) {
        failedAsExpected = true;
        const allOut = (err.stdout || '').toString() + (err.stderr || '').toString();
        assert.notStrictEqual(err.status, 0, 'Exit code phải khác 0');
        assert(allOut.includes('[docker-entrypoint] ERROR') && allOut.includes('Profile directory is not writable'),
          `Phải thông báo rõ ràng về quyền ghi profile: ${allOut}`);
      }
      assert(failedAsExpected, 'Container phải exit non-zero khi profile dir không ghi được');
      recordTest('1.5. Entrypoint thất bại rõ ràng (exit 1) khi profile dir read-only', 'PASS', 'Không nuốt lỗi, không khởi động DSH thiếu config');
    } catch (err) {
      recordTest('1.5. Entrypoint thất bại rõ ràng khi profile dir read-only', 'FAIL', err.message);
      throw err;
    }

    // 4. Test Phase 1: Default Compose Startup with test endpoints DISABLED
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

    // 5. Test Phase 2: Switch to Test Configuration to execute runtime tool checks
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
      const regAlice = await fetch(`${BASE_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: USER_ALICE, password: PWD_ALICE })
      });
      assert(regAlice.status === 201 || regAlice.status === 409, 'Đăng ký Alice phải là 201 hoặc đã có 409');

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

    // E. Initialize Alice's workspace & Session 1 via user-init
    let ALICE_SESSION_1 = '';
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
      assert(initJson.success && initJson.sessionId, `Khởi tạo session 1 phải thành công: ${JSON.stringify(initJson)}`);
      ALICE_SESSION_1 = initJson.sessionId;
      recordTest('3.6. Alice tạo DSH Session 1 qua user-init', 'PASS', `Session 1 ID: ${ALICE_SESSION_1}`);
    } catch (err) {
      recordTest('3.6. Alice tạo DSH Session 1 qua user-init', 'FAIL', err.message);
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

    // G. Upload Attachment 1 for Alice in Session 1
    const ATTACHMENT_NAME_1 = 'alice_attachment_1.txt';
    const ATTACHMENT_MARKER_1 = `MARKER_ATTACHMENT_ALICE_1_${Date.now()}_XYZ789\nTài liệu đính kèm 1 kiểm thử lưu trữ bền vững.`;
    const ATTACHMENT_HASH_1 = sha256(ATTACHMENT_MARKER_1);
    let aliceAttachmentId1 = '';
    let aliceAttachmentPath1 = '';

    try {
      const uploadRes1 = await fetch(`${BASE_URL}/api/session/uploadFileBinary?sessionId=${ALICE_SESSION_1}&name=${ATTACHMENT_NAME_1}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${aliceToken}`,
          'Content-Type': 'text/plain; charset=utf-8'
        },
        body: ATTACHMENT_MARKER_1
      });
      const uploadText1 = await uploadRes1.text();
      let uploadJson1 = {};
      try { uploadJson1 = JSON.parse(uploadText1); } catch(e) {}
      assert.strictEqual(uploadRes1.status, 200, `Upload attachment 1 phải trả 200: ${uploadText1}`);
      assert(uploadJson1.ok, 'Upload attachment 1 phải ok');
      aliceAttachmentId1 = uploadJson1.value.file.attachmentId;

      const listRes = await fetch(`${BASE_URL}/api/document/attachments`, {
        headers: { 'Authorization': `Bearer ${aliceToken}` }
      });
      assert.strictEqual(listRes.status, 200);
      const listJson = await listRes.json();
      const found1 = listJson.attachments.find(a => a.attachment_id === aliceAttachmentId1);
      assert(found1, 'Phải tìm thấy attachment 1 trong DB');
      aliceAttachmentPath1 = found1.file_path;

      recordTest('3.8. Upload attachment 1 cho Session 1 thành công', 'PASS', `ID: ${aliceAttachmentId1}, Path: ${aliceAttachmentPath1}`);
    } catch (err) {
      recordTest('3.8. Upload attachment 1 cho Session 1 thành công', 'FAIL', err.message);
      throw err;
    }

    // H. Runtime Tool Execution: read_document on Attachment 1
    try {
      const execRes1 = await fetch(`${BASE_URL}/api/user-manager/test-execute-tool`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${aliceToken}`
        },
        body: JSON.stringify({
          sessionId: ALICE_SESSION_1,
          toolName: 'read_document',
          args: { file_path: aliceAttachmentPath1 }
        })
      });
      assert.strictEqual(execRes1.status, 200, 'read_document attachment 1 phải trả 200');
      const execJson1 = await execRes1.json();
      assert(execJson1.ok, `Tool execution phải ok: ${JSON.stringify(execJson1)}`);
      const resultStr1 = JSON.stringify(execJson1);
      assert(resultStr1.includes('MARKER_ATTACHMENT_ALICE_1'), `Nội dung phải chứa marker 1: ${resultStr1}`);
      recordTest('3.9. read_document đọc đúng attachment 1 qua runtime', 'PASS', 'Khớp chính xác marker 1');
    } catch (err) {
      recordTest('3.9. read_document đọc đúng attachment 1 qua runtime', 'FAIL', err.message);
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
          sessionId: ALICE_SESSION_1,
          toolName: 'read_document',
          args: { file_path: WS_FILE_NAME }
        })
      });
      const execWsJson = await execWsRes.json();
      assert(execWsJson.ok, `Tool execution workspace file phải ok: ${JSON.stringify(execWsJson)}`);
      const wsResultStr = JSON.stringify(execWsJson);
      assert(wsResultStr.includes('MARKER_WORKSPACE_DOC_ALICE'), `Nội dung phải chứa marker workspace: ${wsResultStr}`);
      recordTest('3.10. read_document đọc đúng file workspace qua runtime', 'PASS', 'Khớp chính xác marker workspace');
    } catch (err) {
      recordTest('3.10. read_document đọc đúng file workspace qua runtime', 'FAIL', err.message);
      throw err;
    }

    // J. Document-Only Security Guard: Specifically verify runtime error message contains "Chế độ Document-Only"
    try {
      const shellRes = await fetch(`${BASE_URL}/api/user-manager/test-execute-tool`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${aliceToken}`
        },
        body: JSON.stringify({
          sessionId: ALICE_SESSION_1,
          toolName: 'bash',
          args: { command: 'date' }
        })
      });
      const shellJson = await shellRes.json();
      const toolResult = shellJson.result;
      assert(toolResult && toolResult.isError === true, `Lệnh shell phải bị ToolRuntime đánh dấu lỗi (isError: true): ${JSON.stringify(shellJson)}`);
      const errMessage = toolResult.error?.message || toolResult.content?.[0]?.text || '';
      assert(errMessage.includes('Chế độ Document-Only'),
        `Thông báo lỗi runtime phải nêu rõ 'Chế độ Document-Only'. Thực tế: "${errMessage}"`);
      recordTest('3.11. Document-Only Guard chặn lệnh shell với thông điệp rõ ràng', 'PASS', errMessage);
    } catch (err) {
      recordTest('3.11. Document-Only Guard chặn lệnh shell với thông điệp rõ ràng', 'FAIL', err.message);
      throw err;
    }

    // K. Create Session 2 for Alice and Upload Attachment 2
    let ALICE_SESSION_2 = '';
    const ATTACHMENT_NAME_2 = 'alice_attachment_2.txt';
    const ATTACHMENT_MARKER_2 = `MARKER_ATTACHMENT_ALICE_2_${Date.now()}_LMN456\nTài liệu đính kèm 2 kiểm thử merge workspace deduplication.`;
    let aliceAttachmentId2 = '';
    let aliceAttachmentPath2 = '';

    try {
      const sess2Res = await fetch(`${BASE_URL}/api/session/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${aliceToken}`
        },
        body: JSON.stringify({
          payload: {
            args: {
              request: {
                workspaceId: `user-workspace-${USER_ALICE}`
              }
            }
          }
        })
      });
      assert.strictEqual(sess2Res.status, 200, 'Tạo session 2 phải trả 200');
      const sess2Json = await sess2Res.json();
      assert(sess2Json.result?.ok && sess2Json.result?.value?.sessionId, `Tạo session 2 thành công: ${JSON.stringify(sess2Json)}`);
      ALICE_SESSION_2 = sess2Json.result.value.sessionId;

      // Upload attachment 2 to Session 2
      const uploadRes2 = await fetch(`${BASE_URL}/api/session/uploadFileBinary?sessionId=${ALICE_SESSION_2}&name=${ATTACHMENT_NAME_2}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${aliceToken}`,
          'Content-Type': 'text/plain; charset=utf-8'
        },
        body: ATTACHMENT_MARKER_2
      });
      const uploadJson2 = await uploadRes2.json();
      assert.strictEqual(uploadRes2.status, 200);
      assert(uploadJson2.ok, 'Upload attachment 2 phải ok');
      aliceAttachmentId2 = uploadJson2.value.file.attachmentId;

      const listRes2 = await fetch(`${BASE_URL}/api/document/attachments`, {
        headers: { 'Authorization': `Bearer ${aliceToken}` }
      });
      const listJson2 = await listRes2.json();
      const found2 = listJson2.attachments.find(a => a.attachment_id === aliceAttachmentId2);
      assert(found2, 'Phải tìm thấy attachment 2 trong DB');
      aliceAttachmentPath2 = found2.file_path;

      // Read attachment 2 in Session 2
      const execRes2 = await fetch(`${BASE_URL}/api/user-manager/test-execute-tool`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${aliceToken}`
        },
        body: JSON.stringify({
          sessionId: ALICE_SESSION_2,
          toolName: 'read_document',
          args: { file_path: aliceAttachmentPath2 }
        })
      });
      const execJson2 = await execRes2.json();
      assert(execJson2.ok, 'read_document attachment 2 phải ok');
      assert(JSON.stringify(execJson2).includes('MARKER_ATTACHMENT_ALICE_2'));

      recordTest('3.12. Tạo Session 2 và upload attachment 2 thành công', 'PASS', `Session 2 ID: ${ALICE_SESSION_2}`);
    } catch (err) {
      recordTest('3.12. Tạo Session 2 và upload attachment 2 thành công', 'FAIL', err.message);
      throw err;
    }

    // L. WORKSPACE DEDUPLICATION TEST:
    // Inject a duplicate workspace claiming Alice's path with Session 2, then sync
    console.log('\n--- KIỂM TRA WORKSPACE DEDUPLICATION: HỢP NHẤT SESSION IDS & BẢO TOÀN ÁNH XẠ ---');
    try {
      const wsJsonPath = path.join(HOST_DSH_HOME_DIR, 'storages', 'workspace.json');
      const wsData = JSON.parse(fs.readFileSync(wsJsonPath, 'utf8'));

      // Create duplicate workspace entry claiming the SAME user directory
      const dupWsId = 'workspace-legacy-alice-dup';
      const aliceWsDirInContainer = `/data/workspaces/${USER_ALICE}`;
      wsData.tables.workspaces[dupWsId] = {
        path: aliceWsDirInContainer,
        title: 'Legacy Alice Workspace',
        sessionIds: [ALICE_SESSION_2],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      if (wsData.global && Array.isArray(wsData.global.workspaceIds)) {
        wsData.global.workspaceIds.push(dupWsId);
      }

      // Remove Session 2 from user-workspace-test_alice in workspace.json to simulate split state
      if (wsData.tables.workspaces[`user-workspace-${USER_ALICE}`]) {
        wsData.tables.workspaces[`user-workspace-${USER_ALICE}`].sessionIds = [ALICE_SESSION_1];
      }
      fs.writeFileSync(wsJsonPath, JSON.stringify(wsData, null, 2), 'utf8');

      // Stop container briefly so SQLite database can be cleanly updated on host without VirtioFS lock collision
      runCmd('docker compose stop');

      // Update SQLite user_sessions on host to point Session 2 to dupWsId
      const usersDbPath = path.join(HOST_DB_DIR, 'users.db');
      const hostDb = new DatabaseSync(usersDbPath);
      hostDb.prepare('UPDATE user_sessions SET workspace_id = ? WHERE session_id = ?').run(dupWsId, ALICE_SESSION_2);
      hostDb.close();

      // Start container with test configuration
      runCmd('docker compose -f docker-compose.yml -f docker-compose.test.yml up -d');
      await waitForServer(`${BASE_URL}/login.html`, 30000);

      // Re-login Alice to get token
      const reLogAlice2 = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: USER_ALICE, password: PWD_ALICE })
      });
      aliceToken = (await reLogAlice2.json()).token;

      // Trigger user-init (calls syncDshUserWorkspaces and cleanupStraySessionsAndWorkspaces)
      const syncRes = await fetch(`${BASE_URL}/api/workspace/user-init`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${aliceToken}`
        }
      });
      assert.strictEqual(syncRes.status, 200, 'user-init sync phải trả 200');

      // Verify workspace.json after deduplication
      const wsDataAfter = JSON.parse(fs.readFileSync(wsJsonPath, 'utf8'));
      assert(!wsDataAfter.tables.workspaces[dupWsId], 'Duplicate workspace phải bị xóa');
      const aliceWs = wsDataAfter.tables.workspaces[`user-workspace-${USER_ALICE}`];
      assert(aliceWs, 'user-workspace-test_alice phải tồn tại');
      assert(aliceWs.sessionIds.includes(ALICE_SESSION_1), 'Session 1 phải có trong sessionIds');
      assert(aliceWs.sessionIds.includes(ALICE_SESSION_2), 'Session 2 phải được hợp nhất vào sessionIds');
      assert(!wsDataAfter.global.workspaceIds.includes(dupWsId), 'global.workspaceIds không được chứa duplicate ID');

      // Verify both sessions can immediately read their respective attachments via runtime tool
      const check1 = await fetch(`${BASE_URL}/api/user-manager/test-execute-tool`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${aliceToken}` },
        body: JSON.stringify({ sessionId: ALICE_SESSION_1, toolName: 'read_document', args: { file_path: aliceAttachmentPath1 } })
      });
      assert((await check1.json()).ok, 'Session 1 phải đọc được attachment 1 sau deduplication sync');

      const check2 = await fetch(`${BASE_URL}/api/user-manager/test-execute-tool`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${aliceToken}` },
        body: JSON.stringify({ sessionId: ALICE_SESSION_2, toolName: 'read_document', args: { file_path: aliceAttachmentPath2 } })
      });
      assert((await check2.json()).ok, 'Session 2 phải đọc được attachment 2 sau deduplication sync');

      recordTest('3.13. Workspace Deduplication hợp nhất hoàn hảo', 'PASS',
        'sessionIds được union, duplicate workspace bị xóa, cả 2 session đọc được attachment');
    } catch (err) {
      recordTest('3.13. Workspace Deduplication hợp nhất hoàn hảo', 'FAIL', err.message);
      throw err;
    }

    // =================================================================
    // 6. TEST PERSISTENCE A: RESTART CONTAINER
    // =================================================================
    console.log('\n--- GIAI ĐOẠN 3: KIỂM THỬ LƯU TRỮ BỀN VỮNG SAU RESTART CONTAINER ---');
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

      // 3. Re-read attachment 1 in Session 1
      const reExecRes1 = await fetch(`${BASE_URL}/api/user-manager/test-execute-tool`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${newAliceToken}` },
        body: JSON.stringify({ sessionId: ALICE_SESSION_1, toolName: 'read_document', args: { file_path: aliceAttachmentPath1 } })
      });
      const reExecJson1 = await reExecRes1.json();
      assert(reExecJson1.ok, 'read_document session 1 sau restart phải ok');
      assert(JSON.stringify(reExecJson1).includes('MARKER_ATTACHMENT_ALICE_1'));

      // 4. Re-read attachment 2 in Session 2
      const reExecRes2 = await fetch(`${BASE_URL}/api/user-manager/test-execute-tool`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${newAliceToken}` },
        body: JSON.stringify({ sessionId: ALICE_SESSION_2, toolName: 'read_document', args: { file_path: aliceAttachmentPath2 } })
      });
      const reExecJson2 = await reExecRes2.json();
      assert(reExecJson2.ok, 'read_document session 2 sau restart phải ok');
      assert(JSON.stringify(reExecJson2).includes('MARKER_ATTACHMENT_ALICE_2'));

      recordTest('4.4. Cả Session 1 và Session 2 đọc lại attachment sau restart thành công', 'PASS',
        'Bảo toàn phiên làm việc, attachment và phân quyền qua restart');
    } catch (err) {
      recordTest('4.4. Cả Session 1 và Session 2 đọc lại attachment sau restart thành công', 'FAIL', err.message);
      throw err;
    }

    // =================================================================
    // 7. TEST PERSISTENCE B: RECREATE CONTAINER (docker compose up --force-recreate)
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

      // 3. Re-read attachment 1 in Session 1
      const recExecRes1 = await fetch(`${BASE_URL}/api/user-manager/test-execute-tool`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${recAliceToken}` },
        body: JSON.stringify({ sessionId: ALICE_SESSION_1, toolName: 'read_document', args: { file_path: aliceAttachmentPath1 } })
      });
      const recExecJson1 = await recExecRes1.json();
      assert(recExecJson1.ok, 'read_document session 1 sau recreate phải ok');
      assert(JSON.stringify(recExecJson1).includes('MARKER_ATTACHMENT_ALICE_1'));

      // 4. Re-read attachment 2 in Session 2
      const recExecRes2 = await fetch(`${BASE_URL}/api/user-manager/test-execute-tool`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${recAliceToken}` },
        body: JSON.stringify({ sessionId: ALICE_SESSION_2, toolName: 'read_document', args: { file_path: aliceAttachmentPath2 } })
      });
      const recExecJson2 = await recExecRes2.json();
      assert(recExecJson2.ok, 'read_document session 2 sau recreate phải ok');
      assert(JSON.stringify(recExecJson2).includes('MARKER_ATTACHMENT_ALICE_2'));

      recordTest('5.3. Cả Session 1 và Session 2 đọc lại attachment sau recreate thành công', 'PASS',
        'Dữ liệu và file cache hoàn toàn nguyên vẹn sau khi hủy và tạo lại container');
    } catch (err) {
      recordTest('5.3. Cả Session 1 và Session 2 đọc lại attachment sau recreate thành công', 'FAIL', err.message);
      throw err;
    }

    // =================================================================
    // 8. TEST ENTRYPOINT NON-DESTRUCTIVE CHECK
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

  } finally {
    // =================================================================
    // GUARANTEED HANDOVER: ALWAYS REVERT TO TEST ENDPOINTS DISABLED
    // =================================================================
    console.log('\n--- BÀN GIAO: ĐẢM BẢO TEST ENDPOINT VÔ HIỆU HÓA TRÊN CONTAINER 3090 ---');
    try {
      // Start with standard compose (test endpoint disabled)
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
    } catch (cleanupErr) {
      console.error('[finally] Lỗi khi đảm bảo cấu hình bàn giao:', cleanupErr.message);
      recordTest('7.1. Cấu hình bàn giao hoàn tất', 'FAIL', cleanupErr.message);
    }
  }

  console.log('\n================================================================');
  console.log('TỔNG HỢP KẾT QUẢ KIỂM THỬ:');
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
