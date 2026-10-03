import { authenticateRequest, parseJsonBody, sendJson } from './auth.js';
import {
  findUserById,
  consumeTokens,
  listAllUsers,
  updateUserQuota,
  resetUserUsage
} from './db.js';

/**
 * Register Quota and Admin management routes
 */
export function registerQuotaRoutes(webServer) {
  // 1. GET /api/user/quota
  webServer.register({
    kind: 'exact',
    path: '/api/user/quota',
    handler: async (req, res) => {
      if (req.method !== 'GET') {
        return sendJson(res, 405, { error: 'Method Not Allowed' });
      }

      const session = authenticateRequest(req);
      if (!session) {
        return sendJson(res, 401, { error: 'Unauthorized: Authentication required' });
      }

      try {
        const user = findUserById(session.id);
        if (!user) {
          return sendJson(res, 404, { error: 'User not found' });
        }

        const remaining = Math.max(0, user.token_quota - user.tokens_used);
        const percentUsed = user.token_quota > 0
          ? Number(((user.tokens_used / user.token_quota) * 100).toFixed(2))
          : 0;

        return sendJson(res, 200, {
          username: user.username,
          token_quota: user.token_quota,
          tokens_used: user.tokens_used,
          remaining,
          percent_used: percentUsed
        });
      } catch (err) {
        return sendJson(res, err.status || 500, { error: err.message });
      }
    }
  });

  // 2. POST /api/user/consume
  webServer.register({
    kind: 'exact',
    path: '/api/user/consume',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        return sendJson(res, 405, { error: 'Method Not Allowed' });
      }

      const session = authenticateRequest(req);
      if (!session) {
        return sendJson(res, 401, { error: 'Unauthorized: Authentication required' });
      }

      try {
        const body = await parseJsonBody(req);
        const { tokens, action = 'chat' } = body;

        if (tokens === undefined || typeof tokens !== 'number' || tokens <= 0) {
          return sendJson(res, 400, { error: 'Field "tokens" must be a positive number' });
        }

        const result = consumeTokens(session.id, tokens, action);
        return sendJson(res, 200, {
          message: 'Tokens consumed successfully',
          ...result
        });
      } catch (err) {
        return sendJson(res, err.status || 500, {
          error: err.message,
          remaining: err.remaining,
          token_quota: err.token_quota,
          tokens_used: err.tokens_used
        });
      }
    }
  });

  // 3. GET /api/admin/users
  webServer.register({
    kind: 'exact',
    path: '/api/admin/users',
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
        const users = listAllUsers();
        return sendJson(res, 200, {
          users
        });
      } catch (err) {
        return sendJson(res, err.status || 500, { error: err.message });
      }
    }
  });

  // 4. POST /api/admin/quota
  webServer.register({
    kind: 'exact',
    path: '/api/admin/quota',
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
        const { username, quota } = body;

        if (!username || typeof username !== 'string' || quota === undefined || typeof quota !== 'number' || quota < 0) {
          return sendJson(res, 400, { error: 'Fields "username" (string) and "quota" (non-negative number) are required' });
        }

        const updatedUser = updateUserQuota(username, quota);
        return sendJson(res, 200, {
          message: `Quota updated for user ${username}`,
          user: {
            id: updatedUser.id,
            username: updatedUser.username,
            role: updatedUser.role,
            token_quota: updatedUser.token_quota,
            tokens_used: updatedUser.tokens_used
          }
        });
      } catch (err) {
        return sendJson(res, err.status || 500, { error: err.message });
      }
    }
  });

  // 5. POST /api/admin/reset-usage
  webServer.register({
    kind: 'exact',
    path: '/api/admin/reset-usage',
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

        if (!username || typeof username !== 'string') {
          return sendJson(res, 400, { error: 'Field "username" is required' });
        }

        const updatedUser = resetUserUsage(username);
        return sendJson(res, 200, {
          message: `Usage reset for user ${username}`,
          user: {
            id: updatedUser.id,
            username: updatedUser.username,
            role: updatedUser.role,
            token_quota: updatedUser.token_quota,
            tokens_used: updatedUser.tokens_used
          }
        });
      } catch (err) {
        return sendJson(res, err.status || 500, { error: err.message });
      }
    }
  });

  console.log('[dsh-plugin-user-manager] Quota & Admin routes registered:');
  console.log('  - GET  /api/user/quota');
  console.log('  - POST /api/user/consume');
  console.log('  - GET  /api/admin/users');
  console.log('  - POST /api/admin/quota');
  console.log('  - POST /api/admin/reset-usage');
}
