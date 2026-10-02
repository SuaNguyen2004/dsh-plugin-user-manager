import {
  findUserByUsername,
  createUser,
  verifyPassword,
  createSession,
  getSession,
  deleteSession
} from './db.js';

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
    'Content-Type': 'application/json',
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
          return sendJson(res, 400, { error: 'Username and password are required' });
        }

        if (typeof username !== 'string' || username.length < 3 || username.length > 32) {
          return sendJson(res, 400, { error: 'Username must be 3-32 characters' });
        }

        // Check if username has valid characters (alphanumeric, -, _)
        if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
          return sendJson(res, 400, { error: 'Username can only contain letters, numbers, hyphens, and underscores' });
        }

        if (typeof password !== 'string' || password.length < 6) {
          return sendJson(res, 400, { error: 'Password must be at least 6 characters' });
        }

        const existing = findUserByUsername(username);
        if (existing) {
          return sendJson(res, 409, { error: 'Username already exists' });
        }

        const newUser = createUser(username, password);
        return sendJson(res, 201, {
          message: 'User registered successfully',
          user: {
            id: newUser.id,
            username: newUser.username,
            role: newUser.role,
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
          return sendJson(res, 400, { error: 'Username and password are required' });
        }

        const user = findUserByUsername(username);
        if (!user || !verifyPassword(password, user.password_hash)) {
          return sendJson(res, 401, { error: 'Invalid username or password' });
        }

        const session = createSession(user.id);
        const cookie = `dsh_user_token=${session.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 3600}`;

        return sendJson(res, 200, {
          message: 'Login successful',
          token: session.token,
          user: {
            id: user.id,
            username: user.username,
            role: user.role,
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

      return sendJson(res, 200, {
        authenticated: true,
        user: {
          id: session.id,
          username: session.username,
          role: session.role,
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

      const expireCookie = `dsh_user_token=; Path=/; HttpOnly; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
      return sendJson(res, 200, { message: 'Logged out successfully' }, {
        'Set-Cookie': expireCookie
      });
    }
  });

  console.log('[dsh-plugin-user-manager] Auth routes registered:');
  console.log('  - POST /api/auth/register');
  console.log('  - POST /api/auth/login');
  console.log('  - GET  /api/auth/me');
  console.log('  - POST /api/auth/logout');
}
