// gateway/server.js
// DSH Lite Enterprise Gateway (Phase 5) — the ONLY container publishing a port (12345).
//
// Responsibilities:
//  - Auth: bcrypt/scrypt + JWT cookie dsh_user_token (HttpOnly, SameSite=Lax, 7 ngày).
//  - SQLite WAL (users.db) in volume dsh-gateway-data via Sequelize (Users/Sessions/UserSessions/Attachments).
//  - Login redirect thẳng "/" (màn hình DSH của dsh-main). KHÔNG còn dashboard admin riêng,
//    KHÔNG còn nút "Vào DeepSeek Harness", KHÔNG spawn container nào lúc login.
//  - Mỗi request HTTP + WebSocket upgrade: verify JWT, STRIP mọi header X-DSH-* do client gửi lên,
//    gắn lại X-DSH-User-Id / X-DSH-Username / X-DSH-Role từ DB, reverse-proxy sang dsh-main:3090.
//  - Cổng nội bộ 3091 (không publish ra host): Exec Router /internal/exec cho dsh-main gọi vào,
//    lazy-spawn tool container dsh-tool-<username> qua orchestrator.
//  - Idle sweeper 15 phút + reconcile on boot cho tool containers. Chat thuần không giữ container.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import httpProxy from 'http-proxy';
import { User, Session, hashPassword, initDatabase } from '../database/index.js';
import { signToken, verifyToken, authenticate, requireAdmin, extractToken } from './jwt.js';
import { masterKeyPool } from './key-pool.js';
import { masterModelManager } from './model-manager.js';
import {
  reconcileOnBoot, startToolIdleSweeper, stopToolIdleSweeper, killToolContainer
} from './orchestrator.js';
import { createInternalHandler } from './exec-router.js';

const PORT = parseInt(process.env.PORT || '12345', 10);
const INTERNAL_PORT = parseInt(process.env.INTERNAL_PORT || '3091', 10);
const PUBLIC_DIR = path.resolve(import.meta.dirname, 'public');

function getDshMainUrl() {
  return process.env.DSH_MAIN_URL || 'http://dsh-main:3090';
}

function getInternalToken() {
  return process.env.INTERNAL_TOKEN || '';
}

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
        reject(new Error('Invalid JSON format'));
      }
    });
    req.on('error', reject);
  });
}

export function sendJson(res, statusCode, data, headers = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    ...headers
  });
  res.end(JSON.stringify(data));
}

/**
 * Trust-boundary header rewrite: remove EVERY client-supplied X-DSH-* header,
 * then inject the identity resolved from the verified JWT + SQLite DB.
 * This is the single place identity crosses into dsh-main; a forged
 * X-DSH-Role from the browser can therefore never survive (acceptance #10).
 */
export function stampTrustedHeaders(req, user) {
  for (const key of Object.keys(req.headers)) {
    if (key.startsWith('x-dsh-')) delete req.headers[key];
  }
  req.headers['x-dsh-user-id'] = String(user.id);
  req.headers['x-dsh-username'] = String(user.username);
  req.headers['x-dsh-role'] = String(user.role);
  req.headers['x-forwarded-host'] = req.headers['host'] || 'localhost';
  return req.headers;
}

async function resolveUser(req) {
  const token = extractToken(req);
  if (!token) return null;
  const decoded = verifyToken(token);
  if (!decoded) return null;
  const user = await User.findByPk(decoded.id);
  if (!user || user.status !== 'active') return null;
  return user;
}

function serveStatic(res, filePath, method) {
  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Not found');
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  if (method === 'HEAD') return res.end();
  return res.end(fs.readFileSync(filePath, 'utf8'));
}

export function createGatewayServer() {
  const proxy = httpProxy.createProxyServer({ ws: true, changeOrigin: true, xfwd: false });
  proxy.on('error', (err, req, res) => {
    console.error('[Gateway Proxy Error]:', err.message);
    if (res && res.writeHead && !res.headersSent) {
      sendJson(res, 502, { error: 'dsh-main unreachable', detail: err.message });
    }
  });

  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
      });
      return res.end();
    }

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    try {
      // 1. Healthcheck
      if (pathname === '/health' && req.method === 'GET') {
        return sendJson(res, 200, {
          service: 'dsh-gateway',
          status: 'healthy',
          port: PORT,
          internalPort: INTERNAL_PORT,
          dshMain: getDshMainUrl(),
          timestamp: new Date().toISOString()
        });
      }

      // 2. Login page (public)
      if ((pathname === '/login' || pathname === '/login.html') && (req.method === 'GET' || req.method === 'HEAD')) {
        return serveStatic(res, path.join(PUBLIC_DIR, 'login.html'), req.method);
      }

      // 2.1 Admin Dashboard (protected by admin RBAC)
      if ((pathname === '/admin' || pathname === '/admin.html') && (req.method === 'GET' || req.method === 'HEAD')) {
        const token = extractToken(req);
        if (!token) {
          res.writeHead(302, { Location: '/login' });
          return res.end();
        }
        const decoded = verifyToken(token);
        if (!decoded) {
          res.writeHead(302, { Location: '/login' });
          return res.end();
        }
        if (decoded.role !== 'admin') {
          res.writeHead(302, { Location: '/' });
          return res.end();
        }
        return serveStatic(res, path.join(PUBLIC_DIR, 'admin.html'), req.method);
      }

      // 3. Register (public; requires admin approval)
      if (pathname === '/api/auth/register' && req.method === 'POST') {
        const { username, password } = await parseJsonBody(req);
        if (!username || !password) {
          return sendJson(res, 400, { error: 'Username và password là bắt buộc.' });
        }
        if (username.length < 3 || username.length > 32) {
          return sendJson(res, 400, { error: 'Username phải từ 3 đến 32 ký tự.' });
        }
        if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
          return sendJson(res, 400, { error: 'Username chỉ được chứa chữ cái, số, gạch nối và gạch dưới.' });
        }
        if (password.length < 6) {
          return sendJson(res, 400, { error: 'Mật khẩu phải có ít nhất 6 ký tự.' });
        }
        const existing = await User.findOne({ where: { username } });
        if (existing) {
          return sendJson(res, 409, { error: 'Tên người dùng đã tồn tại.' });
        }
        const newUser = await User.create({
          username,
          password_hash: hashPassword(password),
          role: 'user',
          status: 'pending'
        });
        return sendJson(res, 201, {
          message: 'Đăng ký thành công! Vui lòng chờ Quản trị viên (Admin) phê duyệt.',
          user: { id: newUser.id, username: newUser.username, role: newUser.role, status: newUser.status }
        });
      }

      // 4. Login: JWT + cookie, NO container spawn, client redirects to "/" (the DSH screen)
      if (pathname === '/api/auth/login' && req.method === 'POST') {
        const { username, password } = await parseJsonBody(req);
        if (!username || !password) {
          return sendJson(res, 400, { error: 'Username và password là bắt buộc.' });
        }
        const user = await User.findOne({ where: { username } });
        if (!user || !user.checkPassword(password)) {
          return sendJson(res, 401, { error: 'Tài khoản hoặc mật khẩu không chính xác.' });
        }
        if (user.status === 'pending') {
          return sendJson(res, 403, { error: 'Tài khoản của bạn đang chờ Admin phê duyệt. Vui lòng liên hệ Admin!', status: 'pending' });
        }
        if (user.status === 'rejected' || user.status === 'banned') {
          return sendJson(res, 403, { error: 'Tài khoản của bạn đã bị từ chối hoặc vô hiệu hóa!', status: user.status });
        }
        const token = signToken({ id: user.id, username: user.username, role: user.role });
        const expiresAt = Date.now() + 7 * 24 * 3600 * 1000;
        await Session.create({ token, user_id: user.id, expires_at: expiresAt }).catch(() => {});
        const cookie = `dsh_user_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 3600}`;
        return sendJson(res, 200, {
          message: 'Đăng nhập thành công',
          token,
          redirectUrl: '/',
          user: { id: user.id, username: user.username, role: user.role, status: user.status }
        }, { 'Set-Cookie': cookie });
      }

      // 5. Profile (protected)
      if (pathname === '/api/auth/me' && req.method === 'GET') {
        return authenticate(req, res, async () => {
          const user = await User.findByPk(req.user.id, {
            attributes: ['id', 'username', 'role', 'status', 'token_quota', 'tokens_used', 'createdAt']
          });
          if (!user) return sendJson(res, 404, { error: 'Không tìm thấy thông tin người dùng.' });
          return sendJson(res, 200, { authenticated: true, user });
        });
      }

      // 5.1 Change password (protected)
      if (pathname === '/api/auth/change-password' && req.method === 'POST') {
        return authenticate(req, res, async () => {
          const { oldPassword, newPassword } = await parseJsonBody(req);
          if (!oldPassword || !newPassword) {
            return sendJson(res, 400, { error: 'Vui lòng nhập đầy đủ mật khẩu cũ và mật khẩu mới.' });
          }
          if (typeof newPassword !== 'string' || newPassword.length < 6) {
            return sendJson(res, 400, { error: 'Mật khẩu mới phải có ít nhất 6 ký tự.' });
          }
          if (oldPassword === newPassword) {
            return sendJson(res, 400, { error: 'Mật khẩu mới không được trùng với mật khẩu cũ.' });
          }
          const user = await User.findByPk(req.user.id);
          if (!user) return sendJson(res, 404, { error: 'Không tìm thấy thông tin tài khoản người dùng.' });
          if (!user.checkPassword(oldPassword)) return sendJson(res, 401, { error: 'Mật khẩu hiện tại không chính xác.' });
          user.password_hash = hashPassword(newPassword);
          await user.save();
          return sendJson(res, 200, { success: true, message: 'Đổi mật khẩu thành công! Mật khẩu mới đã được cập nhật.' });
        });
      }

      // 5.2 Smart redirect: unauthenticated -> /login; authenticated -> "/" (DSH screen via dsh-main)
      if (pathname === '/api/auth/smart-redirect' && req.method === 'GET') {
        const user = await resolveUser(req);
        res.writeHead(302, { Location: user ? '/' : '/login' });
        return res.end();
      }

      // 6. Logout
      if (pathname === '/api/auth/logout' && req.method === 'POST') {
        const token = extractToken(req);
        if (token) await Session.destroy({ where: { token } }).catch(() => {});
        const expireCookie = 'dsh_user_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:01 GMT';
        return sendJson(res, 200, { success: true, message: 'Đăng xuất thành công.' }, { 'Set-Cookie': expireCookie });
      }

      // ==========================================
      // ADMIN APIS (requires Admin RBAC) — user lifecycle & model/key management.
      // The old standalone /admin dashboard page is retired (Phase 5): the admin
      // manages users & models through the DSH screen and these JSON APIs.
      // ==========================================

      if (pathname === '/api/admin/users' && req.method === 'GET') {
        return requireAdmin(req, res, async () => {
          const users = await User.findAll({
            attributes: ['id', 'username', 'role', 'status', 'createdAt'],
            order: [['id', 'ASC']]
          });
          return sendJson(res, 200, { total: users.length, users });
        });
      }

      if (pathname === '/api/admin/pending-users' && req.method === 'GET') {
        return requireAdmin(req, res, async () => {
          const pendingUsers = await User.findAll({
            where: { status: 'pending' },
            attributes: ['id', 'username', 'role', 'status', 'createdAt'],
            order: [['createdAt', 'DESC']]
          });
          return sendJson(res, 200, { pending_users: pendingUsers });
        });
      }

      if (pathname === '/api/admin/approve-user' && req.method === 'POST') {
        return requireAdmin(req, res, async () => {
          const { username } = await parseJsonBody(req);
          if (!username) return sendJson(res, 400, { error: 'Username là bắt buộc.' });
          const user = await User.findOne({ where: { username } });
          if (!user) return sendJson(res, 404, { error: `Không tìm thấy người dùng "${username}".` });
          user.status = 'active';
          await user.save();
          return sendJson(res, 200, { message: `Đã phê duyệt tài khoản "${username}"!`, user: { id: user.id, username: user.username, role: user.role, status: user.status } });
        });
      }

      const userStatusMatch = pathname.match(/^\/api\/admin\/users\/(\d+)\/status$/);
      if (userStatusMatch && (req.method === 'PUT' || req.method === 'POST')) {
        return requireAdmin(req, res, async () => {
          const targetId = parseInt(userStatusMatch[1], 10);
          const { status } = await parseJsonBody(req);
          const user = await User.findByPk(targetId);
          if (!user) return sendJson(res, 404, { error: 'User not found' });
          user.status = status;
          await user.save();
          if (status === 'banned' || status === 'rejected') {
            await Session.destroy({ where: { user_id: user.id } });
            await killToolContainer(user.id).catch(() => {});
          }
          return sendJson(res, 200, { message: `Đã cập nhật trạng thái #${targetId} thành ${status}!`, user: { id: user.id, username: user.username, role: user.role, status: user.status } });
        });
      }

      if (pathname === '/api/admin/reject-user' && req.method === 'POST') {
        return requireAdmin(req, res, async () => {
          const { username } = await parseJsonBody(req);
          if (!username) return sendJson(res, 400, { error: 'Username là bắt buộc.' });
          const user = await User.findOne({ where: { username } });
          if (!user) return sendJson(res, 404, { error: `Không tìm thấy người dùng "${username}".` });
          user.status = 'rejected';
          await user.save();
          await Session.destroy({ where: { user_id: user.id } });
          await killToolContainer(user.id).catch(() => {});
          return sendJson(res, 200, { message: `Đã từ chối tài khoản "${username}".`, user: { id: user.id, username: user.username, role: user.role, status: user.status } });
        });
      }

      // Admin model & key configuration APIs (persisted under /data/gateway volume)
      if (pathname === '/api/admin/models' && req.method === 'GET') {
        return requireAdmin(req, res, async () => {
          const models = masterModelManager.getAllModels();
          return sendJson(res, 200, { success: true, total: models.length, models });
        });
      }
      if (pathname === '/api/admin/models' && req.method === 'POST') {
        return requireAdmin(req, res, async () => {
          const body = await parseJsonBody(req);
          if (!body.id || !body.name) return sendJson(res, 400, { error: 'Model ID và Tên hiển thị là bắt buộc.' });
          const saved = masterModelManager.addOrUpdateModel(body);
          return sendJson(res, 200, { success: true, message: `Đã lưu cấu hình Model "${saved.name}"!`, model: saved });
        });
      }
      const modelStatusMatch = pathname.match(/^\/api\/admin\/models\/(.+)\/status$/);
      if (modelStatusMatch && (req.method === 'PUT' || req.method === 'POST')) {
        return requireAdmin(req, res, async () => {
          const updated = masterModelManager.toggleModelStatus(decodeURIComponent(modelStatusMatch[1]), (await parseJsonBody(req)).enabled);
          if (!updated) return sendJson(res, 404, { error: 'Không tìm thấy Model.' });
          return sendJson(res, 200, { success: true, message: `Đã ${updated.enabled ? 'bật' : 'tắt'} Model`, model: updated });
        });
      }
      const modelScopeMatch = pathname.match(/^\/api\/admin\/models\/(.+)\/scope$/);
      if (modelScopeMatch && (req.method === 'PUT' || req.method === 'POST')) {
        return requireAdmin(req, res, async () => {
          const updated = masterModelManager.setModelScope(decodeURIComponent(modelScopeMatch[1]), (await parseJsonBody(req)).scope);
          if (!updated) return sendJson(res, 404, { error: 'Không tìm thấy Model.' });
          return sendJson(res, 200, { success: true, message: 'Đã cập nhật scope.', model: updated });
        });
      }
      const modelDeleteMatch = pathname.match(/^\/api\/admin\/models\/([^/]+)$/);
      if (modelDeleteMatch && req.method === 'DELETE') {
        return requireAdmin(req, res, async () => {
          const deleted = masterModelManager.deleteModel(decodeURIComponent(modelDeleteMatch[1]));
          if (!deleted) return sendJson(res, 404, { error: 'Không tìm thấy Model để xóa.' });
          return sendJson(res, 200, { success: true, message: 'Đã xóa Model.' });
        });
      }
      if (pathname === '/api/admin/models/config' && req.method === 'GET') {
        return requireAdmin(req, res, async () => sendJson(res, 200, { success: true, pools: masterKeyPool.getMaskedPools() }));
      }
      if (pathname === '/api/admin/models/key' && req.method === 'POST') {
        return requireAdmin(req, res, async () => {
          const { ref, value, mode } = await parseJsonBody(req);
          if (!ref || !value) return sendJson(res, 400, { error: 'ref và value là bắt buộc.' });
          const result = mode === 'append' ? masterKeyPool.addKeys(ref, value) : masterKeyPool.setKeys(ref, value);
          return sendJson(res, 200, { success: true, message: `Đã cấu hình API Key cho ${ref}`, result });
        });
      }

      // 7. Default: reverse proxy to the SHARED dsh-main brain (no container spawn here!)
      const user = await resolveUser(req);
      if (!user) {
        const accept = req.headers['accept'] || '';
        if (accept.includes('text/html') || pathname === '/') {
          res.writeHead(302, { Location: '/login' });
          return res.end();
        }
        return sendJson(res, 401, { error: 'Unauthorized: Vui lòng đăng nhập.' });
      }

      stampTrustedHeaders(req, user);
      return proxy.web(req, res, { target: getDshMainUrl() });
    } catch (err) {
      console.error('[Gateway] Error:', err);
      return sendJson(res, 500, { error: err.message || 'Lỗi hệ thống nội bộ.' });
    }
  });

  // WebSocket upgrades: same trust boundary as HTTP.
  server.on('upgrade', async (req, socket, head) => {
    try {
      const user = await resolveUser(req);
      if (!user) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        return socket.destroy();
      }
      stampTrustedHeaders(req, user);
      proxy.ws(req, socket, head, { target: getDshMainUrl() });
    } catch (err) {
      console.error('[Gateway WS Upgrade Error]:', err.message);
      try { socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n'); socket.destroy(); } catch {}
    }
  });

  return server;
}

/** Internal exec surface (:3091) — docker network only, never published to the host. */
export function createInternalServer() {
  const handler = createInternalHandler({
    internalToken: getInternalToken(),
    lookupUser: async (id) => {
      const user = await User.findByPk(id);
      if (!user) return null;
      return { id: user.id, username: user.username, role: user.role, status: user.status };
    }
  });
  return http.createServer((req, res) => { handler(req, res).catch((e) => sendJson(res, 500, { ok: false, error: e.message })); });
}

export async function startMasterServer(port = PORT) {
  await initDatabase();
  const reconciled = await reconcileOnBoot();
  console.log(`[Gateway] Reconciled ${reconciled} running tool container(s) on boot.`);
  startToolIdleSweeper(60000);

  const internalServer = createInternalServer();
  const server = createGatewayServer();

  await new Promise((resolve, reject) => {
    internalServer.on('error', reject);
    internalServer.listen(INTERNAL_PORT, '0.0.0.0', resolve);
  });
  console.log(`[Gateway] Internal exec surface on :${INTERNAL_PORT} (docker network only, token-authenticated)`);

  return new Promise((resolve, reject) => {
    server.on('error', (err) => {
      console.error(`[Gateway] Lỗi server tại port ${port}:`, err.message);
      reject(err);
    });
    server.listen(port, () => {
      console.log(`[Gateway] Serving on :${port} -> proxy ${getDshMainUrl()}`);
      resolve(server);
    });
  });
}

export { stopToolIdleSweeper };
