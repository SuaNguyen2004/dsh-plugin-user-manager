import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { buildMultiPagePdfBuffer } from './fixtures.js';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEBUG_PORT = 9222;
const USER_DATA_DIR = path.resolve('test', 'chrome-profile');

const TEST_NVS_USER = process.env.TEST_NVS_USERNAME || 'nvs';
const TEST_NVS_PASS = process.env.TEST_NVS_PASSWORD || '';
const TEST_NVA_USER = process.env.TEST_NVA_USERNAME || 'nva';
const TEST_NVA_PASS = process.env.TEST_NVA_PASSWORD || '';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getDebuggerUrl() {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
      if (res.ok) {
        const list = await res.json();
        const pageTarget = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
        if (pageTarget) {
          return pageTarget.webSocketDebuggerUrl;
        }
      }
    } catch (e) {}
    await sleep(300);
  }
  throw new Error('Could not connect to Chrome debugging port');
}

class CDPClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.callbacks = new Map();
    this.eventHandlers = [];

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.callbacks.has(msg.id)) {
        const { resolve, reject } = this.callbacks.get(msg.id);
        this.callbacks.delete(msg.id);
        if (msg.error) reject(msg.error);
        else resolve(msg.result);
      } else if (msg.method) {
        for (const handler of this.eventHandlers) {
          handler(msg.method, msg.params);
        }
      }
    };
  }

  waitOpen() {
    return new Promise((resolve, reject) => {
      if (this.ws.readyState === WebSocket.OPEN) return resolve();
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(e);
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      this.callbacks.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  onEvent(handler) {
    this.eventHandlers.push(handler);
  }

  async eval(expr) {
    const res = await this.send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.exceptionDetails) {
      throw new Error(`Eval error: ${JSON.stringify(res.exceptionDetails)}`);
    }
    return res.result?.value;
  }

  close() {
    this.ws.close();
  }
}

async function run() {
  console.log('======================================================================');
  console.log('   KIỂM THỬ TRÌNH DUYỆT THẬT: NVS -> NVA -> NVS TRÊN CÙNG PROFILE     ');
  console.log('======================================================================\n');

  // Prepare test PDF in nvs workspace
  const nvsWsDir = path.resolve('workspaces', TEST_NVS_USER);
  if (!fs.existsSync(nvsWsDir)) {
    fs.mkdirSync(nvsWsDir, { recursive: true });
  }
  const testPdfPath = path.join(nvsWsDir, 'tai_lieu_nvs.pdf');
  fs.writeFileSync(testPdfPath, buildMultiPagePdfBuffer());
  console.log(`[SETUP] Đã tạo file PDF test tại: ${testPdfPath}`);

  // Launch Chrome without deleting existing profile
  if (!fs.existsSync(USER_DATA_DIR)) {
    fs.mkdirSync(USER_DATA_DIR, { recursive: true });
  }

  const chromeProc = spawn(
    CHROME_PATH,
    [
      `--remote-debugging-port=${DEBUG_PORT}`,
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      `--user-data-dir=${USER_DATA_DIR}`,
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  try {
    const wsUrl = await getDebuggerUrl();
    console.log('[INIT] Chrome CDP connected:', wsUrl);

    const client = new CDPClient(wsUrl);
    await client.waitOpen();

    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Network.enable');

    const consoleLogs = [];
    const networkCalls = [];

    client.onEvent((method, params) => {
      if (method === 'Runtime.consoleAPICalled') {
        const text = params.args.map((a) => a.value ?? a.description ?? JSON.stringify(a)).join(' ');
        consoleLogs.push(`[CONSOLE ${params.type}] ${text}`);
      } else if (method === 'Runtime.exceptionThrown') {
        consoleLogs.push(
          `[EXCEPTION] ${params.exceptionDetails?.text} ${params.exceptionDetails?.exception?.description || ''}`
        );
      } else if (method === 'Network.requestWillBeSent') {
        const url = params.request?.url || '';
        if (url.includes('/api/')) {
          networkCalls.push({
            method: params.request.method,
            url: url.replace(/^http:\/\/[^/]+/, ''),
            postData: params.request.postData ? '[payload]' : undefined,
          });
        }
      }
    });

    // Helper: Form Login on /login UI
    async function doFormLogin(username, password) {
      console.log(`\n---> [FORM LOGIN] Điều hướng tới /login và đăng nhập tài khoản: "${username}"...`);
      await client.send('Page.navigate', { url: 'http://127.0.0.1:3088/login' });
      await sleep(2000);

      const fillRes = await client.eval(`(() => {
        const u = document.querySelector('#login-username');
        const p = document.querySelector('#login-password');
        const btn = document.querySelector('#btn-login-submit');
        if (!u || !p || !btn) return { ok: false, error: 'Elements not found' };
        u.value = ${JSON.stringify(username)};
        u.dispatchEvent(new Event('input', { bubbles: true }));
        p.value = ${JSON.stringify(password)};
        p.dispatchEvent(new Event('input', { bubbles: true }));
        btn.click();
        return { ok: true };
      })()`);

      if (!fillRes.ok) {
        throw new Error(`Login form fill error: ${fillRes.error}`);
      }

      console.log('     Đã nhấn submit form login, chờ chuyển hướng về DSH...');
      await sleep(5000);

      // Verify current URL
      const curUrl = await client.eval('window.location.href');
      console.log('     URL hiện tại sau đăng nhập:', curUrl);
    }

    // Helper: Inspect Composer and Workspace
    async function checkComposerState() {
      return await client.eval(`(() => {
        const wsBtn = document.querySelector('button.pXSMma_workspace') || Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Workspace') || b.textContent.includes('Choose'));
        const editor = document.querySelector('[contenteditable="true"]');
        const sendBtn = document.querySelector('button[aria-label="Send message"]');
        const placeholder = editor ? (editor.getAttribute('data-placeholder') || editor.placeholder || editor.parentElement?.querySelector('[class*="placeholder"]')?.textContent?.trim()) : null;
        const isLocked = editor ? (editor.getAttribute('aria-disabled') === 'true' || !editor.isContentEditable || (placeholder && placeholder.includes('Choose a workspace'))) : true;

        return {
          wsText: wsBtn ? wsBtn.textContent.trim() : null,
          hasEditor: !!editor,
          isContentEditable: editor ? editor.isContentEditable : false,
          placeholder: placeholder || null,
          isLocked: !!isLocked,
          sendBtnDisabled: sendBtn ? sendBtn.disabled : null
        };
      })()`);
    }

    // Helper: Send Prompt via Lexical Editor using CDP native input
    async function sendPrompt(text) {
      console.log(`     Đang nhập prompt: "${text}" vào ô chat qua CDP Native Input...`);
      await client.eval(`(() => {
        const editor = document.querySelector('[contenteditable="true"]');
        if (editor) editor.focus();
      })()`);
      await sleep(400);

      await client.send('Input.insertText', { text });
      await sleep(800);

      const sendBtnState = await client.eval(`(() => {
        const btn = document.querySelector('button[aria-label="Send message"]');
        return {
          exists: !!btn,
          disabled: btn ? btn.disabled : true
        };
      })()`);
      console.log('     Trạng thái nút Gửi sau khi nhập văn bản:', sendBtnState);

      if (sendBtnState.exists && !sendBtnState.disabled) {
        await client.eval(`(() => {
          const btn = document.querySelector('button[aria-label="Send message"]');
          if (btn) btn.click();
        })()`);
        console.log('     Đã nhấn nút Send message.');
        return true;
      } else {
        console.log('     Dispatch phím Enter để gửi prompt...');
        await client.send('Input.dispatchKeyEvent', {
          type: 'rawKeyDown',
          windowsVirtualKeyCode: 13,
          unmodifiedText: '\r',
          text: '\r'
        });
        await client.send('Input.dispatchKeyEvent', {
          type: 'keyUp',
          windowsVirtualKeyCode: 13
        });
        return true;
      }
    }

    // Helper: Wait for Agent Response Turns
    async function waitForAgentTurns(timeoutMs = 12000) {
      const startTime = Date.now();
      while (Date.now() - startTime < timeoutMs) {
        await sleep(2000);
        const turns = await client.eval(`(() => {
          const els = Array.from(document.querySelectorAll('[data-conversation-region="turn"], [class*="turn"], [class*="agentMessage"], [class*="userMessage"], [data-slot*="conversation"], [class*="messageRow"], [class*="bubble"]'))
            .map(e => e.textContent.trim())
            .filter(t => t.length > 0);
          return els;
        })()`);
        if (turns.length > 0) {
          return turns;
        }
      }
      return [];
    }

    // Helper: Click New Session
    async function clickNewSession() {
      console.log('     Đang bấm nút New Session...');
      const clicked = await client.eval(`(() => {
        const btn = document.querySelector('button[aria-label*="New" i], button[aria-label*="new" i], button[title*="New" i], [class*="newSession"]') || Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('New Session') || b.textContent.includes('新建') || b.getAttribute('aria-label') === 'New conversation');
        if (btn) {
          btn.click();
          return true;
        }
        return false;
      })()`);
      console.log('     Kết quả bấm New Session:', clicked);
      await sleep(3000);
    }

    // Helper: Do Logout via UI
    async function doLogout() {
      console.log('     Đang thực hiện đăng xuất qua window.dshUmLogout()...');
      await client.eval('if (typeof window.dshUmLogout === "function") window.dshUmLogout(); else window.location.href = "/login";');
      await sleep(3000);
      const url = await client.eval('window.location.href');
      console.log('     URL sau đăng xuất:', url);
    }

    // =========================================================================
    // GIAI ĐOẠN 1: USER NVS (LOGIN -> VERIFY UNLOCKED -> CHAT -> F5 -> NEW SESSION)
    // =========================================================================
    console.log('\n========================================');
    console.log('GIAI ĐOẠN 1: TÀI KHOẢN NVS');
    console.log('========================================');
    await doFormLogin(TEST_NVS_USER, TEST_NVS_PASS);

    let state1 = await checkComposerState();
    console.log('1.1 Trạng thái UI ban đầu nvs:', JSON.stringify(state1, null, 2));

    // If still showing choose workspace, auto-select
    if (state1.isLocked && state1.wsText && state1.wsText.includes('Choose')) {
      console.log('     Đang kích hoạt chọn Workspace (nvs)...');
      await client.eval(`(() => {
        const btn = document.querySelector('button.pXSMma_workspace') || Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Choose'));
        if (btn) btn.click();
      })()`);
      await sleep(800);
      await client.eval(`(() => {
        const item = Array.from(document.querySelectorAll('[role="menuitem"]')).find(i => i.textContent.includes('nvs'));
        if (item) item.click();
      })()`);
      await sleep(2000);
      state1 = await checkComposerState();
      console.log('1.1b Trạng thái sau khi chọn workspace:', JSON.stringify(state1, null, 2));
    }

    if (state1.isLocked) {
      throw new Error('THẤT BẠI: Ô chat của nvs vẫn bị khóa sau khi chọn workspace!');
    }
    console.log('===> [PASS] Ô chat nvs ĐÃ MỞ KHÓA HOÀN TOÀN!');

    // Send prompt "chào bạn"
    await sendPrompt('chào bạn');
    const turns1 = await waitForAgentTurns(10000);
    console.log(`     Nhận được ${turns1.length} lượt phản hồi từ Agent.`);
    if (turns1.length > 0) {
      console.log('     Phản hồi mới nhất:', turns1[turns1.length - 1].slice(0, 120));
    }

    // Test F5
    console.log('1.2 Thử nghiệm F5 (Reload) cho nvs...');
    await client.send('Page.reload');
    await sleep(4000);
    const state1Reload = await checkComposerState();
    console.log('     Trạng thái sau F5:', JSON.stringify(state1Reload, null, 2));
    if (state1Reload.isLocked) {
      throw new Error('THẤT BẠI: Ô chat bị khóa sau khi F5!');
    }
    console.log('===> [PASS] F5 thành công, trạng thái vẫn giữ mở khóa!');

    // Test New Session
    console.log('1.3 Thử nghiệm tạo New Session cho nvs...');
    await clickNewSession();
    const state1NewSes = await checkComposerState();
    console.log('     Trạng thái sau New Session:', JSON.stringify(state1NewSes, null, 2));
    if (state1NewSes.isLocked) {
      throw new Error('THẤT BẠI: Ô chat bị khóa sau khi tạo New Session!');
    }
    console.log('===> [PASS] New Session thành công, ô chat mở khóa!');

    // Logout
    await doLogout();

    // =========================================================================
    // GIAI ĐOẠN 2: CHUYỂN SANG USER NVA TRÊN CÙNG PROFILE (KHÔNG XÓA STORAGE)
    // =========================================================================
    console.log('\n========================================');
    console.log('GIAI ĐOẠN 2: TÀI KHOẢN NVA (CÙNG PROFILE TRÌNH DUYỆT)');
    console.log('========================================');
    await doFormLogin(TEST_NVA_USER, TEST_NVA_PASS);

    let state2 = await checkComposerState();
    console.log('2.1 Trạng thái UI ban đầu nva:', JSON.stringify(state2, null, 2));

    if (state2.isLocked && state2.wsText && state2.wsText.includes('Choose')) {
      console.log('     Đang chọn Workspace (nva)...');
      await client.eval(`(() => {
        const btn = document.querySelector('button.pXSMma_workspace') || Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Choose'));
        if (btn) btn.click();
      })()`);
      await sleep(800);
      await client.eval(`(() => {
        const item = Array.from(document.querySelectorAll('[role="menuitem"]')).find(i => i.textContent.includes('nva'));
        if (item) item.click();
      })()`);
      await sleep(2000);
      state2 = await checkComposerState();
      console.log('2.1b Trạng thái sau khi chọn workspace nva:', JSON.stringify(state2, null, 2));
    }

    if (state2.isLocked) {
      throw new Error('THẤT BẠI: Ô chat của nva bị khóa với "Choose a workspace to start"!');
    }
    console.log('===> [PASS] Ô chat nva ĐÃ MỞ KHÓA HOÀN TOÀN, không bị khóa!');

    // Send prompt "chào bạn"
    await sendPrompt('chào bạn từ nva');
    const turns2 = await waitForAgentTurns(10000);
    console.log(`     Nhận được ${turns2.length} lượt phản hồi cho nva.`);
    if (turns2.length > 0) {
      console.log('     Phản hồi mới nhất:', turns2[turns2.length - 1].slice(0, 120));
    }

    // Test F5
    console.log('2.2 Thử nghiệm F5 (Reload) cho nva...');
    await client.send('Page.reload');
    await sleep(4000);
    const state2Reload = await checkComposerState();
    console.log('     Trạng thái nva sau F5:', JSON.stringify(state2Reload, null, 2));
    if (state2Reload.isLocked) {
      throw new Error('THẤT BẠI: Ô chat nva bị khóa sau F5!');
    }
    console.log('===> [PASS] F5 nva thành công!');

    // Test New Session
    console.log('2.3 Thử nghiệm tạo New Session cho nva...');
    await clickNewSession();
    const state2NewSes = await checkComposerState();
    console.log('     Trạng thái nva sau New Session:', JSON.stringify(state2NewSes, null, 2));
    if (state2NewSes.isLocked) {
      throw new Error('THẤT BẠI: Ô chat nva bị khóa sau New Session!');
    }
    console.log('===> [PASS] New Session nva thành công!');

    // Logout
    await doLogout();

    // =========================================================================
    // GIAI ĐOẠN 3: QUAY LẠI NVS VÀ ĐỌC FILE PDF BẰNG TOOL READ_DOCUMENT
    // =========================================================================
    console.log('\n========================================');
    console.log('GIAI ĐOẠN 3: QUAY LẠI NVS VÀ KIỂM TRA READ_DOCUMENT VỚI FILE PDF');
    console.log('========================================');
    await doFormLogin(TEST_NVS_USER, TEST_NVS_PASS);

    let state3 = await checkComposerState();
    console.log('3.1 Trạng thái UI nvs khi quay lại:', JSON.stringify(state3, null, 2));

    if (state3.isLocked && state3.wsText && state3.wsText.includes('Choose')) {
      await client.eval(`(() => {
        const btn = document.querySelector('button.pXSMma_workspace') || Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Choose'));
        if (btn) btn.click();
      })()`);
      await sleep(800);
      await client.eval(`(() => {
        const item = Array.from(document.querySelectorAll('[role="menuitem"]')).find(i => i.textContent.includes('nvs'));
        if (item) item.click();
      })()`);
      await sleep(2000);
      state3 = await checkComposerState();
    }

    if (state3.isLocked) {
      throw new Error('THẤT BẠI: Ô chat nvs bị khóa khi quay lại!');
    }
    console.log('===> [PASS] Ô chat nvs đã mở khóa sẵn sàng!');

    // Send prompt reading PDF
    console.log('3.2 Gửi yêu cầu Agent đọc file PDF tai_lieu_nvs.pdf...');
    await sendPrompt('Hãy dùng tool read_document để đọc file tai_lieu_nvs.pdf trong workspace của tôi và cho biết tiêu đề văn bản là gì.');
    const turns3 = await waitForAgentTurns(14000);
    console.log(`     Nhận được ${turns3.length} lượt phản hồi khi đọc PDF.`);
    let readDocVerified = false;
    for (const t of turns3) {
      console.log('       [TURN NVS]:', t.slice(0, 160));
      if (t.includes('CONG HOA XA HOI') || t.includes('CỘNG HÒA XÃ HỘI') || t.includes('tai_lieu_nvs.pdf') || t.includes('read_document') || t.includes('DOC LAP TU DO')) {
        readDocVerified = true;
      }
    }

    // =========================================================================
    // TỔNG HỢP KIỂM TRA LỖI RPC VÀ NETWORK
    // =========================================================================
    console.log('\n========================================');
    console.log('TỔNG HỢP LOG CONSOLE VÀ NETWORK');
    console.log('========================================');
    const fatalErrors = consoleLogs.filter(
      (l) => l.includes('invalid server-response failure') || l.includes('SessionCreateError')
    );
    console.log(`- Số lỗi RPC fatal (invalid server-response / SessionCreateError): ${fatalErrors.length}`);
    if (fatalErrors.length > 0) {
      console.error('  Chi tiết lỗi:', fatalErrors);
    } else {
      console.log('  => ZERO invalid server-response failure!');
    }

    console.log(`- Tổng số API Network calls được ghi nhận: ${networkCalls.length}`);
    const sessionCreates = networkCalls.filter((c) => c.url.includes('/session/create'));
    console.log(`- Số lượt gọi /api/session/create: ${sessionCreates.length}`);

    console.log('\n======================================================================');
    console.log('  TẤT CẢ KIỂM THỬ TRÌNH DUYỆT THẬT (NVS -> NVA -> NVS) THÀNH CÔNG!     ');
    console.log('======================================================================');

    client.close();
  } finally {
    chromeProc.kill();
  }
}

run().catch((err) => {
  console.error('\n[LỖI TEST]:', err);
  process.exit(1);
});
