// test/step4-orchestrator-test.js
// Automated verification script for Step 4: Docker Orchestrator (1 User = 1 Docker Container)

import assert from 'node:assert';
import http from 'node:http';
import {
  docker,
  spawnUserContainer,
  findUserContainer,
  killUserContainer,
  listUserContainers,
  cleanupIdleContainers,
  stopIdleSweeper,
  CONTAINER_RAM_LIMIT,
  CONTAINER_CPU_LIMIT
} from '../master-backend/orchestrator.js';
import { startMasterServer } from '../master-backend/server.js';
import { User, Session, hashPassword, initDatabase } from '../database/index.js';

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

async function runStep4Test() {
  console.log('================================================================');
  console.log('🚀 BƯỚC 4: KIỂM THỬ DOCKER ORCHESTRATOR & CONTAINER SANDBOX');
  console.log('   (1 User = 1 Container, 256MB RAM / 0.5 CPU, Volume & Kill Switch)');
  console.log('================================================================\n');

  const TEST_PORT = 4015;
  let server = null;
  const testUserId = 901;
  const testUsername = 'test_orchestrator_user';

  try {
    // 1. Docker Daemon Connectivity Check
    console.log('--- 1. Kiểm tra kết nối Docker Engine qua Dockerode ---');
    const pingRes = await docker.ping();
    record('Docker Engine Daemon phản hồi OK qua named pipe', !!pingRes);

    // Dọn dẹp container test nếu còn sót
    await killUserContainer(testUserId);
    await killUserContainer(902);

    // 2. Spawn Container trực tiếp từ Orchestrator
    console.log('\n--- 2. Tự động spawn Container riêng biệt với tài nguyên chuẩn ---');
    const spawnRes = await spawnUserContainer(testUserId, testUsername);
    record('spawnUserContainer khởi tạo thành công', spawnRes && spawnRes.status === 'running');
    record('Container có tên chuẩn dsh-user-{id}', spawnRes.name === `dsh-user-${testUserId}`);
    record('Container được cấp phát port động localhost', spawnRes.port >= 3100 && spawnRes.port < 4000, `Port: ${spawnRes.port}`);

    // 3. Inspect Container Hardware limits & Mount
    console.log('\n--- 3. Kiểm tra thông số cô lập phần cứng & Mount Volume ---');
    const container = await findUserContainer(testUserId);
    record('Container tìm thấy trong Docker daemon', !!container);

    const inspect = await container.inspect();
    record('Giới hạn RAM chính xác 256MB', inspect.HostConfig.Memory === CONTAINER_RAM_LIMIT, `${inspect.HostConfig.Memory} bytes`);
    record('Giới hạn CPU chính xác 0.5 Cores', inspect.HostConfig.NanoCpus === CONTAINER_CPU_LIMIT, `${inspect.HostConfig.NanoCpus} nanoCPUs`);
    record('Disable Swap vượt ngưỡng RAM (MemorySwap = 256MB)', inspect.HostConfig.MemorySwap === CONTAINER_RAM_LIMIT);
    
    const binds = inspect.HostConfig.Binds || [];
    const hasWorkspaceBind = binds.some(b => b.includes(':/data/workspace:rw'));
    record('Volume thư mục vật lý được mount vào /data/workspace:rw', hasWorkspaceBind);

    // 4. Test Idempotency (gọi lại không sinh thêm container trùng lặp)
    console.log('\n--- 4. Kiểm tra tính Idempotent khi User gọi lại container ---');
    const reuseRes = await spawnUserContainer(testUserId, testUsername);
    record('Tái sử dụng container đã chạy (reused=true)', reuseRes.reused === true && reuseRes.containerId === spawnRes.containerId);

    // 5. Khởi động Master Backend Server để kiểm thử luồng API
    console.log('\n--- 5. Kiểm thử tích hợp Master Backend API ---');
    server = await startMasterServer(TEST_PORT);
    record('Master Backend khởi động thành công trên port 4015', !!server);

    // Seed Admin & Active User
    await initDatabase();
    const adminExists = await User.findOne({ where: { username: 'admin' } });
    if (!adminExists) {
      await User.create({
        username: 'admin',
        password_hash: hashPassword('admin123'),
        role: 'admin',
        status: 'active',
        workspace_path: '/data/workspaces/admin'
      });
    }

    const aliceUser = await User.findOne({ where: { username: 'alice' } });
    if (aliceUser) {
      aliceUser.status = 'active';
      await aliceUser.save();
    }

    // Đăng nhập Admin để lấy token
    const adminLogRes = await request(TEST_PORT, 'POST', '/api/auth/login', {}, {
      username: 'admin',
      password: 'admin123'
    });
    const adminToken = adminLogRes.body.token;
    record('Admin đăng nhập thành công', !!adminToken);

    // 6. User đăng nhập -> Tự động kích hoạt spawn container
    console.log('\n--- 6. User Login tự động kích hoạt spawn Container ---');
    const aliceLogRes = await request(TEST_PORT, 'POST', '/api/auth/login', {}, {
      username: 'alice',
      password: 'Password123!'
    });
    record('User Alice đăng nhập thành công (HTTP 200)', aliceLogRes.status === 200);
    record('Response đăng nhập chứa thông tin Container riêng', !!aliceLogRes.body.container && !!aliceLogRes.body.container.port, `Container Port: ${aliceLogRes.body.container?.port}`);

    // 7. Admin Container Monitoring API
    console.log('\n--- 7. Kiểm tra API giám sát Container của Admin ---');
    const monRes = await request(TEST_PORT, 'GET', '/api/admin/containers', {
      'Authorization': `Bearer ${adminToken}`
    });
    record('Admin lấy danh sách Container thành công (HTTP 200)', monRes.status === 200 && monRes.body.success);
    record('Danh sách chứa container dsh.managed', monRes.body.containers.length >= 1, `Số lượng: ${monRes.body.count}`);

    // 8. Admin Kill Switch API (Banned user & Force-Kill container)
    console.log('\n--- 8. Kiểm tra Admin Kill Switch (Banned & Force Kill Container) ---');
    const killRes = await request(TEST_PORT, 'POST', '/api/admin/kill-switch', {
      'Authorization': `Bearer ${adminToken}`
    }, {
      userId: aliceUser.id,
      reason: 'Testing Automated Security Kill Switch'
    });
    record('Kill Switch API thực thi thành công (HTTP 200)', killRes.status === 200 && killRes.body.containerKilled === true);

    // Verify DB user status is banned
    await aliceUser.reload();
    record('Trạng thái User trong PostgreSQL được chuyển thành "banned"', aliceUser.status === 'banned');

    // Verify container destroyed
    const aliceContainerAfter = await findUserContainer(aliceUser.id);
    record('Container của Alice đã bị Force Kill và dọn sạch khỏi Docker', aliceContainerAfter === null);

    // Verify banned user cannot log in
    const bannedLoginRes = await request(TEST_PORT, 'POST', '/api/auth/login', {}, {
      username: 'alice',
      password: 'Password123!'
    });
    record('User bị cấm không thể đăng nhập (HTTP 403 Banned)', bannedLoginRes.status === 403 && bannedLoginRes.body.status === 'banned');

    // 9. Idle Container Sweeper
    console.log('\n--- 9. Kiểm tra Worker ngầm dọn dẹp Container nhàn rỗi (Idle Sweeper) ---');
    const idleUserId = 902;
    await spawnUserContainer(idleUserId, 'test_idle_user');
    const idleContainerBefore = await findUserContainer(idleUserId);
    record('Container nhàn rỗi được tạo', !!idleContainerBefore);

    // Sweep with 0 minutes threshold (force clean)
    const sweepRes = await cleanupIdleContainers(0);
    record('Idle Sweeper quét và hạ container nhàn rỗi giải phóng RAM', sweepRes.some(c => String(c.userId) === String(idleUserId)));

    const idleContainerAfter = await findUserContainer(idleUserId);
    record('Container nhàn rỗi đã bị giải phóng hoàn toàn', idleContainerAfter === null);

    // 10. Dọn dẹp tài nguyên test
    console.log('\n--- 10. Hoàn tất & Dọn dẹp tài nguyên ---');
    await killUserContainer(testUserId);
    // Khôi phục tài khoản Alice về active
    aliceUser.status = 'active';
    await aliceUser.save();
    record('Khôi phục tài khoản Alice về trạng thái active', true);

    console.log('\n================================================================');
    console.log(`✅ TẤT CẢ CÁC BÀI TEST BƯỚC 4 ĐÃ ĐẠT: ${passCount} PASSED, ${failCount} FAILED`);
    console.log('================================================================\n');

    process.exit(0);
  } finally {
    stopIdleSweeper();
    if (server) {
      server.close();
    }
  }
}

runStep4Test().catch(err => {
  console.error('\n❌ BÀI TEST BƯỚC 4 THẤT BẠI:', err.message);
  process.exit(1);
});
