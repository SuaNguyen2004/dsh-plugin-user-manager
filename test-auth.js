import http from 'node:http';
import { apply } from './lib/index.js';

// Mock WebServer mimicking Cordis / @deepseek-ai/dsh-host-webserver
class MockWebServer {
  constructor() {
    this.routes = [];
    this.server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
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

async function runTests() {
  console.log('\n--- BẮT ĐẦU TEST TOÀN DIỆN AUTH & DATABASE ---');
  const webServer = new MockWebServer();
  const TEST_PORT = 49152;
  await webServer.listen(TEST_PORT);

  // Apply plugin with mock context
  const mockCtx = {
    webServer,
    provide: (key, val) => { mockCtx[key] = val; }
  };
  apply(mockCtx);

  try {
    // 1. Test status route
    console.log('\n[1] Testing GET /api/user-manager/status...');
    const statusRes = await request(TEST_PORT, 'GET', '/api/user-manager/status');
    console.log('Status code:', statusRes.status);
    console.log('Response:', statusRes.data);
    if (statusRes.status !== 200 || statusRes.data.status !== 'ok') throw new Error('Status test failed');

    // 2. Test Admin Login (default seeded user)
    console.log('\n[2] Testing POST /api/auth/login (admin / admin123)...');
    const adminLoginRes = await request(TEST_PORT, 'POST', '/api/auth/login', {
      username: 'admin',
      password: 'admin123'
    });
    console.log('Status code:', adminLoginRes.status);
    console.log('User logged in:', adminLoginRes.data.user);
    const setCookieHeader = adminLoginRes.headers['set-cookie'];
    console.log('Set-Cookie received:', setCookieHeader);
    if (adminLoginRes.status !== 200 || !adminLoginRes.data.token) throw new Error('Admin login failed');

    const adminToken = adminLoginRes.data.token;
    const cookieHeader = setCookieHeader ? setCookieHeader[0].split(';')[0] : '';

    // 3. Test GET /api/auth/me with Cookie
    console.log('\n[3] Testing GET /api/auth/me with session cookie...');
    const meResCookie = await request(TEST_PORT, 'GET', '/api/auth/me', null, {
      'Cookie': cookieHeader
    });
    console.log('Status code:', meResCookie.status);
    console.log('Auth Me response (Cookie):', meResCookie.data);
    if (meResCookie.status !== 200 || meResCookie.data.user.username !== 'admin') throw new Error('Auth me with cookie failed');

    // 4. Test GET /api/auth/me with Bearer token
    console.log('\n[4] Testing GET /api/auth/me with Bearer token header...');
    const meResBearer = await request(TEST_PORT, 'GET', '/api/auth/me', null, {
      'Authorization': `Bearer ${adminToken}`
    });
    console.log('Status code:', meResBearer.status);
    console.log('Auth Me response (Bearer):', meResBearer.data);
    if (meResBearer.status !== 200 || meResBearer.data.user.username !== 'admin') throw new Error('Auth me with bearer failed');

    // 5. Test Register a new user
    const testUser = `dev_${Date.now().toString().slice(-4)}`;
    console.log(`\n[5] Testing POST /api/auth/register for user '${testUser}'...`);
    const registerRes = await request(TEST_PORT, 'POST', '/api/auth/register', {
      username: testUser,
      password: 'password123'
    });
    console.log('Status code:', registerRes.status);
    console.log('Registration response:', registerRes.data);
    if (registerRes.status !== 201 || registerRes.data.user.username !== testUser) throw new Error('Registration failed');

    // 6. Test Register Duplicate Username
    console.log(`\n[6] Testing Duplicate Register for user '${testUser}' (expecting 409 Conflict)...`);
    const duplicateRes = await request(TEST_PORT, 'POST', '/api/auth/register', {
      username: testUser,
      password: 'password123'
    });
    console.log('Status code:', duplicateRes.status);
    console.log('Duplicate response:', duplicateRes.data);
    if (duplicateRes.status !== 409) throw new Error('Duplicate register check failed');

    // 6.b Admin approves user
    const { approveUser } = await import('./lib/db.js');
    approveUser(testUser);

    // 7. Test Login with new user
    console.log(`\n[7] Testing POST /api/auth/login for user '${testUser}'...`);
    const userLoginRes = await request(TEST_PORT, 'POST', '/api/auth/login', {
      username: testUser,
      password: 'password123'
    });
    console.log('Status code:', userLoginRes.status);
    console.log('User logged in:', userLoginRes.data.user);
    if (userLoginRes.status !== 200 || !userLoginRes.data.token) throw new Error('New user login failed');

    const userCookie = userLoginRes.headers['set-cookie'][0].split(';')[0];

    // 8. Test Logout
    console.log(`\n[8] Testing POST /api/auth/logout for user '${testUser}'...`);
    const logoutRes = await request(TEST_PORT, 'POST', '/api/auth/logout', null, {
      'Cookie': userCookie
    });
    console.log('Status code:', logoutRes.status);
    console.log('Logout response:', logoutRes.data);
    if (logoutRes.status !== 200) throw new Error('Logout failed');

    // 9. Test GET /api/auth/me after logout (expecting 401 Unauthorized)
    console.log(`\n[9] Testing GET /api/auth/me after logout (expecting 401 Unauthorized)...`);
    const meAfterLogout = await request(TEST_PORT, 'GET', '/api/auth/me', null, {
      'Cookie': userCookie
    });
    console.log('Status code:', meAfterLogout.status);
    console.log('Me after logout:', meAfterLogout.data);
    if (meAfterLogout.status !== 401) throw new Error('Unauthorized check after logout failed');

    console.log('\n======================================================');
    console.log('🎉 TẤT CẢ CÁC BÀI TEST AUTH & DATABASE ĐỀU PASS 100%!');
    console.log('======================================================\n');
  } finally {
    await webServer.close();
  }
}

runTests().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
