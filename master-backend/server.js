import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { User, Session, hashPassword, initDatabase } from '../database/index.js';
import { signToken, verifyToken, authenticate, requireAdmin, extractToken } from './jwt.js';
import { masterKeyPool } from './key-pool.js';
import { masterModelManager } from './model-manager.js';
import {
  spawnUserContainer,
  startIdleSweeper,
  stopIdleSweeper,
  recordUserActivity,
  cleanupStaleUserContainersOnBoot
} from './orchestrator.js';

const PORT = parseInt(process.env.MASTER_PORT || '4000', 10);
const PUBLIC_DIR = path.resolve(import.meta.dirname, 'public');

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

export function createMasterServer() {
  const server = http.createServer(async (req, res) => {
    // CORS Preflight
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
          service: 'dsh-master-backend',
          status: 'healthy',
          port: PORT,
          timestamp: new Date().toISOString()
        });
      }

      // 1.1 Gateway Route Resolver for Nginx Dynamic Reverse Proxy (auth_request)
      if (pathname === '/api/gateway/resolve-route' && (req.method === 'GET' || req.method === 'HEAD')) {
        const token = extractToken(req);
        if (!token) {
          return sendJson(res, 401, { error: 'No authentication token provided' });
        }

        const decoded = verifyToken(token);
        if (!decoded) {
          return sendJson(res, 401, { error: 'Invalid or expired token' });
        }

        const user = await User.findByPk(decoded.id);
        if (!user || user.status !== 'active') {
          return sendJson(res, 401, { error: 'User is not active or banned' });
        }

        // Auto-spawn or get dedicated container for active user
        try {
          const containerInfo = await spawnUserContainer(user.id, user.username, user.role);
          recordUserActivity(user.id);

          return sendJson(res, 200, {
            status: 'resolved',
            userId: user.id,
            username: user.username,
            ip: containerInfo.ip,
            port: containerInfo.internalPort || 3090,
            hostPort: containerInfo.port
          }, {
            'X-Target-IP': containerInfo.ip || '127.0.0.1',
            'X-Target-Port': String(containerInfo.internalPort || 3090),
            'X-User-Id': String(user.id),
            'X-User-Name': String(user.username)
          });
        } catch (err) {
          console.error('[Gateway Resolver] Error resolving container:', err.message);
          return sendJson(res, 502, { error: `Failed to resolve user container: ${err.message}` });
        }
      }

      // 2. Serve Login / Register Page (GET / or GET /login or GET /login.html)
      if ((pathname === '/' || pathname === '/login' || pathname === '/login.html') && req.method === 'GET') {
        const filePath = path.join(PUBLIC_DIR, 'login.html');
        if (fs.existsSync(filePath)) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          return res.end(fs.readFileSync(filePath, 'utf8'));
        }
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Login page not found');
      }

      // 2.1 Serve Admin Dashboard (GET /admin or GET /admin.html)
      if ((pathname === '/admin' || pathname === '/admin.html') && req.method === 'GET') {
        const filePath = path.join(PUBLIC_DIR, 'admin.html');
        if (fs.existsSync(filePath)) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          return res.end(fs.readFileSync(filePath, 'utf8'));
        }
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Admin page not found');
      }

      // 3. User Registration (Public API)
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
          status: 'pending',
          workspace_path: `/data/workspaces/${username}`
        });

        return sendJson(res, 201, {
          message: 'Đăng ký thành công! Vui lòng chờ Quản trị viên (Admin) phê duyệt.',
          user: {
            id: newUser.id,
            username: newUser.username,
            role: newUser.role,
            status: newUser.status
          }
        });
      }

      // 4. User Login (Public API - Triggers container spawn on success)
      if (pathname === '/api/auth/login' && req.method === 'POST') {
        const { username, password } = await parseJsonBody(req);
        if (!username || !password) {
          return sendJson(res, 400, { error: 'Username và password là bắt buộc.' });
        }

        const user = await User.findOne({ where: { username } });
        if (!user || !user.checkPassword(password)) {
          return sendJson(res, 401, { error: 'Tài khoản hoặc mật khẩu không chính xác.' });
        }

        // Check account status
        if (user.status === 'pending') {
          return sendJson(res, 403, {
            error: 'Tài khoản của bạn đang chờ Admin phê duyệt. Vui lòng liên hệ Admin!',
            status: 'pending'
          });
        }

        if (user.status === 'rejected' || user.status === 'banned') {
          return sendJson(res, 403, {
            error: 'Tài khoản của bạn đã bị từ chối hoặc vô hiệu hóa!',
            status: user.status
          });
        }

        // Issue JWT token
        const token = signToken({
          id: user.id,
          username: user.username,
          role: user.role
        });

        // Record session in PostgreSQL
        const expiresAt = Date.now() + 7 * 24 * 3600 * 1000;
        await Session.create({
          token,
          user_id: user.id,
          expires_at: expiresAt
        }).catch(() => {});

        const cookie = `dsh_user_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 3600}`;

        // Docker Orchestration: Spawn dedicated container for user
        let containerInfo = null;
        try {
          containerInfo = await spawnUserContainer(user.id, user.username, user.role);
          console.log(`[Master Backend] Spawned container for user ${user.username}: ${containerInfo.name} on port ${containerInfo.port}`);
        } catch (err) {
          console.error(`[Master Backend] Container spawn error for ${user.username}:`, err.message);
        }

        return sendJson(res, 200, {
          message: 'Đăng nhập thành công',
          token,
          user: {
            id: user.id,
            username: user.username,
            role: user.role,
            status: user.status,
            workspace_path: user.workspace_path
          },
          container: containerInfo
        }, {
          'Set-Cookie': cookie
        });
      }

      // 5. User Profile (Protected)
      if (pathname === '/api/auth/me' && req.method === 'GET') {
        return authenticate(req, res, async () => {
          recordUserActivity(req.user.id);
          const user = await User.findByPk(req.user.id, {
            attributes: ['id', 'username', 'role', 'status', 'workspace_path', 'token_quota', 'tokens_used', 'createdAt']
          });
          if (!user) {
            return sendJson(res, 404, { error: 'Không tìm thấy thông tin người dùng.' });
          }
          return sendJson(res, 200, { authenticated: true, user });
        });
      }

      // 5.0 Change Password (Protected)
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
          if (!user) {
            return sendJson(res, 404, { error: 'Không tìm thấy thông tin tài khoản người dùng.' });
          }

          if (!user.checkPassword(oldPassword)) {
            return sendJson(res, 401, { error: 'Mật khẩu hiện tại không chính xác.' });
          }

          user.password_hash = hashPassword(newPassword);
          await user.save();

          console.log(`[Master Backend] User ${user.username} (ID: ${user.id}) changed password successfully.`);
          return sendJson(res, 200, {
            success: true,
            message: 'Đổi mật khẩu thành công! Mật khẩu mới đã được cập nhật.'
          });
        });
      }

      // 5.1 Get Container Launch URL (Direct Navigation into DSH)
      if (pathname === '/api/auth/launch' && req.method === 'GET') {
        return authenticate(req, res, async () => {
          try {
            const containerInfo = await spawnUserContainer(req.user.id, req.user.username, req.user.role);
            return sendJson(res, 200, {
              success: true,
              launchUrl: containerInfo.launchUrl,
              container: containerInfo
            });
          } catch (err) {
            return sendJson(res, 500, { error: err.message });
          }
        });
      }

      // 5.2 Smart Gateway Redirect:
      // If user is unauthenticated -> 302 /login
      // If user is authenticated -> get container launch token -> 302 /?token=${launchToken}
      if (pathname === '/api/auth/smart-redirect' && req.method === 'GET') {
        const token = extractToken(req);
        if (!token) {
          res.writeHead(302, { 'Location': '/login' });
          return res.end();
        }
        const decoded = verifyToken(token);
        if (!decoded) {
          res.writeHead(302, { 'Location': '/login' });
          return res.end();
        }
        const user = await User.findByPk(decoded.id);
        if (!user || user.status !== 'active') {
          res.writeHead(302, { 'Location': '/login' });
          return res.end();
        }

        try {
          const containerInfo = await spawnUserContainer(user.id, user.username, user.role);
          if (containerInfo.launchToken) {
            res.writeHead(302, { 'Location': `/?token=${containerInfo.launchToken}` });
            return res.end();
          }
          res.writeHead(302, { 'Location': '/' });
          return res.end();
        } catch (e) {
          res.writeHead(302, { 'Location': '/login' });
          return res.end();
        }
      }

      // 6. User Sandbox Container Info (Protected)
      if (pathname === '/api/containers/my-container' && req.method === 'GET') {
        return authenticate(req, res, async () => {
          recordUserActivity(req.user.id);
          try {
            const containerInfo = await spawnUserContainer(req.user.id, req.user.username);
            return sendJson(res, 200, {
              success: true,
              container: containerInfo
            });
          } catch (err) {
            return sendJson(res, 500, {
              success: false,
              error: `Lỗi khởi tạo container sandbox: ${err.message}`
            });
          }
        });
      }

      // 7. Logout
      if (pathname === '/api/auth/logout' && req.method === 'POST') {
        const token = extractToken(req);
        if (token) {
          await Session.destroy({ where: { token } }).catch(() => {});
        }
        const expireCookie = 'dsh_user_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT';
        return sendJson(res, 200, { success: true, message: 'Đăng xuất thành công.' }, { 'Set-Cookie': expireCookie });
      }

      // ==========================================
      // ADMIN APIS (Requires Admin RBAC)
      // ==========================================

      // 8. List All Users
      if (pathname === '/api/admin/users' && req.method === 'GET') {
        return requireAdmin(req, res, async () => {
          const users = await User.findAll({
            attributes: ['id', 'username', 'role', 'status', 'workspace_path', 'createdAt'],
            order: [['id', 'ASC']]
          });
          return sendJson(res, 200, { total: users.length, users });
        });
      }

      // 9. List Pending Users
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

      // 10. Approve User (Pending -> Active)
      if (pathname === '/api/admin/approve-user' && req.method === 'POST') {
        return requireAdmin(req, res, async () => {
          const { username } = await parseJsonBody(req);
          if (!username) {
            return sendJson(res, 400, { error: 'Username là bắt buộc.' });
          }

          const user = await User.findOne({ where: { username } });
          if (!user) {
            return sendJson(res, 404, { error: `Không tìm thấy người dùng "${username}".` });
          }

          user.status = 'active';
          await user.save();

          return sendJson(res, 200, {
            message: `Đã phê duyệt thành công tài khoản "${username}"!`,
            user: { id: user.id, username: user.username, role: user.role, status: user.status }
          });
        });
      }

      // 10.1 RESTful Update User Status (PUT /api/admin/users/:id/status)
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
            await killUserContainer(user.id);
          }
          return sendJson(res, 200, {
            message: `Đã cập nhật trạng thái người dùng #${targetId} thành ${status}!`,
            user: { id: user.id, username: user.username, role: user.role, status: user.status }
          });
        });
      }

      // 11. Reject User
      if (pathname === '/api/admin/reject-user' && req.method === 'POST') {
        return requireAdmin(req, res, async () => {
          const { username } = await parseJsonBody(req);
          if (!username) {
            return sendJson(res, 400, { error: 'Username là bắt buộc.' });
          }

          const user = await User.findOne({ where: { username } });
          if (!user) {
            return sendJson(res, 404, { error: `Không tìm thấy người dùng "${username}".` });
          }

          user.status = 'rejected';
          await user.save();

          // Revoke active sessions & kill container if any
          await Session.destroy({ where: { user_id: user.id } });
          await killUserContainer(user.id);

          return sendJson(res, 200, {
            message: `Đã từ chối tài khoản "${username}".`,
            user: { id: user.id, username: user.username, role: user.role, status: user.status }
          });
        });
      }

      // 12. Admin Model Configs & API Keys
      if (pathname === '/api/admin/models' && req.method === 'GET') {
        return requireAdmin(req, res, async () => {
          const models = masterModelManager.getAllModels();
          return sendJson(res, 200, {
            success: true,
            total: models.length,
            models
          });
        });
      }

      if (pathname === '/api/admin/models' && req.method === 'POST') {
        return requireAdmin(req, res, async () => {
          const body = await parseJsonBody(req);
          if (!body.id || !body.name) {
            return sendJson(res, 400, { error: 'Model ID và Tên hiển thị là bắt buộc.' });
          }
          const saved = masterModelManager.addOrUpdateModel(body);
          return sendJson(res, 200, {
            success: true,
            message: `Đã lưu cấu hình Model "${saved.name}" thành công!`,
            model: saved
          });
        });
      }

      const modelStatusMatch = pathname.match(/^\/api\/admin\/models\/(.+)\/status$/);
      if (modelStatusMatch && (req.method === 'PUT' || req.method === 'POST')) {
        return requireAdmin(req, res, async () => {
          const modelId = decodeURIComponent(modelStatusMatch[1]);
          const { enabled } = await parseJsonBody(req);
          const updated = masterModelManager.toggleModelStatus(modelId, enabled);
          if (!updated) return sendJson(res, 404, { error: 'Không tìm thấy Model.' });
          return sendJson(res, 200, {
            success: true,
            message: `Đã ${updated.enabled ? 'bật' : 'tắt'} Model ${modelId}`,
            model: updated
          });
        });
      }

      const modelScopeMatch = pathname.match(/^\/api\/admin\/models\/(.+)\/scope$/);
      if (modelScopeMatch && (req.method === 'PUT' || req.method === 'POST')) {
        return requireAdmin(req, res, async () => {
          const modelId = decodeURIComponent(modelScopeMatch[1]);
          const { scope } = await parseJsonBody(req);
          const updated = masterModelManager.setModelScope(modelId, scope);
          if (!updated) return sendJson(res, 404, { error: 'Không tìm thấy Model.' });
          return sendJson(res, 200, {
            success: true,
            message: `Đã phân quyền Model "${modelId}" sang ${updated.scope === 'admin_only' ? 'Chỉ Admin' : 'Tất cả User'}`,
            model: updated
          });
        });
      }

      const modelDeleteMatch = pathname.match(/^\/api\/admin\/models\/([^/]+)$/);
      if (modelDeleteMatch && req.method === 'DELETE') {
        return requireAdmin(req, res, async () => {
          const modelId = decodeURIComponent(modelDeleteMatch[1]);
          const deleted = masterModelManager.deleteModel(modelId);
          if (!deleted) return sendJson(res, 404, { error: 'Không tìm thấy Model để xóa.' });
          return sendJson(res, 200, { success: true, message: 'Đã xóa Model thành công.' });
        });
      }

      if (pathname === '/api/admin/models/config' && req.method === 'GET') {
        return requireAdmin(req, res, async () => {
          const pools = masterKeyPool.getMaskedPools();
          return sendJson(res, 200, { success: true, pools });
        });
      }

      if (pathname === '/api/admin/models/key' && req.method === 'POST') {
        return requireAdmin(req, res, async () => {
          const { ref, value, mode } = await parseJsonBody(req);
          if (!ref || !value) {
            return sendJson(res, 400, { error: 'ref và value là bắt buộc.' });
          }

          let result;
          if (mode === 'append') {
            result = masterKeyPool.addKeys(ref, value);
          } else {
            result = masterKeyPool.setKeys(ref, value);
          }

          return sendJson(res, 200, {
            success: true,
            message: `Đã cấu hình API Key thành công cho ${ref}`,
            result
          });
        });
      }

      return sendJson(res, 404, { error: 'Endpoint không tồn tại trên Master Backend Gateway.' });
    } catch (err) {
      console.error('[Master Backend] Error:', err);
      return sendJson(res, 500, { error: err.message || 'Lỗi hệ thống nội bộ.' });
    }
  });

  return server;
}

export async function startMasterServer(port = PORT) {
  await initDatabase();
  await cleanupStaleUserContainersOnBoot();
  startIdleSweeper(60000, 30); // Background idle container check every 1 minute
  const server = createMasterServer();
  return new Promise((resolve, reject) => {
    server.on('error', (err) => {
      console.error(`[Master Backend] Lỗi server tại port ${port}:`, err.message);
      reject(err);
    });
    server.listen(port, () => {
      console.log(`[Master Backend] Service đang hoạt động độc lập tại cổng ${port}`);
      resolve(server);
    });
  });
}
