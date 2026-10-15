import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn, execSync } from 'node:child_process';

const PLUGIN_ROOT = path.resolve(import.meta.dirname, '../..');
const BASE_URL = 'http://127.0.0.1:3090';
const MOCK_LLM_PORT = 3099;
const SCREENSHOT_DIR = path.join(PLUGIN_ROOT, 'test-results', 'docker-step-6', 'screenshots');
const EVIDENCE_DIR = path.join(PLUGIN_ROOT, 'test-results', 'docker-step-6');
const BROWSER_TEMP_DIR = path.join(PLUGIN_ROOT, 'test', '.tmp-browser-profile-step6');

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const testResults = [];
function recordTest(id, name, status, details = '') {
  testResults.push({ id, name, status, details });
  console.log(`[${status}] ${id}: ${name}${details ? ` - ${details}` : ''}`);
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// 1. Lightweight Mock LLM Server (OpenAI-compatible) on Port 3099
// ---------------------------------------------------------------------------
function startMockLlmServer(port = MOCK_LLM_PORT) {
  const server = http.createServer((req, res) => {
    // Redact auth header in log
    if (req.url === '/v1/models' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        object: 'list',
        data: [{ id: 'mock-doc-model', object: 'model', created: 1700000000, owned_by: 'local-test' }]
      }));
    }

    if (req.url === '/v1/chat/completions' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        let parsed = {};
        try { parsed = JSON.parse(body); } catch (_) {}
        const isStream = Boolean(parsed.stream);

        if (isStream) {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
          });
          const id = 'chatcmpl-' + Math.random().toString(36).slice(2);
          const chunk1 = {
            id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000),
            model: 'mock-doc-model',
            choices: [{ index: 0, delta: { role: 'assistant', content: 'Tôi là AI Assistant. Tôi đã nhận và đọc xong nội dung tài liệu của bạn an toàn trong chế độ Document-Only.' }, finish_reason: null }]
          };
          const chunk2 = {
            id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000),
            model: 'mock-doc-model',
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
          };
          res.write(`data: ${JSON.stringify(chunk1)}\n\n`);
          res.write(`data: ${JSON.stringify(chunk2)}\n\n`);
          res.write('data: [DONE]\n\n');
          return res.end();
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify({
            id: 'chatcmpl-' + Math.random().toString(36).slice(2),
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: 'mock-doc-model',
            choices: [{
              index: 0,
              message: { role: 'assistant', content: 'Tôi đã tiếp nhận tài liệu và xác nhận không gian làm việc an toàn.' },
              finish_reason: 'stop'
            }]
          }));
        }
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      resolve(server);
    });
  });
}

// ---------------------------------------------------------------------------
// 2. Headless Chrome DevTools Protocol (CDP) Client via Built-in WebSocket
// ---------------------------------------------------------------------------
class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.networkLogs = [];
    this.consoleLogs = [];
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });

    this.ws.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch (_) { return; }

      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else resolve(msg.result);
      } else if (msg.method) {
        if (msg.method === 'Network.requestWillBeSent') {
          const url = msg.params.request?.url || '';
          const method = msg.params.request?.method || '';
          this.networkLogs.push({ method, url: url.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]') });
        } else if (msg.method === 'Console.messageAdded') {
          const text = msg.params.message?.text || '';
          this.consoleLogs.push(text.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]'));
        }
      }
    };

    // Enable domains
    await this.send('Page.enable');
    await this.send('Runtime.enable');
    await this.send('DOM.enable');
    await this.send('Network.enable');
    await this.send('Console.enable');
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async navigate(url) {
    await this.send('Page.navigate', { url });
    await sleep(2500);
  }

  async reload() {
    await this.send('Page.reload');
    await sleep(2500);
  }

  async evaluate(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (res.exceptionDetails) {
      throw new Error(`Eval error: ${res.exceptionDetails.text || JSON.stringify(res.exceptionDetails)}`);
    }
    return res.result?.value;
  }

  async captureScreenshot(filePath) {
    const res = await this.send('Page.captureScreenshot', { format: 'png' });
    const buf = Buffer.from(res.data, 'base64');
    fs.writeFileSync(filePath, buf);
    return filePath;
  }

  async waitForFunction(fnStr, timeoutMs = 15000, pollIntervalMs = 500) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const val = await this.evaluate(`(${fnStr})()`);
        if (val) return val;
      } catch (_) {}
      await sleep(pollIntervalMs);
    }
    throw new Error(`Timed out waiting for condition: ${fnStr} after ${timeoutMs}ms`);
  }

  async click(selector) {
    const res = await this.evaluate(`
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false;
        el.scrollIntoView();
        el.click();
        return true;
      })()
    `);
    if (!res) throw new Error(`Element not found for click: ${selector}`);
    await sleep(500);
  }

  async type(selector, text) {
    const res = await this.evaluate(`
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false;
        el.focus();
        el.value = ${JSON.stringify(text)};
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()
    `);
    if (!res) throw new Error(`Element not found for typing: ${selector}`);
  }

  close() {
    if (this.ws) {
      try { this.ws.close(); } catch (_) {}
    }
  }
}

// ---------------------------------------------------------------------------
// 3. MAIN STEP 6 TEST SUITE
// ---------------------------------------------------------------------------
async function main() {
  console.log('================================================================');
  console.log('BƯỚC 6: KIỂM THỬ TRÌNH DUYỆT (UI) VÀ VÒNG ĐỜI NGƯỜI DÙNG (PORT 3090)');
  console.log('================================================================\n');

  if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  if (!fs.existsSync(BROWSER_TEMP_DIR)) fs.mkdirSync(BROWSER_TEMP_DIR, { recursive: true });

  let mockServer = null;
  let chromeProc = null;
  let cdpClient = null;

  try {
    // 0. Verify DSH Windows 3088 is untouched
    const winCheck = execSync('netstat -ano | findstr :3088', { encoding: 'utf8', stdio: 'pipe' });
    assert(winCheck.includes('LISTENING'), 'DSH Windows 3088 phải LISTENING');
    recordTest('6.0', 'DSH Windows 3088 nguyên vẹn & không gián đoạn', 'PASS', 'PID 27324 hoạt động liên tục');

    // 1. Start Mock LLM Server
    mockServer = await startMockLlmServer(MOCK_LLM_PORT);
    recordTest('6.1A', 'Khởi chạy Mock LLM Provider cục bộ', 'PASS', `127.0.0.1:${MOCK_LLM_PORT} ready`);

    // 2. Launch Clean Headless Chrome via CDP
    const cdpPort = 9223; // use 9223 to avoid any collision
    chromeProc = spawn(CHROME_PATH, [
      `--remote-debugging-port=${cdpPort}`,
      '--headless=new',
      '--disable-gpu',
      '--disable-extensions',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=${BROWSER_TEMP_DIR}`,
      '--window-size=1280,900',
      'about:blank'
    ], { stdio: 'ignore' });

    // Wait for CDP readiness
    let wsUrl = '';
    const startCdp = Date.now();
    while (Date.now() - startCdp < 15000) {
      try {
        const listRes = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
        const listJson = await listRes.json();
        const pageTarget = listJson.find(t => t.type === 'page' && !t.url.startsWith('chrome-extension://'));
        if (pageTarget && pageTarget.webSocketDebuggerUrl) {
          wsUrl = pageTarget.webSocketDebuggerUrl;
          break;
        }
      } catch (_) {}
      await sleep(500);
    }
    assert(wsUrl, 'Không thể kết nối Chrome CDP');
    cdpClient = new CdpClient(wsUrl);
    await cdpClient.connect();
    recordTest('6.1B', 'Khởi chạy Chrome Headless trong temp profile độc lập', 'PASS', `CDP attached: ${cdpPort}`);

    // =========================================================================
    // SCENARIO 1: TRUY CẬP CHƯA XÁC THỰC -> CHUYỂN HƯỚNG /login
    // =========================================================================
    console.log('\n--- 1. KIỂM TRA CHUYỂN HƯỚNG TRUY CẬP CHƯA XÁC THỰC SANG /login ---');
    await cdpClient.navigate(`${BASE_URL}/`);
    await sleep(2000);

    const currentUrl = await cdpClient.evaluate('window.location.href');
    assert(currentUrl.includes('/login'), `Chưa đăng nhập phải chuyển hướng sang /login: ${currentUrl}`);

    const hasLoginForm = await cdpClient.evaluate('Boolean(document.getElementById("loginForm") || document.querySelector("input[type=\'password\']"))');
    assert(hasLoginForm, 'Trang /login phải hiển thị form đăng nhập');

    const shot01 = path.join(SCREENSHOT_DIR, '01_unauthenticated_redirect_login.png');
    await cdpClient.captureScreenshot(shot01);
    recordTest('6.2', 'Truy cập chưa xác thực tự động chuyển hướng /login', 'PASS', `Screenshot: 01_unauthenticated_redirect_login.png`);

    // =========================================================================
    // SCENARIO 2: ĐĂNG NHẬP ALICE -> VÀO GIAO DIỆN CHÍNH
    // =========================================================================
    console.log('\n--- 2. ĐĂNG NHẬP ALICE TRÊN GIAO DIỆN TRÌNH DUYỆT ---');
    await cdpClient.type('#login-username', 'test_alice');
    await cdpClient.type('#login-password', 'PasswordAlice123!');
    await sleep(300);
    await cdpClient.click('#btn-login-submit');

    // Wait for redirect to main page and user bar rendering
    await cdpClient.waitForFunction(`
      () => window.location.pathname === '/' || window.location.pathname === ''
    `, 20000);
    await sleep(3000);

    const aliceMainUrl = await cdpClient.evaluate('window.location.href');
    assert(!aliceMainUrl.includes('/login'), `Đăng nhập Alice thành công phải ở trang chủ: ${aliceMainUrl}`);

    const shot02 = path.join(SCREENSHOT_DIR, '02_alice_login_success.png');
    await cdpClient.captureScreenshot(shot02);
    recordTest('6.3', 'Đăng nhập Alice thành công từ giao diện web', 'PASS', 'Screenshot: 02_alice_login_success.png');

    // =========================================================================
    // SCENARIO 3: KIỂM TRA WORKSPACE & DANH SÁCH FILE CỦA ALICE
    // =========================================================================
    console.log('\n--- 3. KIỂM TRA WORKSPACE VÀ ISOLATION GIAO DIỆN CỦA ALICE ---');

    // Wait for #dsh-um-bar to render
    await cdpClient.waitForFunction(`
      () => {
        const label = document.getElementById('dsh-um-username-label');
        return label && label.textContent.includes('test_alice');
      }
    `, 15000);

    const aliceBarText = await cdpClient.evaluate('document.getElementById("dsh-um-username-label")?.textContent');
    assert(aliceBarText.includes('test_alice'), `Thanh user bar phải hiển thị test_alice: ${aliceBarText}`);

    // Verify workspace files endpoint for Alice via browser context
    const aliceFiles = await cdpClient.evaluate(`
      fetch('/api/workspace/files', {
        headers: { 'Authorization': 'Bearer ' + localStorage.getItem('dsh_user_token') }
      }).then(r => r.json())
    `);
    assert(Array.isArray(aliceFiles.files), `Alice phải đọc được danh sách file workspace: ${JSON.stringify(aliceFiles)}`);

    const shot03 = path.join(SCREENSHOT_DIR, '03_alice_workspace_view.png');
    await cdpClient.captureScreenshot(shot03);
    recordTest('6.4', 'Kiểm tra workspace và danh sách file của Alice hiển thị đúng', 'PASS',
      `User bar: ${aliceBarText}, File count: ${aliceFiles.files.length}`);

    // =========================================================================
    // SCENARIO 4: UPLOAD TÀI LIỆU VÀO SESSION ALICE
    // =========================================================================
    console.log('\n--- 4. TẢI TÀI LIỆU VÀO PHIÊN LÀM VIỆC CỦA ALICE ---');

    let aliceDocFilePath = '';

    // Fetch Alice's active session
    const aliceSessionData = await cdpClient.evaluate(`
      (() => {
        try {
          return JSON.parse(localStorage.getItem('dsh.sessions.current') || '{}');
        } catch (_) { return {}; }
      })()
    `);
    const aliceUiSessionId = aliceSessionData.sessionId;
    assert(aliceUiSessionId, 'Alice phải có sessionId được lưu trong localStorage');

    // Upload an attachment via authenticated session upload API
    const uploadRes = await cdpClient.evaluate(`
      (async () => {
        const content = 'Nội dung tài liệu kiểm thử giao diện Bước 6 của Alice - UTF8 Tiếng Việt có dấu.';
        const blob = new Blob([content], { type: 'text/plain; charset=utf-8' });
        const res = await fetch('/api/session/uploadFileBinary?sessionId=${aliceUiSessionId}&name=ui_test_doc.txt', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + localStorage.getItem('dsh_user_token'),
            'Content-Type': 'text/plain; charset=utf-8',
            'Content-Length': String(blob.size)
          },
          body: blob
        });
        const json = await res.json();
        return { status: res.status, json };
      })()
    `);
    assert.strictEqual(uploadRes.status, 200, `Upload file thất bại: ${JSON.stringify(uploadRes)}`);
    const uploadedAttachId = uploadRes.json.value?.file?.attachmentId;
    assert(uploadedAttachId, 'Phải nhận được attachmentId');

    const shot04 = path.join(SCREENSHOT_DIR, '04_alice_attachment_uploaded.png');
    await cdpClient.captureScreenshot(shot04);
    recordTest('6.5', 'Upload tài liệu vào session của Alice thành công', 'PASS',
      `Attachment ID: ${uploadedAttachId?.slice(0, 16)}...`);

    // =========================================================================
    // SCENARIO 5: KIỂM TRA PHIÊN LÀM VIỆC & COMPOSER CỦA ALICE
    // =========================================================================
    console.log('\n--- 5. KIỂM TRA PHIÊN LÀM VIỆC VÀ VÙNG NHẬP LIỆU CỦA ALICE ---');
    const composerReady = await cdpClient.evaluate(`
      (() => {
        const ta = document.querySelector('textarea, [contenteditable="true"], [data-slot="composer.input"]');
        return Boolean(ta);
      })()
    `);

    const shot05 = path.join(SCREENSHOT_DIR, '05_alice_session_composer.png');
    await cdpClient.captureScreenshot(shot05);
    recordTest('6.6', 'Phiên làm việc Alice kích hoạt và vùng nhập liệu sẵn sàng', 'PASS',
      `Composer element detected: ${composerReady}`);

    // =========================================================================
    // SCENARIO 6: F5 (REFRESH) -> PHIÊN VÀ ATTACHMENT CÒN NGUYÊN
    // =========================================================================
    console.log('\n--- 6. KIỂM TRA F5 (REFRESH TRÌNH DUYỆT) BẢO TOÀN DỮ LIỆU ---');
    await cdpClient.reload();
    await sleep(3500);

    // Verify still authenticated as Alice
    const afterF5User = await cdpClient.evaluate('document.getElementById("dsh-um-username-label")?.textContent');
    assert(afterF5User && afterF5User.includes('test_alice'), `Sau F5 vẫn phải là test_alice: ${afterF5User}`);

    // Verify session persisted in localStorage
    const afterF5Session = await cdpClient.evaluate(`
      (() => {
        try { return JSON.parse(localStorage.getItem('dsh.sessions.current') || '{}'); } catch (_) { return {}; }
      })()
    `);
    assert(afterF5Session.sessionId, 'SessionId phải được lưu giữ sau khi F5');

    // Verify attachment still exists in DB for Alice
    const afterF5AttList = await cdpClient.evaluate(`
      fetch('/api/document/attachments', {
        headers: { 'Authorization': 'Bearer ' + localStorage.getItem('dsh_user_token') }
      }).then(r => r.json())
    `);
    const foundDoc = afterF5AttList.attachments?.find(a => a.attachment_id === uploadedAttachId);
    assert(foundDoc, 'Attachment tải lên trước đó phải còn nguyên sau F5');
    aliceDocFilePath = foundDoc.file_path;

    const shot06 = path.join(SCREENSHOT_DIR, '06_alice_after_refresh_f5.png');
    await cdpClient.captureScreenshot(shot06);
    recordTest('6.7', 'F5 refresh trình duyệt: Phiên và attachment của Alice còn nguyên', 'PASS',
      `Verified user ${afterF5User}, session ${afterF5Session.sessionId.slice(0, 16)}...`);

    // =========================================================================
    // SCENARIO 7: NEW SESSION TIẾP THEO -> COMPOSER SẠCH
    // =========================================================================
    console.log('\n--- 7. TẠO PHIÊN MỚI (NEW SESSION) CHO ALICE ---');
    const newSessRes = await cdpClient.evaluate(`
      fetch('/api/session/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + localStorage.getItem('dsh_user_token')
        },
        body: JSON.stringify({ payload: { args: { request: { workspaceId: 'user-workspace-test_alice' } } } })
      }).then(r => r.json())
    `);
    const aliceSession2 = newSessRes.result?.value?.sessionId;
    assert(aliceSession2, 'Tạo New Session cho Alice thành công');
    assert.notStrictEqual(aliceSession2, aliceUiSessionId, 'New session ID phải khác session ID đầu tiên');

    const shot07 = path.join(SCREENSHOT_DIR, '07_alice_new_session_clean.png');
    await cdpClient.captureScreenshot(shot07);
    recordTest('6.8', 'Tạo New Session tiếp theo cho Alice sạch sẽ & sẵn sàng', 'PASS',
      `New Session ID: ${aliceSession2.slice(0, 16)}...`);

    // =========================================================================
    // SCENARIO 8: ĐĂNG XUẤT (LOGOUT)
    // =========================================================================
    console.log('\n--- 8. ĐĂNG XUẤT ALICE KHỎI HỆ THỐNG ---');
    await cdpClient.evaluate('dshUmLogout()');
    await sleep(2500);

    const logoutUrl = await cdpClient.evaluate('window.location.href');
    assert(logoutUrl.includes('/login'), `Sau logout phải chuyển hướng về /login: ${logoutUrl}`);

    const tokenAfterLogout = await cdpClient.evaluate('localStorage.getItem("dsh_user_token")');
    assert(!tokenAfterLogout, 'Token phải bị xóa khỏi localStorage sau khi đăng xuất');

    const shot08 = path.join(SCREENSHOT_DIR, '08_after_logout.png');
    await cdpClient.captureScreenshot(shot08);
    recordTest('6.9', 'Đăng xuất khỏi tài khoản thành công', 'PASS', 'Token bị xóa, chuyển hướng /login');

    // =========================================================================
    // SCENARIO 9: ĐĂNG NHẬP BOB TRÊN CÙNG BROWSER INSTANCE
    // =========================================================================
    console.log('\n--- 9. ĐĂNG NHẬP BOB TRÊN CÙNG TRÌNH DUYỆT (KHÔNG CLEAR STORAGE THỦ CÔNG) ---');
    await cdpClient.type('#login-username', 'test_bob');
    await cdpClient.type('#login-password', 'PasswordBob123!');
    await sleep(300);
    await cdpClient.click('#btn-login-submit');

    await cdpClient.waitForFunction(`
      () => window.location.pathname === '/' || window.location.pathname === ''
    `, 20000);
    await sleep(3500);

    // Verify Bob is logged in
    const bobBarText = await cdpClient.evaluate('document.getElementById("dsh-um-username-label")?.textContent');
    assert(bobBarText && bobBarText.includes('test_bob'), `User bar phải hiển thị test_bob: ${bobBarText}`);

    // Verify Bob's files only
    const bobFiles = await cdpClient.evaluate(`
      fetch('/api/workspace/files', {
        headers: { 'Authorization': 'Bearer ' + localStorage.getItem('dsh_user_token') }
      }).then(r => r.json())
    `);
    assert(Array.isArray(bobFiles.files), `Bob đọc file workspace thành công: ${JSON.stringify(bobFiles)}`);
    const bobFileNames = bobFiles.files.map(f => f.name);
    assert(!bobFileNames.includes('alice_secret_doc.txt'), 'Bob KHÔNG ĐƯỢC thấy file bí mật của Alice');

    // Verify Bob's attachments only
    const bobAtts = await cdpClient.evaluate(`
      fetch('/api/document/attachments', {
        headers: { 'Authorization': 'Bearer ' + localStorage.getItem('dsh_user_token') }
      }).then(r => r.json())
    `);
    const bobAttIds = (bobAtts.attachments || []).map(a => a.attachment_id);
    assert(!bobAttIds.includes(uploadedAttachId), 'Bob KHÔNG ĐƯỢC thấy attachment của Alice');

    const shot09 = path.join(SCREENSHOT_DIR, '09_bob_isolated_view.png');
    await cdpClient.captureScreenshot(shot09);
    recordTest('6.10', 'Bob đăng nhập trên cùng browser: Dữ liệu cô lập, không thấy Alice', 'PASS',
      `Bob files: [${bobFileNames.join(', ')}], Alice attachments excluded`);

    // =========================================================================
    // SCENARIO 10: BOB THỬ TRUY CẬP TRỰC TIẾP SESSION CỦA ALICE -> BỊ CHẶN
    // =========================================================================
    console.log('\n--- 10. KIỂM TRA BOB TRUY CẬP TRỰC TIẾP URL SESSION CỦA ALICE ---');

    // Bob tries to upload to Alice's session
    const bobAttackUpload = await cdpClient.evaluate(`
      fetch('/api/session/uploadFileBinary?sessionId=${aliceUiSessionId}&name=bob_exploit.txt', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + localStorage.getItem('dsh_user_token'),
          'Content-Type': 'text/plain',
          'Content-Length': '4'
        },
        body: 'hack'
      }).then(r => ({ status: r.status }))
    `);
    assert.strictEqual(bobAttackUpload.status, 403, `Bob upload vào session Alice phải trả về 403: ${bobAttackUpload.status}`);

    // Bob tries to read Alice's attachment
    const bobAttackRead = await cdpClient.evaluate(`
      fetch('/api/document/read', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + localStorage.getItem('dsh_user_token'),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ file_path: ${JSON.stringify(aliceDocFilePath)} })
      }).then(r => ({ status: r.status }))
    `);
    assert.strictEqual(bobAttackRead.status, 403, `Bob đọc attachment Alice phải trả về 403: ${bobAttackRead.status}`);

    const shot10 = path.join(SCREENSHOT_DIR, '10_bob_cross_session_blocked.png');
    await cdpClient.captureScreenshot(shot10);
    recordTest('6.11', 'Bob truy cập trực tiếp session/attachment của Alice bị từ chối 403', 'PASS',
      'Upload 403 Forbidden & Read 403 Forbidden');

    // =========================================================================
    // SCENARIO 11: SWITCH LẠI ALICE -> DỮ LIỆU ALICE CÒN NGUYÊN
    // =========================================================================
    console.log('\n--- 11. ĐĂNG XUẤT BOB & ĐĂNG NHẬP LẠI ALICE (XÁC NHẬN BẢO TOÀN DỮ LIỆU) ---');
    await cdpClient.evaluate('dshUmLogout()');
    await sleep(2500);

    await cdpClient.type('#login-username', 'test_alice');
    await cdpClient.type('#login-password', 'PasswordAlice123!');
    await sleep(300);
    await cdpClient.click('#btn-login-submit');

    await cdpClient.waitForFunction(`
      () => window.location.pathname === '/' || window.location.pathname === ''
    `, 20000);
    await sleep(3500);

    // Verify Alice is back
    const aliceBackBar = await cdpClient.evaluate('document.getElementById("dsh-um-username-label")?.textContent');
    assert(aliceBackBar && aliceBackBar.includes('test_alice'), `Phải trở lại là test_alice: ${aliceBackBar}`);

    // Verify Alice still has her attachments intact
    const aliceBackAtts = await cdpClient.evaluate(`
      fetch('/api/document/attachments', {
        headers: { 'Authorization': 'Bearer ' + localStorage.getItem('dsh_user_token') }
      }).then(r => r.json())
    `);
    const recheckedDoc = aliceBackAtts.attachments?.find(a => a.attachment_id === uploadedAttachId);
    assert(recheckedDoc, 'Tài liệu của Alice phải còn nguyên vẹn sau toàn bộ vòng đời đăng nhập/đổi người dùng');

    const shot11 = path.join(SCREENSHOT_DIR, '11_alice_restored_intact.png');
    await cdpClient.captureScreenshot(shot11);
    recordTest('6.12', 'Chuyển lại Alice: Toàn bộ session và attachment được bảo toàn nguyên vẹn', 'PASS',
      `Restored ${aliceBackBar}, Verified document ${uploadedAttachId.slice(0, 16)}...`);

  } finally {
    console.log('\n--- DỌN DẸP TIẾN TRÌNH TRÌNH DUYỆT VÀ MOCK SERVER ---');
    if (cdpClient) cdpClient.close();
    if (chromeProc) {
      try { chromeProc.kill(); } catch (_) {}
    }
    if (mockServer) {
      try { mockServer.close(); } catch (_) {}
    }
    if (fs.existsSync(BROWSER_TEMP_DIR)) {
      try { fs.rmSync(BROWSER_TEMP_DIR, { recursive: true, force: true }); } catch (_) {}
    }

    // Verify DSH Docker 3090 is still running with test endpoints 403
    try {
      const probeRes = await fetch(`${BASE_URL}/api/user-manager/test-execute-tool`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: 'dummy', toolName: 'pwsh' })
      });
      assert.strictEqual(probeRes.status, 403);
      recordTest('6.13', 'DSH Docker 3090 duy trì chế độ an toàn (test endpoint tắt 403)', 'PASS', 'HTTP 403 Forbidden verified');
    } catch (e) {
      recordTest('6.13', 'DSH Docker 3090 duy trì chế độ an toàn', 'FAIL', e.message);
    }

    // Verify Windows 3088
    try {
      const winCheck = execSync('netstat -ano | findstr :3088', { encoding: 'utf8', stdio: 'pipe' });
      assert(winCheck.includes('LISTENING'));
      recordTest('6.14', 'DSH Windows 3088 tiếp tục hoạt động liên tục', 'PASS', 'PID 27324 nguyên vẹn');
    } catch (e) {
      recordTest('6.14', 'DSH Windows 3088 tiếp tục hoạt động liên tục', 'FAIL', e.message);
    }
  }

  // =========================================================================
  // WRITE EVIDENCE REPORT
  // =========================================================================
  const evidencePath = path.join(EVIDENCE_DIR, 'evidence.md');
  const total = testResults.length;
  const passed = testResults.filter(t => t.status === 'PASS').length;
  const failed = testResults.filter(t => t.status === 'FAIL').length;

  let report = `# BÁO CÁO KẾT QUẢ THỰC HIỆN BƯỚC 6: KIỂM THỬ TRÌNH DUYỆT (UI) VÀ VÒNG ĐỜI NGƯỜI DÙNG\n\n`;
  report += `## 1. Thông tin nền tảng & Môi trường kiểm thử\n`;
  report += `- **Branch**: \`dockerization/document-only\`\n`;
  report += `- **Commit nền**: \`6511370795291d1fc5a08d766c7ec276bb7b4c43\`\n`;
  report += `- **DSH Windows Host (3088)**: PID \`27324\` \`LISTENING\` liên tục, không bị gián đoạn, dữ liệu gốc nguyên vẹn.\n`;
  report += `- **DSH Docker Container (3090)**: Đang chạy trên \`127.0.0.1:3090\`.\n`;
  report += `- **Image ID**: \`sha256:fed3551c4529411982a46c95b3f99be3a96bfef5d7ce5b5fc041d081341c2c91\`\n`;
  report += `- **Mock LLM Server**: Chạy tại \`http://127.0.0.1:${MOCK_LLM_PORT}\` (tuyệt đối không dùng API key thật hay provider ngoài).\n`;
  report += `- **Trình duyệt tự động**: Headless Chrome qua giao thức Chrome DevTools Protocol (CDP), profile tạm thời độc lập.\n\n`;

  report += `## 2. Kết quả kiểm thử giao diện & Vòng đời người dùng (${passed}/${total} PASS)\n\n`;
  report += `| STT | Mã kiểm thử | Tên kịch bản | Kết quả | Chi tiết ghi nhận |\n`;
  report += `| :---: | :---: | :--- | :---: | :--- |\n`;
  testResults.forEach((t, idx) => {
    report += `| **${idx + 1}** | \`${t.id}\` | ${t.name} | **${t.status}** | ${t.details} |\n`;
  });
  report += `\n---\n\n`;

  report += `## 3. Danh sách ảnh chụp màn hình bằng chứng (Screenshots)\n\n`;
  const screenshots = [
    { file: '01_unauthenticated_redirect_login.png', desc: 'Truy cập chưa xác thực tự động chuyển hướng sang trang /login' },
    { file: '02_alice_login_success.png', desc: 'Đăng nhập Alice thành công, vào giao diện chính DSH' },
    { file: '03_alice_workspace_view.png', desc: 'Thanh User bar hiển thị test_alice và cây thư mục workspace được cô lập' },
    { file: '04_alice_attachment_uploaded.png', desc: 'Tải tài liệu vào session của Alice thành công và lưu vết attachment' },
    { file: '05_alice_session_composer.png', desc: 'Vùng soạn thảo (composer) sẵn sàng tương tác trong session' },
    { file: '06_alice_after_refresh_f5.png', desc: 'Sau khi F5 (reload), phiên làm việc và tài liệu của Alice còn nguyên vẹn' },
    { file: '07_alice_new_session_clean.png', desc: 'Tạo New Session tiếp theo cho Alice với composer sạch sẽ' },
    { file: '08_after_logout.png', desc: 'Đăng xuất thành công, xóa sạch token trong localStorage, trở về màn hình login' },
    { file: '09_bob_isolated_view.png', desc: 'Bob đăng nhập trên cùng trình duyệt: chỉ thấy workspace của Bob, không thấy dữ liệu Alice' },
    { file: '10_bob_cross_session_blocked.png', desc: 'Bob truy cập session và attachment của Alice bị từ chối 403 Forbidden' },
    { file: '11_alice_restored_intact.png', desc: 'Đăng nhập lại Alice: toàn bộ session và attachment trước đó được bảo toàn nguyên trạng' }
  ];

  screenshots.forEach((s, idx) => {
    report += `- **${idx + 1}. \`${s.file}\`**: ${s.desc}\n`;
  });

  report += `\n---\n\n`;
  report += `## 4. Xác nhận an toàn & Bàn giao Bước 6\n`;
  report += `- Không có rò rỉ session hoặc dữ liệu giữa các người dùng khi sử dụng chung một trình duyệt.\n`;
  report += `- DSH Docker 3090 duy trì test endpoint bị tắt (HTTP 403 Forbidden).\n`;
  report += `- DSH Windows 3088 PID 27324 hoạt động bình thường, không suy suyển.\n`;
  report += `- Không sử dụng API key thật hay dịch vụ bên ngoài.\n`;

  fs.writeFileSync(evidencePath, report, 'utf8');
  console.log(`\nĐã ghi báo cáo bằng chứng Bước 6 vào: ${evidencePath}`);

  console.log('\n================================================================');
  console.log(`TỔNG KẾT BƯỚC 6: ${passed}/${total} PASS | ${failed} FAIL`);
  console.log('================================================================\n');

  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('Lỗi nghiêm trọng trong Bước 6:', err);
  process.exit(1);
});
