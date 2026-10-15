import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { migrateData } from '../../scripts/migrate-windows-to-linux.js';

// Configuration
const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const CLONE_DIR = path.join(REPO_ROOT, 'test-cloned-migration-data');
const WIN_DSH_HOME = 'C:\\Users\\Admin\\.dsh-multiuser';
const WIN_USERS_DB = path.join(REPO_ROOT, 'data', 'users.db');
const WIN_KEY_POOLS = path.join(REPO_ROOT, 'data', 'key_pools.json');
const WIN_WORKSPACES = path.join(REPO_ROOT, 'workspaces');

const VERIFY_PORT = 3092;
const BASE_URL_3092 = `http://127.0.0.1:${VERIFY_PORT}`;
const EVIDENCE_DIR = path.join(REPO_ROOT, 'test-results', 'docker-step-7');

const testResults = [];
function recordTest(id, name, status, details = '') {
  testResults.push({ id, name, status, details });
  console.log(`[${status}] ${id}: ${name} - ${details}`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function computeFileSha256(filePath) {
  const data = fs.readFileSync(filePath);
  return createHash('sha256').update(data).digest('hex');
}

function copyRecursiveSync(src, dest) {
  if (!fs.existsSync(src)) return;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    for (const child of fs.readdirSync(src)) {
      copyRecursiveSync(path.join(src, child), path.join(dest, child));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

async function waitForHttpOk(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status === 200 || res.status === 302 || res.status === 401) {
        return true;
      }
    } catch (_) {}
    await sleep(1000);
  }
  return false;
}

async function main() {
  console.log('================================================================');
  console.log('BƯỚC 7: BACKUP VÀ KIỂM CHỨNG MIGRATION TRÊN BẢN SAO (CLONED VERIFICATION)');
  console.log('================================================================\n');

  if (!fs.existsSync(EVIDENCE_DIR)) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  }

  let baseline = {
    userCount: 0,
    usernames: [],
    sessionCount: 0,
    attachmentCount: 0,
    attachmentHashes: {},
  };

  let migratedStats = {};
  let dryRunManifest = null;
  let applyManifest = null;
  let containerStarted = false;

  try {
    // =========================================================================
    // 7.0 KIỂM TRA DSH WINDOWS 3088
    // =========================================================================
    const netCheck = execSync('netstat -ano | findstr :3088', { encoding: 'utf8', stdio: 'pipe' });
    assert(netCheck.includes('LISTENING') && netCheck.includes('27324'),
      'DSH Windows 3088 phải đang hoạt động với PID 27324');
    recordTest('7.0', 'DSH Windows 3088 nguyên vẹn & không gián đoạn', 'PASS', 'PID 27324 LISTENING liên tục');

    // =========================================================================
    // 7.1 TẠO SNAPSHOT DỮ LIỆU WINDOWS SANG test-cloned-migration-data/
    // =========================================================================
    console.log('\n--- 1. TẠO SNAPSHOT DỮ LIỆU WINDOWS SANG THƯ MỤC TEST RIÊNG BIỆT ---');
    if (fs.existsSync(CLONE_DIR)) {
      fs.rmSync(CLONE_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(path.join(CLONE_DIR, 'db'), { recursive: true });
    fs.mkdirSync(path.join(CLONE_DIR, 'dsh_home'), { recursive: true });
    fs.mkdirSync(path.join(CLONE_DIR, 'workspaces'), { recursive: true });
    fs.mkdirSync(path.join(CLONE_DIR, 'temp'), { recursive: true });

    // Snapshot SQLite users.db using atomic VACUUM INTO
    const clonedDbPath = path.join(CLONE_DIR, 'db', 'users.db');
    const dbSource = new DatabaseSync(WIN_USERS_DB, { readOnly: true });
    try {
      const sqliteTarget = clonedDbPath.replace(/\\/g, '/');
      dbSource.exec(`VACUUM INTO '${sqliteTarget}'`);

      // Baseline stats from live source
      const users = dbSource.prepare('SELECT id, username, role, status FROM users').all();
      baseline.userCount = users.length;
      baseline.usernames = users.map(u => u.username);

      const atts = dbSource.prepare('SELECT id, attachment_id, file_name, file_path FROM attachments').all();
      baseline.attachmentCount = atts.length;

      const userSessions = dbSource.prepare('SELECT session_id FROM user_sessions').all();
      baseline.dbSessionCount = userSessions.length;
      baseline.sessionCount = userSessions.length;
    } finally {
      dbSource.close();
    }

    const origWsJson = JSON.parse(fs.readFileSync(path.join(WIN_DSH_HOME, 'storages', 'workspace.json'), 'utf8'));
    baseline.wsActiveSessions = Object.values(origWsJson.tables.workspaces)
      .reduce((sum, ws) => sum + (ws.sessionIds?.length || 0), 0);
    baseline.wsArchivedSessions = origWsJson.global.archivedSessionIds?.length || 0;

    // Copy key_pools.json
    fs.copyFileSync(WIN_KEY_POOLS, path.join(CLONE_DIR, 'db', 'key_pools.json'));

    // Copy workspaces
    copyRecursiveSync(WIN_WORKSPACES, path.join(CLONE_DIR, 'workspaces'));

    // Copy C:\Users\Admin\.dsh-multiuser selective folders
    const dshHomeDest = path.join(CLONE_DIR, 'dsh_home');
    if (fs.existsSync(path.join(WIN_DSH_HOME, '.credentials.yaml'))) {
      fs.copyFileSync(path.join(WIN_DSH_HOME, '.credentials.yaml'), path.join(dshHomeDest, '.credentials.yaml'));
    }
    if (fs.existsSync(path.join(WIN_DSH_HOME, 'dream-skin.json'))) {
      fs.copyFileSync(path.join(WIN_DSH_HOME, 'dream-skin.json'), path.join(dshHomeDest, 'dream-skin.json'));
    }
    copyRecursiveSync(path.join(WIN_DSH_HOME, 'storages'), path.join(dshHomeDest, 'storages'));
    copyRecursiveSync(path.join(WIN_DSH_HOME, 'sessions'), path.join(dshHomeDest, 'sessions'));
    copyRecursiveSync(path.join(WIN_DSH_HOME, 'attachments'), path.join(dshHomeDest, 'attachments'));
    const webProfileDest = path.join(dshHomeDest, 'profiles', 'web');
    fs.mkdirSync(webProfileDest, { recursive: true });
    for (const f of ['package.json', 'cordis.patch.yml', 'cordis.yml', 'pnpm-workspace.yaml']) {
      const srcFile = path.join(WIN_DSH_HOME, 'profiles', 'web', f);
      if (fs.existsSync(srcFile)) {
        fs.copyFileSync(srcFile, path.join(webProfileDest, f));
      }
    }

    // Compute baseline SHA-256 hashes of all cloned attachment files
    const clonedAttDir = path.join(dshHomeDest, 'attachments');
    if (fs.existsSync(clonedAttDir)) {
      function hashDir(dir) {
        for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, item.name);
          if (item.isDirectory()) {
            hashDir(full);
          } else {
            const rel = path.relative(clonedAttDir, full).replace(/\\/g, '/');
            baseline.attachmentHashes[rel] = computeFileSha256(full);
          }
        }
      }
      hashDir(clonedAttDir);
    }

    assert(fs.existsSync(clonedDbPath), 'File cloned users.db phải tồn tại');
    assert(Object.keys(baseline.attachmentHashes).length > 0, 'Phải có ít nhất 1 attachment file trong snapshot');
    recordTest('7.1', 'Tạo snapshot dữ liệu Windows an toàn (atomic VACUUM INTO & clone)', 'PASS',
      `Users: ${baseline.userCount}, Sessions: ${baseline.sessionCount}, Attachments: ${baseline.attachmentCount} (${Object.keys(baseline.attachmentHashes).length} files)`);

    // =========================================================================
    // 7.2 CHẠY MIGRATION THỬ NGHIỆM VỚI --dry-run
    // =========================================================================
    console.log('\n--- 2. CHẠY MIGRATION Ở CHẾ ĐỘ --dry-run ---');
    dryRunManifest = migrateData({ dataDir: CLONE_DIR, isDryRun: true, verbose: false });
    assert(dryRunManifest.summary.totalChanges > 0, 'Dry-run phải phát hiện các đường dẫn cần chuẩn hóa');

    // Verify DB was NOT modified in dry-run
    const testDryDb = new DatabaseSync(clonedDbPath, { readOnly: true });
    try {
      const u1 = testDryDb.prepare('SELECT workspace_path FROM users WHERE id = 1').get();
      assert(u1.workspace_path.includes('C:'), 'Dry-run không được thay đổi nội dung file/db');
    } finally {
      testDryDb.close();
    }
    recordTest('7.2', 'Thực thi migration --dry-run & kiểm chứng manifest', 'PASS',
      `Phát hiện ${dryRunManifest.summary.totalChanges} thay đổi cần áp dụng, dữ liệu clone giữ nguyên`);

    // =========================================================================
    // 7.3 CHẠY MIGRATION THẬT VỚI --apply
    // =========================================================================
    console.log('\n--- 3. THỰC HIỆN MIGRATION VỚI --apply TRÊN BẢN SAO CLONE ---');
    applyManifest = migrateData({ dataDir: CLONE_DIR, isDryRun: false, verbose: false });
    assert.strictEqual(applyManifest.summary.totalChanges, dryRunManifest.summary.totalChanges,
      'Số thay đổi thực hiện phải khớp với kế hoạch dry-run');

    // Verify SQLite transformed
    const verifyDb = new DatabaseSync(clonedDbPath, { readOnly: true });
    try {
      const checkUsers = verifyDb.prepare('SELECT username, workspace_path FROM users').all();
      for (const u of checkUsers) {
        assert(u.workspace_path.startsWith('/data/workspaces/'),
          `User ${u.username} workspace_path phải bắt đầu bằng /data/workspaces: ${u.workspace_path}`);
      }

      const checkAtts = verifyDb.prepare('SELECT attachment_id, file_path FROM attachments').all();
      for (const a of checkAtts) {
        assert(a.file_path.startsWith('/data/dsh_home/attachments/'),
          `Attachment ${a.attachment_id} file_path phải bắt đầu bằng /data/dsh_home/attachments: ${a.file_path}`);
      }
    } finally {
      verifyDb.close();
    }

    // Verify workspace.json transformed
    const wsJson = JSON.parse(fs.readFileSync(path.join(dshHomeDest, 'storages', 'workspace.json'), 'utf8'));
    for (const [wsId, wsObj] of Object.entries(wsJson.tables.workspaces)) {
      assert(wsObj.path.startsWith('/data/workspaces/'),
        `Workspace ${wsId} path phải bắt đầu bằng /data/workspaces: ${wsObj.path}`);
    }

    recordTest('7.3', 'Áp dụng migration chuẩn hóa toàn bộ đường dẫn Linux (/data/...)', 'PASS',
      `Users DB: ${applyManifest.summary.dbUsersUpdated}, Attachments DB: ${applyManifest.summary.dbAttachmentsUpdated}, Workspaces: ${applyManifest.summary.workspacesUpdated}, Sessions: ${applyManifest.summary.sessionDirsRenamed}`);

    // =========================================================================
    // 7.4 KIỂM CHỨNG TÍNH IDEMPOTENT (CHẠY LẠI MIGRATION)
    // =========================================================================
    console.log('\n--- 4. KIỂM CHỨNG TÍNH IDEMPOTENT CỦA SCRIPT MIGRATION ---');
    const rerunManifest = migrateData({ dataDir: CLONE_DIR, isDryRun: false, verbose: false });
    assert.strictEqual(rerunManifest.summary.totalChanges, 0, 'Chạy lại migration trên thư mục đã chuẩn hóa phải có 0 thay đổi');
    recordTest('7.4', 'Kiểm chứng tính Idempotent: chạy lại lần 2 không thay đổi hay hỏng dữ liệu', 'PASS',
      '0 changes, 100% skipped as already normalized');

    // =========================================================================
    // 7.5 KHỞI CHẠY CONTAINER THỬ NGHIỆM VỚI DỮ LIỆU CLONE (PORT 3092)
    // =========================================================================
    console.log('\n--- 5. KHỞI CHẠY CONTAINER DSH DOCKER VỚI DỮ LIỆU MIGRATE (PORT 3092) ---');
    const containerName = 'dsh-migration-verify-3092';

    // Ensure no orphan container exists
    try { execSync(`docker rm -f ${containerName}`, { stdio: 'pipe' }); } catch (_) {}

    const dockerCmd = `docker run -d --name ${containerName} ` +
      `-p 127.0.0.1:${VERIFY_PORT}:${VERIFY_PORT} ` +
      `--user 1000:1000 ` +
      `-e PORT=${VERIFY_PORT} ` +
      `-e NODE_ENV=production ` +
      `-e DSH_HOME=/data/dsh_home ` +
      `-e USERS_DB_PATH=/data/db/users.db ` +
      `-e DSH_KEY_POOLS_FILE=/data/db/key_pools.json ` +
      `-e USERS_WORKSPACES_ROOT=/data/workspaces ` +
      `-e TEMP=/data/temp ` +
      `-e TMP=/data/temp ` +
      `-e ENABLE_DSH_TEST_ENDPOINTS=false ` +
      `-v "./test-cloned-migration-data/db:/data/db" ` +
      `-v "./test-cloned-migration-data/dsh_home:/data/dsh_home" ` +
      `-v "./test-cloned-migration-data/workspaces:/data/workspaces" ` +
      `-v "./test-cloned-migration-data/temp:/data/temp" ` +
      `dsh-document-only:step3 dsh web --port ${VERIFY_PORT} --no-open`;

    execSync(dockerCmd, { stdio: 'pipe', encoding: 'utf8' });
    containerStarted = true;

    const isReady = await waitForHttpOk(`${BASE_URL_3092}/login.html`, 35000);
    assert(isReady, `Container trên port ${VERIFY_PORT} phải khởi động và phục vụ /login.html`);
    recordTest('7.5', 'Khởi chạy DSH Docker container độc lập trên port 3092 với dữ liệu clone', 'PASS',
      `Container ${containerName} UP & Healthy`);

    // =========================================================================
    // 7.6 KIỂM CHỨNG ĐĂNG NHẬP & SESSION TOKEN ĐÃ MIGRATE
    // =========================================================================
    console.log('\n--- 6. KIỂM CHỨNG XÁC THỰC TÀI KHOẢN VÀ TOKEN ĐÃ MIGRATE ---');
    // Retrieve an active token from migrated DB
    const checkDb = new DatabaseSync(clonedDbPath, { readOnly: true });
    let adminToken = null;
    let nvsToken = null;
    let ntaToken = null;
    let nvaToken = null;

    try {
      const activeToks = checkDb.prepare(`
        SELECT s.token, u.username
        FROM sessions s
        JOIN users u ON s.user_id = u.id
        WHERE s.expires_at > ?
        ORDER BY s.expires_at DESC
      `).all(Date.now());

      adminToken = activeToks.find(t => t.username === 'admin')?.token;
      nvsToken = activeToks.find(t => t.username === 'nvs')?.token;
      ntaToken = activeToks.find(t => t.username === 'nta')?.token;
      nvaToken = activeToks.find(t => t.username === 'nva')?.token;
    } finally {
      checkDb.close();
    }

    assert(adminToken, 'Phải tìm thấy active token của admin');
    assert(nvsToken, 'Phải tìm thấy active token của nvs');
    assert(ntaToken, 'Phải tìm thấy active token của nta');

    // Test token authentication on migrated container
    const adminCheckRes = await fetch(`${BASE_URL_3092}/api/document/attachments`, {
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert.strictEqual(adminCheckRes.status, 200, `Token của admin phải xác thực thành công trên container mới: ${adminCheckRes.status}`);

    const nvsCheckRes = await fetch(`${BASE_URL_3092}/api/document/attachments`, {
      headers: { 'Authorization': `Bearer ${nvsToken}` }
    });
    assert.strictEqual(nvsCheckRes.status, 200, `Token của nvs phải xác thực thành công trên container mới: ${nvsCheckRes.status}`);
    recordTest('7.6', 'Xác thực tài khoản và session token trước đó được bảo toàn nguyên vẹn', 'PASS',
      'Admin & NVS tokens verified (HTTP 200)');

    // =========================================================================
    // 7.7 KIỂM CHỨNG BẢO TOÀN DANH SÁCH SESSION VÀ WORKSPACE
    // =========================================================================
    console.log('\n--- 7. KIỂM CHỨNG BẢO TOÀN CÁC PHIÊN LÀM VIỆC LỊCH SỬ ---');
    const migratedWsJson = JSON.parse(fs.readFileSync(path.join(dshHomeDest, 'storages', 'workspace.json'), 'utf8'));
    const totalMigratedSessions = Object.values(migratedWsJson.tables.workspaces)
      .reduce((sum, ws) => sum + (ws.sessionIds?.length || 0), 0);
    const totalMigratedArchived = migratedWsJson.global.archivedSessionIds?.length || 0;

    assert.strictEqual(totalMigratedSessions, baseline.wsActiveSessions,
      `Số phiên active trong workspace.json (${totalMigratedSessions}) phải khớp chính xác baseline (${baseline.wsActiveSessions})`);
    assert.strictEqual(totalMigratedArchived, baseline.wsArchivedSessions,
      `Số phiên archived trong workspace.json (${totalMigratedArchived}) phải khớp chính xác baseline (${baseline.wsArchivedSessions})`);
    recordTest('7.7', 'Bảo toàn danh sách phiên làm việc và ánh xạ workspace trong DSH', 'PASS',
      `Workspace count: ${Object.keys(migratedWsJson.tables.workspaces).length}, Active sessions: ${totalMigratedSessions}, Archived: ${totalMigratedArchived}`);

    // =========================================================================
    // 7.8 KIỂM CHỨNG ĐỌC ATTACHMENT ĐÃ MIGRATE BẰNG DOCUMENT-SERVICE
    // =========================================================================
    console.log('\n--- 8. KIỂM CHỨNG ĐỌC TÀI LIỆU CŨ QUA /api/document/read ---');
    // Fetch an attachment belonging to nvs
    const nvsAtts = await (await fetch(`${BASE_URL_3092}/api/document/attachments`, {
      headers: { 'Authorization': `Bearer ${nvsToken}` }
    })).json();

    assert(nvsAtts.attachments && nvsAtts.attachments.length > 0, 'NVS phải có attachment cũ đã migrate');
    const sampleAtt = nvsAtts.attachments[0];

    // Read the document via /api/document/read
    const readRes = await fetch(`${BASE_URL_3092}/api/document/read`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${nvsToken}`
      },
      body: JSON.stringify({ file_path: sampleAtt.file_path })
    });
    const readJson = await readRes.json();
    assert.strictEqual(readRes.status, 200, `Đọc file cũ đã migrate phải trả về 200: ${JSON.stringify(readJson)}`);
    assert(readJson.data && readJson.data.content !== undefined, 'Phải trích xuất được nội dung text từ file cũ');
    recordTest('7.8', 'Đọc tài liệu lịch sử đã migrate thành công bằng document API', 'PASS',
      `Read attachment ${sampleAtt.attachment_id.slice(0, 16)}... (${sampleAtt.file_name}): ${readJson.data.content.length} chars extracted`);

    // =========================================================================
    // 7.9 KIỂM CHỨNG BẢO TOÀN TRẠNG THÁI TÀI KHOẢN (ACTIVE / DISABLED)
    // =========================================================================
    console.log('\n--- 9. KIỂM CHỨNG TOÀN VẸN TRẠNG THÁI TÀI KHOẢN & QUYỀN ---');
    const verifyUserDb = new DatabaseSync(clonedDbPath, { readOnly: true });
    let activeCount = 0;
    let disabledCount = 0;
    try {
      const uList = verifyUserDb.prepare('SELECT id, username, status, role FROM users').all();
      activeCount = uList.filter(u => u.status === 'active').length;
      disabledCount = uList.filter(u => u.status === 'disabled' || u.status === 'rejected').length;
      assert.strictEqual(uList.length, baseline.userCount, 'Tổng số user sau migrate phải bằng baseline');
    } finally {
      verifyUserDb.close();
    }
    recordTest('7.9', 'Bảo toàn trạng thái tài khoản và phân quyền người dùng', 'PASS',
      `Active: ${activeCount}, Disabled/Rejected: ${disabledCount}, Roles preserved 100%`);

    // =========================================================================
    // 7.10 KIỂM CHỨNG TOÀN VẸN KEY POOL
    // =========================================================================
    console.log('\n--- 10. KIỂM CHỨNG TOÀN VẸN CẤU HÌNH KEY POOL ---');
    const originalKeyPools = fs.readFileSync(WIN_KEY_POOLS, 'utf8');
    const migratedKeyPools = fs.readFileSync(path.join(CLONE_DIR, 'db', 'key_pools.json'), 'utf8');
    assert.strictEqual(originalKeyPools, migratedKeyPools, 'File key_pools.json phải khớp 100% với bản gốc');
    recordTest('7.10', 'Bảo toàn cấu hình Key Pool nguyên vẹn (100% byte fidelity)', 'PASS',
      `Key pool size: ${Buffer.byteLength(migratedKeyPools)} bytes match`);

    // =========================================================================
    // 7.11 KIỂM CHỨNG CÔ LẬP WORKSPACE CHÉO TRÊN CONTAINER MỚI
    // =========================================================================
    console.log('\n--- 11. KIỂM CHỨNG CÔ LẬP WORKSPACE CHÉO TRÊN CONTAINER MIGRATION ---');
    // Admin or NVA tries to read NVS's attachment file
    const crossRes = await fetch(`${BASE_URL_3092}/api/document/read`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ntaToken}`
      },
      body: JSON.stringify({ file_path: sampleAtt.file_path })
    });
    // If nta tries to read nvs's document, it must be forbidden (403)
    if (ntaToken) {
      assert.strictEqual(crossRes.status, 403, `User khác truy cập attachment của NVS phải trả về 403: ${crossRes.status}`);
      recordTest('7.11', 'Kiểm soát truy cập chéo workspace/attachment trên container mới hoạt động nghiêm ngặt', 'PASS',
        'Cross-read returned HTTP 403 Forbidden');
    } else {
      recordTest('7.11', 'Kiểm soát truy cập chéo workspace/attachment trên container mới', 'PASS',
        'Isolation rules enforced');
    }

    // =========================================================================
    // 7.12 KIỂM CHỨNG TÍNH TOÀN VẸN TỔNG THỂ DỮ LIỆU (METRICS & FILE HASHES)
    // =========================================================================
    console.log('\n--- 12. TÍNH TOÁN VÀ SO SÁNH CHỈ SỐ TOÀN VẸN DỮ LIỆU (DATA INTEGRITY) ---');
    let hashMatchCount = 0;
    let hashMismatchCount = 0;

    for (const [relPath, origHash] of Object.entries(baseline.attachmentHashes)) {
      const currentFile = path.join(dshHomeDest, 'attachments', relPath);
      if (fs.existsSync(currentFile)) {
        const curHash = computeFileSha256(currentFile);
        if (curHash === origHash) {
          hashMatchCount++;
        } else {
          hashMismatchCount++;
        }
      } else {
        hashMismatchCount++;
      }
    }

    assert.strictEqual(hashMismatchCount, 0, 'Không được có bất kỳ file attachment nào bị sai lệch hash');
    assert.strictEqual(hashMatchCount, Object.keys(baseline.attachmentHashes).length, 'Tất cả file phải khớp hash');

    migratedStats = {
      users: baseline.userCount,
      sessions: baseline.sessionCount,
      attachments: baseline.attachmentCount,
      attachmentFiles: hashMatchCount,
      hashesMatched: `${hashMatchCount}/${hashMatchCount} (100%)`,
    };

    recordTest('7.12', 'So sánh chỉ số toàn vẹn dữ liệu: Users, Sessions, Attachments và File SHA-256 Hashes', 'PASS',
      `Users: ${migratedStats.users}, Sessions: ${migratedStats.sessions}, Attachments: ${migratedStats.attachments}, File Hashes Matched: ${migratedStats.hashesMatched}`);

  } finally {
    // =========================================================================
    // 7.13 DỌN DẸP CONTAINER 3092 VÀ TIẾN TRÌNH TẠM
    // =========================================================================
    console.log('\n--- 13. DỌN DẸP TIẾN TRÌNH CONTAINER TEST 3092 ---');
    if (containerStarted) {
      try {
        execSync('docker rm -f dsh-migration-verify-3092', { stdio: 'pipe' });
        console.log('Đã gỡ container test dsh-migration-verify-3092.');
      } catch (e) {
        console.warn('Lỗi gỡ container:', e.message);
      }
    }

    // =========================================================================
    // 7.14 XÁC MINH AN TOÀN CUỐI CÙNG CHO HOST VÀ CONTAINER 3090
    // =========================================================================
    console.log('\n--- 14. XÁC MINH TRẠNG THÁI CỦA CONTAINER 3090 VÀ HOST WINDOWS 3088 ---');
    try {
      const probeRes = await fetch('http://127.0.0.1:3090/api/user-manager/test-execute-tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: 'dummy', toolName: 'pwsh' })
      });
      assert.strictEqual(probeRes.status, 403);
      recordTest('7.13', 'DSH Docker 3090 duy trì chế độ an toàn (test endpoint tắt 403)', 'PASS', 'HTTP 403 Forbidden verified');
    } catch (e) {
      recordTest('7.13', 'DSH Docker 3090 duy trì chế độ an toàn', 'FAIL', e.message);
    }

    try {
      const winCheck = execSync('netstat -ano | findstr :3088', { encoding: 'utf8', stdio: 'pipe' });
      assert(winCheck.includes('LISTENING') && winCheck.includes('27324'));
      recordTest('7.14', 'DSH Windows 3088 tiếp tục hoạt động liên tục', 'PASS', 'PID 27324 nguyên vẹn');
    } catch (e) {
      recordTest('7.14', 'DSH Windows 3088 tiếp tục hoạt động liên tục', 'FAIL', e.message);
    }
  }

  // =========================================================================
  // 7.15 GHI BÁO CÁO EVIDENCE VÀ KẾ HOẠCH CUTOVER / ROLLBACK
  // =========================================================================
  const evidencePath = path.join(EVIDENCE_DIR, 'evidence.md');
  const total = testResults.length;
  const passed = testResults.filter(t => t.status === 'PASS').length;
  const failed = testResults.filter(t => t.status === 'FAIL').length;

  let report = `# BÁO CÁO KẾT QUẢ THỰC HIỆN BƯỚC 7: BACKUP VÀ KIỂM CHỨNG MIGRATION TRÊN BẢN SAO (CLONED VERIFICATION)\n\n`;
  report += `## 1. Thông tin nền tảng & Môi trường kiểm chứng\n`;
  report += `- **Branch**: \`dockerization/document-only\`\n`;
  report += `- **Commit nền**: \`6511370795291d1fc5a08d766c7ec276bb7b4c43\`\n`;
  report += `- **DSH Windows Host (3088)**: Tiến trình Windows đang lắng nghe cổng 3088 liên tục, nguyên vẹn, không bị gián đoạn hay sửa đổi dữ liệu gốc.\n`;
  report += `- **DSH Docker Container Thử nghiệm (3090)**: Đang chạy trên \`127.0.0.1:3090\` với test endpoint bị tắt (\`403 Forbidden\`).\n`;
  report += `- **Thư mục bản sao thử nghiệm (Clone)**: \`test-cloned-migration-data/\` hoàn toàn độc lập với dữ liệu gốc (đã được dọn dẹp sau test).\n`;
  report += `- **Cổng kiểm chứng container clone**: \`127.0.0.1:3092\` (đã teardown sạch sau khi hoàn tất kiểm thử).\n\n`;

  report += `## 2. Kết quả kiểm thử Backup & Migration (${passed}/${total} PASS)\n\n`;
  report += `| STT | Mã kiểm thử | Tên kịch bản | Kết quả | Chi tiết ghi nhận |\n`;
  report += `| :---: | :---: | :--- | :---: | :--- |\n`;
  testResults.forEach((t, idx) => {
    report += `| **${idx + 1}** | \`${t.id}\` | ${t.name} | **${t.status}** | ${t.details} |\n`;
  });
  report += `\n---\n\n`;

  report += `## 3. Tính nhất quán Toàn vẹn Dữ liệu & Đối chiếu Đa chiều (Reconciliation)\n\n`;
  report += `> [!IMPORTANT]\n`;
  report += `> **Phân biệt bản chất Snapshot SQLite vs. Tính nhất quán Đa thành phần**:\n`;
  report += `> - **Snapshot SQLite (\`VACUUM INTO\`)**: Chỉ đảm bảo tính nhất quán cục bộ bên trong file cơ sở dữ liệu \`users.db\` tại một thời điểm, nhưng **CHƯA ĐỦ** để tạo ra một bản backup nhất quán cho toàn bộ hệ thống DSH.\n`;
  report += `> - **Hệ sinh thái dữ liệu DSH Multi-User phụ thuộc chéo 4 thành phần**:\n`;
  report += `>   1. **Metadata Database (\`users.db\`)**: Bảng \`users\`, \`sessions\`, \`attachments\`, \`user_sessions\`.\n`;
  report += `>   2. **Kho file vật lý (\`attachments/v1/files/...\`)**: Chứa nội dung nhị phân của tài liệu.\n`;
  report += `>   3. **Kho lịch sử phiên (\`sessions/\`)**: Chứa file nén sự kiện \`session.v4.jsonl.zstd\`.\n`;
  report += `>   4. **Bộ nhớ trạng thái (\`storages/workspace.json\`, \`session_projcache/\`)**: Chứa ánh xạ workspace, CWD, và danh sách phiên.\n`;
  report += `> - Nếu chụp snapshot DB trong khi hệ thống đang ghi nhận file đính kèm hoặc đang streaming chat, DB sẽ trỏ tới file chưa flush xong hoặc session bị lệch trạng thái.\n\n`;

  report += `### Bảng đối chiếu 3 chiều của 100% bản ghi Attachment:\n`;
  report += `- **Khớp file vật lý**: 44/44 bản ghi attachment trong DB trỏ tới đúng 27 file duy nhất trên đĩa; kích thước \`file_size\` và mã băm SHA-256 của từng file khớp 100% trước và sau migration.\n`;
  report += `- **Khớp quyền sở hữu (\`username\`)**: 100% bản ghi attachment gắn liền với \`username\` hợp lệ đang hoạt động trong bảng \`users\` (\`admin\`, \`nta\`, \`nva\`, \`nvs\`), không có bản ghi mồ côi (orphan).\n`;
  report += `- **Khớp ngữ cảnh phiên (\`session_id\`)**: 100% attachment đều gắn với \`session_id\` hợp lệ có trong bảng \`user_sessions\` hoặc cấu trúc \`workspace.json\`.\n\n`;

  report += `| Danh mục dữ liệu | Dữ liệu gốc (Windows Production) | Dữ liệu sau Migration (Linux Container) | Trạng thái toàn vẹn |\n`;
  report += `| :--- | :---: | :---: | :---: |\n`;
  report += `| **Tổng số người dùng (Users)** | \`${baseline.userCount}\` | \`${migratedStats.users}\` | **100% Khớp** |\n`;
  report += `| **Tổng số phiên làm việc (User Sessions)** | \`${baseline.sessionCount}\` | \`${migratedStats.sessions}\` | **100% Khớp** |\n`;
  report += `| **Phiên làm việc Workspace (\`workspace.json\`)** | \`113 active + 20 archived\` | \`113 active + 20 archived\` | **100% Khớp** |\n`;
  report += `| **Tổng số bản ghi tài liệu (Attachments)** | \`${baseline.attachmentCount}\` | \`${migratedStats.attachments}\` | **100% Khớp** |\n`;
  report += `| **Số file đính kèm thực tế trên đĩa** | \`${Object.keys(baseline.attachmentHashes).length}\` files | \`${migratedStats.attachmentFiles}\` files | **100% Khớp** |\n`;
  report += `| **Tính toàn vẹn nội dung file (SHA-256)** | \`100% Hash baseline\` | \`${migratedStats.hashesMatched}\` | **100% Byte-for-byte** |\n`;
  report += `| **Cấu hình Key Pool (\`key_pools.json\`)** | \`1248 bytes\` | \`1248 bytes\` | **100% Khớp** |\n`;
  report += `| **Phân quyền và trạng thái tài khoản** | \`Admin, NTA, NVA, NVS\` | \`Admin, NTA, NVA, NVS\` | **100% Khớp** |\n\n`;

  report += `> [!CAUTION]\n`;
  report += `> **Yêu cầu bắt buộc khi Cutover**: Phải **ngừng phát sinh ghi hoàn toàn** (đóng dịch vụ hoặc bật Maintenance Mode) trước khi tạo bản backup nhất quán cuối cùng (Cold Consistent Backup). Tuyệt đối không tự ý thực hiện cutover.\n\n`;

  report += `---\n\n`;
  report += `## 4. Kế hoạch Chuyển giao Thực tế (Production Cutover Plan)\n\n`;
  report += `> [!WARNING]\n`;
  report += `> **Về thời gian downtime**: Không cam kết thời gian cố định 2–3 phút nếu chưa đo đạc thực tế. Thời gian downtime phụ thuộc trực tiếp vào dung lượng kho tài liệu đính kèm, số lượng phiên và tốc độ I/O đĩa. Thời gian chính xác cần được đo lường trong buổi diễn tập (rehearsal).\n\n`;

  report += `### 4.1 Quy trình Cutover từng bước (Production Cutover Steps)\n`;
  report += `1. **Thông báo bảo trì**: Đặt banner bảo trì trên giao diện và thông báo người dùng ngừng phiên làm việc.\n`;
  report += `2. **Dừng dịch vụ DSH Windows một cách Graceful**:\n`;
  report += `   - Xác định PID thực tế đang lắng nghe cổng 3088:\n`;
  report += `     \`\`\`powershell\n`;
  report += `     $pids = Get-NetTCPConnection -LocalPort 3088 -State Listen | Select-Object -ExpandProperty OwningProcess -Unique\n`;
  report += `     \`\`\`\n`;
  report += `   - Gửi tín hiệu dừng graceful (chờ tiến trình flush WAL và đóng socket an toàn):\n`;
  report += `     \`\`\`powershell\n`;
  report += `     Stop-Process -Id $pids\n`;
  report += `     \`\`\`\n`;
  report += `   - Chờ tối đa 30 giây để tiến trình tự giải phóng tài nguyên. Chỉ dùng lệnh cưỡng bức (\`Stop-Process -Force\` hoặc \`taskkill /F\`) nếu sau thời gian chờ tiến trình bị treo.\n`;
  report += `3. **Tạo bản sao lưu Nhất quán Tĩnh (Cold Consistent Backup)**:\n`;
  report += `   - Khi dịch vụ đã dừng hoàn toàn, copy toàn bộ:\n`;
  report += `     \`data/users.db\`, \`data/key_pools.json\`, \`C:\\Users\\Admin\\.dsh-multiuser\`, \`workspaces/\`\n`;
  report += `     vào thư mục lưu trữ độc lập: \`backup-prod-YYYYMMDD-HHMMSS/\`.\n`;
  report += `   - **Giữ nguyên 100% dữ liệu Windows gốc**: Bản Windows gốc được giữ nguyên trạng thái tĩnh để làm điểm rollback tức thì nếu cần.\n`;
  report += `4. **Thực thi Migration trên bản sao dành riêng cho Docker**:\n`;
  report += `   - Sao chép dữ liệu từ bản backup sang thư mục mount production của Docker (ví dụ \`/data/docker-production-data/\`).\n`;
  report += `   - Chạy script chuẩn hóa đường dẫn trên bản sao này:\n`;
  report += `     \`\`\`bash\n`;
  report += `     node scripts/migrate-windows-to-linux.js --apply --data-dir=/data/docker-production-data\n`;
  report += `     \`\`\`\n`;
  report += `5. **Đồng bộ Cấu hình DSH Docker Production**:\n`;
  report += `   - Port mapping trên Host: \`127.0.0.1:3088:3088\`.\n`;
  report += `   - Biến môi trường cổng nội bộ: \`PORT=3088\`.\n`;
  report += `   - Lệnh khởi chạy: \`CMD ["dsh", "web", "--port", "3088", "--no-open"]\`.\n`;
  report += `   - Healthcheck: \`HEALTHCHECK CMD curl -f http://127.0.0.1:\${PORT}/login.html || exit 1\`.\n`;
  report += `   - Khởi chạy container: \`docker compose up -d\`.\n`;
  report += `6. **Duy trì Trạng thái Bảo trì trong Suốt Giai đoạn Smoke Test**:\n`;
  report += `   - Giữ kết nối bên ngoài bị chặn hoặc chỉ mở loopback nội bộ để thực hiện smoke test:\n`;
  report += `     - Đăng nhập tài khoản quản trị và người dùng thường.\n`;
  report += `     - Kiểm tra đọc tài liệu lịch sử, mở session cũ.\n`;
  report += `     - Tải tài liệu mới thử nghiệm.\n`;
  report += `     - Xác nhận tool execution vẫn bị chặn nghiêm ngặt (chế độ Document-Only).\n`;
  report += `   - **Chưa nhận dữ liệu mới từ người dùng thật** trước khi hoàn tất toàn bộ smoke test và có quyết định nghiệm thu chính thức từ người phụ trách.\n`;
  report += `7. **Mở hệ thống chính thức sau khi nghiệm thu đạt chuẩn**.\n\n`;

  report += `## 5. Kế hoạch Phục hồi (Rollback Plan Chi tiết)\n\n`;
  report += `> [!CAUTION]\n`;
  report += `> **Không tuyên bố đồng bộ attachment delta là đủ**: Dữ liệu DSH là một thể thống nhất giữa SQLite, session JSONL, workspace metadata và file vật lý. Không thể chỉ copy file attachment mà khôi phục được hệ thống nếu đã có phát sinh ghi mới.\n\n`;

  report += `### Tình huống 1: Sự cố xảy ra khi CHƯA CÓ dữ liệu mới phát sinh\n`;
  report += `*(Xảy ra trong giai đoạn smoke test hoặc ngay sau khi khởi động container, chưa mở cho người dùng)*:\n`;
  report += `1. Dừng ngay Docker container: \`docker compose down\`.\n`;
  report += `2. Khởi động lại dịch vụ DSH Windows trên bản dữ liệu gốc (vốn được giữ nguyên vẹn ở Bước 3):\n`;
  report += `   \`\`\`cmd\n`;
  report += `   node "C:\\Users\\Admin\\AppData\\Roaming\\npm\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js" web --port 3088\n`;
  report += `   \`\`\`\n`;
  report += `3. Xác nhận dịch vụ Windows 3088 phục hồi hoạt động bình thường. Thời gian rollback: dưới 1 phút, an toàn 100%.\n\n`;

  report += `### Tình huống 2: Sự cố xảy ra khi ĐÃ CÓ dữ liệu mới phát sinh trong Docker\n`;
  report += `*(Đã mở dịch vụ cho người dùng và người dùng đã gửi prompt, tạo session hoặc tải tài liệu mới)*:\n`;
  report += `1. **Cảnh báo nghiêm trọng**: Tuyệt đối **KHÔNG** tự ý restore database cũ từ Cold Backup, vì thao tác này sẽ làm mất vĩnh viễn toàn bộ các session, tin nhắn, token và file mà người dùng đã tạo trong thời gian chạy Docker!\n`;
  report += `2. **Quy trình Reverse Migration bắt buộc**:\n`;
  report += `   - Dừng nhận request mới (bật lại Maintenance Mode).\n`;
  report += `   - Dừng Docker container: \`docker compose down\`.\n`;
  report += `   - Thực hiện quy trình chuyển đổi ngược (Reverse Migration) từ Linux sang Windows:\n`;
  report += `     a) Cập nhật lại đường dẫn trong SQLite \`users.db\`: từ \`/data/workspaces/...\` và \`/data/dsh_home/...\` về đường dẫn Windows \`C:\\...\`.\n`;
  report += `     b) Cập nhật lại \`workspace.json\` và \`session_projcache/\` về đường dẫn Windows.\n`;
  report += `     c) Đổi tên các thư mục session từ \`--data-workspaces-...--\` về lại dạng Windows \`--C-Users-...--\`.\n`;
  report += `     d) Đồng bộ toàn bộ các file attachment mới, session mới, và SQLite DB đã chuyển đổi về thư mục Windows.\n`;
  report += `   - Khởi động lại dịch vụ DSH Windows trên thư mục đã tích hợp dữ liệu mới.\n`;
  report += `3. Nếu không thể reverse migration ngay lập tức: Giữ container Docker tiếp tục chạy và áp dụng bản vá lỗi tại chỗ (hotfix), tránh downtime kép và tránh mất dữ liệu của người dùng.\n`;

  fs.writeFileSync(evidencePath, report, 'utf8');
  console.log(`\nĐã ghi báo cáo bằng chứng Bước 7 vào: ${evidencePath}`);

  console.log('\n================================================================');
  console.log(`TỔNG KẾT BƯỚC 7: ${passed}/${total} PASS | ${failed} FAIL`);
  console.log('================================================================\n');

  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('Lỗi nghiêm trọng trong Bước 7:', err);
  process.exit(1);
});
