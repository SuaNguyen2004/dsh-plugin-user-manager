import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawn } from 'node:child_process';
import http from 'node:http';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import {
  initDatabase,
  closeDatabase,
  createUser,
  findUserByUsername,
  getWorkspacesRoot
} from '/app/lib/common/db.js';
import {
  getUserWorkspaceDir,
  getDshHome
} from '/app/lib/user/workspace.js';
import { extractDocument } from '/app/lib/document/document-extractor.js';
import { KeyPoolManager } from '/app/lib/admin/key-pool.js';
import {
  buildMultiPagePdfBuffer,
  buildTableDocxBuffer,
  buildVietnameseBomTxtBuffer
} from '/app/test/helpers/fixtures.js';

console.log('======================================================================');
console.log('      BƯỚC 3: KIỂM THỬ RUNTIME LINUX CONTAINER (DSH DOCUMENT-ONLY)    ');
console.log('======================================================================\n');

const results = [];
let allPassed = true;

function recordTest(name, fn) {
  const start = Date.now();
  try {
    fn();
    const duration = Date.now() - start;
    console.log(`[PASS] ${name} (${duration}ms)`);
    results.push({ name, status: 'PASS', duration, error: null });
  } catch (err) {
    const duration = Date.now() - start;
    console.error(`[FAIL] ${name} (${duration}ms):`, err.message);
    results.push({ name, status: 'FAIL', duration, error: err.message });
    allPassed = false;
  }
}

async function recordTestAsync(name, fn) {
  const start = Date.now();
  try {
    await fn();
    const duration = Date.now() - start;
    console.log(`[PASS] ${name} (${duration}ms)`);
    results.push({ name, status: 'PASS', duration, error: null });
  } catch (err) {
    const duration = Date.now() - start;
    console.error(`[FAIL] ${name} (${duration}ms):`, err.message);
    results.push({ name, status: 'FAIL', duration, error: err.message });
    allPassed = false;
  }
}

async function fetchHttp(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error(`Timeout fetching ${url}`));
    });
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

async function runStep3Tests() {
  // A. Node/DSH version & Module imports
  recordTest('A.1 Xác minh phiên bản Node.js (Node 22 LTS)', () => {
    const nodeVer = process.version;
    console.log(`  -> Node version: ${nodeVer}`);
    assert.strictEqual(nodeVer.startsWith('v22.'), true, `Node must be v22.x, got ${nodeVer}`);
  });

  recordTest('A.2 Xác minh phiên bản DSH CLI (@deepseek-ai/dsh@0.2.0-rc.2)', () => {
    const dshVer = execSync('dsh -V', { encoding: 'utf8' }).trim();
    console.log(`  -> DSH version: ${dshVer}`);
    assert.strictEqual(dshVer, '0.2.0-rc.2', `DSH version must be 0.2.0-rc.2, got ${dshVer}`);
  });

  await recordTestAsync('A.3 Import plugin và dependencies (mammoth, pdf-parse, node:sqlite)', async () => {
    const plugin = await import('/app/lib/index.js');
    assert.ok(plugin.apply, 'Plugin must export apply function');
    assert.strictEqual(plugin.name, 'dsh-plugin-user-manager');

    const req = createRequire('/app/package.json');
    const mammothPath = req.resolve('mammoth');
    const mammoth = await import(pathToFileURL(mammothPath).href);
    assert.ok(mammoth.extractRawText, 'mammoth must be importable');

    const pdfParsePath = req.resolve('pdf-parse');
    const pdfParse = await import(pathToFileURL(pdfParsePath).href);
    assert.ok(pdfParse.default || typeof pdfParse === 'function', 'pdf-parse must be importable');
  });

  // B & C. DSH runtime profile config & read_document tool registration
  recordTest('B.1 Xác nhận plugin được nạp trong cấu hình profile qua dsh web --dump-config', () => {
    const testDshHome = '/data/test_step3/dsh_home';
    const profileDir = path.join(testDshHome, 'profiles', 'web');
    fs.mkdirSync(path.join(profileDir, 'node_modules'), { recursive: true });
    try {
      fs.symlinkSync('/app', path.join(profileDir, 'node_modules', 'dsh-plugin-user-manager'), 'dir');
    } catch (_) {}
    fs.writeFileSync(path.join(profileDir, 'package.json'), JSON.stringify({
      name: 'dsh-profile-web',
      private: true,
      dependencies: { 'dsh-plugin-user-manager': 'link:/app' },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-plugin-user-manager'] } }
    }, null, 2));

    const dump = execSync('dsh web --dump-config', {
      encoding: 'utf8',
      env: { ...process.env, DSH_HOME: testDshHome }
    });
    assert.ok(dump.includes('dsh-plugin-user-manager'), 'Dumped profile config must contain dsh-plugin-user-manager');
  });

  await recordTestAsync('B.2 & C. Khởi động DSH thật với plugin và xác nhận read_document được đăng ký', async () => {
    const testPort = 3099;
    const testDshHome = '/data/test_step3/dsh_home';
    const profileDir = path.join(testDshHome, 'profiles', 'web');
    fs.mkdirSync(path.join(profileDir, 'node_modules'), { recursive: true });
    try {
      fs.symlinkSync('/app', path.join(profileDir, 'node_modules', 'dsh-plugin-user-manager'), 'dir');
    } catch (_) {}
    fs.writeFileSync(path.join(profileDir, 'package.json'), JSON.stringify({
      name: 'dsh-profile-web',
      private: true,
      dependencies: { 'dsh-plugin-user-manager': 'link:/app' },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-plugin-user-manager'] } }
    }, null, 2));

    // Spawn real DSH process
    const dshProc = spawn('dsh', [
      'web',
      '--host', '127.0.0.1',
      '--port', String(testPort),
      '--no-open'
    ], {
      env: {
        ...process.env,
        DSH_HOME: testDshHome,
        USERS_DB_PATH: '/data/test_step3/db/users.db',
        DSH_KEY_POOLS_FILE: '/data/test_step3/db/key_pools.json',
        USERS_WORKSPACES_ROOT: '/data/test_step3/workspaces'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdoutLog = '';
    let stderrLog = '';
    dshProc.stdout.on('data', (d) => { stdoutLog += d.toString(); });
    dshProc.stderr.on('data', (d) => { stderrLog += d.toString(); });

    try {
      // Poll until web server is responding (up to 20 seconds)
      let connected = false;
      let lastErr = null;
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 500));
        try {
          const res = await fetchHttp(`http://127.0.0.1:${testPort}/login.html`);
          if (res.status === 200) {
            connected = true;
            assert.ok(res.body.includes('Đăng nhập'), 'login.html must contain login title');
            break;
          }
        } catch (e) {
          lastErr = e;
        }
      }
      assert.strictEqual(connected, true, `DSH web server did not respond on port ${testPort}: ${lastErr?.message}`);

      // Verify plugin's authentication endpoint (admin login)
      const loginRes = await fetchHttp(`http://127.0.0.1:${testPort}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'admin123' })
      });
      assert.strictEqual(loginRes.status, 200, 'Admin login must return HTTP 200');
      const loginData = JSON.parse(loginRes.body);
      assert.ok(loginData.token, 'Token must be returned on login');

      // Verify authenticated session endpoint /api/auth/me
      const meRes = await fetchHttp(`http://127.0.0.1:${testPort}/api/auth/me`, {
        headers: { Authorization: `Bearer ${loginData.token}` }
      });
      assert.strictEqual(meRes.status, 200, '/api/auth/me must return 200 for authenticated user');
      const meData = JSON.parse(meRes.body);
      assert.strictEqual(meData.user.username, 'admin', 'Current user must be admin');

      // Verify stdout log confirmation
      assert.ok(
        stdoutLog.includes('dsh-plugin-user-manager') || stdoutLog.includes('Activating User Management'),
        'DSH stdout log must confirm plugin activation'
      );
      assert.ok(
        stdoutLog.includes('read_document') || stdoutLog.includes('Registered document reading tool') || stdoutLog.includes('Tool Security Guard'),
        'DSH stdout must confirm read_document / security guard registration'
      );
    } finally {
      dshProc.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 500));
      try { dshProc.kill('SIGKILL'); } catch (_) {}
    }
  });

  // D. Document Extraction on Linux: PDF (with text layer), DOCX (with table), TXT (UTF-8)
  await recordTestAsync('D. Trích xuất tài liệu (PDF text layer tiếng Việt, DOCX bảng biểu, TXT UTF-8) trên Linux', async () => {
    const fixtureDir = '/data/test_step3/fixtures';
    fs.mkdirSync(fixtureDir, { recursive: true });

    const pdfPath = path.join(fixtureDir, 'sample_multipage.pdf');
    const docxPath = path.join(fixtureDir, 'sample_table.docx');
    const txtPath = path.join(fixtureDir, 'sample_bom.txt');

    fs.writeFileSync(pdfPath, buildMultiPagePdfBuffer());
    fs.writeFileSync(docxPath, buildTableDocxBuffer());
    fs.writeFileSync(txtPath, buildVietnameseBomTxtBuffer());

    // 1. PDF
    const pdfRes = await extractDocument(pdfPath);
    assert.strictEqual(pdfRes.format, 'PDF', 'Format must be PDF');
    assert.ok(pdfRes.totalPages >= 2, 'Total pages must be >= 2');
    assert.ok(
      pdfRes.content.includes('CONG HOA XA HOI CHU NGHIA VIET NAM') || pdfRes.content.includes('TRANG 1'),
      'PDF content must contain expected Vietnamese document text'
    );

    // 2. DOCX with table
    const docxRes = await extractDocument(docxPath);
    assert.strictEqual(docxRes.format, 'DOCX', 'Format must be DOCX');
    assert.ok(
      docxRes.content.includes('BẢNG KÊ TIẾN ĐỘ THỰC HIỆN CÔNG VIỆC') || docxRes.content.includes('Xác thực người dùng DSH'),
      'DOCX content must contain table text in Vietnamese'
    );

    // 3. TXT UTF-8 with BOM
    const txtRes = await extractDocument(txtPath);
    assert.strictEqual(txtRes.format, 'TXT', 'Format must be TXT');
    assert.ok(
      txtRes.content.includes('CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM') && txtRes.content.includes('Đà Nẵng'),
      'TXT content must contain Vietnamese UTF-8 text'
    );
    assert.notStrictEqual(txtRes.content.charCodeAt(0), 0xFEFF, 'BOM must be stripped');
  });

  // E. Path configuration isolation
  recordTest('E. Cấu hình DSH_HOME, USERS_DB_PATH, DSH_KEY_POOLS_FILE, USERS_WORKSPACES_ROOT điều hướng đúng thư mục test', () => {
    const testIsolationRoot = '/data/test_step3/isolation_env';
    const dshHome = path.join(testIsolationRoot, 'dsh_home');
    const dbPath = path.join(testIsolationRoot, 'db', 'users.db');
    const keyPools = path.join(testIsolationRoot, 'db', 'key_pools.json');
    const wsRoot = path.join(testIsolationRoot, 'workspaces');

    process.env.DSH_HOME = dshHome;
    process.env.USERS_DB_PATH = dbPath;
    process.env.DSH_KEY_POOLS_FILE = keyPools;
    process.env.USERS_WORKSPACES_ROOT = wsRoot;

    closeDatabase();
    initDatabase(dbPath);

    const user = createUser('container_test_user', 'passContainer123', 'user', 50000, 'active');
    assert.ok(user, 'User must be created');
    assert.strictEqual(path.resolve(user.workspace_path), path.resolve(getUserWorkspaceDir('container_test_user')));
    assert.strictEqual(user.workspace_path.startsWith(wsRoot), true, 'User workspace must be under test workspaces root');
    assert.strictEqual(fs.existsSync(dbPath), true, 'SQLite DB must be created under test db path');
    assert.strictEqual(fs.existsSync(user.workspace_path), true, 'User workspace must exist on disk');

    closeDatabase();
  });

  // F. Non-root user permissions & Read-Only enforcement
  recordTest('F. User không phải root (UID 1000) ghi được /data nhưng không ghi được /app (Codebase)', () => {
    const uid = typeof process.getuid === 'function' ? process.getuid() : -1;
    console.log(`  -> Current container process UID: ${uid}`);
    assert.strictEqual(uid, 1000, 'Container process must run as non-root user node (UID 1000)');

    // 1. Can write to /data
    const dataTestFile = '/data/write_test.tmp';
    fs.writeFileSync(dataTestFile, 'writable by node', 'utf8');
    assert.strictEqual(fs.readFileSync(dataTestFile, 'utf8'), 'writable by node');
    fs.rmSync(dataTestFile);

    // 2. CANNOT write to /app
    assert.throws(() => {
      fs.writeFileSync('/app/test_should_fail.txt', 'evil modification');
    }, /EACCES|read-only/i, 'Writing to /app must be rejected with EACCES permission denied');
  });

  // Summary
  console.log('\n======================================================================');
  console.log('                          KẾT QUẢ KIỂM THỬ BƯỚC 3                     ');
  console.log('======================================================================');
  let passCount = 0;
  let failCount = 0;
  for (const r of results) {
    if (r.status === 'PASS') passCount++;
    else failCount++;
    console.log(`- [${r.status}] ${r.name} (${r.duration}ms)${r.error ? ` -> ${r.error}` : ''}`);
  }
  console.log(`\nTổng số test: ${results.length} | Đạt: ${passCount} | Lỗi: ${failCount}`);

  if (!allPassed) {
    process.exit(1);
  }
}

runStep3Tests().catch((err) => {
  console.error('Fatal error running Step 3 tests:', err);
  process.exit(1);
});
