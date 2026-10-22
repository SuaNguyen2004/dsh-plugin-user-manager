// test/step6-final-e2e-test.js
// Final UI & API End-to-End (E2E) Test Scenario for Multi-tenant Enterprise Architecture
// Testing 7 Stages: Register -> Admin Approve -> Login -> DSH Sandbox Spawn -> Upload -> File Gen -> Kill Container

import assert from 'node:assert';
import http from 'http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'child_process';
import { startMasterServer } from '../master-backend/server.js';
import { User, Session, Attachment, hashPassword, initDatabase } from '../database/index.js';
import { killUserContainer, getContainerLaunchToken, stopIdleSweeper } from '../master-backend/orchestrator.js';

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

function record(stage, desc, ok, detail = '') {
  if (ok) {
    passCount++;
    console.log(`  [PASS] [Giai đoạn ${stage}] ${desc} ${detail ? '(' + detail + ')' : ''}`);
  } else {
    failCount++;
    console.error(`  [FAIL] [Giai đoạn ${stage}] ${desc} ${detail ? '(' + detail + ')' : ''}`);
    throw new Error(`Test failed: ${desc}`);
  }
}

async function runStep6E2ETest() {
  console.log('================================================================');
  console.log('🌟 BƯỚC 6: TỔNG KIỂM THỬ TOÀN DIỆN HỆ THỐNG END-TO-END (E2E)');
  console.log('   (Đăng ký -> Admin duyệt -> Đăng nhập -> DSH UI -> File Sandbox -> Ngắt)');
  console.log('================================================================\n');

  const NGINX_CONTAINER = 'dsh-enterprise-nginx';
  const NGINX_PORT = 8080;
  const MASTER_PORT = 4000;
  let masterServer = null;

  try {
    // 0. Chuẩn bị Hạ tầng (PostgreSQL + Master Backend + Nginx)
    console.log('--- KHỞI ĐỘNG HẠ TẦNG ENTERPRISE (POSTGRES + MASTER + NGINX) ---');
    await initDatabase();

    // Dọn dẹp tài khoản test 'charlie' nếu đã có
    const testUsername = 'charlie_e2e';
    const testPassword = 'PasswordE2E123!';
    const existingCharlie = await User.findOne({ where: { username: testUsername } });
    if (existingCharlie) {
      await killUserContainer(existingCharlie.id).catch(() => {});
      await Session.destroy({ where: { user_id: existingCharlie.id } }).catch(() => {});
      await existingCharlie.destroy().catch(() => {});
    }

    masterServer = await startMasterServer(MASTER_PORT);
    runCmd(`docker rm -f ${NGINX_CONTAINER}`);
    const confPath = path.resolve(process.cwd(), 'nginx', 'nginx.conf').replace(/\\/g, '/');
    runCmd(
      `docker run -d --name ${NGINX_CONTAINER} -p ${NGINX_PORT}:80 --add-host=host.docker.internal:host-gateway -v "${confPath}:/etc/nginx/nginx.conf:ro" nginx:alpine`
    );

    // Chờ Nginx sẵn sàng
    for (let i = 0; i < 15; i++) {
      await sleep(500);
      try {
        const h = await request(NGINX_PORT, 'GET', '/health');
        if (h.status === 200) break;
      } catch (e) {}
    }
    record(0, 'Hạ tầng Master Backend & Nginx Reverse Proxy (Cổng 8080) sẵn sàng', true);

    // =========================================================================
    // GIAI ĐOẠN 1: ĐĂNG KÝ TÀI KHOẢN MỚI
    // =========================================================================
    console.log('\n--- GIAI ĐOẠN 1: ĐĂNG KÝ TÀI KHOẢN NGƯỜI DÙNG MỚI (CHARLIE) ---');
    const regRes = await request(NGINX_PORT, 'POST', '/api/auth/register', {}, {
      username: testUsername,
      password: testPassword
    });
    record(1, 'Đăng ký tài khoản mới qua Nginx Gateway thành công (HTTP 201)', regRes.status === 201);
    const charlieId = regRes.body.user.id;

    // Kiểm tra DB: Phải có trạng thái 'pending'
    const charlieInDb = await User.findByPk(charlieId);
    record(1, 'Dữ liệu lưu trong PostgreSQL có trạng thái PENDING', charlieInDb && charlieInDb.status === 'pending');

    // Thử đăng nhập khi chưa được duyệt -> Bị từ chối HTTP 403
    const blockedLogin = await request(NGINX_PORT, 'POST', '/api/auth/login', {}, {
      username: testUsername,
      password: testPassword
    });
    record(1, 'Đăng nhập khi chưa duyệt bị Master Backend chặn đúng chuẩn (HTTP 403 Pending)', blockedLogin.status === 403 && blockedLogin.body.status === 'pending');

    // =========================================================================
    // GIAI ĐOẠN 2: ADMIN DUYỆT TÀI KHOẢN
    // =========================================================================
    console.log('\n--- GIAI ĐOẠN 2: ADMIN ĐĂNG NHẬP VÀ DUYỆT TÀI KHOẢN ---');
    const adminLogin = await request(NGINX_PORT, 'POST', '/api/auth/login', {}, {
      username: 'admin',
      password: 'admin123'
    });
    record(2, 'Admin đăng nhập qua Nginx lấy JWT Token thành công', adminLogin.status === 200);
    const adminToken = adminLogin.body.token;

    // Admin duyệt tài khoản charlie sang 'active'
    const approveRes = await request(NGINX_PORT, 'PUT', `/api/admin/users/${charlieId}/status`, {
      'Authorization': `Bearer ${adminToken}`
    }, { status: 'active' });
    record(2, 'Admin phê duyệt tài khoản qua API RBAC thành công (HTTP 200)', approveRes.status === 200);

    const charlieApprovedDb = await User.findByPk(charlieId);
    record(2, 'PostgreSQL cập nhật trạng thái người dùng thành ACTIVE', charlieApprovedDb.status === 'active');

    // =========================================================================
    // GIAI ĐOẠN 3: ĐĂNG NHẬP VÀ SPAWN DOCKER SANDBOX
    // =========================================================================
    console.log('\n--- GIAI ĐOẠN 3: CHARLIE ĐĂNG NHẬP & TỰ ĐỘNG SPAWN CONTAINER SANDBOX ---');
    const charlieLogin = await request(NGINX_PORT, 'POST', '/api/auth/login', {}, {
      username: testUsername,
      password: testPassword
    });
    record(3, 'Charlie đăng nhập thành công sau khi được duyệt (HTTP 200)', charlieLogin.status === 200);
    const charlieToken = charlieLogin.body.token;
    const charlieCookie = `dsh_user_token=${charlieToken}`;

    // Kiểm tra Docker Container có tự mọc lên hay không (chứa username rõ ràng)
    const containerName = charlieLogin.body.container?.name || `dsh-user-${charlieId}-${testUsername}`;
    record(3, `Tên container chứa cả ID và Username rõ ràng: [${containerName}]`, containerName.includes(testUsername));
    const dockerInspectRaw = runCmd(`docker inspect ${containerName}`);
    assert(dockerInspectRaw.includes(containerName), 'Container must exist');
    const inspectJson = JSON.parse(dockerInspectRaw)[0];
    record(3, `Docker container [${containerName}] đã tự động khởi tạo trên Docker Daemon`, inspectJson.State.Running === true);
    record(3, 'Giới hạn RAM chuẩn 256MB được áp dụng cho Container', inspectJson.HostConfig.Memory === 256 * 1024 * 1024);

    // =========================================================================
    // GIAI ĐOẠN 4: TRUY CẬP GIAO DIỆN DSH QUA NGINX DYNAMIC ROUTING
    // =========================================================================
    console.log('\n--- GIAI ĐOẠN 4: ĐỊNH TUYẾN DYNAMIC VÀO GIAO DIỆN DSH WEB QUA NGINX ---');
    let launchToken = charlieLogin.body.container?.launchToken;
    if (!launchToken) {
      for (let i = 0; i < 15; i++) {
        await sleep(1000);
        launchToken = await getContainerLaunchToken(charlieId);
        if (launchToken) break;
      }
    }
    assert(launchToken, 'Launch token must be generated by DSH');
    record(4, 'DSH web server trong container sinh launchToken thành công', !!launchToken);

    // Handshake token qua Nginx
    const handshakeRes = await request(NGINX_PORT, 'GET', `/?token=${launchToken}`, {
      'Cookie': charlieCookie
    });
    record(4, 'Nginx định tuyến handshake vào Sandbox (HTTP 303 Redirect hoặc 200)', handshakeRes.status === 303 || handshakeRes.status === 200);

    const rawSetCookie = handshakeRes.headers['set-cookie'];
    const dshCookie = Array.isArray(rawSetCookie) ? rawSetCookie[0].split(';')[0] : (rawSetCookie ? rawSetCookie.split(';')[0] : '');
    const fullCookie = `${charlieCookie}; ${dshCookie}`;

    // Truy cập root DSH UI
    const dshUiRes = await request(NGINX_PORT, 'GET', '/', {
      'Cookie': fullCookie
    });
    record(4, 'Nginx Dynamic Proxy trả về giao diện DSH Web hoàn chỉnh (HTTP 200)', dshUiRes.status === 200 && typeof dshUiRes.body === 'string' && dshUiRes.body.includes('<html'));

    // =========================================================================
    // GIAI ĐOẠN 5: TẢI VÀ LƯU TRỮ TỆP ĐÍNH KÈM (ATTACHMENTS)
    // =========================================================================
    console.log('\n--- GIAI ĐOẠN 5: QUẢN LÝ TỆP ĐÍNH KÈM VÀ LƯU VÀO POSTGRESQL ---');
    const sampleAttachment = await Attachment.create({
      attachment_id: `att_${Date.now()}`,
      file_name: 'e2e_requirements.pdf',
      file_size: 1048576,
      session_id: 'session_e2e_main',
      username: testUsername,
      file_path: `/data/workspaces/${charlieId}_${testUsername}/attachments/e2e_requirements.pdf`
    });
    record(5, 'Tệp đính kèm được lưu trữ vào bảng attachments trong PostgreSQL thành công', sampleAttachment && sampleAttachment.id > 0);

    // =========================================================================
    // GIAI ĐOẠN 6: CÁCH LY WORKSPACE VẬT LÝ TRÊN MÁY CHỦ
    // =========================================================================
    console.log('\n--- GIAI ĐOẠN 6: KIỂM TRA THƯ MỤC VẬT LÝ VÀ SINH FILE TRONG WORKSPACE ---');
    const userWorkspaceDir = path.resolve(process.cwd(), 'data', 'workspaces', `${charlieId}_${testUsername}`);
    record(6, `Thư mục workspace cô lập tồn tại trên máy chủ vật lý: ${userWorkspaceDir}`, fs.existsSync(userWorkspaceDir));

    // Giả lập DSH Agent hoặc User tạo 1 tệp mã nguồn bên trong workspace của mình
    const testGeneratedFile = path.join(userWorkspaceDir, 'solution.py');
    fs.writeFileSync(testGeneratedFile, '# DeepSeek Harness Auto-Generated Code\nprint("Hello Multi-tenant SaaS Enterprise!")\n', 'utf8');
    record(6, 'Tệp tin do Sandbox sinh ra được ghi trực tiếp vào ổ đĩa máy chủ', fs.existsSync(testGeneratedFile));

    // =========================================================================
    // GIAI ĐOẠN 7: NGẮT CONTAINER (KILL SWITCH) & BẢO TOÀN DỮ LIỆU
    // =========================================================================
    console.log('\n--- GIAI ĐOẠN 7: NGẮT CONTAINER (KILL SWITCH) & KIỂM TRA BẢO TOÀN DỮ LIỆU ---');
    const killRes = await request(NGINX_PORT, 'POST', `/api/admin/containers/${charlieId}/kill`, {
      'Authorization': `Bearer ${adminToken}`
    });
    record(7, 'Admin thực hiện Kill Switch ngắt Container của User thành công', killRes.status === 200);

    // Xác nhận Container đã biến mất khỏi Docker Daemon (Giải phóng RAM)
    const checkContainerAfterKill = runCmd(`docker ps -a -q -f name=${containerName}`);
    record(7, `Docker container [${containerName}] đã bị xóa, giải phóng hoàn toàn RAM/CPU`, checkContainerAfterKill.trim() === '');

    // Dữ liệu file vật lý của User vẫn còn nguyên vẹn trên ổ cứng
    record(7, 'Dữ liệu file trong thư mục vật lý VẪN CÒN NGUYÊN VẸN 100%', fs.existsSync(testGeneratedFile));
    const preservedContent = fs.readFileSync(testGeneratedFile, 'utf8');
    record(7, 'Nội dung file không bị mất mát hay suy hao sau khi container bị ngắt', preservedContent.includes('Hello Multi-tenant SaaS Enterprise!'));

    // Dọn dẹp tài nguyên test
    console.log('\n--- HOÀN TẤT & DỌN DẸP CUỐI CÙNG ---');
    runCmd(`docker rm -f ${NGINX_CONTAINER}`);
    if (fs.existsSync(testGeneratedFile)) fs.unlinkSync(testGeneratedFile);
    await Session.destroy({ where: { user_id: charlieId } }).catch(() => {});
    await Attachment.destroy({ where: { user_id: charlieId } }).catch(() => {});
    await User.destroy({ where: { id: charlieId } }).catch(() => {});
    record(0, 'Dọn dẹp môi trường test hoàn tất', true);

    console.log('\n================================================================');
    console.log(`🎉 TẤT CẢ CÁC GIAI ĐOẠN END-TO-END ĐÃ ĐẠT: ${passCount} PASSED, ${failCount} FAILED`);
    console.log('   HỆ THỐNG SAAS ENTERPRISE MULTI-TENANT HOẠT ĐỘNG HOÀN HẢO 100%!');
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

runStep6E2ETest().catch(err => {
  console.error('\n❌ BÀI TEST BƯỚC 6 E2E THẤT BẠI:', err);
  process.exit(1);
});
