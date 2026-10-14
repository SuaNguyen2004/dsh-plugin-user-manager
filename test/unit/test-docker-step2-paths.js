import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  initDatabase,
  closeDatabase,
  createUser,
  findUserByUsername,
  recordAttachment,
  recordUserSession,
  getWorkspacesRoot
} from '../../lib/common/db.js';
import {
  getUserWorkspaceDir,
  resolveSafePath,
  readWorkspaceFile,
  writeWorkspaceFile,
  getDshHome
} from '../../lib/user/workspace.js';
import {
  validateFileToolAccess,
  validateShellCommandAccess,
  isAttachmentStorePath,
  setupToolSecurityGuard
} from '../../lib/user/security-guard.js';
import { extractDocument } from '../../lib/document/document-extractor.js';
import { KeyPoolManager } from '../../lib/admin/key-pool.js';

// Setup isolated, timestamped test directory
const runId = 'step2-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
const testRoot = process.env.TEST_ROOT || path.resolve('test', '.tmp-docker-step2', runId);

const DSH_HOME_TEST = path.join(testRoot, 'dsh_home');
const DB_PATH_TEST = path.join(testRoot, 'db', 'users.db');
const KEY_POOLS_TEST = path.join(testRoot, 'db', 'key_pools.json');
const WORKSPACES_TEST = path.join(testRoot, 'workspaces');
const TEMP_TEST = path.join(testRoot, 'temp');

// Create test directories
fs.mkdirSync(DSH_HOME_TEST, { recursive: true });
fs.mkdirSync(path.dirname(DB_PATH_TEST), { recursive: true });
fs.mkdirSync(WORKSPACES_TEST, { recursive: true });
fs.mkdirSync(TEMP_TEST, { recursive: true });

// Snapshot real paths before test to guarantee isolation
const REAL_DATA_DIR = path.resolve('data');
const REAL_WORKSPACES_DIR = path.resolve('workspaces');
const REAL_DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh-multiuser');

function snapshotDir(dirPath) {
  if (!fs.existsSync(dirPath)) return null;
  const entries = {};
  try {
    const list = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const item of list) {
      const full = path.join(dirPath, item.name);
      try {
        const stat = fs.statSync(full);
        entries[item.name] = { mtime: stat.mtimeMs, size: stat.size };
      } catch (_) {}
    }
  } catch (_) {}
  return entries;
}

const beforeRealData = snapshotDir(REAL_DATA_DIR);
const beforeRealWorkspaces = snapshotDir(REAL_WORKSPACES_DIR);
const beforeRealDshHome = snapshotDir(REAL_DSH_HOME);

// Apply isolated environment variables
process.env.DSH_HOME = DSH_HOME_TEST;
process.env.USERS_DB_PATH = DB_PATH_TEST;
process.env.DSH_KEY_POOLS_FILE = KEY_POOLS_TEST;
process.env.USERS_WORKSPACES_ROOT = WORKSPACES_TEST;
process.env.TEMP = TEMP_TEST;
process.env.TMP = TEMP_TEST;

const results = [];
let allPassed = true;

function recordTest(name, fn) {
  const startTime = Date.now();
  try {
    fn();
    const duration = Date.now() - startTime;
    console.log(`[PASS] ${name} (${duration}ms)`);
    results.push({ name, status: 'PASS', duration, error: null });
  } catch (err) {
    const duration = Date.now() - startTime;
    console.error(`[FAIL] ${name} (${duration}ms):`, err.message);
    results.push({ name, status: 'FAIL', duration, error: err.message });
    allPassed = false;
  }
}

async function recordTestAsync(name, fn) {
  const startTime = Date.now();
  try {
    await fn();
    const duration = Date.now() - startTime;
    console.log(`[PASS] ${name} (${duration}ms)`);
    results.push({ name, status: 'PASS', duration, error: null });
  } catch (err) {
    const duration = Date.now() - startTime;
    console.error(`[FAIL] ${name} (${duration}ms):`, err.message);
    results.push({ name, status: 'FAIL', duration, error: err.message });
    allPassed = false;
  }
}

console.log('======================================================================');
console.log('   STEP 2: KIỂM THỬ CHUẨN HÓA ĐƯỜNG DẪN VÀ CÔ LẬP MÔI TRƯỜNG DOCKER   ');
console.log('======================================================================');
console.log(`Test Root: ${testRoot}`);
console.log(`DSH_HOME: ${process.env.DSH_HOME}`);
console.log(`USERS_DB_PATH: ${process.env.USERS_DB_PATH}`);
console.log(`DSH_KEY_POOLS_FILE: ${process.env.DSH_KEY_POOLS_FILE}`);
console.log(`USERS_WORKSPACES_ROOT: ${process.env.USERS_WORKSPACES_ROOT}\n`);

async function runAll() {
  // 1. Initialize isolated database
  recordTest('1. Khởi tạo cơ sở dữ liệu SQLite tại thư mục test cô lập', () => {
    initDatabase(DB_PATH_TEST);
    assert.strictEqual(fs.existsSync(DB_PATH_TEST), true, 'Database file must exist in test dir');
    assert.strictEqual(getWorkspacesRoot(), WORKSPACES_TEST, 'getWorkspacesRoot must match USERS_WORKSPACES_ROOT');
    assert.strictEqual(getDshHome(), DSH_HOME_TEST, 'getDshHome must match DSH_HOME_TEST');
  });

  // 2. Create two test users and verify workspace paths
  let u1, u2;
  recordTest('2. Tạo 2 user giả và kiểm tra getUserWorkspaceDir khớp workspace_path', () => {
    u1 = createUser('user_alpha', 'passAlpha123', 'user', 100000, 'active');
    u2 = createUser('user_beta', 'passBeta456', 'user', 100000, 'active');

    assert.ok(u1, 'User 1 must be created');
    assert.ok(u2, 'User 2 must be created');

    const u1Dir = getUserWorkspaceDir('user_alpha');
    const u2Dir = getUserWorkspaceDir('user_beta');

    assert.strictEqual(path.resolve(u1.workspace_path), path.resolve(u1Dir), 'u1 workspace_path must match getUserWorkspaceDir');
    assert.strictEqual(path.resolve(u2.workspace_path), path.resolve(u2Dir), 'u2 workspace_path must match getUserWorkspaceDir');

    assert.strictEqual(u1Dir.startsWith(path.resolve(WORKSPACES_TEST)), true, 'u1 dir must be inside WORKSPACES_TEST');
    assert.strictEqual(u2Dir.startsWith(path.resolve(WORKSPACES_TEST)), true, 'u2 dir must be inside WORKSPACES_TEST');
    assert.strictEqual(fs.existsSync(u1Dir), true, 'u1 workspace dir must exist on disk');
    assert.strictEqual(fs.existsSync(u2Dir), true, 'u2 workspace dir must exist on disk');
  });

  // Register test sessions for users
  recordUserSession('sess_alpha_1', 'user_alpha', 'user-workspace-user_alpha');
  recordUserSession('sess_beta_1', 'user_beta', 'user-workspace-user_beta');

  // Setup security guard with mock context
  let registeredGuard = null;
  const mockToolsService = {
    guard(fn) {
      registeredGuard = fn;
    }
  };
  const mockCtx = {
    tools: mockToolsService,
    inject(deps, cb) {
      if (deps.includes('tools')) {
        cb({ tools: mockToolsService });
      }
    }
  };
  setupToolSecurityGuard(mockCtx);
  assert.strictEqual(typeof registeredGuard, 'function', 'Tool security guard must be registered');

  // 3. Read and write TXT UTF-8 with Vietnamese filename and spaces
  await recordTestAsync('3. Đọc/ghi file TXT UTF-8 có tên tiếng Việt và khoảng trắng', async () => {
    const vnFileName = 'Báo cáo tài chính quý 1 năm 2026.txt';
    const vnContent = 'Dự án Docker hóa: Kiểm thử đường dẫn đa nền tảng và ký tự tiếng Việt có dấu: ă, â, đ, ê, ô, ơ, ư.\nSố dư: 1.000.000 ₫.';

    writeWorkspaceFile('user_alpha', vnFileName, vnContent);

    const readBack = readWorkspaceFile('user_alpha', vnFileName);
    assert.strictEqual(readBack, vnContent, 'Read back content must match original UTF-8 content exactly');

    // Also verify extractDocument tool logic
    const fullFilePath = path.join(getUserWorkspaceDir('user_alpha'), vnFileName);
    const docResult = await extractDocument(fullFilePath);
    assert.strictEqual(docResult.format.toLowerCase(), 'txt', 'Format must be txt');
    assert.strictEqual(docResult.content, vnContent, 'Extracted content must match UTF-8 text');
    assert.ok(docResult.totalCharacters > 0, 'Character count must be positive');
  });

  // 4. Cross-workspace isolation
  recordTest('4. Chặn đọc/ghi chéo workspace giữa hai user', () => {
    const u1Dir = getUserWorkspaceDir('user_alpha');
    const u2Dir = getUserWorkspaceDir('user_beta');
    const u2File = path.join(u2Dir, 'secret_notes.txt');
    fs.writeFileSync(u2File, 'Top secret beta data', 'utf8');

    // Attempt traversal via resolveSafePath
    assert.throws(() => {
      resolveSafePath('user_alpha', '../user_beta/secret_notes.txt');
    }, /Truy cập bị từ chối|Path traversal/i, 'Path traversal must be rejected');

    // Attempt access via validateFileToolAccess
    const readDenial = validateFileToolAccess('read', u2File, 'sess_alpha_1', 'user_alpha', u1Dir);
    assert.ok(readDenial, 'Read other user workspace must be denied');

    const writeDenial = validateFileToolAccess('write', u2File, 'sess_alpha_1', 'user_alpha', u1Dir);
    assert.ok(writeDenial, 'Write other user workspace must be denied');

    // Attempt access via full security guard
    const guardDenial = registeredGuard({
      name: 'read_document',
      arguments: { file_path: u2File },
      agent: { session: { header: { id: 'sess_alpha_1', cwd: u1Dir } } }
    });
    assert.ok(guardDenial, 'Guard must deny read_document targeting another user workspace');
  });

  // 5. Cross-attachment isolation
  recordTest('5. Chặn đọc chéo attachment của user khác', () => {
    const u1Dir = getUserWorkspaceDir('user_alpha');
    const u2AttId = 'att_beta_999';
    const u2AttPath = path.join(DSH_HOME_TEST, 'attachments', 'v1', 'files', 'att_beta_999.pdf');
    fs.mkdirSync(path.dirname(u2AttPath), { recursive: true });
    fs.writeFileSync(u2AttPath, '%PDF-1.4 dummy', 'utf8');

    recordAttachment({
      attachmentId: u2AttId,
      fileName: 'secret.pdf',
      fileSize: 100,
      filePath: u2AttPath,
      sessionId: 'sess_beta_1',
      username: 'user_beta'
    });

    // user_alpha trying to access user_beta attachment
    const attDenial = validateFileToolAccess('read', u2AttPath, 'sess_alpha_1', 'user_alpha');
    assert.ok(attDenial, 'Access to other user attachment must be denied');
    assert.ok(isAttachmentStorePath(u2AttPath), 'Path must be recognized as attachment store path');

    // Full guard check
    const guardDenial = registeredGuard({
      name: 'read_document',
      arguments: { file_path: u2AttPath },
      agent: { session: { header: { id: 'sess_alpha_1', cwd: u1Dir } } }
    });
    assert.ok(guardDenial, 'Guard must deny reading another user attachment');
  });

  // 6. Document-Only mode blocks shell tools for regular users
  recordTest('6. Document-Only mode chặn shell tools (pwsh, bash, cmd, run_command) cho user thường', () => {
    const u1Dir = getUserWorkspaceDir('user_alpha');

    // Guard-level Document-Only checks
    const shellTools = ['pwsh', 'bash', 'cmd', 'run_command', 'terminal'];
    for (const tool of shellTools) {
      const denial = registeredGuard({
        name: tool,
        arguments: { command: 'echo 123' },
        agent: { session: { header: { id: 'sess_alpha_1', cwd: u1Dir } } }
      });
      assert.ok(denial, `Document-Only guard must block ${tool} for regular user`);
      assert.ok(denial.includes('Document-Only'), `Denial message must mention Document-Only`);
    }

    // Direct validateShellCommandAccess check
    const directPwsh = validateShellCommandAccess('pwsh', 'Get-Process', u1Dir, 'sess_alpha_1', 'user_alpha', u1Dir);
    // In Document-Only mode, any shell command is disallowed or restricted to harmless within workspace
    assert.ok(directPwsh === null || typeof directPwsh === 'string', 'validateShellCommandAccess returns valid check');
  });

  // 7. Security Guard fail-closed behavior on errors / invalid inputs
  recordTest('7. Guard gặp lỗi hoặc tham số không hợp lệ phải từ chối (Fail-Closed)', () => {
    // Unregistered / unknown session
    const unknownSessDenial = registeredGuard({
      name: 'read_document',
      arguments: { file_path: 'doc.txt' },
      agent: { session: { header: { id: 'unregistered_sess_999' } } }
    });
    assert.ok(unknownSessDenial, 'Unregistered session must be denied by default');
    assert.ok(unknownSessDenial.includes('chưa được xác thực'), 'Denial must cite unverified session');

    // Null execution / corrupted input
    const nullExecDenial = registeredGuard(null);
    assert.ok(nullExecDenial, 'Null execution object must be denied');

    // Missing agent/session header
    const noHeaderDenial = registeredGuard({ name: 'read_document' });
    assert.ok(noHeaderDenial, 'Missing session header must be denied');

    // Pre-filter null byte injection
    assert.ok(validateFileToolAccess('read', 'safe/path\0/evil.txt', 'sess_alpha_1', 'user_alpha'), 'Null byte must be denied');
  });

  // 8. Close/reopen DB and Key Pool persistence
  recordTest('8. Đóng/mở lại DB và Key Pool, dữ liệu test được bảo toàn chính xác', () => {
    // Add synthetic test keys to KeyPoolManager
    const poolManager = new KeyPoolManager();
    poolManager.init();
    poolManager.addKeys('deepseek/chat', ['sk-fixture-key-01-abcdef', 'sk-fixture-key-02-ghijkl']);

    assert.strictEqual(fs.existsSync(KEY_POOLS_TEST), true, 'Key pool file must exist on disk');

    // Close DB
    closeDatabase();

    // Reopen DB
    const reopenedDb = initDatabase(DB_PATH_TEST);
    assert.ok(reopenedDb, 'DB must reopen successfully');

    // Check user data persisted
    const loadedU1 = findUserByUsername('user_alpha');
    const loadedU2 = findUserByUsername('user_beta');
    assert.strictEqual(loadedU1?.username, 'user_alpha', 'User alpha must persist');
    assert.strictEqual(loadedU2?.username, 'user_beta', 'User beta must persist');

    // Create fresh KeyPoolManager instance and verify persisted keys
    const freshPool = new KeyPoolManager();
    freshPool.init();
    const activeKey = freshPool.getActiveKey('deepseek/chat');
    assert.strictEqual(activeKey, 'sk-fixture-key-01-abcdef', 'Active key must match persisted fixture');
    const summary = freshPool.getPoolSummary('deepseek/chat');
    assert.strictEqual(summary.total, 2, 'Total keys in pool must persist as 2');
  });

  // 9. Unwritable directory handling with clear error reporting
  recordTest('9. Cấu hình thư mục không ghi được phải báo lỗi rõ ràng', () => {
    // Test invalid DB path where parent is a plain file (causes ENOTDIR / unwritable)
    let dbError = null;
    const blockerFile = path.join(testRoot, 'dummy_blocker_file');
    fs.writeFileSync(blockerFile, 'blocking plain file', 'utf8');
    const impossiblePath = path.join(blockerFile, 'sub_dir', 'users.db');

    try {
      initDatabase(impossiblePath);
    } catch (err) {
      dbError = err;
    }
    assert.ok(dbError, 'Should throw error when DB directory is unwritable');
    assert.strictEqual(typeof dbError.message, 'string');
    assert.ok(
      dbError.message.includes('Cannot initialize database') ||
      dbError.message.includes('Cannot open database') ||
      dbError.message.includes('ENOTDIR'),
      `Error message should be clear, got: ${dbError.message}`
    );

    // Test invalid username or invalid workspace path
    assert.throws(() => {
      getUserWorkspaceDir('');
    }, /Invalid username/i, 'Empty username should throw clean Invalid username error');
  });

  // 10. Verify no modifications occurred in real data, workspaces, or DSH_HOME
  recordTest('10. Xác nhận không phát sinh ghi vào data/workspaces/DSH_HOME thật', () => {
    const afterRealData = snapshotDir(REAL_DATA_DIR);
    const afterRealWorkspaces = snapshotDir(REAL_WORKSPACES_DIR);
    const afterRealDshHome = snapshotDir(REAL_DSH_HOME);

    // Assert real data directory untouched
    assert.deepStrictEqual(afterRealData, beforeRealData, 'Real data/ directory must NOT be modified');
    assert.deepStrictEqual(afterRealWorkspaces, beforeRealWorkspaces, 'Real workspaces/ directory must NOT be modified');
    if (beforeRealDshHome !== null) {
      assert.deepStrictEqual(afterRealDshHome, beforeRealDshHome, 'Real DSH_HOME directory must NOT be modified');
    }
  });

  // Summary output
  console.log('\n======================================================================');
  console.log('                          KẾT QUẢ KIỂM THỬ                            ');
  console.log('======================================================================');
  let passCount = 0;
  let failCount = 0;
  for (const r of results) {
    if (r.status === 'PASS') passCount++;
    else failCount++;
    console.log(`- [${r.status}] ${r.name} (${r.duration}ms)${r.error ? ` -> ${r.error}` : ''}`);
  }
  console.log(`\nTổng số test: ${results.length} | Đạt: ${passCount} | Lỗi: ${failCount}`);

  // Clean up DB connection
  closeDatabase();

  if (!allPassed) {
    process.exit(1);
  }
}

runAll().catch((err) => {
  console.error('Lỗi nghiêm trọng trong quá trình chạy test:', err);
  closeDatabase();
  process.exit(1);
});
