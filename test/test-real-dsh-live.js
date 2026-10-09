import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { getOwnerOfSessionFromDb, initDatabase, findUserByUsername } from '../lib/db.js';

const LIVE_DSH_URL = 'http://127.0.0.1:3088';

async function main() {
  console.log('======================================================================');
  console.log('   KIỂM THỬ TRÊN DSH THẬT (PORT 3088) - KHÔNG DÙNG MOCK / TỰ GÁN     ');
  console.log('======================================================================\n');

  // Verify DSH live server is responsive
  let statusData;
  try {
    const statusRes = await fetch(`${LIVE_DSH_URL}/api/user-manager/status`);
    statusData = await statusRes.json();
    console.log('[1] Live DSH Status Check: OK');
    console.log('    Tool registration:', statusData.toolRegistration);
    assert.strictEqual(statusData.status, 'ok');
    assert.strictEqual(statusData.toolRegistration.ready, true);
    assert.strictEqual(statusData.toolRegistration.toolRegistered, true);
  } catch (err) {
    console.error('Không thể kết nối tới DSH thật trên cổng 3088:', err.message);
    process.exit(1);
  }

  // 1. Đăng nhập tài khoản test (admin / admin123) trên DSH thật
  console.log('\n[2] Đăng nhập tài khoản "admin" trên DSH thật...');
  const loginRes = await fetch(`${LIVE_DSH_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'password123' })
  });

  let adminCookie = '';
  if (loginRes.ok) {
    const setCookie = loginRes.headers.get('set-cookie');
    if (setCookie) {
      adminCookie = setCookie.split(';')[0];
    }
  } else {
    // Thử mật khẩu admin123 nếu password123 không đúng
    const loginRes2 = await fetch(`${LIVE_DSH_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    });
    assert.strictEqual(loginRes2.status, 200, 'Đăng nhập admin phải thành công');
    const setCookie = loginRes2.headers.get('set-cookie');
    assert.ok(setCookie, 'Phải nhận được cookie đăng nhập');
    adminCookie = setCookie.split(';')[0];
  }
  console.log('    Đăng nhập thành công, Cookie:', adminCookie.slice(0, 30) + '...');

  // 2. Tạo session mới qua API thật của DSH KHÔNG hề tự gán quyền thủ công
  console.log('\n[3] Tạo session mới qua luồng DSH thật (/api/session/create)...');
  const createSessionRes = await fetch(`${LIVE_DSH_URL}/api/session/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': adminCookie
    },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: `rpc-live-test-${Date.now()}`,
      method: 'session/create',
      payload: {
        args: {
          request: {
            workspaceId: 'user-workspace-admin'
          }
        }
      }
    })
  });

  const sessionJson = await createSessionRes.json();
  console.log('    Mã trạng thái:', createSessionRes.status);
  console.log('    Kết quả trả về từ DSH:', JSON.stringify(sessionJson));
  const isOk = sessionJson.ok ?? sessionJson.result?.ok;
  assert.strictEqual(isOk, true);

  const val = sessionJson.value || sessionJson.result?.value;
  const createdSessionId = val?.id || val?.sessionId;
  assert.ok(createdSessionId, 'DSH phải trả về session ID thực tế');
  console.log(`    Session ID mới tạo: "${createdSessionId}"`);

  // 3. Tra cứu chủ sở hữu trong SQLite database thật (chờ async attachSession hoàn tất)
  console.log('\n[4] Kiểm tra chủ sở hữu session được tự động ghi nhận trong SQLite...');
  initDatabase();
  let ownerInDb = null;
  for (let i = 0; i < 20; i++) {
    ownerInDb = getOwnerOfSessionFromDb(createdSessionId);
    if (ownerInDb) break;
    await new Promise(r => setTimeout(r, 100));
  }
  console.log(`    Chủ sở hữu ghi nhận trong DB cho session "${createdSessionId}": "${ownerInDb}"`);
  assert.strictEqual(ownerInDb, 'admin', 'Server DSH phải tự động gán chủ sở hữu là admin từ phiên đăng nhập');

  // 4. Kiểm tra chặn tạo session trái phép (chưa đăng nhập -> 401)
  console.log('\n[5] Kiểm tra bảo mật: Từ chối tạo session khi chưa đăng nhập (401)...');
  const unauthRes = await fetch(`${LIVE_DSH_URL}/api/session/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: 'rpc-unauth',
      method: 'session/create',
      payload: { args: { request: {} } }
    })
  });
  console.log('    Mã trạng thái yêu cầu chưa đăng nhập:', unauthRes.status);
  assert.strictEqual(unauthRes.status, 401);

  // 5. Kiểm tra đọc tài liệu từ workspace admin qua /api/document/read
  console.log('\n[6] Kiểm tra đọc tài liệu trên DSH thật qua /api/document/read...');
  // Tạo 1 file test tiếng Việt tạm trong workspace admin
  const adminWsFile = path.resolve('workspaces', 'admin', 'tailieu_dsh_live.txt');
  fs.writeFileSync(adminWsFile, 'CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM\nKiểm thử tích hợp hệ thống đọc tài liệu DSH trên môi trường thực tế.', 'utf8');

  const readRes = await fetch(`${LIVE_DSH_URL}/api/document/read`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': adminCookie
    },
    body: JSON.stringify({
      file_path: 'tailieu_dsh_live.txt',
      session_id: createdSessionId
    })
  });

  const readData = await readRes.json();
  console.log('    Mã trạng thái đọc tài liệu:', readRes.status);
  console.log('    Nội dung trích xuất:', readData.data?.content?.slice(0, 70));
  assert.strictEqual(readRes.status, 200);
  assert.strictEqual(readData.ok, true);
  assert.ok(readData.data.content.includes('CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM'));

  // Dọn dẹp file test
  try { fs.unlinkSync(adminWsFile); } catch (e) {}

  console.log('\n======================================================================');
  console.log('  TẤT CẢ KIỂM THỬ TRÊN DSH THẬT (PORT 3088) ĐỀU THÀNH CÔNG RỰC RỠ!   ');
  console.log('======================================================================\n');
}

main().catch((err) => {
  console.error('LỖI KIỂM THỬ DSH THẬT:', err);
  process.exit(1);
});
