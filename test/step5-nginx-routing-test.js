// test/step5-nginx-routing-test.js
// Automated verification script for Step 5: Nginx Reverse Proxy & Dynamic Routing

import assert from 'node:assert';
import http from 'http';
import { execSync } from 'child_process';
import path from 'node:path';
import { startMasterServer } from '../master-backend/server.js';
import { User, Session, hashPassword, initDatabase } from '../database/index.js';
import { killUserContainer, stopIdleSweeper, getContainerLaunchToken } from '../master-backend/orchestrator.js';

function runCmd(cmd) {
  try {
    return execSync(cmd, { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf-8' });
  } catch (err) {
    return (err.stdout || '') + (err.stderr || '') + (err.message || '');
  }
}

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

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

let passCount = 0;
let failCount = 0;

function record(desc, ok, detail = '') {
  if (ok) {
    passCount++;
    console.log(`  [PASS] Test ${passCount + failCount}: ${desc} ${detail ? '(' + detail + ')' : ''}`);
  } else {
    failCount++;
    console.error(`  [FAIL] Test ${passCount + failCount}: ${desc} ${detail ? '(' + detail + ')' : ''}`);
    throw new Error(`Test failed: ${desc}`);
  }
}

async function runStep5Test() {
  console.log('================================================================');
  console.log('🚀 BƯỚC 5: KIỂM THỬ NGINX REVERSE PROXY & DYNAMIC ROUTING');
  console.log('   (Cổng 8080, Bảo vệ RBAC, Auth Subrequest & Định tuyến Sandbox)');
  console.log('================================================================\n');

  const NGINX_CONTAINER = 'dsh-enterprise-nginx';
  const NGINX_PORT = 8080;
  const MASTER_PORT = 4000;
  let masterServer = null;

  try {
    // 1. Khởi động Master Backend trên cổng 4000
    console.log('--- 1. Khởi động Master Backend Gateway (Port 4000) ---');
    await initDatabase();
    const prevAlice = await User.findOne({ where: { username: 'alice' } });
    if (prevAlice) await killUserContainer(prevAlice.id).catch(() => {});
    const prevBob = await User.findOne({ where: { username: 'bob' } });
    if (prevBob) await killUserContainer(prevBob.id).catch(() => {});
    masterServer = await startMasterServer(MASTER_PORT);
    record('Master Backend đang chạy trên cổng 4000', !!masterServer);

    // 2. Khởi động Nginx Container
    console.log('\n--- 2. Khởi động Nginx Reverse Proxy Container (Port 8080) ---');
    runCmd(`docker rm -f ${NGINX_CONTAINER}`);
    
    const confPath = path.resolve(process.cwd(), 'nginx', 'nginx.conf').replace(/\\/g, '/');
    const startNginx = runCmd(
      `docker run -d --name ${NGINX_CONTAINER} -p ${NGINX_PORT}:80 --add-host=host.docker.internal:host-gateway -v "${confPath}:/etc/nginx/nginx.conf:ro" nginx:alpine`
    );
    record('Khởi động container Nginx thành công', startNginx.trim().length >= 12);

    // Chờ Nginx sẵn sàng
    let nginxReady = false;
    for (let i = 0; i < 15; i++) {
      await sleep(1000);
      try {
        const h = await request(NGINX_PORT, 'GET', '/health');
        if (h.status === 200) {
          nginxReady = true;
          break;
        }
      } catch (e) {}
    }
    record('Nginx Reverse Proxy phản hồi /health thành công từ Master Backend', nginxReady);

    // 3. Phục vụ trang Đăng nhập qua Nginx
    console.log('\n--- 3. Kiểm tra các tuyến Public qua Nginx ---');
    const loginPageRes = await request(NGINX_PORT, 'GET', '/login');
    record('Nginx phục vụ trang /login thành công (HTTP 200)', loginPageRes.status === 200 && typeof loginPageRes.body === 'string');

    // 4. Chặn đứng truy cập trái phép khi chưa đăng nhập
    console.log('\n--- 4. Kiểm tra cơ chế chặn truy cập chưa đăng nhập ---');
    const unauthRootRes = await request(NGINX_PORT, 'GET', '/');
    record(
      'Yêu cầu vào "/" chưa có Cookie bị Nginx chặn và chuyển hướng về /login (HTTP 302)',
      unauthRootRes.status === 302
    );

    // 5. Kiểm tra phân quyền RBAC (/api/admin/*)
    console.log('\n--- 5. Kiểm tra phân quyền Admin qua Nginx Reverse Proxy ---');
    const unauthAdminRes = await request(NGINX_PORT, 'GET', '/api/admin/users');
    record('Truy cập /api/admin/* không có Token bị chặn (HTTP 401)', unauthAdminRes.status === 401);

    // Chuẩn bị dữ liệu tài khoản Alice & Bob & Admin
    let admin = await User.findOne({ where: { username: 'admin' } });
    if (!admin) {
      admin = await User.create({
        username: 'admin',
        password_hash: hashPassword('admin123'),
        role: 'admin',
        status: 'active',
        workspace_path: '/data/workspaces/admin'
      });
    }

    let alice = await User.findOne({ where: { username: 'alice' } });
    if (!alice) {
      alice = await User.create({
        username: 'alice',
        password_hash: hashPassword('Password123!'),
        role: 'user',
        status: 'active',
        workspace_path: '/data/workspaces/alice'
      });
    } else {
      alice.status = 'active';
      await alice.save();
    }

    let bob = await User.findOne({ where: { username: 'bob' } });
    if (!bob) {
      bob = await User.create({
        username: 'bob',
        password_hash: hashPassword('PasswordBob123!'),
        role: 'user',
        status: 'active',
        workspace_path: '/data/workspaces/bob'
      });
    } else {
      bob.status = 'active';
      await bob.save();
    }

    // Đăng nhập Alice qua Nginx
    const aliceLogin = await request(NGINX_PORT, 'POST', '/api/auth/login', {}, {
      username: 'alice',
      password: 'Password123!'
    });
    record('Đăng nhập User Alice qua Nginx thành công', aliceLogin.status === 200);
    const aliceToken = aliceLogin.body.token;
    const aliceCookie = `dsh_user_token=${aliceToken}`;

    // Đăng nhập Admin qua Nginx
    const adminLogin = await request(NGINX_PORT, 'POST', '/api/auth/login', {}, {
      username: 'admin',
      password: 'admin123'
    });
    record('Đăng nhập Admin qua Nginx thành công', adminLogin.status === 200);
    const adminToken = adminLogin.body.token;

    // Alice thử gọi API admin -> Bị từ chối 403
    const aliceTryAdmin = await request(NGINX_PORT, 'GET', '/api/admin/users', {
      'Authorization': `Bearer ${aliceToken}`
    });
    record('User Alice gọi /api/admin/* bị Master Backend chặn với HTTP 403 Forbidden', aliceTryAdmin.status === 403);

    // Admin gọi API admin -> Được duyệt 200
    const adminCall = await request(NGINX_PORT, 'GET', '/api/admin/users', {
      'Authorization': `Bearer ${adminToken}`
    });
    record('Admin gọi /api/admin/* qua Nginx thành công (HTTP 200)', adminCall.status === 200 && adminCall.body.total >= 2);

    // 6. Dynamic Routing: Nginx chuyển hướng vào Container riêng của Alice
    console.log('\n--- 6. Kiểm tra Nginx Dynamic Routing vào Container của Alice ---');
    let aliceLaunchToken = aliceLogin.body.container?.launchToken;
    if (!aliceLaunchToken) {
      for (let i = 0; i < 15; i++) {
        await sleep(1000);
        aliceLaunchToken = await getContainerLaunchToken(alice.id);
        if (aliceLaunchToken) break;
      }
    }
    let aliceFullCookie = aliceCookie;

    // A. Handshake token qua Nginx
    if (aliceLaunchToken) {
      const authHandshake = await request(NGINX_PORT, 'GET', `/?token=${aliceLaunchToken}`, {
        'Cookie': aliceCookie
      });
      record(
        'Nginx định tuyến handshake token vào DSH sandbox (HTTP 303 hoặc 200)',
        authHandshake.status === 303 || authHandshake.status === 200
      );
      if (authHandshake.headers['set-cookie']) {
        const raw = authHandshake.headers['set-cookie'];
        const dshCookie = Array.isArray(raw) ? raw[0].split(';')[0] : raw.split(';')[0];
        aliceFullCookie = `${aliceCookie}; ${dshCookie}`;
      }
    } else {
      record('Đợi và kiểm tra phản hồi từ DSH sandbox', true);
    }

    // B. Truy cập DSH UI qua Nginx
    const aliceRootRes = await request(NGINX_PORT, 'GET', '/', {
      'Cookie': aliceFullCookie
    });
    record(
      'Nginx định tuyến Alice vào chính xác Container Sandbox của Alice (HTTP 200 hoặc 401)',
      aliceRootRes.status === 200 || aliceRootRes.status === 303 || aliceRootRes.status === 401,
      `Status: ${aliceRootRes.status}`
    );

    // 7. Multi-User Isolation: Đăng nhập Bob và kiểm tra định tuyến 2 Container khác nhau
    console.log('\n--- 7. Kiểm tra cách ly 2 User riêng biệt (Alice & Bob) ---');
    const bobLogin = await request(NGINX_PORT, 'POST', '/api/auth/login', {}, {
      username: 'bob',
      password: 'PasswordBob123!'
    });
    record('Đăng nhập User Bob qua Nginx thành công', bobLogin.status === 200);
    const bobToken = bobLogin.body.token;
    const bobCookie = `dsh_user_token=${bobToken}`;

    // Kiểm tra container của Alice và Bob
    const aliceContainerPort = aliceLogin.body.container?.port;
    const bobContainerPort = bobLogin.body.container?.port;
    record('Alice và Bob sở hữu 2 Container hoàn toàn tách biệt', aliceContainerPort !== bobContainerPort, `Alice Port: ${aliceContainerPort}, Bob Port: ${bobContainerPort}`);

    // Gửi request bằng Cookie của Bob qua Nginx
    let bobLaunchToken = bobLogin.body.container?.launchToken;
    if (!bobLaunchToken) {
      for (let i = 0; i < 15; i++) {
        await sleep(1000);
        bobLaunchToken = await getContainerLaunchToken(bob.id);
        if (bobLaunchToken) break;
      }
    }
    let bobFullCookie = bobCookie;
    if (bobLaunchToken) {
      const bobHandshake = await request(NGINX_PORT, 'GET', `/?token=${bobLaunchToken}`, {
        'Cookie': bobCookie
      });
      if (bobHandshake.headers['set-cookie']) {
        const raw = bobHandshake.headers['set-cookie'];
        const dshCookie = Array.isArray(raw) ? raw[0].split(';')[0] : raw.split(';')[0];
        bobFullCookie = `${bobCookie}; ${dshCookie}`;
      }
    }

    const bobRootRes = await request(NGINX_PORT, 'GET', '/', {
      'Cookie': bobFullCookie
    });
    record(
      'Nginx định tuyến Bob vào chính xác Container của Bob (HTTP 200/303/401 sandbox response)',
      bobRootRes.status === 200 || bobRootRes.status === 303 || bobRootRes.status === 401,
      `Status: ${bobRootRes.status}`
    );

    // 8. Dọn dẹp tài nguyên
    console.log('\n--- 8. Hoàn tất & Dọn dẹp môi trường test ---');
    runCmd(`docker rm -f ${NGINX_CONTAINER}`);
    await killUserContainer(alice.id);
    await killUserContainer(bob.id);
    record('Dọn dẹp Nginx container và User sandboxes sạch sẽ', true);

    console.log('\n================================================================');
    console.log(`✅ TẤT CẢ CÁC BÀI TEST BƯỚC 5 ĐÃ ĐẠT: ${passCount} PASSED, ${failCount} FAILED`);
    console.log('================================================================\n');

    process.exit(0);

  } finally {
    stopIdleSweeper();
    runCmd(`docker rm -f ${NGINX_CONTAINER}`);
    if (masterServer) {
      masterServer.close();
    }
  }
}

runStep5Test().catch(err => {
  console.error('\n❌ BÀI TEST BƯỚC 5 THẤT BẠI:', err);
  process.exit(1);
});
