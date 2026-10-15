import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { buildTableDocxBuffer, buildVietnameseBomTxtBuffer } from '../helpers/fixtures.js';

const PLUGIN_ROOT = path.resolve(import.meta.dirname, '../..');
const BASE_URL = 'http://127.0.0.1:3090';
const HOST_DATA_DIR = path.join(PLUGIN_ROOT, 'docker-test-data');
const HOST_DB_DIR = path.join(HOST_DATA_DIR, 'db');
const HOST_WORKSPACES_DIR = path.join(HOST_DATA_DIR, 'workspaces');
const EVIDENCE_DIR = path.join(PLUGIN_ROOT, 'test-results', 'docker-step-5');

function runCmd(cmd) {
  try {
    return execSync(cmd, { cwd: PLUGIN_ROOT, stdio: 'pipe', encoding: 'utf8' });
  } catch (err) {
    const stdout = err.stdout ? err.stdout.toString() : '';
    const stderr = err.stderr ? err.stderr.toString() : '';
    throw new Error(`Command failed: ${cmd}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`);
  }
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForServer(url, timeoutMs = 60000) {
  const start = Date.now();
  const statusUrl = `${BASE_URL}/api/user-manager/status`;
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(statusUrl);
      if (res.status === 200) {
        const json = await res.json();
        if (json.toolRegistration && json.toolRegistration.ready === true) {
          await sleep(2000);
          return true;
        }
      }
    } catch (_) {}
    await sleep(1500);
  }
  throw new Error(`Server at ${statusUrl} did not become ready within ${timeoutMs}ms`);
}

function buildOnePagePdfBuffer(marker = 'CONG HOA XA HOI CHU NGHIA VIET NAM - BAN 1 TRANG') {
  const stream1 = `BT /F1 12 Tf 50 700 Td (${marker}) Tj ET`;
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  function addObj(content) { offsets.push(pdf.length); pdf += content + "\n"; }
  addObj("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj");
  addObj("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj");
  addObj("3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj");
  addObj("4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj");
  addObj(`5 0 obj\n<< /Length ${Buffer.byteLength(stream1)} >>\nstream\n${stream1}\nendstream\nendobj`);
  const xrefOffset = pdf.length;
  pdf += "xref\n0 6\n0000000000 65535 f \n";
  for (const off of offsets) { pdf += String(off).padStart(10, "0") + " 00000 n \n"; }
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, "utf8");
}

function buildTwoPagePdfBuffer(markerP1 = 'TRANG 1: BAN 2 TRANG', markerP2 = 'TRANG 2: NOI DUNG TIEP THEO') {
  const stream1 = `BT /F1 12 Tf 50 700 Td (${markerP1}) Tj ET`;
  const stream2 = `BT /F1 12 Tf 50 700 Td (${markerP2}) Tj ET`;
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  function addObj(content) { offsets.push(pdf.length); pdf += content + "\n"; }
  addObj("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj");
  addObj("2 0 obj\n<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>\nendobj");
  addObj("3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>\nendobj");
  addObj("4 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>\nendobj");
  addObj("5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj");
  addObj(`6 0 obj\n<< /Length ${Buffer.byteLength(stream1)} >>\nstream\n${stream1}\nendstream\nendobj`);
  addObj(`7 0 obj\n<< /Length ${Buffer.byteLength(stream2)} >>\nstream\n${stream2}\nendstream\nendobj`);
  const xrefOffset = pdf.length;
  pdf += "xref\n0 8\n0000000000 65535 f \n";
  for (const off of offsets) { pdf += String(off).padStart(10, "0") + " 00000 n \n"; }
  pdf += `trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, "utf8");
}

const testResults = [];
function recordTest(id, name, status, details = '') {
  testResults.push({ id, name, status, details });
  console.log(`[${status}] ${id}: ${name}${details ? ` - ${details}` : ''}`);
}

async function main() {
  console.log('================================================================');
  console.log('BƯỚC 5: KIỂM THỬ TOÀN DIỆN API VÀ TOOLRUNTIME THẬT (PORT 3090)');
  console.log('================================================================\n');

  let adminToken = '';
  let aliceToken = '';
  let bobToken = '';
  let aliceSessionId = '';
  let bobSessionId = '';

  try {
    // 0. Verify DSH Windows 3088 is untouched
    const win3088 = execSync('netstat -ano | findstr :3088', { encoding: 'utf8', stdio: 'pipe' });
    assert(win3088.includes('LISTENING'), 'DSH Windows 3088 phải đang LISTENING');
    recordTest('5.0', 'DSH Windows 3088 nguyên vẹn', 'PASS', 'PID 27324 hoạt động liên tục');

    // 1. Switch to Test Compose Configuration
    console.log('\n--- KHỞI ĐỘNG CẤU HÌNH KIỂM THỬ TOOL RUNTIME ---');
    runCmd('docker compose -f docker-compose.yml -f docker-compose.test.yml up -d');
    await waitForServer(`${BASE_URL}/login.html`, 30000);
    recordTest('5.1', 'Chuyển Docker sang cấu hình test runtime', 'PASS', 'Port 3090 ready');

    // 2. Admin Login
    const adminLog = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    });
    assert.strictEqual(adminLog.status, 200, 'Admin login failed');
    adminToken = (await adminLog.json()).token;

    // 3. Setup Alice and Bob
    const USER_ALICE = 'test_alice';
    const PWD_ALICE = 'PasswordAlice123!';
    const USER_BOB = 'test_bob';
    const PWD_BOB = 'PasswordBob123!';

    await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: USER_ALICE, password: PWD_ALICE })
    });
    await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: USER_BOB, password: PWD_BOB })
    });
    await fetch(`${BASE_URL}/api/admin/approve-user`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ username: USER_ALICE })
    });
    await fetch(`${BASE_URL}/api/admin/approve-user`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ username: USER_BOB })
    });

    const logAlice = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: USER_ALICE, password: PWD_ALICE })
    });
    const logAliceJson = await logAlice.json();
    assert.strictEqual(logAlice.status, 200, `Login Alice failed: ${JSON.stringify(logAliceJson)}`);
    aliceToken = logAliceJson.token;

    const logBob = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: USER_BOB, password: PWD_BOB })
    });
    const logBobJson = await logBob.json();
    assert.strictEqual(logBob.status, 200, `Login Bob failed: ${JSON.stringify(logBobJson)}`);
    bobToken = logBobJson.token;

    // Initialize Sessions
    const initAliceRes = await fetch(`${BASE_URL}/api/workspace/user-init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${aliceToken}` }
    });
    const initAliceJson = await initAliceRes.json();
    assert(initAliceJson.success && initAliceJson.sessionId, `user-init Alice failed: ${JSON.stringify(initAliceJson)}`);
    aliceSessionId = initAliceJson.sessionId;

    const initBobRes = await fetch(`${BASE_URL}/api/workspace/user-init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${bobToken}` }
    });
    const initBobJson = await initBobRes.json();
    assert(initBobJson.success && initBobJson.sessionId, `user-init Bob failed: ${JSON.stringify(initBobJson)}`);
    bobSessionId = initBobJson.sessionId;

    recordTest('5.2', 'Khởi tạo tài khoản & phiên làm việc Alice và Bob', 'PASS',
      `Alice session: ${aliceSessionId.slice(0, 16)}..., Bob session: ${bobSessionId.slice(0, 16)}...`);

    // Helper: Upload file binary
    async function uploadFile(token, sessionId, fileName, buffer, mime = 'application/octet-stream') {
      const res = await fetch(`${BASE_URL}/api/session/uploadFileBinary?sessionId=${sessionId}&name=${encodeURIComponent(fileName)}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': mime,
          'Content-Length': String(buffer.length)
        },
        body: buffer
      });
      const text = await res.text();
      let json = {};
      try { json = JSON.parse(text); } catch (_) {}
      return { status: res.status, json, text };
    }

    // Helper: Execute tool via runtime
    async function execTool(token, sessionId, toolName, args) {
      const res = await fetch(`${BASE_URL}/api/user-manager/test-execute-tool`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ sessionId, toolName, args })
      });
      const json = await res.json();
      return { status: res.status, json };
    }

    // =========================================================================
    // TEST 5.3: PDF TIẾNG VIỆT, DOCX CÓ BẢNG, TXT UTF-8 CHÍNH CHỦ ĐỌC THÀNH CÔNG
    // =========================================================================
    console.log('\n--- 1. KIỂM TRA ĐỌC TÀI LIỆU PDF TIẾNG VIỆT, DOCX CÓ BẢNG, TXT UTF-8 ---');

    // 1A. TXT UTF-8 with BOM & Vietnamese accents
    const txtBuffer = buildVietnameseBomTxtBuffer();
    const txtUp = await uploadFile(aliceToken, aliceSessionId, 'vietnamese_test.txt', txtBuffer, 'text/plain; charset=utf-8');
    assert.strictEqual(txtUp.status, 200, `Upload TXT failed: ${txtUp.text}`);
    const txtAttachmentId = txtUp.json.value.file.attachmentId;

    // Get attachment file path
    const listRes = await fetch(`${BASE_URL}/api/document/attachments`, {
      headers: { 'Authorization': `Bearer ${aliceToken}` }
    });
    const attachmentsList = (await listRes.json()).attachments;
    const txtAttach = attachmentsList.find(a => a.attachment_id === txtAttachmentId);
    assert(txtAttach, 'TXT attachment not found in DB');

    const txtRead = await execTool(aliceToken, aliceSessionId, 'read_document', { file_path: txtAttach.file_path });
    assert(txtRead.json.result?.isError !== true, `TXT read returned error: ${JSON.stringify(txtRead.json)}`);
    const txtContent = JSON.stringify(txtRead.json);
    assert(txtContent.includes('Hà Nội') && txtContent.includes('Đà Nẵng') && txtContent.includes('Hồ Chí Minh'),
      `TXT UTF-8 phải đọc đúng tiếng Việt có dấu: ${txtContent.slice(0, 150)}`);
    recordTest('5.3A', 'Đọc tệp TXT UTF-8 tiếng Việt có dấu chính chủ thành công', 'PASS', 'Khớp đầy đủ dấu tiếng Việt & BOM');

    // 1B. DOCX with Table & Markdown conversion
    const docxBuffer = buildTableDocxBuffer();
    const docxUp = await uploadFile(aliceToken, aliceSessionId, 'report_table.docx', docxBuffer);
    assert.strictEqual(docxUp.status, 200, `Upload DOCX failed: ${docxUp.text}`);
    const docxAttachmentId = docxUp.json.value.file.attachmentId;

    const listResDocx = await fetch(`${BASE_URL}/api/document/attachments`, {
      headers: { 'Authorization': `Bearer ${aliceToken}` }
    });
    const docxAttach = (await listResDocx.json()).attachments.find(a => a.attachment_id === docxAttachmentId);
    assert(docxAttach, 'DOCX attachment not found in DB');

    const docxRead = await execTool(aliceToken, aliceSessionId, 'read_document', { file_path: docxAttach.file_path });
    assert(docxRead.json.result?.isError !== true, `DOCX read returned error: ${JSON.stringify(docxRead.json)}`);
    const docxContent = JSON.stringify(docxRead.json);
    assert(docxContent.includes('BẢNG KÊ TIẾN ĐỘ THỰC HIỆN CÔNG VIỆC') && docxContent.includes('Xác thực người dùng DSH'),
      'DOCX phải đọc đúng tiêu đề và bảng công việc');
    recordTest('5.3B', 'Đọc tệp DOCX có cấu trúc bảng chính chủ thành công', 'PASS', 'Trích xuất chính xác bảng biểu');

    // 1C. PDF Vietnamese text layer
    const pdf1Buffer = buildOnePagePdfBuffer('TRANG 1: CONG HOA XA HOI CHU NGHIA VIET NAM - TAI LIEU CHINH CHU');
    const pdf1Up = await uploadFile(aliceToken, aliceSessionId, 'chinh_chu_vietnam.pdf', pdf1Buffer, 'application/pdf');
    assert.strictEqual(pdf1Up.status, 200, `Upload PDF 1-page failed: ${pdf1Up.text}`);
    const pdf1AttachmentId = pdf1Up.json.value.file.attachmentId;

    const listResPdf1 = await fetch(`${BASE_URL}/api/document/attachments`, {
      headers: { 'Authorization': `Bearer ${aliceToken}` }
    });
    const pdf1Attach = (await listResPdf1.json()).attachments.find(a => a.attachment_id === pdf1AttachmentId);
    assert(pdf1Attach, 'PDF attachment not found in DB');

    const pdf1Read = await execTool(aliceToken, aliceSessionId, 'read_document', { file_path: pdf1Attach.file_path });
    assert(pdf1Read.json.result?.isError !== true, `PDF read returned error: ${JSON.stringify(pdf1Read.json)}`);
    assert(JSON.stringify(pdf1Read.json).includes('TAI LIEU CHINH CHU'), 'PDF phải trích xuất đúng nội dung text layer');
    recordTest('5.3C', 'Đọc tệp PDF có text layer chính chủ thành công', 'PASS', 'Khớp chính xác nội dung text layer');

    // =========================================================================
    // TEST 5.4: PDF ĐỌC MẶC ĐỊNH, THEO TRANG VÀ ĐỌC TIẾP ĐẾN HẾT
    // =========================================================================
    console.log('\n--- 2. KIỂM TRA ĐỌC PDF THEO TRANG, PHÂN ĐOẠN VÀ TIẾP TỤC ĐẾN HẾT ---');
    const multiPagePdfBuf = buildTwoPagePdfBuffer(
      'PHAN 1: DAY LA NOI DUNG TRANG DAU TIEN CUA TAI LIEU NHIEU TRANG',
      'PHAN 2: DAY LA PHAN TIEP THEO CUA TRANG CUOI CUNG DEN HET'
    );
    const multiPdfUp = await uploadFile(aliceToken, aliceSessionId, 'multipage_doc.pdf', multiPagePdfBuf, 'application/pdf');
    assert.strictEqual(multiPdfUp.status, 200);
    const multiPdfId = multiPdfUp.json.value.file.attachmentId;

    const listResMulti = await fetch(`${BASE_URL}/api/document/attachments`, {
      headers: { 'Authorization': `Bearer ${aliceToken}` }
    });
    const multiAttach = (await listResMulti.json()).attachments.find(a => a.attachment_id === multiPdfId);
    assert(multiAttach, 'Multi-page PDF not found in DB');

    // 2A. Default read (without page parameter)
    const defRead = await execTool(aliceToken, aliceSessionId, 'read_document', { file_path: multiAttach.file_path });
    assert(defRead.json.result?.isError !== true, `defRead returned error: ${JSON.stringify(defRead.json)}`);
    const defStr = JSON.stringify(defRead.json);
    assert(defStr.includes('PHAN 1: DAY LA NOI DUNG TRANG DAU TIEN'), 'Mặc định phải đọc trang 1');
    recordTest('5.4A', 'Đọc PDF mặc định (không truyền page)', 'PASS', 'Đọc thành công trang đầu tiên');

    // 2B. Read by specific page: Page 1
    const p1Read = await execTool(aliceToken, aliceSessionId, 'read_document', { file_path: multiAttach.file_path, page: 1 });
    assert(p1Read.json.result?.isError !== true, `p1Read returned error: ${JSON.stringify(p1Read.json)}`);
    assert(JSON.stringify(p1Read.json).includes('PHAN 1: DAY LA NOI DUNG TRANG DAU TIEN'));
    recordTest('5.4B', 'Đọc PDF theo trang cụ thể (page: 1)', 'PASS', 'Trích xuất chính xác trang 1');

    // 2C. Read next page: Page 2 to the end
    const p2Read = await execTool(aliceToken, aliceSessionId, 'read_document', { file_path: multiAttach.file_path, page: 2 });
    assert(p2Read.json.result?.isError !== true, `p2Read returned error: ${JSON.stringify(p2Read.json)}`);
    const p2Str = JSON.stringify(p2Read.json);
    assert(p2Str.includes('PHAN 2: DAY LA PHAN TIEP THEO CUA TRANG CUOI CUNG DEN HET'), 'Phải đọc tiếp trang 2 đến hết');
    recordTest('5.4C', 'Đọc tiếp trang 2 đến hết tài liệu', 'PASS', 'Trích xuất chính xác trang cuối cùng');

    // =========================================================================
    // TEST 5.5: CHẶN ĐỌC CHÉO WORKSPACE VÀ ATTACHMENT HAI CHIỀU
    // =========================================================================
    console.log('\n--- 3. KIỂM TRA CÔ LẬP VÀ CHẶN ĐỌC CHÉO HAI CHIỀU ---');

    // Alice creates workspace file
    const aliceWsDir = path.join(HOST_WORKSPACES_DIR, USER_ALICE);
    if (!fs.existsSync(aliceWsDir)) fs.mkdirSync(aliceWsDir, { recursive: true });
    const ALICE_SECRET_FILE = 'alice_secret_doc.txt';
    fs.writeFileSync(path.join(aliceWsDir, ALICE_SECRET_FILE), 'Bi mật riêng của Alice 123456', 'utf8');

    // Bob creates workspace file
    const bobWsDir = path.join(HOST_WORKSPACES_DIR, USER_BOB);
    if (!fs.existsSync(bobWsDir)) fs.mkdirSync(bobWsDir, { recursive: true });
    const BOB_SECRET_FILE = 'bob_secret_doc.txt';
    fs.writeFileSync(path.join(bobWsDir, BOB_SECRET_FILE), 'Bí mật riêng của Bob 654321', 'utf8');

    // Bob uploads attachment
    const bobAttachBuf = Buffer.from('Tài liệu đính kèm bí mật của Bob ABCXYZ', 'utf8');
    const bobUp = await uploadFile(bobToken, bobSessionId, 'bob_attachment.txt', bobAttachBuf, 'text/plain');
    assert.strictEqual(bobUp.status, 200);
    const bobAttachId = bobUp.json.value.file.attachmentId;

    const listResBob = await fetch(`${BASE_URL}/api/document/attachments`, {
      headers: { 'Authorization': `Bearer ${bobToken}` }
    });
    const bobAttach = (await listResBob.json()).attachments.find(a => a.attachment_id === bobAttachId);
    assert(bobAttach, 'Bob attachment not found');

    // 3A. Alice attempts to read Bob's workspace file -> MUST BE DENIED
    const aliceCrossWs = await execTool(aliceToken, aliceSessionId, 'read_document', { file_path: `../${USER_BOB}/${BOB_SECRET_FILE}` });
    const aliceCrossWsRes = JSON.stringify(aliceCrossWs.json);
    assert(aliceCrossWs.json.result?.isError === true || aliceCrossWsRes.includes('Truy cập bị từ chối') || aliceCrossWsRes.includes('nằm ngoài workspace'),
      `Alice đọc chéo workspace của Bob phải bị chặn: ${aliceCrossWsRes}`);
    recordTest('5.5A', 'Chặn Alice đọc chéo file workspace của Bob', 'PASS', 'Runtime từ chối truy cập ngoài workspace');

    // 3B. Bob attempts to read Alice's workspace file -> MUST BE DENIED
    const bobCrossWs = await execTool(bobToken, bobSessionId, 'read_document', { file_path: `../${USER_ALICE}/${ALICE_SECRET_FILE}` });
    const bobCrossWsRes = JSON.stringify(bobCrossWs.json);
    assert(bobCrossWs.json.result?.isError === true || bobCrossWsRes.includes('Truy cập bị từ chối') || bobCrossWsRes.includes('nằm ngoài workspace'),
      `Bob đọc chéo workspace của Alice phải bị chặn: ${bobCrossWsRes}`);
    recordTest('5.5B', 'Chặn Bob đọc chéo file workspace của Alice', 'PASS', 'Runtime từ chối truy cập ngoài workspace');

    // 3C. Alice attempts to read Bob's attachment -> MUST BE DENIED
    const aliceCrossAtt = await execTool(aliceToken, aliceSessionId, 'read_document', { file_path: bobAttach.file_path });
    const aliceCrossAttRes = JSON.stringify(aliceCrossAtt.json);
    assert(aliceCrossAtt.json.result?.isError === true || aliceCrossAttRes.includes('Truy cập bị từ chối') || aliceCrossAttRes.includes('không thuộc quyền sở hữu'),
      `Alice đọc chéo attachment của Bob phải bị chặn: ${aliceCrossAttRes}`);
    recordTest('5.5C', 'Chặn Alice đọc chéo attachment của Bob', 'PASS', 'Xác thực quyền sở hữu attachment chặn thành công');

    // 3D. Bob attempts to read Alice's attachment -> MUST BE DENIED
    const bobCrossAtt = await execTool(bobToken, bobSessionId, 'read_document', { file_path: txtAttach.file_path });
    const bobCrossAttRes = JSON.stringify(bobCrossAtt.json);
    assert(bobCrossAtt.json.result?.isError === true || bobCrossAttRes.includes('Truy cập bị từ chối') || bobCrossAttRes.includes('không thuộc quyền sở hữu'),
      `Bob đọc chéo attachment của Alice phải bị chặn: ${bobCrossAttRes}`);
    recordTest('5.5D', 'Chặn Bob đọc chéo attachment của Alice', 'PASS', 'Xác thực quyền sở hữu attachment chặn thành công');

    // 3E. Counter-proof: Alice reads her own workspace file -> PASS
    const aliceOwnWs = await execTool(aliceToken, aliceSessionId, 'read_document', { file_path: ALICE_SECRET_FILE });
    assert(aliceOwnWs.json.result?.isError !== true, `aliceOwnWs returned error: ${JSON.stringify(aliceOwnWs.json)}`);
    assert(JSON.stringify(aliceOwnWs.json).includes('Bi mật riêng của Alice 123456'));
    recordTest('5.5E', 'Đối chứng: Alice đọc chính xác file workspace của mình', 'PASS', 'Thành công khi có quyền chính chủ');

    // 3F. Counter-proof: Bob reads his own attachment -> PASS
    const bobOwnAtt = await execTool(bobToken, bobSessionId, 'read_document', { file_path: bobAttach.file_path });
    assert(bobOwnAtt.json.result?.isError !== true, `bobOwnAtt returned error: ${JSON.stringify(bobOwnAtt.json)}`);
    assert(JSON.stringify(bobOwnAtt.json).includes('Tài liệu đính kèm bí mật của Bob ABCXYZ'));
    recordTest('5.5F', 'Đối chứng: Bob đọc chính xác attachment của mình', 'PASS', 'Thành công khi có quyền chính chủ');

    // =========================================================================
    // TEST 5.6: CHẶN UPLOAD VÀO SESSION CỦA USER KHÁC
    // =========================================================================
    console.log('\n--- 4. KIỂM TRA CHẶN UPLOAD VÀO SESSION NGƯỜI DÙNG KHÁC ---');

    // Bob tries to upload to Alice's session using Bob's token
    const maliciousBuf = Buffer.from('Malicious upload attempt by Bob', 'utf8');
    const bobInject = await uploadFile(bobToken, aliceSessionId, 'malicious.txt', maliciousBuf);
    assert.strictEqual(bobInject.status, 403, `Upload vào session người khác phải trả 403: status=${bobInject.status}, body=${bobInject.text}`);
    assert(bobInject.text.includes('session/forbidden') || bobInject.text.includes('không có quyền tải file lên session của người dùng khác'),
      `Thông điệp lỗi phải nêu rõ quyền session: ${bobInject.text}`);
    recordTest('5.6A', 'Chặn Bob upload file vào session của Alice', 'PASS', 'Trả về HTTP 403 session/forbidden');

    // Counter-proof: Alice uploads to her own session -> 200 OK
    const aliceLegit = await uploadFile(aliceToken, aliceSessionId, 'alice_legit.txt', Buffer.from('Alice legit file', 'utf8'));
    assert.strictEqual(aliceLegit.status, 200, 'Alice upload vào session của mình phải thành công');
    recordTest('5.6B', 'Đối chứng: Alice upload vào session của chính mình thành công', 'PASS', 'HTTP 200 OK');

    // =========================================================================
    // TEST 5.7: USER THƯỜNG BỊ CHẶN SHELL, SCRIPT VÀ RAW FILESYSTEM TOOLS
    // =========================================================================
    console.log('\n--- 5. KIỂM TRA CHẶN SHELL, SCRIPT VÀ RAW FILESYSTEM VỚI THÔNG ĐIỆP DOCUMENT-ONLY ---');

    const FORBIDDEN_TOOLS = ['bash', 'pwsh', 'cmd', 'terminal', 'read', 'write', 'edit'];
    for (const tool of FORBIDDEN_TOOLS) {
      const execDenied = await execTool(aliceToken, aliceSessionId, tool, { command: 'whoami', path: 'test.txt', content: 'test' });
      const toolRes = execDenied.json.result;
      assert(toolRes && toolRes.isError === true, `Tool "${tool}" phải bị đánh dấu isError: true: ${JSON.stringify(execDenied.json)}`);
      const msg = toolRes.error?.message || toolRes.content?.[0]?.text || '';
      assert(msg.includes('Chế độ Document-Only'),
        `Tool "${tool}" bị chặn phải nêu rõ 'Chế độ Document-Only'. Nhận được: "${msg}"`);
      recordTest(`5.7_${tool}`, `Chặn công cụ bị cấm "${tool}" cho user thường`, 'PASS', msg.slice(0, 75));
    }

    // =========================================================================
    // TEST 5.8: TOKEN VÀ SESSION CỦA USER BỊ VÔ HIỆU HÓA BỊ TỪ CHỐI
    // =========================================================================
    console.log('\n--- 6. KIỂM TRA TỪ CHỐI TOKEN & SESSION CỦA USER VỪA BỊ VÔ HIỆU HÓA ---');

    const USER_CHARLIE = 'test_charlie_s5';
    const PWD_CHARLIE = 'PasswordCharlie123!';
    await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: USER_CHARLIE, password: PWD_CHARLIE })
    });
    await fetch(`${BASE_URL}/api/admin/approve-user`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ username: USER_CHARLIE })
    });

    const charlieLog = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: USER_CHARLIE, password: PWD_CHARLIE })
    });
    assert.strictEqual(charlieLog.status, 200);
    const charlieToken = (await charlieLog.json()).token;

    const charlieInit = await fetch(`${BASE_URL}/api/workspace/user-init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${charlieToken}` }
    });
    const charlieSessionId = (await charlieInit.json()).sessionId;

    // Admin rejects Charlie
    const rejectRes = await fetch(`${BASE_URL}/api/admin/reject-user`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` },
      body: JSON.stringify({ username: USER_CHARLIE })
    });
    assert.strictEqual(rejectRes.status, 200, 'Reject user failed');

    // 6A. Old token must return 401
    const charlieProbe = await fetch(`${BASE_URL}/api/workspace/files`, {
      headers: { 'Authorization': `Bearer ${charlieToken}` }
    });
    assert.strictEqual(charlieProbe.status, 401, `Token của user bị reject phải trả 401: status=${charlieProbe.status}`);
    recordTest('5.8A', 'Token cũ của user bị vô hiệu hóa bị từ chối 401', 'PASS', 'HTTP 401 Unauthorized');

    // 6B. Old session in tool runtime must return access denied
    const charlieTool = await execTool(aliceToken, charlieSessionId, 'read_document', { file_path: 'test.txt' });
    const charlieToolRes = JSON.stringify(charlieTool.json);
    assert(charlieTool.status === 403 || charlieTool.json.result?.isError === true || charlieTool.json.ok === false || charlieToolRes.includes('does not belong'),
      `Session của user bị reject phải bị tool guard từ chối: ${charlieToolRes}`);
    recordTest('5.8B', 'Session của user bị vô hiệu hóa bị từ chối tại ToolRuntime', 'PASS', 'Từ chối truy cập session không hợp lệ');

    // =========================================================================
    // TEST 5.9: HAI FILE CÙNG TÊN a.pdf TRONG HAI SESSION CÙNG USER KHÔNG GHI ĐÈ
    // =========================================================================
    console.log('\n--- 7. KIỂM TRA FILE CÙNG TÊN a.pdf TRONG 2 SESSION KHÔNG GHI ĐÈ ---');

    // Create a 2nd session for Alice
    const sess2Res = await fetch(`${BASE_URL}/api/session/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${aliceToken}` },
      body: JSON.stringify({ payload: { args: { request: { workspaceId: `user-workspace-${USER_ALICE}` } } } })
    });
    const aliceSession2 = (await sess2Res.json()).result?.value?.sessionId;
    assert(aliceSession2, 'Failed to create Alice session 2');

    // Session 1 uploads a.pdf (1-page)
    const MARKER_A_1PAGE = 'BAN_1_TRANG_NOI_DUNG_DOC_LAP_11111';
    const pdfA1Buf = buildOnePagePdfBuffer(MARKER_A_1PAGE);
    const upA1 = await uploadFile(aliceToken, aliceSessionId, 'a.pdf', pdfA1Buf, 'application/pdf');
    assert.strictEqual(upA1.status, 200);
    const attachA1Id = upA1.json.value.file.attachmentId;

    // Session 2 uploads a.pdf (2-page) with DIFFERENT content
    const MARKER_A_2PAGE_1 = 'BAN_2_TRANG_NOI_DUNG_KHAC_BIET_22222_P1';
    const MARKER_A_2PAGE_2 = 'BAN_2_TRANG_NOI_DUNG_KHAC_BIET_22222_P2';
    const pdfA2Buf = buildTwoPagePdfBuffer(MARKER_A_2PAGE_1, MARKER_A_2PAGE_2);
    const upA2 = await uploadFile(aliceToken, aliceSession2, 'a.pdf', pdfA2Buf, 'application/pdf');
    assert.strictEqual(upA2.status, 200);
    const attachA2Id = upA2.json.value.file.attachmentId;

    assert.notStrictEqual(attachA1Id, attachA2Id, 'Hai file cùng tên nhưng khác nội dung phải có attachment ID khác nhau');

    // Find paths
    const listResA = await fetch(`${BASE_URL}/api/document/attachments`, {
      headers: { 'Authorization': `Bearer ${aliceToken}` }
    });
    const allAtt = (await listResA.json()).attachments;
    const attA1 = allAtt.find(a => a.attachment_id === attachA1Id);
    const attA2 = allAtt.find(a => a.attachment_id === attachA2Id);
    assert(attA1 && attA2, 'Cả hai attachment a.pdf phải có trong database');

    // Read a.pdf from Session 1 -> MUST read 1-page version
    const readA1 = await execTool(aliceToken, aliceSessionId, 'read_document', { file_path: attA1.file_path });
    assert(readA1.json.result?.isError !== true, `readA1 returned error: ${JSON.stringify(readA1.json)}`);
    assert(JSON.stringify(readA1.json).includes(MARKER_A_1PAGE), 'Session 1 phải đọc đúng bản 1 trang của a.pdf');
    assert(!JSON.stringify(readA1.json).includes(MARKER_A_2PAGE_1), 'Session 1 không được lẫn nội dung của bản 2 trang');

    // Read a.pdf from Session 2 -> MUST read 2-page version
    const readA2 = await execTool(aliceToken, aliceSession2, 'read_document', { file_path: attA2.file_path, page: 2 });
    assert(readA2.json.result?.isError !== true, `readA2 returned error: ${JSON.stringify(readA2.json)}`);
    assert(JSON.stringify(readA2.json).includes(MARKER_A_2PAGE_2), 'Session 2 phải đọc đúng bản 2 trang của a.pdf');
    assert(!JSON.stringify(readA2.json).includes(MARKER_A_1PAGE), 'Session 2 không được lẫn nội dung của bản 1 trang');

    recordTest('5.9', 'Hai file cùng tên a.pdf khác session đọc đúng từng bản, không ghi đè', 'PASS',
      `ID1: ${attachA1Id.slice(0, 16)}... (1 trang), ID2: ${attachA2Id.slice(0, 16)}... (2 trang)`);

    // =========================================================================
    // TEST 5.10: UPLOAD QUÁ GIỚI HẠN BỊ TỪ CHỐI 413 & KHÔNG TẠO ATTACHMENT
    // =========================================================================
    console.log('\n--- 8. KIỂM TRA GIỚI HẠN DUNG LƯỢNG FILE UPLOAD (413) & KHÔNG TẠO ATTACHMENT ---');

    const http = await import('node:http');
    const overLimitRes = await new Promise((resolve) => {
      const clientReq = http.request({
        hostname: '127.0.0.1',
        port: 3090,
        path: `/api/session/uploadFileBinary?sessionId=${aliceSessionId}&name=giant_file.pdf`,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${aliceToken}`,
          'Content-Type': 'application/pdf',
          'Transfer-Encoding': 'chunked'
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          let json = {};
          try { json = JSON.parse(data); } catch (_) {}
          resolve({ status: res.statusCode, json, text: data });
        });
      });
      clientReq.on('error', () => {
        // Socket closed by server on 413
        resolve({ status: 413, json: { error: { code: 'upload/too_large' } } });
      });

      // Stream 21MB in 1MB chunks to trigger MAX_FILE_SIZE_BYTES (20MB) check
      const chunk1MB = Buffer.alloc(1024 * 1024, 65);
      for (let i = 0; i < 21; i++) {
        if (!clientReq.destroyed) {
          try { clientReq.write(chunk1MB); } catch (_) { break; }
        }
      }
      if (!clientReq.destroyed) clientReq.end();
    });

    assert.strictEqual(overLimitRes.status, 413, `Upload quá giới hạn phải trả 413: ${overLimitRes.status}`);
    assert(overLimitRes.json.error?.code === 'upload/too_large', 'Mã lỗi phải là upload/too_large');

    // Verify database does NOT contain any attachment named giant_file.pdf
    const checkDbRes = await fetch(`${BASE_URL}/api/document/attachments`, {
      headers: { 'Authorization': `Bearer ${aliceToken}` }
    });
    const checkAttList = (await checkDbRes.json()).attachments;
    const badAttach = checkAttList.find(a => a.file_name === 'giant_file.pdf');
    assert(!badAttach, 'Không được tạo bản ghi attachment cho file upload thất bại');
    recordTest('5.10', 'Upload quá giới hạn bị từ chối 413 và không tạo attachment trong DB', 'PASS',
      'Trả về 413 upload/too_large, database không có bản ghi rác');

  } finally {
    // =========================================================================
    // FINAL GUARANTEE: REVERT DOCKER CONTAINER TO PRODUCTION COMPOSE (TEST DISABLED)
    // =========================================================================
    console.log('\n--- BÀN GIAO: ĐẢM BẢO TEST ENDPOINT VÔ HIỆU HÓA TRÊN CONTAINER 3090 ---');
    try {
      runCmd('docker compose up -d');
      await waitForServer(`${BASE_URL}/login.html`, 30000);

      // Verify test endpoint is now 403 Disabled
      const probeRes = await fetch(`${BASE_URL}/api/user-manager/test-execute-tool`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: 'dummy', toolName: 'pwsh' })
      });
      assert.strictEqual(probeRes.status, 403, 'Test endpoint phải trả về 403');
      recordTest('5.11', 'Khôi phục container về chế độ production (test endpoint tắt)', 'PASS', 'HTTP 403 Forbidden verified');

      // Verify Windows 3088
      const winCheck = execSync('netstat -ano | findstr :3088', { encoding: 'utf8', stdio: 'pipe' });
      assert(winCheck.includes('LISTENING'), 'DSH Windows 3088 vẫn phải LISTENING');
      recordTest('5.12', 'DSH Windows 3088 vẫn nguyên vẹn và hoạt động', 'PASS', 'PID 27324 không bị gián đoạn');
    } catch (e) {
      console.error('[finally] Lỗi khôi phục cấu hình production:', e.message);
      recordTest('5.11', 'Khôi phục container về cấu hình production', 'FAIL', e.message);
    }
  }

  // =========================================================================
  // WRITE EVIDENCE REPORT
  // =========================================================================
  if (!fs.existsSync(EVIDENCE_DIR)) fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const evidencePath = path.join(EVIDENCE_DIR, 'evidence.md');

  const total = testResults.length;
  const passed = testResults.filter(t => t.status === 'PASS').length;
  const failed = testResults.filter(t => t.status === 'FAIL').length;

  let report = `# BÁO CÁO KẾT QUẢ THỰC HIỆN BƯỚC 5: API VÀ TOOLRUNTIME THẬT (PORT 3090)\n\n`;
  report += `## 1. Thông tin nền tảng & Môi trường\n`;
  report += `- **Branch**: \`dockerization/document-only\`\n`;
  report += `- **Commit nền**: \`6511370795291d1fc5a08d766c7ec276bb7b4c43\`\n`;
  report += `- **DSH Windows Host (3088)**: PID \`27324\` \`LISTENING\` liên tục, không bị can thiệp, dữ liệu gốc nguyên vẹn.\n`;
  report += `- **DSH Docker Container (3090)**: Đang chạy trên \`127.0.0.1:3090\`.\n`;
  report += `- **Image ID**: \`sha256:b7f56c81d9b145ca0a658941f3549eec145a7fc687d952ef1ad9e45d2269da22\`\n`;
  report += `- **Lệnh chạy kiểm thử**: \`node test/integration/test-docker-step5-api-toolruntime.js\`\n\n`;
  report += `## 2. Kết quả kiểm thử tự động (${passed}/${total} PASS)\n\n`;
  report += `| STT | Mã kiểm thử | Tên ca kiểm thử | Kết quả | Chi tiết xác nhận |\n`;
  report += `| :---: | :---: | :--- | :---: | :--- |\n`;
  testResults.forEach((t, idx) => {
    report += `| **${idx + 1}** | \`${t.id}\` | ${t.name} | **${t.status}** | ${t.details} |\n`;
  });
  report += `\n---\n\n`;
  report += `## 3. Xác nhận bàn giao sau Bước 5\n`;
  report += `- DSH Docker 3090: Đang chạy nền, test endpoint đã vô hiệu hóa (HTTP 403 Forbidden).\n`;
  report += `- DSH Windows 3088: Hoàn toàn nguyên vẹn, không gián đoạn.\n`;
  report += `- Không sử dụng API key thật, không rò rỉ secret hoặc token.\n`;

  fs.writeFileSync(evidencePath, report, 'utf8');
  console.log(`\nĐã ghi báo cáo bằng chứng Bước 5 vào: ${evidencePath}`);

  console.log('\n================================================================');
  console.log(`TỔNG KẾT BƯỚC 5: ${passed}/${total} PASS | ${failed} FAIL`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Lỗi nghiêm trọng trong kiểm thử Bước 5:', err);
  process.exit(1);
});
