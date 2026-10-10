import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
  initDatabase,
  findUserByUsername,
  createUser,
  approveUser,
  recordAttachment,
  hashPassword,
  getDb
} from '../lib/db.js';

const LIVE_DSH_URL = 'http://127.0.0.1:3088';
const PLUGIN_ROOT = path.resolve(import.meta.dirname, '..');
const DB_PATH = path.join(PLUGIN_ROOT, 'data', 'users.db');
const DSH_HOME = 'C:\\Users\\Admin\\.dsh-multiuser';
const ATT_DIR = path.join(DSH_HOME, 'attachments', 'v1', 'files');

async function main() {
  console.log('======================================================================');
  console.log('   KIỂM THỬ GUARD CỦA PWSH QUA RUNTIME DSH THẬT (PORT 3088)          ');
  console.log('   - Không thông qua quyết định gọi tool của LLM                     ');
  console.log('   - Không chỉ gọi trực tiếp hàm validateShellCommandAccess          ');
  console.log('   - Sử dụng DSH ToolRuntime.execute thực tế trên máy chủ DSH         ');
  console.log('======================================================================\n');

  // Khởi tạo kết nối DB trực tiếp để chuẩn bị tài khoản và dọn dẹp
  initDatabase(DB_PATH);

  // 1. Đảm bảo user "nvs" và "nva" tồn tại và active
  console.log('[BƯỚC 1] Kiểm tra tài khoản nvs và nva trên hệ thống thật...');
  const userPassword = process.env.TEST_USER_PASSWORD || '123456';
  let userNvs = findUserByUsername('nvs');
  if (!userNvs) {
    createUser('nvs', userPassword, 'user', 100000, 'active');
  }

  let userNva = findUserByUsername('nva');
  if (!userNva) {
    createUser('nva', userPassword, 'user', 100000, 'active');
  }
  console.log('  -> Tài khoản nvs và nva sẵn sàng.');

  // 2. Đăng nhập nvs qua HTTP API thật để lấy Cookie xác thực
  console.log('\n[BƯỚC 2] Đăng nhập tài khoản "nvs" qua /api/auth/login...');
  const loginResNvs = await fetch(`${LIVE_DSH_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'nvs', password: userPassword })
  });
  assert.strictEqual(loginResNvs.status, 200, 'Đăng nhập nvs phải thành công');
  const cookieNvs = loginResNvs.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookieNvs, 'Phải nhận được cookie xác thực của nvs');
  console.log('  -> Đăng nhập nvs thành công (phiên đã được xác thực).');

  // 3. Đăng nhập nva để tạo session nva
  console.log('\n[BƯỚC 3] Đăng nhập tài khoản "nva" để tạo attachment nva...');
  const loginResNva = await fetch(`${LIVE_DSH_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'nva', password: userPassword })
  });
  assert.strictEqual(loginResNva.status, 200, 'Đăng nhập nva phải thành công');
  const cookieNva = loginResNva.headers.get('set-cookie')?.split(';')[0];

  // 4. Tạo session thật cho nva qua /api/session/create
  const createSessionNvaRes = await fetch(`${LIVE_DSH_URL}/api/session/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': cookieNva
    },
    body: JSON.stringify({
      workspaceId: 'user-workspace-nva',
      agentPreset: 'standard'
    })
  });
  const dataNva = await createSessionNvaRes.json();
  const sessionNva = dataNva.result?.value?.sessionId || dataNva.sessionId;
  assert.ok(sessionNva, 'Tạo session nva thành công');
  console.log('  -> Session của nva:', sessionNva);

  // 5. Tạo attachment giả test-nva.txt thuộc sở hữu của nva
  const SECRET_CONTENT_NVA = 'CONFIDENTIAL_NVA_ATTACHMENT_SECRET_DATA_XYZ_987654321';
  const nvaAttDir = path.join(ATT_DIR, 'fake_sec_test_nva');
  fs.mkdirSync(nvaAttDir, { recursive: true });
  const fakeAttPath = path.join(nvaAttDir, 'test-nva.txt');
  fs.writeFileSync(fakeAttPath, SECRET_CONTENT_NVA, 'utf8');

  recordAttachment({
    attachmentId: 'sha256:fake_hash_nva_attachment_1',
    fileName: 'test-nva.txt',
    fileSize: SECRET_CONTENT_NVA.length,
    sessionId: sessionNva,
    username: 'nva',
    filePath: fakeAttPath
  });
  console.log('  -> Đã tạo attachment giả test-nva.txt thuộc sở hữu nva tại:');
  console.log('    ', fakeAttPath);

  // 6. Tạo session thật cho nvs qua /api/session/create
  console.log('\n[BƯỚC 4] Tạo session thật cho "nvs" qua API /api/session/create...');
  const createSessionNvsRes = await fetch(`${LIVE_DSH_URL}/api/session/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': cookieNvs
    },
    body: JSON.stringify({
      workspaceId: 'user-workspace-nvs',
      agentPreset: 'standard'
    })
  });
  assert.strictEqual(createSessionNvsRes.status, 200);
  const dataNvs = await createSessionNvsRes.json();
  const sessionNvs = dataNvs.result?.value?.sessionId || dataNvs.sessionId;
  assert.ok(sessionNvs, 'Tạo session nvs thành công');
  console.log('  -> Session của nvs được xác thực thành công:', sessionNvs);

  // 7. YÊU CẦU 1: nvs gọi pwsh Get-Content đọc test-nva.txt
  // Kiểm thử trực tiếp qua DSH ToolRuntime trên máy chủ thật (không qua LLM quyết định)
  console.log('\n[BƯỚC 5] Thực thi Get-Content đọc attachment của nva qua DSH ToolRuntime thật...');
  const attackCmd = `Get-Content -LiteralPath "${fakeAttPath}" -Raw -Encoding UTF8`;
  console.log('  -> Lệnh pwsh gửi tới runtime DSH:');
  console.log('     ', attackCmd);

  const testExecRes1 = await fetch(`${LIVE_DSH_URL}/api/user-manager/test-execute-tool`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': cookieNvs
    },
    body: JSON.stringify({
      sessionId: sessionNvs,
      toolName: 'pwsh',
      args: {
        command: attackCmd,
        description: 'Đọc file đính kèm của nva bằng shell'
      }
    })
  });

  const rawText1 = await testExecRes1.text();
  let resData1;
  try { resData1 = JSON.parse(rawText1); } catch (e) { resData1 = { raw: rawText1 }; }
  if (testExecRes1.status !== 200) {
    console.error('Server returned error:', testExecRes1.status, resData1);
  }
  assert.strictEqual(testExecRes1.status, 200, 'Endpoint thực thi runtime trả HTTP 200');
  assert.strictEqual(resData1.ok, true, 'Server xử lý yêu cầu runtime thành công');
  const result1 = resData1.result;

  console.log('\n  [KẾT QUẢ TỪ RUNTIME DSH THẬT]:');
  console.log('  - isError:', result1.isError);
  console.log('  - error.message:', result1.error?.message);
  console.log('  - content text:', result1.content?.[0]?.text);

  // Xác nhận 1: Guard từ chối trước khi shell chạy
  assert.strictEqual(result1.isError, true, 'DSH ToolRuntime phải trả isError = true');
  assert.ok(
    result1.error?.message?.includes('Truy cập bị từ chối') ||
    result1.content?.[0]?.text?.includes('Truy cập bị từ chối'),
    'Thông báo lỗi phải là từ chối truy cập từ Guard'
  );

  // Xác nhận 2: KHÔNG BAO GIỜ trả nội dung bí mật
  const rawResponseString = JSON.stringify(resData1);
  const leaked = rawResponseString.includes(SECRET_CONTENT_NVA);
  assert.strictEqual(leaked, false, 'TUYỆT ĐỐI KHÔNG ĐƯỢC RÒ RỈ NỘI DUNG ATTACHMENT BÍ MẬT CỦA NVA');
  console.log('  -> [PASS 1] Guard đã từ chối trước khi pwsh chạy, KHÔNG trả bất kỳ nội dung nào của nva.');

  // 8. YÊU CẦU 2: Chạy thêm một lệnh hợp lệ trong workspace nvs để xác nhận luồng thực thi hoạt động
  console.log('\n[BƯỚC 6] Chạy lệnh hợp lệ trong workspace nvs qua DSH ToolRuntime thật...');
  const validEchoText = 'NVS_LEGITIMATE_TEST_EXECUTION_SUCCESS_OK_778899';
  const validCmd = `Write-Output "${validEchoText}"`;
  console.log('  -> Lệnh pwsh gửi tới runtime DSH:');
  console.log('     ', validCmd);

  const testExecRes2 = await fetch(`${LIVE_DSH_URL}/api/user-manager/test-execute-tool`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': cookieNvs
    },
    body: JSON.stringify({
      sessionId: sessionNvs,
      toolName: 'pwsh',
      args: {
        command: validCmd,
        description: 'Chạy lệnh Write-Output hợp lệ trong workspace nvs'
      }
    })
  });

  assert.strictEqual(testExecRes2.status, 200);
  const resData2 = await testExecRes2.json();
  assert.strictEqual(resData2.ok, true);
  const result2 = resData2.result;

  console.log('\n  [KẾT QUẢ TỪ RUNTIME DSH THẬT]:');
  console.log('  - isError:', !!result2.isError);
  console.log('  - content text:', result2.content?.[0]?.text?.trim());

  // Xác nhận 3: Lệnh hợp lệ được guard cho phép và thực thi thành công
  assert.strictEqual(!!result2.isError, false, 'Lệnh hợp lệ không được báo lỗi');
  const validOutputMatched = result2.content?.[0]?.text?.includes(validEchoText);
  assert.strictEqual(validOutputMatched, true, 'Kết quả thực thi phải chứa chuỗi Write-Output');
  console.log('  -> [PASS 2] Lệnh hợp lệ trong workspace nvs đã được thực thi thành công qua shell.');

  // 9. Dọn dẹp file test
  console.log('\n[BƯỚC 7] Dọn dẹp tệp thử nghiệm...');
  try {
    fs.unlinkSync(fakeAttPath);
    fs.rmdirSync(nvaAttDir);
  } catch (e) {}
  console.log('  -> Đã dọn dẹp sạch sẽ tệp thử nghiệm test-nva.txt.');

  console.log('\n======================================================================');
  console.log('   TẤT CẢ KIỂM THỬ RUNTIME THẬT ĐỀU ĐẠT CHUẨN XÁC MINH 100%!        ');
  console.log('======================================================================');
}

main().catch(err => {
  console.error('\n[LỖI TEST RUNTIME]:', err);
  process.exit(1);
});
