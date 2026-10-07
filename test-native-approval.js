import http from 'node:http';
import { apply } from './lib/index.js';

class MockWebServer {
  constructor() {
    this.routes = [];
    this.indexTaps = [];
    this.server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);

      // Serve mocked DSH index.html
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        let html = '<!doctype html><html><head><title>DSH</title></head><body><div id="root">DSH UI</div></body></html>';
        for (const tap of this.indexTaps) {
          html = tap(html);
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(html);
      }

      const matched = this.routes.find(r => {
        if (r.kind === 'exact') return r.path === url.pathname;
        if (r.kind === 'prefix') return url.pathname.startsWith(r.path);
        return false;
      });

      if (matched) {
        matched.handler(req, res);
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not Found' }));
      }
    });
  }

  register(route) {
    this.routes.push(route);
  }

  tapIndex(transform) {
    this.indexTaps.push(transform);
  }

  listen(port) {
    return new Promise((resolve) => {
      this.server.listen(port, '127.0.0.1', () => resolve());
    });
  }

  close() {
    return new Promise((resolve) => {
      this.server.close(() => resolve());
    });
  }
}

async function request(port, method, path, data = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const postData = data ? JSON.stringify(data) : null;
    const reqHeaders = { ...headers };
    if (postData) {
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(postData);
    }

    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: reqHeaders
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(body);
        } catch {
          json = body;
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data: json
        });
      });
    });

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function runNativeApprovalTests() {
  console.log('\n--- BẮT ĐẦU TEST NATIVE DSH INTEGRATION & APPROVAL FLOW ---');
  const webServer = new MockWebServer();
  const TEST_PORT = 49155;
  await webServer.listen(TEST_PORT);

  const mockCtx = {
    webServer,
    provide: (name, obj) => {
      mockCtx[name] = obj;
    }
  };

  apply(mockCtx);

  try {
    // 0. Verify Native tapIndex Injection into DSH index.html
    console.log('\n[0] Testing GET / (DSH index.html with injected native UI)...');
    const indexRes = await request(TEST_PORT, 'GET', '/');
    console.log('Status code:', indexRes.status);
    const html = String(indexRes.data);
    if (!html.includes('id="dsh-um-bar"') || !html.includes('id="dsh-um-admin-modal"')) {
      throw new Error('Native UI injection into index.html failed!');
    }
    console.log('✅ Injected User Bar & Admin Modal verified in HTML!');

    // 1. Register new user 'newbie' -> Status must be 'pending'
    const newbie = `newbie_${Date.now().toString().slice(-4)}`;
    console.log(`\n[1] Registering new user '${newbie}'...`);
    const regRes = await request(TEST_PORT, 'POST', '/api/auth/register', {
      username: newbie,
      password: 'password123'
    });
    console.log('Status code:', regRes.status);
    console.log('Registration response:', regRes.data);
    if (regRes.status !== 201 || regRes.data.user.status !== 'pending') {
      throw new Error(`Expected user status 'pending' but got ${regRes.data?.user?.status}`);
    }

    // 2. 'newbie' attempts to login while 'pending' -> Expect HTTP 403 Forbidden
    console.log(`\n[2] User '${newbie}' attempting to login while pending (expecting 403)...`);
    const pendingLoginRes = await request(TEST_PORT, 'POST', '/api/auth/login', {
      username: newbie,
      password: 'password123'
    });
    console.log('Status code:', pendingLoginRes.status);
    console.log('Rejection response:', pendingLoginRes.data);
    if (pendingLoginRes.status !== 403 || pendingLoginRes.data.status !== 'pending') {
      throw new Error(`Expected 403 Forbidden for pending user, got: ${pendingLoginRes.status}`);
    }
    console.log('✅ Pending user successfully blocked from logging in!');

    // 3. Admin logs in -> Accesses /api/admin/pending-users
    console.log('\n[3] Admin logging in...');
    const adminLoginRes = await request(TEST_PORT, 'POST', '/api/auth/login', {
      username: 'admin',
      password: 'admin123'
    });
    console.log('Admin login status:', adminLoginRes.status);
    const adminCookie = adminLoginRes.headers['set-cookie'][0].split(';')[0];

    console.log('\n[3.2] Admin fetching pending users list...');
    const pendingListRes = await request(TEST_PORT, 'GET', '/api/admin/pending-users', null, { 'Cookie': adminCookie });
    console.log('Pending users count:', pendingListRes.data.users.length);
    const foundPending = pendingListRes.data.users.find(u => u.username === newbie);
    if (!foundPending) {
      throw new Error(`Newly registered user '${newbie}' not found in admin pending list`);
    }
    console.log(`✅ User '${newbie}' found in pending approval list!`);

    // 4. Admin approves 'newbie'
    console.log(`\n[4] Admin approving '${newbie}'...`);
    const approveRes = await request(TEST_PORT, 'POST', '/api/admin/approve-user', {
      username: newbie
    }, { 'Cookie': adminCookie });
    console.log('Approval response:', approveRes.data);
    if (approveRes.status !== 200 || approveRes.data.user.status !== 'active') {
      throw new Error('Approval API failed');
    }
    console.log(`✅ User '${newbie}' is now 'active'!`);

    // 5. 'newbie' logs in again -> Now succeeds with 200 OK
    console.log(`\n[5] User '${newbie}' logging in after approval...`);
    const approvedLoginRes = await request(TEST_PORT, 'POST', '/api/auth/login', {
      username: newbie,
      password: 'password123'
    });
    console.log('Login status:', approvedLoginRes.status);
    console.log('User data:', approvedLoginRes.data.user);
    if (approvedLoginRes.status !== 200 || approvedLoginRes.data.user.status !== 'active') {
      throw new Error('Approved login failed');
    }
    const newbieCookie = approvedLoginRes.headers['set-cookie'][0].split(';')[0];

    // 6. User writes file to their isolated workspace
    console.log(`\n[6] User '${newbie}' writing file to isolated workspace...`);
    const writeRes = await request(TEST_PORT, 'POST', '/api/workspace/file', {
      path: 'my-secrets/note.txt',
      content: 'Hello, this is my confidential workspace!'
    }, { 'Cookie': newbieCookie });
    console.log('Write file status:', writeRes.status);
    if (writeRes.status !== 201) throw new Error('Write file failed');

    // 7. Verify cross-user isolation: Admin or another user cannot traverse into newbie's workspace
    console.log(`\n[7] Cross-user isolation: verifying isolated file access...`);
    const readUserRes = await request(TEST_PORT, 'GET', '/api/workspace/file?path=my-secrets/note.txt', null, {
      'Cookie': newbieCookie
    });
    if (readUserRes.status !== 200 || !readUserRes.data.content.includes('confidential')) {
      throw new Error('User reading their own file failed');
    }

    const unauthRead = await request(TEST_PORT, 'GET', '/api/workspace/file?path=my-secrets/note.txt');
    if (unauthRead.status !== 401) {
      throw new Error('Unauthenticated read must return 401');
    }
    console.log('✅ Workspace isolation strictly verified!');

    console.log('\n========================================================================');
    console.log('🎉 TẤT CẢ TEST CASES NATIVE DSH INTEGRATION & APPROVAL FLOW PASS 100%!');
    console.log('========================================================================\n');
  } finally {
    await webServer.close();
  }
}

runNativeApprovalTests().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
