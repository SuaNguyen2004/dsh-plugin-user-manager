import fs from 'node:fs';
import path from 'node:path';
import {
  findUserByUsername,
  createUser,
  verifyPassword,
  createSession,
  getSession,
  deleteSession,
  listPendingUsers,
  listAllUsers,
  approveUser,
  rejectUser
} from './db.js';
import { getUserWorkspaceDir, syncDshUserWorkspaces, cleanupUserWorkspaceAndSessions } from './workspace.js';

const PLUGIN_ROOT = path.resolve(import.meta.dirname, '..');

/**
 * Helper to parse JSON body from incoming request
 */
export function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1e6) {
        req.destroy();
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Helper to send JSON response
 */
export function sendJson(res, statusCode, data, headers = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    ...headers
  });
  res.end(JSON.stringify(data));
}

/**
 * Extract session token from Cookie header or Authorization Bearer
 */
export function extractToken(req) {
  // Check Authorization header first
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }

  // Check Cookie header
  const cookieHeader = req.headers['cookie'];
  if (cookieHeader) {
    const cookies = cookieHeader.split(';').map(c => c.trim());
    for (const cookie of cookies) {
      if (cookie.startsWith('dsh_user_token=')) {
        return decodeURIComponent(cookie.substring('dsh_user_token='.length));
      }
    }
  }

  return null;
}

/**
 * Authenticate request using session token
 */
export function authenticateRequest(req) {
  const token = extractToken(req);
  if (!token) return null;
  return getSession(token);
}

/**
 * Register Auth HTTP routes on ctx.webServer
 */
export function registerAuthRoutes(webServer) {
  // 1. POST /api/auth/register
  webServer.register({
    kind: 'exact',
    path: '/api/auth/register',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        return sendJson(res, 405, { error: 'Method Not Allowed' });
      }

      try {
        const { username, password } = await parseJsonBody(req);
        if (!username || !password) {
          return sendJson(res, 400, { error: 'Username và password là bắt buộc' });
        }

        if (typeof username !== 'string' || username.length < 3 || username.length > 32) {
          return sendJson(res, 400, { error: 'Username phải từ 3 đến 32 ký tự' });
        }

        // Check if username has valid characters (alphanumeric, -, _)
        if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
          return sendJson(res, 400, { error: 'Username chỉ được chứa chữ cái, số, gạch nối và gạch dưới' });
        }

        if (typeof password !== 'string' || password.length < 6) {
          return sendJson(res, 400, { error: 'Mật khẩu phải có ít nhất 6 ký tự' });
        }

        const existing = findUserByUsername(username);
        if (existing) {
          return sendJson(res, 409, { error: 'Tên người dùng đã tồn tại' });
        }

        // Tạo user với status 'pending' (Chờ duyệt)
        const newUser = createUser(username, password, 'user', 100000, 'pending');

        return sendJson(res, 201, {
          message: 'Đăng ký thành công! Vui lòng chờ Quản trị viên (Admin) phê duyệt tài khoản để có thể đăng nhập.',
          user: {
            id: newUser.id,
            username: newUser.username,
            role: newUser.role,
            status: newUser.status,
            workspace_path: newUser.workspace_path,
            token_quota: newUser.token_quota,
            tokens_used: newUser.tokens_used
          }
        });
      } catch (err) {
        return sendJson(res, 500, { error: err.message || 'Internal server error' });
      }
    }
  });

  // 2. POST /api/auth/login
  webServer.register({
    kind: 'exact',
    path: '/api/auth/login',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        return sendJson(res, 405, { error: 'Method Not Allowed' });
      }

      try {
        const { username, password } = await parseJsonBody(req);
        if (!username || !password) {
          return sendJson(res, 400, { error: 'Username và password là bắt buộc' });
        }

        const user = findUserByUsername(username);
        if (!user || !verifyPassword(password, user.password_hash)) {
          return sendJson(res, 401, { error: 'Tài khoản hoặc mật khẩu không chính xác' });
        }

        // Kiểm tra trạng thái tài khoản
        if (user.status === 'pending') {
          return sendJson(res, 403, {
            error: 'Tài khoản của bạn đang chờ Admin phê duyệt. Vui lòng liên hệ Admin!',
            status: 'pending'
          });
        }

        if (user.status === 'rejected') {
          return sendJson(res, 403, {
            error: 'Tài khoản của bạn đã bị từ chối!',
            status: 'rejected'
          });
        }

        const session = createSession(user.id);
        const cookie = `dsh_user_token=${session.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 3600}`;

        try {
          syncDshUserWorkspaces(user.username);
        } catch (e) {
          console.error('[dsh-plugin-user-manager] Error syncing user workspace on login:', e);
        }

        return sendJson(res, 200, {
          message: 'Đăng nhập thành công',
          token: session.token,
          user: {
            id: user.id,
            username: user.username,
            role: user.role,
            status: user.status,
            token_quota: user.token_quota,
            tokens_used: user.tokens_used,
            workspace_path: user.workspace_path
          }
        }, {
          'Set-Cookie': cookie
        });
      } catch (err) {
        return sendJson(res, 500, { error: err.message || 'Internal server error' });
      }
    }
  });

  // 3. GET /api/auth/me
  webServer.register({
    kind: 'exact',
    path: '/api/auth/me',
    handler: async (req, res) => {
      if (req.method !== 'GET') {
        return sendJson(res, 405, { error: 'Method Not Allowed' });
      }

      const session = authenticateRequest(req);
      if (!session) {
        return sendJson(res, 401, { error: 'Unauthorized: No valid session found' });
      }

      const token = extractToken(req);
      return sendJson(res, 200, {
        authenticated: true,
        token: token || session.token,
        user: {
          id: session.id,
          username: session.username,
          role: session.role,
          status: session.status,
          token_quota: session.token_quota,
          tokens_used: session.tokens_used,
          workspace_path: session.workspace_path
        }
      });
    }
  });

  // 4. POST /api/auth/logout
  webServer.register({
    kind: 'exact',
    path: '/api/auth/logout',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        return sendJson(res, 405, { error: 'Method Not Allowed' });
      }

      const token = extractToken(req);
      if (token) {
        deleteSession(token);
      }

      const expireCookie = 'dsh_user_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT';
      return sendJson(res, 200, { success: true, message: 'Đăng xuất thành công' }, {
        'Set-Cookie': expireCookie
      });
    }
  });

  // 5. GET /api/admin/pending-users
  webServer.register({
    kind: 'exact',
    path: '/api/admin/pending-users',
    handler: async (req, res) => {
      if (req.method !== 'GET') {
        return sendJson(res, 405, { error: 'Method Not Allowed' });
      }

      const session = authenticateRequest(req);
      if (!session) {
        return sendJson(res, 401, { error: 'Unauthorized: Authentication required' });
      }

      if (session.role !== 'admin') {
        return sendJson(res, 403, { error: 'Forbidden: Admin access required' });
      }

      try {
        const pendingUsers = listPendingUsers();
        return sendJson(res, 200, {
          users: pendingUsers,
          pending_users: pendingUsers
        });
      } catch (err) {
        return sendJson(res, 500, { error: err.message });
      }
    }
  });

  // 6. POST /api/admin/approve-user
  webServer.register({
    kind: 'exact',
    path: '/api/admin/approve-user',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        return sendJson(res, 405, { error: 'Method Not Allowed' });
      }

      const session = authenticateRequest(req);
      if (!session) {
        return sendJson(res, 401, { error: 'Unauthorized: Authentication required' });
      }

      if (session.role !== 'admin') {
        return sendJson(res, 403, { error: 'Forbidden: Admin access required' });
      }

      try {
        const body = await parseJsonBody(req);
        const { username } = body;
        if (!username) {
          return sendJson(res, 400, { error: 'Username là bắt buộc' });
        }

        const approved = approveUser(username);
        try {
          getUserWorkspaceDir(username);
          syncDshUserWorkspaces(username);
        } catch (e) {
          console.error('[dsh-plugin-user-manager] Error syncing workspace for approved user:', e.message);
        }
        return sendJson(res, 200, {
          message: `Đã phê duyệt tài khoản "${username}" thành công!`,
          user: {
            id: approved.id,
            username: approved.username,
            role: approved.role,
            status: approved.status,
            token_quota: approved.token_quota,
            tokens_used: approved.tokens_used
          }
        });
      } catch (err) {
        return sendJson(res, err.status || 500, { error: err.message });
      }
    }
  });

  // 7. POST /api/admin/reject-user
  webServer.register({
    kind: 'exact',
    path: '/api/admin/reject-user',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        return sendJson(res, 405, { error: 'Method Not Allowed' });
      }

      const session = authenticateRequest(req);
      if (!session) {
        return sendJson(res, 401, { error: 'Unauthorized: Authentication required' });
      }

      if (session.role !== 'admin') {
        return sendJson(res, 403, { error: 'Forbidden: Admin access required' });
      }

      try {
        const body = await parseJsonBody(req);
        const { username } = body;
        if (!username) {
          return sendJson(res, 400, { error: 'Username là bắt buộc' });
        }

        const rejected = rejectUser(username);
        try {
          cleanupUserWorkspaceAndSessions(username);
        } catch (e) {
          console.error('[dsh-plugin-user-manager] Error cleaning up workspace for rejected user:', e.message);
        }

        return sendJson(res, 200, {
          message: `Đã từ chối tài khoản "${username}" và tự động dọn dẹp sạch toàn bộ file & dữ liệu không gian làm việc!`,
          user: {
            id: rejected.id,
            username: rejected.username,
            role: rejected.role,
            status: rejected.status
          }
        });
      } catch (err) {
        return sendJson(res, err.status || 500, { error: err.message });
      }
    }
  });



  // 9. Dedicated Login Page routes (GET /login and GET /login.html)
  const serveLoginPage = (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.searchParams.get('logout') === '1') {
        const token = extractToken(req);
        if (token) deleteSession(token);
        const expireCookie = 'dsh_user_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT';
        res.setHeader('Set-Cookie', expireCookie);
      }
    } catch (e) {}

    const htmlPath = path.join(PLUGIN_ROOT, 'public', 'login.html');
    if (fs.existsSync(htmlPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(htmlPath, 'utf8'));
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Login page not found');
    }
  };

  webServer.register({
    kind: 'exact',
    path: '/login',
    handler: serveLoginPage
  });

  webServer.register({
    kind: 'exact',
    path: '/login.html',
    handler: serveLoginPage
  });

  console.log('[dsh-plugin-user-manager] Auth & Approval routes registered:');
  console.log('  - GET  /login');
  console.log('  - POST /api/auth/register');
  console.log('  - POST /api/auth/login');
  console.log('  - GET  /api/auth/me');
  console.log('  - POST /api/auth/logout');
  console.log('  - GET  /api/admin/pending-users');
  console.log('  - GET  /api/admin/users');
  console.log('  - POST /api/admin/approve-user');
  console.log('  - POST /api/admin/reject-user');
}
