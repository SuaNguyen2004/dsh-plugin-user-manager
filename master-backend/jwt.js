import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'dsh-master-backend-enterprise-secret-2026';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

export function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}

export function extractToken(req) {
  // 1. Authorization Bearer header
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }

  // 2. Cookie header
  const cookieHeader = req.headers['cookie'];
  if (cookieHeader) {
    const cookies = cookieHeader.split(';').map(c => c.trim());
    for (const c of cookies) {
      if (c.startsWith('dsh_user_token=')) {
        return decodeURIComponent(c.substring('dsh_user_token='.length));
      }
    }
  }

  return null;
}

export function authenticate(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Unauthorized: Thiếu token xác thực.' }));
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Unauthorized: Token không hợp lệ hoặc đã hết hạn.' }));
  }

  req.user = decoded;
  if (next) next();
}

export function requireAdmin(req, res, next) {
  authenticate(req, res, () => {
    if (!req.user || req.user.role !== 'admin') {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Forbidden: Yêu cầu quyền Quản trị viên (Admin).' }));
    }
    if (next) next();
  });
}

