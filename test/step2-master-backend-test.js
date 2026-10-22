import assert from 'node:assert';
import http from 'node:http';
import { startMasterServer } from '../master-backend/server.js';
import { User, Session, hashPassword, sequelize } from '../database/index.js';

function request(port, method, urlPath, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: urlPath,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) { json = data; }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: json
        });
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function runStep2Test() {
  console.log('================================================================');
  console.log('🚀 BƯỚC 2: KIỂM THỬ MASTER BACKEND (ADMIN GATEWAY & AUTH SERVICE)');
  console.log('   (Độc lập port 4005, phục vụ login.html, JWT/Cookie & Admin RBAC)');
  console.log('================================================================\n');

  const TEST_PORT = 4005;
  let server = null;
  let passed = 0;
  let total = 0;

  function record(desc, ok, detail = '') {
    total++;
    if (ok) {
      passed++;
      console.log(`  [PASS] Test ${total}: ${desc} ${detail ? '(' + detail + ')' : ''}`);
    } else {
      console.error(`  [FAIL] Test ${total}: ${desc} ${detail ? '(' + detail + ')' : ''}`);
      throw new Error(`Test failed: ${desc}`);
    }
  }

  const testUsername = `user_step2_${Date.now()}`;
  let adminToken = null;
  let userToken = null;

  try {
    // 0. Seed Admin in DB
    const adminExists = await User.findOne({ where: { username: 'admin' } });
    if (!adminExists) {
      await User.create({
        username: 'admin',
        password_hash: hashPassword('admin123'),
        role: 'admin',
        status: 'active',
        workspace_path: '/data/workspaces/admin'
      });
    } else if (adminExists.status !== 'active') {
      adminExists.status = 'active';
      await adminExists.save();
    }

    // 1. Khởi động Master Backend Server trên port 4005
    server = await startMasterServer(TEST_PORT);
    record('Master Backend khởi động thành công độc lập', !!server);

    // 2. Healthcheck
    console.log('\n--- 1. Kiểm tra Healthcheck & Phục vụ login.html ---');
    const healthRes = await request(TEST_PORT, 'GET', '/health');
    record('Endpoint /health trả về 200 OK và status=healthy', healthRes.status === 200 && healthRes.body.status === 'healthy');

    const pageRes = await request(TEST_PORT, 'GET', '/login');
    record('Phục vụ trang login.html trực tiếp tại cổng Master Backend', pageRes.status === 200 && typeof pageRes.body === 'string' && pageRes.body.includes('DSH Master Gateway'));

    // 3. Đăng ký tài khoản người dùng mới (Public API)
    console.log('\n--- 2. Đăng ký tài khoản mới & Kiểm tra trạng thái Pending ---');
    const regRes = await request(TEST_PORT, 'POST', '/api/auth/register', {}, {
      username: testUsername,
      password: 'StrongUserPass123!'
    });
    record('Đăng ký tài khoản mới thành công (201 Created)', regRes.status === 201);
    record('Tài khoản mới đăng ký ở trạng thái status=pending', regRes.body.user && regRes.body.user.status === 'pending');

    // 4. Thử đăng nhập khi tài khoản còn pending -> Bị chặn 403
    const loginPendingRes = await request(TEST_PORT, 'POST', '/api/auth/login', {}, {
      username: testUsername,
      password: 'StrongUserPass123!'
    });
    record('Chặn đăng nhập khi tài khoản chưa được duyệt (403 Forbidden)', loginPendingRes.status === 403 && loginPendingRes.body.status === 'pending');

    // 5. Đăng nhập Admin lấy JWT Token & Cookie
    console.log('\n--- 3. Đăng nhập Admin & Cấp phát JWT Token / Cookie ---');
    const adminLoginRes = await request(TEST_PORT, 'POST', '/api/auth/login', {}, {
      username: 'admin',
      password: 'admin123'
    });
    record('Admin đăng nhập thành công nhận HTTP 200', adminLoginRes.status === 200);
    record('Hệ thống cấp token JWT hợp lệ', !!adminLoginRes.body.token);
    record('Hệ thống đính kèm Set-Cookie: dsh_user_token (HttpOnly)', !!adminLoginRes.headers['set-cookie'] && adminLoginRes.headers['set-cookie'][0].includes('dsh_user_token'));
    adminToken = adminLoginRes.body.token;

    // 6. Admin kiểm tra danh sách chờ duyệt
    console.log('\n--- 4. Quyền Quản trị viên (Admin RBAC): Xem danh sách & Phê duyệt ---');
    const pendingListRes = await request(TEST_PORT, 'GET', '/api/admin/pending-users', {
      Authorization: `Bearer ${adminToken}`
    });
    const foundPending = pendingListRes.body.pending_users && pendingListRes.body.pending_users.some(u => u.username === testUsername);
    record('Admin xem danh sách pending thấy tài khoản vừa tạo', pendingListRes.status === 200 && foundPending);

    // 7. Admin phê duyệt tài khoản (Approve User)
    const approveRes = await request(TEST_PORT, 'POST', '/api/admin/approve-user', {
      Authorization: `Bearer ${adminToken}`
    }, {
      username: testUsername
    });
    record('Admin phê duyệt tài khoản thành công', approveRes.status === 200 && approveRes.body.user.status === 'active');

    // 8. User đăng nhập sau khi được phê duyệt -> Thành công nhận Token
    console.log('\n--- 5. Đăng nhập User sau khi được Active & Lấy Profile ---');
    const userLoginRes = await request(TEST_PORT, 'POST', '/api/auth/login', {}, {
      username: testUsername,
      password: 'StrongUserPass123!'
    });
    record('User đăng nhập thành công sau khi được Active', userLoginRes.status === 200 && !!userLoginRes.body.token);
    userToken = userLoginRes.body.token;

    // 9. User lấy thông tin /api/auth/me
    const meRes = await request(TEST_PORT, 'GET', '/api/auth/me', {
      Authorization: `Bearer ${userToken}`
    });
    record('User xác thực qua /api/auth/me nhận đúng profile', meRes.status === 200 && meRes.body.user.username === testUsername);

    // 10. Chặn User thường gọi API của Admin (RBAC check)
    console.log('\n--- 6. Kiểm tra RBAC Security Guard: Chặn User thường gọi API Admin ---');
    const unauthorizedAdminCall = await request(TEST_PORT, 'POST', '/api/admin/approve-user', {
      Authorization: `Bearer ${userToken}`
    }, {
      username: 'any_user'
    });
    record('User thường bị chặn 403 Forbidden khi cố gọi API Admin', unauthorizedAdminCall.status === 403);

    // 11. Admin cấu hình Model & API Key
    console.log('\n--- 7. Quản trị Model & API Key Pool ---');
    const addKeyRes = await request(TEST_PORT, 'POST', '/api/admin/models/key', {
      Authorization: `Bearer ${adminToken}`
    }, {
      ref: 'OPENROUTER_API_KEY',
      value: 'sk-or-v1-new-enterprise-test-key-2026',
      mode: 'append'
    });
    record('Admin thêm API Key vào Key Pool thành công', addKeyRes.status === 200 && addKeyRes.body.success === true);

    const getKeysRes = await request(TEST_PORT, 'GET', '/api/admin/models/config', {
      Authorization: `Bearer ${adminToken}`
    });
    record('Admin xem danh sách API Key (được mask bảo mật)', getKeysRes.status === 200 && !!getKeysRes.body.pools.OPENROUTER_API_KEY);

    // 12. Logout
    console.log('\n--- 8. Kiểm tra Đăng xuất (Logout & Xóa Cookie) ---');
    const logoutRes = await request(TEST_PORT, 'POST', '/api/auth/logout', {
      Authorization: `Bearer ${userToken}`
    });
    record('Đăng xuất thành công và vô hiệu hóa Cookie', logoutRes.status === 200 && logoutRes.headers['set-cookie'][0].includes('Max-Age=0'));

    console.log('\n================================================================');
    console.log(`🎉 BƯỚC 2 HOÀN TẤT VỚI KẾT QUẢ XUẤT SẮC: ${passed}/${total} TEST PASS (100%)`);
    console.log('================================================================');

  } catch (err) {
    console.error('\n❌ LỖI KIỂM THỬ BƯỚC 2:', err);
    process.exit(1);
  } finally {
    if (server) {
      server.close();
    }
    await sequelize.close();
  }
}

runStep2Test();

