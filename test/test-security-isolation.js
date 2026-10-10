import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
  initDatabase,
  closeDatabase,
  createUser,
  recordUserSession,
  recordAttachment
} from '../lib/db.js';
import {
  getUserWorkspaceDir,
  getOwnerOfSession,
  checkDocumentAccess
} from '../lib/workspace.js';
import { executeReadDocument } from '../lib/document-tool.js';
import {
  canonicalizePath,
  validateFileToolAccess,
  validateShellCommandAccess,
  setupToolSecurityGuard
} from '../lib/security-guard.js';

// Setup isolated test directories
const TEST_DIR = path.resolve('test', '.tmp-security-test');
if (fs.existsSync(TEST_DIR)) {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
}
fs.mkdirSync(TEST_DIR, { recursive: true });

const TEST_DB = path.join(TEST_DIR, 'security_test.db');
const TEST_WS_ROOT = path.join(TEST_DIR, 'workspaces');
const TEST_ATT_DIR = path.join(TEST_DIR, '.dsh-multiuser', 'attachments', 'v1', 'files');

fs.mkdirSync(TEST_WS_ROOT, { recursive: true });
fs.mkdirSync(TEST_ATT_DIR, { recursive: true });

process.env.USERS_DB_PATH = TEST_DB;
process.env.USERS_WORKSPACES_ROOT = TEST_WS_ROOT;
process.env.DSH_HOME = path.join(TEST_DIR, '.dsh-multiuser');

async function runTests() {
  console.log('======================================================================');
  console.log('   BỘ KIỂM THỬ CÔ LẬP TRUY CẬP VÀ PHÂN QUYỀN ĐA NGƯỜI DÙNG (SECURITY)   ');
  console.log('======================================================================\n');

  initDatabase(TEST_DB);

  // Create test users
  createUser('nvs', 'pass_nvs_123', 'user', 100000, 'active');
  createUser('nva', 'pass_nva_123', 'user', 100000, 'active');

  const sessionNvs = 'session-sec-nvs-1';
  const sessionNva = 'session-sec-nva-1';

  recordUserSession(sessionNvs, 'nvs', 'user-workspace-nvs');
  recordUserSession(sessionNva, 'nva', 'user-workspace-nva');

  const wsNvs = getUserWorkspaceDir('nvs');
  const wsNva = getUserWorkspaceDir('nva');

  // Create fake test files
  const SECRET_A = 'FAKE_CONFIDENTIAL_A_DATA_98765';
  const SECRET_B = 'FAKE_CONFIDENTIAL_B_DATA_12345';
  const ATT_SECRET_A = 'FAKE_ATTACHMENT_A_SECRET_AAA';
  const ATT_SECRET_B = 'FAKE_ATTACHMENT_B_SECRET_BBB';

  const fileA = path.join(wsNvs, 'secret_a.txt');
  const fileB = path.join(wsNva, 'secret_b.txt');
  fs.writeFileSync(fileA, SECRET_A, 'utf8');
  fs.writeFileSync(fileB, SECRET_B, 'utf8');

  // Create fake attachments
  const attFolderA = path.join(TEST_ATT_DIR, 'aa', 'hash_a_folder');
  const attFolderB = path.join(TEST_ATT_DIR, 'bb', 'hash_b_folder');
  fs.mkdirSync(attFolderA, { recursive: true });
  fs.mkdirSync(attFolderB, { recursive: true });

  const attFileA = path.join(attFolderA, 'doc_nvs.txt');
  const attFileB = path.join(attFolderB, 'doc_nva.txt');
  fs.writeFileSync(attFileA, ATT_SECRET_A, 'utf8');
  fs.writeFileSync(attFileB, ATT_SECRET_B, 'utf8');

  recordAttachment({
    attachmentId: 'sha256:hash_a_fake',
    fileName: 'doc_nvs.txt',
    fileSize: ATT_SECRET_A.length,
    sessionId: sessionNvs,
    username: 'nvs',
    filePath: attFileA
  });

  recordAttachment({
    attachmentId: 'sha256:hash_b_fake',
    fileName: 'doc_nva.txt',
    fileSize: ATT_SECRET_B.length,
    sessionId: sessionNva,
    username: 'nva',
    filePath: attFileB
  });

  // Setup Symlinks / Junctions (Reparse Points)
  let hasReparsePoints = false;
  const junctionAtoB = path.join(wsNvs, 'junction_to_b');
  const junctionAtoAtt = path.join(wsNvs, 'junction_to_att');
  try {
    fs.symlinkSync(wsNva, junctionAtoB, 'junction');
    fs.symlinkSync(TEST_ATT_DIR, junctionAtoAtt, 'junction');
    hasReparsePoints = true;
    console.log('[INFO] Directory Junctions (NTFS Reparse Points) được thiết lập thành công.');
  } catch (e) {
    console.log('[INFO] Môi trường không cấp quyền tạo junction:', e.message);
  }

  const execNvs = { sessionId: sessionNvs, agent: { session: { header: { id: sessionNvs, cwd: wsNvs } } } };
  const execNva = { sessionId: sessionNva, agent: { session: { header: { id: sessionNva, cwd: wsNva } } } };

  console.log('\n--- PHẦN 1: KIỂM THỬ TOOL read_document (TÀI LIỆU WORKSPACE & ATTACHMENT) ---');

  // 1.1 NVS reads NVS file
  const readA = await executeReadDocument({ file_path: 'secret_a.txt' }, execNvs);
  assert.strictEqual(readA.content, SECRET_A, 'NVS phải đọc được file của mình');
  console.log('  [PASS] 1.1 User A (nvs) đọc thành công file workspace của mình');

  // 1.2 NVS reads NVS attachment
  const readAttA = await executeReadDocument({ file_path: attFileA }, execNvs);
  assert.strictEqual(readAttA.content, ATT_SECRET_A, 'NVS phải đọc được attachment của mình');
  console.log('  [PASS] 1.2 User A (nvs) đọc thành công attachment của mình');

  // 1.3 NVS tries to read NVA file -> MUST THROW & NOT RETURN SECRET_B
  let threw13 = false;
  try {
    const res = await executeReadDocument({ file_path: fileB }, execNvs);
    assert.fail(`Không được phép đọc file của B, nhận được: ${res.content}`);
  } catch (err) {
    threw13 = true;
    assert.strictEqual(String(err.message).includes(SECRET_B), false, 'Lỗi không được chứa nội dung bí mật của B');
    assert.strictEqual(err.status, 403, 'Phải trả mã lỗi 403 Forbidden');
  }
  assert.strictEqual(threw13, true, 'User A phải bị từ chối khi đọc file workspace của User B');
  console.log('  [PASS] 1.3 User A bị chặn đọc file workspace của User B qua read_document (Không trả nội dung)');

  // 1.4 NVS tries to read NVA attachment -> MUST THROW & NOT RETURN ATT_SECRET_B
  let threw14 = false;
  try {
    const res = await executeReadDocument({ file_path: attFileB }, execNvs);
    assert.fail(`Không được phép đọc attachment của B, nhận được: ${res.content}`);
  } catch (err) {
    threw14 = true;
    assert.strictEqual(String(err.message).includes(ATT_SECRET_B), false, 'Lỗi không được chứa nội dung bí mật của B');
    assert.strictEqual(err.status, 403, 'Phải trả mã lỗi 403 Forbidden');
  }
  assert.strictEqual(threw14, true, 'User A phải bị từ chối khi đọc attachment của User B');
  console.log('  [PASS] 1.4 User A bị chặn đọc attachment của User B qua read_document (Không trả nội dung)');

  // 1.5 Symlink / Junction traversal check for read_document
  if (hasReparsePoints) {
    let threw15 = false;
    try {
      const junctionTarget = path.join(junctionAtoB, 'secret_b.txt');
      const res = await executeReadDocument({ file_path: junctionTarget }, execNvs);
      assert.fail(`Không được phép đọc qua junction trỏ tới B, nhận được: ${res.content}`);
    } catch (err) {
      threw15 = true;
      assert.strictEqual(String(err.message).includes(SECRET_B), false, 'Lỗi không được chứa nội dung bí mật của B');
      assert.strictEqual(err.status, 403, 'Phải trả mã lỗi 403 Forbidden');
    }
    assert.strictEqual(threw15, true, 'User A phải bị chặn khi đọc qua directory junction trỏ sang workspace B');
    console.log('  [PASS] 1.5 User A bị chặn đọc file của B qua directory junction trong read_document');
  } else {
    console.log('  [SKIP] 1.5 Bỏ qua test junction vật lý');
  }

  // 1.6 NVA reads NVA file (Hai chiều)
  const readB = await executeReadDocument({ file_path: 'secret_b.txt' }, execNva);
  assert.strictEqual(readB.content, SECRET_B, 'NVA phải đọc được file của mình');
  console.log('  [PASS] 1.6 User B (nva) đọc thành công file workspace của mình');

  // 1.7 NVA reads NVA attachment
  const readAttB = await executeReadDocument({ file_path: attFileB }, execNva);
  assert.strictEqual(readAttB.content, ATT_SECRET_B, 'NVA phải đọc được attachment của mình');
  console.log('  [PASS] 1.7 User B (nva) đọc thành công attachment của mình');

  // 1.8 NVA tries to read NVS file -> MUST THROW & NOT RETURN SECRET_A (Hai chiều)
  let threw18 = false;
  try {
    await executeReadDocument({ file_path: fileA }, execNva);
    assert.fail('B không được phép đọc file của A');
  } catch (err) {
    threw18 = true;
    assert.strictEqual(String(err.message).includes(SECRET_A), false);
    assert.strictEqual(err.status, 403);
  }
  assert.strictEqual(threw18, true);
  console.log('  [PASS] 1.8 User B bị chặn đọc file workspace của User A qua read_document (Hai chiều)');

  // 1.9 NVA tries to read NVS attachment
  let threw19 = false;
  try {
    await executeReadDocument({ file_path: attFileA }, execNva);
    assert.fail('B không được phép đọc attachment của A');
  } catch (err) {
    threw19 = true;
    assert.strictEqual(String(err.message).includes(ATT_SECRET_A), false);
    assert.strictEqual(err.status, 403);
  }
  assert.strictEqual(threw19, true);
  console.log('  [PASS] 1.9 User B bị chặn đọc attachment của User A qua read_document (Hai chiều)');

  console.log('\n--- PHẦN 2: KIỂM THỬ TOOL ĐỌC FILE DSH (read, read_image, edit) QUA SECURITY GUARD ---');

  // 2.1 A reads A's file via file tool
  const denial21 = validateFileToolAccess('read', fileA, sessionNvs, 'nvs', wsNvs);
  assert.strictEqual(denial21, null, 'A đọc file của mình phải được phép');
  console.log('  [PASS] 2.1 User A đọc file trong workspace của mình qua file tool được CHO PHÉP');

  // 2.2 A tries to read B's file via file tool -> DENIED
  const denial22 = validateFileToolAccess('read', fileB, sessionNvs, 'nvs', wsNvs);
  assert.strictEqual(typeof denial22, 'string', 'A đọc file của B phải bị từ chối');
  assert.strictEqual(denial22.includes('nva'), true);
  console.log('  [PASS] 2.2 User A bị chặn đọc file workspace của User B qua tool read');

  // 2.3 A tries to read B's attachment via file tool -> DENIED
  const denial23 = validateFileToolAccess('read', attFileB, sessionNvs, 'nvs', wsNvs);
  assert.strictEqual(typeof denial23, 'string', 'A đọc attachment của B phải bị từ chối');
  console.log('  [PASS] 2.3 User A bị chặn đọc attachment của User B qua tool read');

  // 2.4 Symlink / Junction detection in file tool
  if (hasReparsePoints) {
    const junctionTarget = path.join(junctionAtoB, 'secret_b.txt');
    const denial24 = validateFileToolAccess('read', junctionTarget, sessionNvs, 'nvs', wsNvs);
    assert.strictEqual(typeof denial24, 'string', 'Junction trỏ tới B phải bị từ chối');
    assert.strictEqual(denial24.includes('nva'), true);
    console.log('  [PASS] 2.4 User A bị chặn đọc file của B qua junction trong tool read');
  }

  // 2.5 B reads B's file -> ALLOWED (Hai chiều)
  const denial25 = validateFileToolAccess('read', fileB, sessionNva, 'nva', wsNva);
  assert.strictEqual(denial25, null);
  console.log('  [PASS] 2.5 User B đọc file của mình được CHO PHÉP (Hai chiều)');

  // 2.6 B tries to read A's file -> DENIED (Hai chiều)
  const denial26 = validateFileToolAccess('read', fileA, sessionNva, 'nva', wsNva);
  assert.strictEqual(typeof denial26, 'string');
  assert.strictEqual(denial26.includes('nvs'), true);
  console.log('  [PASS] 2.6 User B bị chặn đọc file của User A qua tool read (Hai chiều)');

  // 2.7 B tries to read A's attachment -> DENIED (Hai chiều)
  const denial27 = validateFileToolAccess('read', attFileA, sessionNva, 'nva', wsNva);
  assert.strictEqual(typeof denial27, 'string');
  console.log('  [PASS] 2.7 User B bị chặn đọc attachment của User A qua tool read (Hai chiều)');

  console.log('\n--- PHẦN 3: KIỂM THỬ LỆNH SHELL (pwsh, bash, node fs.readFileSync, Get-Content) ---');

  // 3.1 A executes legitimate command inside A workspace
  const denial31 = validateShellCommandAccess('pwsh', 'Get-Content -LiteralPath "secret_a.txt"', wsNvs, sessionNvs, 'nvs', wsNvs);
  assert.strictEqual(denial31, null, 'Lệnh hợp lệ trong workspace của A phải được phép');
  console.log('  [PASS] 3.1 User A thực thi lệnh hợp lệ trong workspace của mình: CHO PHÉP');

  // 3.2 A executes Get-Content on B's workspace file -> DENIED
  const cmd32 = `Get-Content -LiteralPath "${fileB}" -Raw -Encoding UTF8`;
  const denial32 = validateShellCommandAccess('pwsh', cmd32, wsNvs, sessionNvs, 'nvs', wsNvs);
  assert.strictEqual(typeof denial32, 'string', 'Lệnh Get-Content trỏ vào B phải bị từ chối');
  assert.strictEqual(denial32.includes('nva'), true);
  console.log('  [PASS] 3.2 User A bị chặn gọi pwsh Get-Content đọc file của User B');

  // 3.3 A executes Get-Content on B's attachment -> DENIED
  const cmd33 = `Get-Content -LiteralPath "${attFileB}" -Raw -Encoding UTF8`;
  const denial33 = validateShellCommandAccess('pwsh', cmd33, wsNvs, sessionNvs, 'nvs', wsNvs);
  assert.strictEqual(typeof denial33, 'string', 'Lệnh Get-Content trỏ vào attachment B phải bị từ chối');
  console.log('  [PASS] 3.3 User A bị chặn gọi pwsh Get-Content đọc attachment của User B');

  // 3.4 A executes node fs.readFileSync on B's workspace file -> DENIED
  const cmd34 = `node -e "console.log(require('fs').readFileSync('${fileB.replace(/\\/g, '\\\\')}', 'utf8'))"`;
  const denial34 = validateShellCommandAccess('pwsh', cmd34, wsNvs, sessionNvs, 'nvs', wsNvs);
  assert.strictEqual(typeof denial34, 'string', 'Lệnh node fs.readFileSync trỏ vào B phải bị từ chối');
  assert.strictEqual(denial34.includes('nva'), true);
  console.log('  [PASS] 3.4 User A bị chặn gọi node fs.readFileSync đọc file của User B');

  // 3.5 A executes node fs.readFileSync on B's attachment -> DENIED
  const cmd35 = `node -e "const fs = require('fs'); fs.readFileSync('${attFileB.replace(/\\/g, '\\\\')}')"`;
  const denial35 = validateShellCommandAccess('pwsh', cmd35, wsNvs, sessionNvs, 'nvs', wsNvs);
  assert.strictEqual(typeof denial35, 'string', 'Lệnh node fs.readFileSync trỏ vào attachment B phải bị từ chối');
  console.log('  [PASS] 3.5 User A bị chặn gọi node fs.readFileSync đọc attachment của User B');

  // 3.6 A attempts relative path traversal in shell: cd ..\nva or cat ..\nva\file -> DENIED
  const cmd36 = 'cat ..\\nva\\secret_b.txt';
  const denial36 = validateShellCommandAccess('pwsh', cmd36, wsNvs, sessionNvs, 'nvs', wsNvs);
  assert.strictEqual(typeof denial36, 'string');
  console.log('  [PASS] 3.6 User A bị chặn relative path traversal (cat ..\\nva\\...)');

  // 3.7 A attempts to create symlink targeting B's workspace -> DENIED
  const cmd37 = `New-Item -ItemType SymbolicLink -Path .\\link -Target "${fileB}"`;
  const denial37 = validateShellCommandAccess('pwsh', cmd37, wsNvs, sessionNvs, 'nvs', wsNvs);
  assert.strictEqual(typeof denial37, 'string');
  console.log('  [PASS] 3.7 User A bị chặn tạo symlink/junction trỏ vào workspace của User B');

  // 3.8 B executes legitimate command inside B workspace -> ALLOWED (Hai chiều)
  const denial38 = validateShellCommandAccess('pwsh', 'Get-Content "secret_b.txt"', wsNva, sessionNva, 'nva', wsNva);
  assert.strictEqual(denial38, null);
  console.log('  [PASS] 3.8 User B thực thi lệnh hợp lệ trong workspace của mình: CHO PHÉP (Hai chiều)');

  // 3.9 B executes Get-Content on A's workspace file -> DENIED (Hai chiều)
  const cmd39 = `Get-Content -LiteralPath "${fileA}"`;
  const denial39 = validateShellCommandAccess('pwsh', cmd39, wsNva, sessionNva, 'nva', wsNva);
  assert.strictEqual(typeof denial39, 'string');
  assert.strictEqual(denial39.includes('nvs'), true);
  console.log('  [PASS] 3.9 User B bị chặn gọi pwsh Get-Content đọc file của User A (Hai chiều)');

  // 3.10 B executes node fs.readFileSync on A's file -> DENIED (Hai chiều)
  const cmd310 = `node -e "console.log(fs.readFileSync('${fileA.replace(/\\/g, '\\\\')}'))"`;
  const denial310 = validateShellCommandAccess('pwsh', cmd310, wsNva, sessionNva, 'nva', wsNva);
  assert.strictEqual(typeof denial310, 'string');
  assert.strictEqual(denial310.includes('nvs'), true);
  console.log('  [PASS] 3.10 User B bị chặn gọi node fs.readFileSync đọc file của User A (Hai chiều)');

  // 3.11 B executes Get-Content on A's attachment -> DENIED (Hai chiều)
  const cmd311 = `Get-Content "${attFileA}"`;
  const denial311 = validateShellCommandAccess('pwsh', cmd311, wsNva, sessionNva, 'nva', wsNva);
  assert.strictEqual(typeof denial311, 'string');
  console.log('  [PASS] 3.11 User B bị chặn đọc attachment của User A qua shell (Hai chiều)');

  // 3.12 Chặn thay đổi workdir sang workspace người khác
  const denial312 = validateShellCommandAccess('pwsh', 'ls', wsNva, sessionNvs, 'nvs', wsNvs);
  assert.strictEqual(typeof denial312, 'string');
  console.log('  [PASS] 3.12 Chặn lệnh shell thiết lập workdir sang workspace người khác');

  console.log('\n--- PHẦN 4: KIỂM THỬ TÍCH HỢP TOÀN BỘ VỚI ctx.tools.guard ---');

  // Test ToolRuntime guard mock
  let registeredGuardFn = null;
  const mockToolsService = {
    guard(fn) {
      registeredGuardFn = fn;
    }
  };
  const mockCtx = {
    tools: mockToolsService,
    inject(deps, callback) {
      if (deps.includes('tools')) {
        callback({ tools: mockToolsService });
      }
    }
  };

  setupToolSecurityGuard(mockCtx);
  assert.strictEqual(typeof registeredGuardFn, 'function', 'Guard phải được đăng ký thành công');

  // Simulate tool calls via registered guard
  const guardCall1 = registeredGuardFn({
    name: 'read',
    arguments: { file_path: fileB },
    agent: { session: { header: { id: sessionNvs, cwd: wsNvs } } }
  });
  assert.strictEqual(typeof guardCall1, 'string', 'Guard phải chặn tool read truy cập file B');
  console.log('  [PASS] 4.1 ctx.tools.guard chặn thành công lệnh read của User A vào file User B');

  const guardCall2 = registeredGuardFn({
    name: 'pwsh',
    arguments: { command: `Get-Content "${attFileB}"` },
    agent: { session: { header: { id: sessionNvs, cwd: wsNvs } } }
  });
  assert.strictEqual(typeof guardCall2, 'string', 'Guard phải chặn tool pwsh truy cập attachment B');
  console.log('  [PASS] 4.2 ctx.tools.guard chặn thành công lệnh pwsh của User A vào attachment User B');

  const guardCall3 = registeredGuardFn({
    name: 'read',
    arguments: { file_path: fileA },
    agent: { session: { header: { id: sessionNvs, cwd: wsNvs } } }
  });
  assert.strictEqual(guardCall3, undefined, 'Guard phải cho phép tool read truy cập file hợp lệ của chính mình');
  console.log('  [PASS] 4.3 ctx.tools.guard cho phép tool read truy cập file hợp lệ của User A');

  console.log('\n======================================================================');
  console.log('   KẾT QUẢ KIỂM THỬ BẢO MẬT: TẤT CẢ 26 BƯỚC KIỂM THỬ ĐỀU PASS!       ');
  if (hasReparsePoints) {
    try { fs.rmdirSync(junctionAtoB); } catch (e) {}
    try { fs.rmdirSync(junctionAtoAtt); } catch (e) {}
  }

  closeDatabase();
  try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch (e) {}
}

runTests().catch((err) => {
  console.error('\n[LỖI TEST SECURITY]:', err);
  process.exit(1);
});
