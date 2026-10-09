import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert';
import { writeAllFixtures, buildLargeDocxBuffer } from './fixtures.js';

// Setup test isolation environment variables before loading plugin modules
const TEST_ROOT = path.resolve('./test/.tmp-test-suite');
if (fs.existsSync(TEST_ROOT)) {
  fs.rmSync(TEST_ROOT, { recursive: true, force: true });
}
fs.mkdirSync(TEST_ROOT, { recursive: true });

const TEST_DB_PATH = path.join(TEST_ROOT, 'test_users.db');
const TEST_WS_ROOT = path.join(TEST_ROOT, 'workspaces');
const TEST_DSH_HOME = path.join(TEST_ROOT, 'dsh_home');

process.env.USERS_DB_PATH = TEST_DB_PATH;
process.env.USERS_WORKSPACES_ROOT = TEST_WS_ROOT;
process.env.DSH_HOME = TEST_DSH_HOME;

// Now import modules under test
import {
  initDatabase,
  closeDatabase,
  createUser,
  approveUser,
  findUserByUsername,
  createSession,
  recordAttachment,
  checkAttachmentOwnership,
  findAttachment,
  recordUserSession,
  getOwnerOfSessionFromDb
} from '../lib/db.js';
import {
  getUserWorkspaceDir,
  resolveSafePath,
  writeWorkspaceFile,
  readWorkspaceFile,
  checkDocumentAccess,
  getOwnerOfSession,
  syncDshUserWorkspaces,
  registerWorkspaceRoutes
} from '../lib/workspace.js';
import {
  extractDocument,
  runInWorkerWithTimeout,
  DocumentExtractionError,
  MAX_FILE_SIZE_BYTES,
  MAX_CHUNK_LIMIT
} from '../lib/document-extractor.js';
import {
  registerDocumentRoutes,
  setDocumentServiceContext,
  hookFileUploadsService,
  toolRegistrationStatus
} from '../lib/document-service.js';
import {
  createReadDocumentTool,
  executeReadDocument
} from '../lib/document-tool.js';
import { registerAuthRoutes } from '../lib/auth.js';

// Simple MockWebServer for HTTP integration tests
class MockWebServer {
  constructor() {
    this.routes = [];
    this.server = http.createServer(async (req, res) => {
      const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
      const matched = this.routes.find((r) => {
        if (r.kind === 'exact') return r.path === url.pathname;
        if (r.kind === 'prefix') return url.pathname.startsWith(r.path);
        return false;
      });

      if (matched) {
        try {
          await matched.handler(req, res);
        } catch (err) {
          if (!res.writableEnded) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
          }
        }
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not Found' }));
      }
    });
  }

  register(route) {
    this.routes.push(route);
  }

  listen(port = 0) {
    return new Promise((resolve) => {
      this.server.listen(port, '127.0.0.1', () => {
        this.port = this.server.address().port;
        resolve(this.port);
      });
    });
  }

  close() {
    return new Promise((resolve) => {
      this.server.close(() => resolve());
    });
  }
}

// HTTP request helper
function httpRequest(port, method, reqPath, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const isBuffer = Buffer.isBuffer(body);
    const postData = isBuffer ? body : (body !== null ? JSON.stringify(body) : null);
    const reqHeaders = { 'Connection': 'close', ...headers };

    if (postData) {
      if (!isBuffer && !reqHeaders['Content-Type']) {
        reqHeaders['Content-Type'] = 'application/json';
      }
      reqHeaders['Content-Length'] = Buffer.isBuffer(postData) ? postData.length : Buffer.byteLength(postData);
    }

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: reqPath,
        method,
        headers: reqHeaders
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = JSON.parse(raw);
          } catch (e) {}
          resolve({ status: res.statusCode, headers: res.headers, raw, json });
        });
      }
    );

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function runComprehensiveTests() {
  console.log('======================================================================');
  console.log('   BỘ KIỂM THỬ TOÀN DIỆN HỆ THỐNG ĐỌC TÀI LIỆU DSH MULTI-USER (V2)   ');
  console.log('======================================================================\n');
  console.log(`[CẤU HÌNH MÔI TRƯỜNG TEST CÔ LẬP]`);
  console.log(`- Thư mục test tạm: ${TEST_ROOT}`);
  console.log(`- SQLite Test DB:   ${TEST_DB_PATH}`);
  console.log(`- Workspaces Test:  ${TEST_WS_ROOT}`);
  console.log(`- DSH Home Test:    ${TEST_DSH_HOME}\n`);

  let totalTests = 0;
  let passedTests = 0;
  let failedTests = 0;

  async function test(name, fn) {
    totalTests++;
    try {
      await fn();
      console.log(`  [PASS] ${name}`);
      passedTests++;
    } catch (err) {
      console.error(`  [FAIL] ${name}`);
      console.error(`         Chi tiết: ${err.message}`);
      if (err.stack) console.error(`         ${err.stack.split('\n')[1]}`);
      failedTests++;
    }
  }

  // 1. Khởi tạo DB tạm và tạo test fixtures
  initDatabase(TEST_DB_PATH);
  const fixturesDir = path.join(TEST_ROOT, 'fixtures');
  const fixtures = writeAllFixtures(fixturesDir);

  // Tạo 2 tài khoản thử nghiệm
  const userA = createUser('test_user_a', 'pass_a_123', 'user', 100000, 'active');
  const userB = createUser('test_user_b', 'pass_b_123', 'user', 100000, 'active');
  const dirA = getUserWorkspaceDir(userA.username);
  const dirB = getUserWorkspaceDir(userB.username);

  // =========================================================================
  // PHẦN 1: UNIT TEST - BỘ TRÍCH XUẤT VĂN BẢN (EXTRACTOR)
  // =========================================================================
  console.log('--- PHẦN 1: Unit Test Bộ Trích Xuất Văn Bản ---');

  await test('1.1 PDF: Đọc đúng tiếng Việt nhiều trang (Page 1)', async () => {
    const res = await extractDocument(fixtures.pdfMultiPage, { page: 1 });
    assert.strictEqual(res.format, 'PDF');
    assert.strictEqual(res.totalPages, 2);
    assert.strictEqual(res.page, 1);
    assert.ok(res.content.includes('TRANG 1: CONG HOA XA HOI CHU NGHIA VIET NAM'));
    assert.strictEqual(res.hasMore, false);
  });

  await test('1.2 PDF: Đọc đúng tiếng Việt nhiều trang (Page 2)', async () => {
    const res = await extractDocument(fixtures.pdfMultiPage, { page: 2 });
    assert.strictEqual(res.format, 'PDF');
    assert.strictEqual(res.page, 2);
    assert.ok(res.content.includes('TRANG 2: KET QUA DANH GIA'));
  });

  await test('1.3 DOCX: Đọc đúng nội dung đoạn văn và bảng biểu Markdown', async () => {
    const res = await extractDocument(fixtures.docxTable);
    assert.strictEqual(res.format, 'DOCX');
    assert.ok(res.content.includes('CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM'));
    assert.ok(res.content.includes('BẢNG KÊ TIẾN ĐỘ THỰC HIỆN CÔNG VIỆC'));
    assert.ok(res.content.includes('Xác thực người dùng DSH'));
    assert.ok(res.content.includes('Trích xuất PDF/DOCX/TXT'));
    assert.ok(res.note && res.note.includes('Markdown'));
  });

  await test('1.4 TXT: Xác thực UTF-8 nghiêm ngặt, tự động loại bỏ BOM', async () => {
    const res = await extractDocument(fixtures.txtBom);
    assert.strictEqual(res.format, 'TXT');
    assert.ok(res.content.includes('CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM'));
    assert.ok(res.content.includes('Hà Nội, Đà Nẵng, TP. Hồ Chí Minh'));
    assert.ok(res.content.includes('ă, â, đ, ê, ô, ơ, ư'));
    assert.notStrictEqual(res.content.charCodeAt(0), 0xFEFF, 'BOM phải được loại bỏ');
  });

  await test('1.5 TXT: Báo lỗi INVALID_ENCODING khi gặp byte UTF-8 lỗi (không chứa byte null)', async () => {
    await assert.rejects(
      async () => await extractDocument(fixtures.txtInvalidUtf8),
      (err) => {
        assert.ok(err instanceof DocumentExtractionError);
        assert.strictEqual(err.code, 'INVALID_ENCODING');
        return true;
      }
    );
  });

  await test('1.6 PDF: Phân biệt chính xác PDF trang trắng (không báo scan)', async () => {
    const res = await extractDocument(fixtures.pdfBlank);
    assert.strictEqual(res.format, 'PDF');
    assert.strictEqual(res.totalCharacters, 0);
    assert.strictEqual(res.hasMore, false);
    assert.ok(res.note.includes('trang trắng'), `Note phải nêu rõ trang trắng: ${res.note}`);
    assert.ok(!res.note.includes('scan'), 'Không được nhầm trang trắng thành PDF scan');
  });

  await test('1.7 PDF: Phân biệt chính xác PDF scan (báo rõ chưa hỗ trợ OCR)', async () => {
    const res = await extractDocument(fixtures.pdfScanned);
    assert.strictEqual(res.format, 'PDF');
    assert.strictEqual(res.totalCharacters, 0);
    assert.ok(res.note.includes('scan') && res.note.includes('OCR'), `Note phải nêu rõ scan và OCR: ${res.note}`);
  });

  await test('1.7b PDF: Phân biệt PDF chỉ có hình vẽ vector (không báo scan, báo cần OCR)', async () => {
    const res = await extractDocument(fixtures.pdfVectorNoText);
    assert.strictEqual(res.format, 'PDF');
    assert.strictEqual(res.totalCharacters, 0);
    assert.ok(res.note.includes('OCR'), `Note phải đề cập OCR: ${res.note}`);
    assert.ok(!res.note.includes('scan'), 'Không được nhầm vector graphics thành PDF scan');
  });

  await test('1.8 PDF: Báo lỗi PASSWORD_PROTECTED khi file có mật khẩu bảo vệ', async () => {
    await assert.rejects(
      async () => await extractDocument(fixtures.pdfPassword),
      (err) => {
        assert.ok(err instanceof DocumentExtractionError);
        assert.strictEqual(err.code, 'PASSWORD_PROTECTED');
        return true;
      }
    );
  });

  await test('1.9 File hỏng: Báo lỗi rõ ràng PDF_CORRUPT hoặc DOCX_CORRUPT', async () => {
    await assert.rejects(
      async () => await extractDocument(fixtures.pdfCorrupt),
      (err) => {
        assert.ok(err instanceof DocumentExtractionError);
        assert.strictEqual(err.code, 'PDF_CORRUPT');
        return true;
      }
    );
    await assert.rejects(
      async () => await extractDocument(fixtures.docxCorrupt),
      (err) => {
        assert.ok(err instanceof DocumentExtractionError);
        assert.strictEqual(err.code, 'DOCX_CORRUPT');
        return true;
      }
    );
  });

  await test('1.10 Giới hạn dung lượng: Từ chối file vượt quá 20MB', async () => {
    await assert.rejects(
      async () => await extractDocument(fixtures.over20Mb),
      (err) => {
        assert.ok(err instanceof DocumentExtractionError);
        assert.strictEqual(err.code, 'FILE_TOO_LARGE');
        return true;
      }
    );
  });

  await test('1.11 Kiểm tra tham số phân trang: Từ chối page, offset, limit sai', async () => {
    await assert.rejects(
      async () => await extractDocument(fixtures.txtBom, { page: -1 }),
      (err) => err.code === 'INVALID_PARAM'
    );
    await assert.rejects(
      async () => await extractDocument(fixtures.txtBom, { offset: 'invalid' }),
      (err) => err.code === 'INVALID_PARAM'
    );
    await assert.rejects(
      async () => await extractDocument(fixtures.txtBom, { limit: 0 }),
      (err) => err.code === 'INVALID_PARAM'
    );
    await assert.rejects(
      async () => await extractDocument(fixtures.pdfMultiPage, { page: 99 }),
      (err) => err.code === 'PAGE_OUT_OF_RANGE'
    );
  });

  await test('1.12 Đặt giới hạn cứng lượng ký tự trả về và trả gợi ý đọc tiếp', async () => {
    const chunk1 = await extractDocument(fixtures.docxTable, { offset: 0, limit: 50 });
    assert.strictEqual(chunk1.limit, 50);
    assert.strictEqual(chunk1.hasMore, true);
    assert.strictEqual(chunk1.nextOffset, 50);
    assert.strictEqual(chunk1.content.length, 50);

    const chunk2 = await extractDocument(fixtures.docxTable, { offset: 50, limit: 50 });
    assert.strictEqual(chunk2.offset, 50);
    assert.notStrictEqual(chunk1.content, chunk2.content);
  });

  await test('1.13 Worker: Truyền đầy đủ dữ liệu lớn qua IPC và hủy tiến trình khi timeout', async () => {
    // 1. Tạo file DOCX lớn (>100KB văn bản) để test truyền tải qua worker IPC
    const largeDocxPath = path.join(TEST_ROOT, 'large_payload.docx');
    const largeDocxBuffer = buildLargeDocxBuffer(600);
    fs.writeFileSync(largeDocxPath, largeDocxBuffer);

    // Kiểm tra worker trích xuất thành công và truyền đầy đủ dữ liệu lớn qua IPC
    const workerResult = await runInWorkerWithTimeout({ filePath: largeDocxPath, format: 'DOCX' });
    assert.strictEqual(workerResult.format, 'DOCX');
    assert.ok(workerResult.fullText.length > 50000, 'Dữ liệu trích xuất lớn qua IPC phải đầy đủ');
    assert.ok(workerResult.fullText.includes('Đoạn văn 600:'), 'Phải chứa đoạn văn cuối cùng');

    // Kiểm tra extractDocument bọc worker cũng trả về totalCharacters đầy đủ
    const res = await extractDocument(largeDocxPath);
    assert.strictEqual(res.format, 'DOCX');
    assert.strictEqual(res.totalCharacters, workerResult.fullText.length);
    assert.strictEqual(res.hasMore, true);

    // 2. Kiểm tra timeout: tiến trình worker bị dừng/hủy khi quá thời gian
    await assert.rejects(
      async () => await runInWorkerWithTimeout({ filePath: largeDocxPath, format: 'DOCX' }, 1),
      (err) => {
        assert.strictEqual(err.code, 'TIMEOUT');
        assert.ok(err.message.includes('vượt quá giới hạn'));
        return true;
      }
    );
  });

  await test('1.14 Migration DB: Xử lý trùng lặp trong transaction, bảo toàn quyền khác nhau', async () => {
    const { DatabaseSync } = await import('node:sqlite');
    const legacyDbPath = path.join(TEST_ROOT, 'legacy_test.db');
    const db = new DatabaseSync(legacyDbPath);

    // Tạo bảng attachments cũ chưa có unique index
    db.exec(`
      CREATE TABLE attachments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        attachment_id TEXT NOT NULL,
        file_name TEXT NOT NULL,
        file_size INTEGER NOT NULL DEFAULT 0,
        session_id TEXT NOT NULL,
        username TEXT NOT NULL,
        file_path TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Chèn 2 bản ghi TRÙNG TƯƠNG ĐƯƠNG (cùng user, session, attachment_id, file_path)
    db.prepare(`
      INSERT INTO attachments (attachment_id, file_name, file_size, session_id, username, file_path)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('att-dup-1', 'test.pdf', 100, 'sess-1', 'userA', 'C:\\files\\test.pdf');

    db.prepare(`
      INSERT INTO attachments (attachment_id, file_name, file_size, session_id, username, file_path)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('att-dup-1', 'test.pdf', 100, 'sess-1', 'userA', 'C:\\files\\test.pdf');

    // Chèn 2 bản ghi COLLISION TRÙNG attachment_id nhưng KHÁC file_path (phải bảo toàn cả 2!)
    db.prepare(`
      INSERT INTO attachments (attachment_id, file_name, file_size, session_id, username, file_path)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('att-dup-collision', 'file1.pdf', 200, 'sess-2', 'userA', 'C:\\files\\path_one.pdf');

    db.prepare(`
      INSERT INTO attachments (attachment_id, file_name, file_size, session_id, username, file_path)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('att-dup-collision', 'file2.pdf', 300, 'sess-2', 'userA', 'C:\\files\\path_two.pdf');

    db.close();

    // Mở DB qua initDatabase (sẽ tự động chạy migration setupSchema an toàn)
    const migratedDb = initDatabase(legacyDbPath);

    // Kiểm tra kết quả
    const rows = migratedDb.prepare('SELECT * FROM attachments ORDER BY id ASC').all();

    // Bản ghi trùng tương đương chỉ còn lại 1
    const exactDups = rows.filter(r => r.file_path === 'C:\\files\\test.pdf');
    assert.strictEqual(exactDups.length, 1, 'Bản ghi trùng tương đương chỉ giữ lại 1 bản ghi');

    // Hai bản ghi có file_path khác nhau đều được giữ lại (bảo toàn quyền cho cả 2 file)
    const pathOne = rows.find(r => r.file_path === 'C:\\files\\path_one.pdf');
    const pathTwo = rows.find(r => r.file_path === 'C:\\files\\path_two.pdf');
    assert.ok(pathOne, 'Bản ghi file_path thứ nhất phải được giữ lại');
    assert.ok(pathTwo, 'Bản ghi file_path thứ hai phải được giữ lại');
    assert.notStrictEqual(pathOne.attachment_id, pathTwo.attachment_id, 'AttachmentId bị trùng đã được phân biệt để bảo toàn unique index');

    // Unique index phải tồn tại và hoạt động
    const indexInfo = migratedDb.prepare(`PRAGMA index_list('attachments')`).all();
    const hasUnique = indexInfo.some(idx => idx.name === 'idx_attachments_user_session_id' && idx.unique === 1);
    assert.strictEqual(hasUnique, true, 'Unique index idx_attachments_user_session_id phải được tạo thành công');

    closeDatabase();
    // Khôi phục lại DB chính của test suite
    initDatabase(TEST_DB_PATH);
  });

  // =========================================================================
  // PHẦN 2: BẢO MẬT & PHÂN QUYỀN WORKSPACE VÀ ATTACHMENT
  // =========================================================================
  console.log('\n--- PHẦN 2: Bảo Mật, Phân Quyền Workspace & Attachment ---');

  // Ghi file mẫu vào workspace user A và user B
  const fileA = path.join(dirA, 'doc_a.txt');
  fs.writeFileSync(fileA, 'Tài liệu riêng của User A', 'utf8');
  const fileB = path.join(dirB, 'doc_b.txt');
  fs.writeFileSync(fileB, 'Tài liệu riêng của User B', 'utf8');

  await test('2.1 User A truy cập được file trong workspace của mình', async () => {
    const accessed = checkDocumentAccess('test_user_a', 'doc_a.txt');
    assert.strictEqual(accessed, fileA);
  });

  await test('2.2 Chặn truy cập chéo: User A KHÔNG thể đọc file trong workspace User B', async () => {
    assert.throws(
      () => checkDocumentAccess('test_user_a', fileB),
      (err) => {
        assert.strictEqual(err.status, 403);
        assert.ok(err.message.includes('nằm ngoài workspace'));
        return true;
      }
    );
  });

  await test('2.3 Chặn Path Traversal và Null Byte', async () => {
    assert.throws(
      () => checkDocumentAccess('test_user_a', '../../test_users.db'),
      (err) => err.status === 403
    );
    assert.throws(
      () => checkDocumentAccess('test_user_a', 'doc_a.txt\0.pdf'),
      (err) => err.status === 403
    );
  });

  await test('2.4 Từ chối truy cập nếu đường dẫn là thư mục (chỉ nhận file thường)', async () => {
    assert.throws(
      () => checkDocumentAccess('test_user_a', dirA),
      (err) => {
        assert.strictEqual(err.status, 400);
        assert.ok(err.message.includes('không hỗ trợ thư mục'));
        return true;
      }
    );
  });

  await test('2.5 Quyền sở hữu attachment: Tra cứu chính xác user + session + attachment', async () => {
    const attachPath = path.join(TEST_ROOT, 'attachment_test.pdf');
    fs.writeFileSync(attachPath, fixtures.pdfMultiPage);

    recordAttachment({
      attachmentId: 'att-101',
      fileName: 'attachment_test.pdf',
      fileSize: 1000,
      sessionId: 'session-user-a-1',
      username: 'test_user_a',
      filePath: attachPath
    });

    // User A có quyền
    assert.strictEqual(checkAttachmentOwnership('test_user_a', attachPath, 'session-user-a-1'), true);
    // User B KHÔNG có quyền đối với attachment của User A
    assert.strictEqual(checkAttachmentOwnership('test_user_b', attachPath, 'session-user-a-1'), false);
    assert.strictEqual(checkAttachmentOwnership('test_user_b', attachPath), false);
  });

  await test('2.6 Không dùng LIKE: Tên file gần giống không được nhận quyền nhầm', async () => {
    const attachPath = path.join(TEST_ROOT, 'attachment_test.pdf');
    // Truy vấn với đường dẫn một phần hoặc chuỗi con
    assert.strictEqual(checkAttachmentOwnership('test_user_b', 'attachment_test'), false);
    assert.strictEqual(checkAttachmentOwnership('test_user_a', 'att'), false);
  });

  await test('2.7 Bỏ bypass Admin: Admin trong luồng chat thường không tự động đọc file người khác', async () => {
    const attachPath = path.join(TEST_ROOT, 'attachment_test.pdf');
    // Admin không được bypass trong checkAttachmentOwnership
    assert.strictEqual(checkAttachmentOwnership('admin', attachPath), false);
  });

  await test('2.8 Hai người upload cùng một file vật lý: Lưu tách biệt 2 bản ghi quyền riêng', async () => {
    const sharedPhysicalFile = path.join(TEST_ROOT, 'shared_physical.docx');
    fs.writeFileSync(sharedPhysicalFile, fixtures.docxTable);

    recordAttachment({
      attachmentId: 'att-shared-a',
      fileName: 'shared_physical.docx',
      fileSize: 2000,
      sessionId: 'session-a-99',
      username: 'test_user_a',
      filePath: sharedPhysicalFile
    });

    recordAttachment({
      attachmentId: 'att-shared-b',
      fileName: 'shared_physical.docx',
      fileSize: 2000,
      sessionId: 'session-b-99',
      username: 'test_user_b',
      filePath: sharedPhysicalFile
    });

    // Cả 2 đều có quyền truy cập file vật lý này trong session của mình
    assert.strictEqual(checkAttachmentOwnership('test_user_a', sharedPhysicalFile, 'session-a-99'), true);
    assert.strictEqual(checkAttachmentOwnership('test_user_b', sharedPhysicalFile, 'session-b-99'), true);
    // Nhưng User A không được đọc với session của B
    assert.strictEqual(checkAttachmentOwnership('test_user_a', sharedPhysicalFile, 'session-b-99'), false);
  });

  await test('2.9 Không ghi file_path rỗng thành thư mục hiện tại', async () => {
    assert.throws(
      () => recordAttachment({
        attachmentId: 'att-empty',
        fileName: 'empty.txt',
        fileSize: 0,
        sessionId: 'session-a-99',
        username: 'test_user_a',
        filePath: ''
      }),
      (err) => err.message.includes('file_path là bắt buộc')
    );
  });

  await test('2.10 Quan hệ session - user: Tra cứu đáng tin cậy, từ chối session vô danh', async () => {
    recordUserSession('session-trusted-a', 'test_user_a', 'user-workspace-test_user_a');
    assert.strictEqual(getOwnerOfSession('session-trusted-a'), 'test_user_a');
    assert.strictEqual(getOwnerOfSession('session-unknown-random'), null);
  });

  await test('2.11 recordUserSession: Từ chối đổi chủ khi session đã thuộc user khác', async () => {
    // Session session-trusted-a đã thuộc test_user_a
    assert.throws(
      () => recordUserSession('session-trusted-a', 'test_user_b', 'user-workspace-test_user_b'),
      (err) => {
        assert.strictEqual(err.status, 403);
        assert.strictEqual(err.code, 'SESSION_OWNERSHIP_CONFLICT');
        return true;
      }
    );
    // Chủ sở hữu vẫn bảo toàn là test_user_a
    assert.strictEqual(getOwnerOfSession('session-trusted-a'), 'test_user_a');
  });

  await test('2.12 getOwnerOfSession: Không dùng tên thư mục session để xác lập quyền', async () => {
    // Tạo thư mục giả trên đĩa có tên format -workspaces-test_user_b--/session-unrecorded-fake
    const fakeDiskDir = path.join(TEST_DSH_HOME, 'sessions', '-workspaces-test_user_b--', 'session-unrecorded-fake');
    fs.mkdirSync(fakeDiskDir, { recursive: true });

    // Không tồn tại trong SQLite hay workspace.json -> phải trả về null
    assert.strictEqual(getOwnerOfSession('session-unrecorded-fake'), null);
  });

  // =========================================================================
  // PHẦN 3: HTTP INTEGRATION TEST VỚI HAI TÀI KHOẢN
  // =========================================================================
  console.log('\n--- PHẦN 3: HTTP Integration Test Hai Tài Khoản ---');

  const webServer = new MockWebServer();
  registerAuthRoutes(webServer);
  registerWorkspaceRoutes(webServer);
  registerDocumentRoutes(webServer);

  // Giả lập fileUploads và attachments service cho mock context
  const mockStorageAttachments = new Map();
  const mockFileUploads = {
    __dshTrackHooked: false,
    uploadStream: async (req) => {
      const chunks = [];
      for await (const c of req.data) chunks.push(c);
      const buf = Buffer.concat(chunks);
      const attachId = `att-mock-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const savedPath = path.join(TEST_ROOT, `${attachId}_${req.name}`);
      fs.writeFileSync(savedPath, buf);

      const fileObj = {
        attachmentId: attachId,
        name: req.name,
        bytes: buf.length,
        path: savedPath
      };
      mockStorageAttachments.set(attachId, savedPath);
      return { file: fileObj };
    }
  };
  const mockAttachmentsService = {
    fileHostPath: (file) => file.path
  };

  const mockCordis = {
    get: (key) => {
      if (key === 'fileUploads') return mockFileUploads;
      if (key === 'attachments') return mockAttachmentsService;
      return null;
    }
  };
  setDocumentServiceContext(mockCordis);
  hookFileUploadsService(mockFileUploads, mockAttachmentsService);

  const port = await webServer.listen(0);

  // Đăng nhập 2 tài khoản
  const sessionTokenA = createSession(userA.id).token;
  const sessionTokenB = createSession(userB.id).token;

  await test('3.1 User A upload tài liệu PDF thành công qua HTTP /api/session/uploadFileBinary', async () => {
    // Đăng ký session cho User A trước
    recordUserSession('session-http-a', 'test_user_a', 'user-workspace-test_user_a');

    const pdfData = fs.readFileSync(fixtures.pdfMultiPage);
    const res = await httpRequest(
      port,
      'POST',
      '/api/session/uploadFileBinary?sessionId=session-http-a&name=multipage.pdf',
      pdfData,
      {
        'Cookie': `dsh_user_token=${sessionTokenA}`,
        'Content-Type': 'application/pdf'
      }
    );

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.ok, true);
    assert.strictEqual(res.json.value.file.name, 'multipage.pdf');
  });

  await test('3.2 Chặn Upload: User A không thể upload vào session của User B', async () => {
    recordUserSession('session-http-b', 'test_user_b', 'user-workspace-test_user_b');

    const pdfData = fs.readFileSync(fixtures.pdfMultiPage);
    const res = await httpRequest(
      port,
      'POST',
      '/api/session/uploadFileBinary?sessionId=session-http-b&name=hack.pdf',
      pdfData,
      {
        'Cookie': `dsh_user_token=${sessionTokenA}`,
        'Content-Type': 'application/pdf'
      }
    );

    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.json.ok, false);
    assert.strictEqual(res.json.error.code, 'session/forbidden');
  });

  await test('3.3 Chặn Upload: Từ chối upload vào session vô danh (không rõ chủ)', async () => {
    const pdfData = fs.readFileSync(fixtures.pdfMultiPage);
    const res = await httpRequest(
      port,
      'POST',
      '/api/session/uploadFileBinary?sessionId=session-nonexistent&name=hack.pdf',
      pdfData,
      {
        'Cookie': `dsh_user_token=${sessionTokenA}`,
        'Content-Type': 'application/pdf'
      }
    );

    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.json.ok, false);
    assert.strictEqual(res.json.error.code, 'session/unowned');
  });

  await test('3.4 Chặn Upload: Từ chối upload file vượt quá 20MB', async () => {
    const res = await httpRequest(
      port,
      'POST',
      '/api/session/uploadFileBinary?sessionId=session-http-a&name=huge.txt',
      null,
      {
        'Cookie': `dsh_user_token=${sessionTokenA}`,
        'Content-Length': String(21 * 1024 * 1024)
      }
    );

    assert.strictEqual(res.status, 413);
    assert.strictEqual(res.json.ok, false);
    assert.strictEqual(res.json.error.code, 'upload/too_large');
  });

  await test('3.5 User A đọc tài liệu qua HTTP POST /api/document/read', async () => {
    const res = await httpRequest(
      port,
      'POST',
      '/api/document/read',
      { file_path: 'doc_a.txt' },
      { 'Cookie': `dsh_user_token=${sessionTokenA}` }
    );

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.ok, true);
    assert.ok(res.json.data.content.includes('Tài liệu riêng của User A'));
  });

  await test('3.6 Chặn Đọc qua HTTP: User B không thể đọc file của User A', async () => {
    const res = await httpRequest(
      port,
      'POST',
      '/api/document/read',
      { file_path: fileA },
      { 'Cookie': `dsh_user_token=${sessionTokenB}` }
    );

    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.json.ok, false);
  });

  await test('3.7 Đảm bảo metadata chỉ ghi 1 lần sau khi upload thành công (không trùng lặp)', async () => {
    const userAAttachments = findAttachment('multipage.pdf', 'test_user_a');
    assert.ok(userAAttachments !== null, 'Phải tìm thấy attachment của User A');
  });

  await test('3.8 Chặn Tạo Session: Từ chối yêu cầu chưa đăng nhập (401)', async () => {
    const res = await httpRequest(
      port,
      'POST',
      '/api/session/create',
      {
        type: 'client-request',
        rpcId: 'rpc-unauth-test',
        method: 'session/create',
        payload: { args: { request: {} } }
      }
    );

    assert.strictEqual(res.status, 401);
  });

  await test('3.9 Chặn Tạo Session: User A không thể tạo session trong workspace của User B', async () => {
    const res = await httpRequest(
      port,
      'POST',
      '/api/session/create',
      {
        type: 'client-request',
        rpcId: 'rpc-cross-ws',
        method: 'session/create',
        payload: {
          args: {
            request: {
              workspaceId: 'user-workspace-test_user_b'
            }
          }
        }
      },
      { 'Cookie': `dsh_user_token=${sessionTokenA}` }
    );

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.result.ok, false);
    assert.strictEqual(res.json.result.error.code, 'session/forbidden');
  });

  await test('3.10 Luồng tạo session DSH: User A tạo session mới thành công và server tự gán chủ sở hữu', async () => {
    // Lưu ý: KHÔNG gọi recordUserSession trước! Luồng tạo session phải tự động gán.
    const res = await httpRequest(
      port,
      'POST',
      '/api/session/create',
      {
        type: 'client-request',
        rpcId: 'rpc-create-valid',
        method: 'session/create',
        payload: {
          args: {
            request: {}
          }
        }
      },
      { 'Cookie': `dsh_user_token=${sessionTokenA}` }
    );

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.json.result.ok, true);
    const newSessionId = res.json.result.value.sessionId;
    assert.ok(newSessionId, 'Phải trả về sessionId hợp lệ');

    // Kiểm tra chủ sở hữu session được tự động ghi nhận trong SQLite DB
    const dbOwner = getOwnerOfSessionFromDb(newSessionId);
    assert.strictEqual(dbOwner, 'test_user_a', 'Chủ sở hữu trong user_sessions DB phải là test_user_a');

    // Tra cứu qua hàm getOwnerOfSession cũng phải ra test_user_a
    const resolvedOwner = getOwnerOfSession(newSessionId);
    assert.strictEqual(resolvedOwner, 'test_user_a', 'getOwnerOfSession phải trả về test_user_a');
  });

  // =========================================================================
  // PHẦN 4: AGENT TOOL INTEGRATION TEST (read_document)
  // =========================================================================
  console.log('\n--- PHẦN 4: Tích Hợp Tool "read_document" Cho Agent ---');

  await test('4.1 Khởi tạo tool read_document và kiểm tra schema hợp lệ', async () => {
    const tool = await createReadDocumentTool();
    assert.strictEqual(tool.name, 'read_document');
    assert.ok(tool.description.includes('Trích xuất'));
  });

  await test('4.2 Thực thi executeReadDocument với execution context có session hợp lệ', async () => {
    recordUserSession('session-agent-exec-a', 'test_user_a', 'user-workspace-test_user_a');

    const execContext = {
      sessionId: 'session-agent-exec-a',
      agent: {
        id: 'agent-1',
        session: { id: 'session-agent-exec-a' }
      }
    };

    const out = await executeReadDocument({ file_path: 'doc_a.txt' }, execContext);
    assert.strictEqual(out.format, 'TXT');
    assert.ok(out.content.includes('Tài liệu riêng của User A'));
  });

  await test('4.3 executeReadDocument từ chối nếu không xác định được session hoặc session không rõ chủ', async () => {
    await assert.rejects(
      async () => await executeReadDocument({ file_path: 'doc_a.txt' }, {}),
      (err) => err.message.includes('Không thể xác định phiên làm việc')
    );

    const unownedExecContext = {
      sessionId: 'session-ghost-unowned'
    };
    await assert.rejects(
      async () => await executeReadDocument({ file_path: 'doc_a.txt' }, unownedExecContext),
      (err) => err.message.includes('chưa được gán chủ sở hữu hợp lệ')
    );
  });

  await test('4.4 executeReadDocument chặn Agent đọc file ngoài workspace người dùng', async () => {
    const execContext = {
      sessionId: 'session-agent-exec-a'
    };
    await assert.rejects(
      async () => await executeReadDocument({ file_path: fileB }, execContext),
      (err) => err.status === 403
    );
  });

  await test('4.5 Kiểm tra tính bền vững: Khởi động lại DB, attachment cũ vẫn bảo toàn quyền', async () => {
    // Đóng DB và mở lại
    closeDatabase();
    initDatabase(TEST_DB_PATH);

    // Kiểm tra User A vẫn sở hữu attachment trước đó
    const owned = checkAttachmentOwnership('test_user_a', 'multipage.pdf', 'session-http-a');
    assert.strictEqual(owned, true);
    // User B vẫn không có quyền
    const bOwned = checkAttachmentOwnership('test_user_b', 'multipage.pdf', 'session-http-a');
    assert.strictEqual(bOwned, false);
  });

  // Dọn dẹp server
  await webServer.close();
  closeDatabase();

  console.log('\n======================================================================');
  console.log(`KẾT QUẢ KIỂM THỬ: ${passedTests}/${totalTests} PASS (${failedTests} FAILED)`);
  console.log('======================================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runComprehensiveTests().catch((err) => {
  console.error('LỖI KHÔNG MONG MUỐN TRONG TEST SUITE:', err);
  process.exit(1);
});
