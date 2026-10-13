import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEBUG_PORT = 9222;
const USER_DATA_DIR = path.resolve('test', 'chrome-profile');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getDebuggerUrl() {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
      if (res.ok) {
        const list = await res.json();
        const pageTarget = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
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
      awaitPromise: true
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
  const testUsername = process.env.TEST_DSH_USERNAME || 'nvs';
  const testPassword = process.env.TEST_DSH_PASSWORD || '';
  console.log(`[1] Logging in as ${testUsername} via HTTP API...`);
  const loginRes = await fetch('http://127.0.0.1:3088/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: testUsername, password: testPassword })
  });
  const loginData = await loginRes.json();
  console.log('    Login success:', loginData.ok);

  console.log('[2] Launching Chrome headless...');
  if (fs.existsSync(USER_DATA_DIR)) {
    try { fs.rmSync(USER_DATA_DIR, { recursive: true, force: true }); } catch (e) {}
  }
  fs.mkdirSync(USER_DATA_DIR, { recursive: true });

  const chromeProc = spawn(CHROME_PATH, [
    `--remote-debugging-port=${DEBUG_PORT}`,
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    `--user-data-dir=${USER_DATA_DIR}`,
    'about:blank'
  ], { stdio: 'ignore' });

  try {
    const wsUrl = await getDebuggerUrl();
    console.log('[3] Connected to Chrome CDP:', wsUrl);

    const client = new CDPClient(wsUrl);
    await client.waitOpen();

    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Network.enable');

    const consoleLogs = [];
    const rpcFrames = [];

    client.onEvent((method, params) => {
      if (method === 'Runtime.consoleAPICalled') {
        const text = params.args.map(a => a.value ?? a.description ?? JSON.stringify(a)).join(' ');
        consoleLogs.push(`[CONSOLE ${params.type}] ${text}`);
      } else if (method === 'Runtime.exceptionThrown') {
        consoleLogs.push(`[EXCEPTION] ${params.exceptionDetails?.text} ${params.exceptionDetails?.exception?.description || ''}`);
      } else if (method === 'Network.webSocketFrameReceived') {
        const payload = params.response?.payloadData;
        if (payload) {
          try {
            const data = JSON.parse(payload);
            rpcFrames.push({ dir: 'RECV', data });
          } catch (e) {}
        }
      } else if (method === 'Network.webSocketFrameSent') {
        const payload = params.response?.payloadData;
        if (payload) {
          try {
            const data = JSON.parse(payload);
            rpcFrames.push({ dir: 'SENT', data });
          } catch (e) {}
        }
      }
    });

    // Set cookie
    await client.send('Network.setCookie', {
      name: 'dsh_user_token',
      value: loginData.token,
      domain: '127.0.0.1',
      path: '/'
    });

    console.log('[4] Navigating to http://127.0.0.1:3088/ ...');
    await client.send('Page.navigate', { url: 'http://127.0.0.1:3088/' });

    // Wait for load
    await sleep(6000);

    // Seed localStorage as well
    await client.eval(`
      localStorage.setItem('dsh_user_token', ${JSON.stringify(loginData.token)});
      localStorage.setItem('dsh_user_info', ${JSON.stringify(JSON.stringify(loginData.user))});
    `);

    console.log('[5] Checking DSH UI State...');
    const domSummary = await client.eval(`(() => {
      const texts = Array.from(document.querySelectorAll('*'))
        .filter(e => e.children.length === 0 && e.textContent.trim().length > 0)
        .map(e => ({
          tag: e.tagName,
          text: e.textContent.trim(),
          class: String(e.className || ''),
          aria: e.getAttribute('aria-label') || e.getAttribute('title') || '',
          id: e.id || ''
        }));

      const buttons = Array.from(document.querySelectorAll('button')).map(b => ({
        text: b.textContent.trim(),
        aria: b.getAttribute('aria-label') || '',
        class: String(b.className || ''),
        disabled: b.disabled,
        popup: b.getAttribute('aria-haspopup') || ''
      }));

      const inputs = Array.from(document.querySelectorAll('textarea, input')).map(i => ({
        tag: i.tagName,
        placeholder: i.getAttribute('placeholder') || '',
        disabled: i.disabled,
        value: i.value,
        class: String(i.className || '')
      }));

      return { texts: texts.slice(0, 30), buttons, inputs };
    })()`);

    // Find the actual Choose workspace button!
    const wsBtnInfo = await client.eval(`(() => {
      const btn = document.querySelector('button.pXSMma_workspace') || Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Choose workspace') || b.textContent.includes('Workspace'));
      return btn ? { text: btn.textContent.trim(), class: btn.className, outer: btn.outerHTML } : null;
    })()`);
    console.log('\n--- CHOOSE WORKSPACE BUTTON ---');
    console.log(JSON.stringify(wsBtnInfo, null, 2));

    // Also find composer container
    const composerInfo = await client.eval(`(() => {
      const c = document.querySelector('[class*="composer"], [class*="composerBar"], [class*="hero"], [class*="inputBar"]');
      return c ? { class: c.className, outer: c.outerHTML.slice(0, 500) } : null;
    })()`);
    console.log('\n--- COMPOSER CONTAINER ---');
    console.log(JSON.stringify(composerInfo, null, 2));

    console.log('\n[6] Clicking Choose workspace button (button.pXSMma_workspace)...');
    const clickRes = await client.eval(`(() => {
      const btn = document.querySelector('button.pXSMma_workspace') || Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Choose workspace') || b.textContent.includes('Workspace'));
      if (btn) {
        btn.click();
        return 'Clicked: ' + btn.textContent.trim();
      }
      return 'Not found';
    })()`);
    console.log('    Click result:', clickRes);

    await sleep(1000);

    // Now check menuitems
    const menuItems = await client.eval(`(() => {
      const items = Array.from(document.querySelectorAll('[role="menuitem"], [class*="menuItem"], [class*="option"], [data-radix-collection-item]'));
      return items.map(el => ({
        text: el.textContent?.trim(),
        role: el.getAttribute('role'),
        class: el.className,
        display: window.getComputedStyle(el).display,
        visibility: window.getComputedStyle(el).visibility
      }));
    })()`);
    console.log('\n--- MENU ITEMS AFTER CLICK ---');
    console.log(JSON.stringify(menuItems, null, 2));

    const rpcFramesBeforeClick = rpcFrames.length;

    // Click item with nvs
    const selectRes = await client.eval(`(() => {
      const items = Array.from(document.querySelectorAll('[role="menuitem"], [class*="menuItem"]'));
      const target = items.find(el => el.textContent.includes('nvs'));
      if (target) {
        target.click();
        return 'Clicked target: ' + target.textContent.trim();
      }
      return 'No target with nvs found among ' + items.map(i => i.textContent.trim()).join('; ');
    })()`);
    console.log('\n[7] Selection result:', selectRes);

    await sleep(3000);

    console.log('\n--- RPC FRAMES TRIGGERED BY CLICKING WORKSPACE (NVS) ---');
    const newFrames = rpcFrames.slice(rpcFramesBeforeClick);
    console.log(`Total new frames: ${newFrames.length}`);
    for (const f of newFrames) {
      console.log(`${f.dir}:`, JSON.stringify(f.data));
    }

    // Now check the button text and composer state!
    const afterSelection = await client.eval(`(() => {
      const btn = document.querySelector('button.pXSMma_workspace') || Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Workspace') || b.textContent.includes('Choose'));
      const textarea = document.querySelector('textarea, [contenteditable="true"], input[type="text"]');
      const sendBtn = document.querySelector('button[aria-label="Send message"]');
      const rootDiv = document.querySelector('[data-conversation-region="composer"]');
      return {
        wsBtn: btn ? { text: btn.textContent.trim(), class: btn.className } : null,
        input: textarea ? {
          tag: textarea.tagName,
          disabled: textarea.disabled,
          placeholder: textarea.getAttribute('placeholder') || textarea.getAttribute('data-placeholder'),
          contentEditable: textarea.getAttribute('contenteditable')
        } : null,
        sendBtn: sendBtn ? { disabled: sendBtn.disabled } : null,
        composerHTML: rootDiv ? rootDiv.outerHTML.slice(0, 800) : null
      };
    })()`);
    console.log('\n--- STATE AFTER CLICKING WORKSPACE (NVS) ---');
    console.log(JSON.stringify(afterSelection, null, 2));

    console.log('\n--- ALL CONSOLE LOGS ---');
    console.log(consoleLogs.join('\n'));

    console.log('\n--- RELEVANT RPC FRAMES ---');
    for (const f of rpcFrames) {
      const s = JSON.stringify(f.data);
      if (s.includes('workspace') || s.includes('session') || s.includes('error') || s.includes('failure')) {
        console.log(`${f.dir}:`, s);
      }
    }

    client.close();
  } finally {
    chromeProc.kill();
  }
}

run().catch(err => {
  console.error('ERROR in browser flow test:', err);
  process.exit(1);
});
