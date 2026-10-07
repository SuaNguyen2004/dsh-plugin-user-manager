import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const PLUGIN_ROOT = path.resolve(import.meta.dirname, '..');
const DB_DIR = path.join(PLUGIN_ROOT, 'data');
const DB_PATH = path.join(DB_DIR, 'users.db');
const WORKSPACE_BASE = path.join(PLUGIN_ROOT, 'workspaces');

let dbInstance = null;

/**
 * Hash password using crypto.scrypt
 */
export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = scryptSync(password, salt, 64);
  return `${salt}:${derivedKey.toString('hex')}`;
}

/**
 * Verify password against salt:hash
 */
export function verifyPassword(password, storedHash) {
  try {
    const [salt, key] = storedHash.split(':');
    if (!salt || !key) return false;
    const keyBuffer = Buffer.from(key, 'hex');
    const derivedKey = scryptSync(password, salt, 64);
    return timingSafeEqual(keyBuffer, derivedKey);
  } catch {
    return false;
  }
}

/**
 * Generate secure session token
 */
export function generateToken() {
  return randomBytes(32).toString('hex');
}

/**
 * Initialize and setup Database
 */
export function initDatabase() {
  if (dbInstance) return dbInstance;

  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  const db = new DatabaseSync(DB_PATH);

  // Enable WAL mode for better concurrency and enable foreign keys
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');

  // 1. Create users table with status ('pending' | 'active' | 'rejected')
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      status TEXT NOT NULL DEFAULT 'pending',
      token_quota INTEGER NOT NULL DEFAULT 100000,
      tokens_used INTEGER NOT NULL DEFAULT 0,
      workspace_path TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Migration: Ensure 'status' column exists if users table was created previously without it
  try {
    const tableInfo = db.prepare(`PRAGMA table_info(users)`).all();
    const hasStatus = tableInfo.some(col => col.name === 'status');
    if (!hasStatus) {
      db.exec(`ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';`);
    }
  } catch (err) {
    console.error('[dsh-plugin-user-manager] Error checking/migrating status column:', err);
  }

  // 2. Create sessions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // 3. Create token_logs table
  db.exec(`
    CREATE TABLE IF NOT EXISTS token_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      tokens INTEGER NOT NULL,
      action TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // 4. Create default admin if not exists (admin must always have status 'active')
  const checkAdminStmt = db.prepare('SELECT id, status FROM users WHERE username = ?');
  const existingAdmin = checkAdminStmt.get('admin');

  if (!existingAdmin) {
    const defaultWorkspace = path.join(WORKSPACE_BASE, 'admin');
    if (!fs.existsSync(defaultWorkspace)) {
      fs.mkdirSync(defaultWorkspace, { recursive: true });
    }
    const adminHash = hashPassword('admin123');
    const insertAdminStmt = db.prepare(`
      INSERT INTO users (username, password_hash, role, status, token_quota, tokens_used, workspace_path)
      VALUES (?, ?, 'admin', 'active', 100000, 0, ?)
    `);
    insertAdminStmt.run('admin', adminHash, defaultWorkspace);
    console.log('[dsh-plugin-user-manager] Initialized default active admin user (admin / admin123).');
  } else if (existingAdmin.status !== 'active') {
    db.prepare(`UPDATE users SET status = 'active' WHERE username = 'admin'`).run();
  }

  dbInstance = db;
  return db;
}

/**
 * Get the DB instance
 */
export function getDb() {
  if (!dbInstance) {
    return initDatabase();
  }
  return dbInstance;
}

// User CRUD Helpers
export function findUserByUsername(username) {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM users WHERE username = ?');
  return stmt.get(username);
}

export function findUserById(id) {
  const db = getDb();
  const stmt = db.prepare('SELECT * FROM users WHERE id = ?');
  return stmt.get(id);
}

/**
 * Create a new user with status defaulting to 'pending'
 */
export function createUser(username, password, role = 'user', tokenQuota = 100000, status = 'pending') {
  const db = getDb();
  const workspacePath = path.join(WORKSPACE_BASE, username);
  if (!fs.existsSync(workspacePath)) {
    fs.mkdirSync(workspacePath, { recursive: true });
  }

  const pwdHash = hashPassword(password);
  const stmt = db.prepare(`
    INSERT INTO users (username, password_hash, role, status, token_quota, tokens_used, workspace_path)
    VALUES (?, ?, ?, ?, ?, 0, ?)
  `);
  stmt.run(username, pwdHash, role, status, tokenQuota, workspacePath);
  return findUserByUsername(username);
}

/**
 * Approve pending user -> status = 'active'
 */
export function approveUser(username) {
  const db = getDb();
  const user = findUserByUsername(username);
  if (!user) {
    const err = new Error(`User "${username}" not found`);
    err.status = 404;
    throw err;
  }
  const stmt = db.prepare(`UPDATE users SET status = 'active' WHERE username = ?`);
  stmt.run(username);
  return findUserByUsername(username);
}

/**
 * Reject pending user -> status = 'rejected'
 */
export function rejectUser(username) {
  const db = getDb();
  const user = findUserByUsername(username);
  if (!user) {
    const err = new Error(`User "${username}" not found`);
    err.status = 404;
    throw err;
  }
  const stmt = db.prepare(`UPDATE users SET status = 'rejected' WHERE username = ?`);
  stmt.run(username);
  return findUserByUsername(username);
}

/**
 * List pending users
 */
export function listPendingUsers() {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT id, username, role, status, token_quota, tokens_used, workspace_path, created_at
    FROM users
    WHERE status = 'pending'
    ORDER BY id ASC
  `);
  return stmt.all();
}

/**
 * List active users
 */
export function listActiveUsers() {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT username
    FROM users
    WHERE status = 'active'
    ORDER BY id ASC
  `);
  return stmt.all().map(r => r.username);
}

// Session Helpers
export function createSession(userId, durationHours = 24 * 7) {
  const db = getDb();
  const token = generateToken();
  const expiresAt = Date.now() + durationHours * 3600 * 1000;
  const stmt = db.prepare(`
    INSERT INTO sessions (token, user_id, expires_at)
    VALUES (?, ?, ?)
  `);
  stmt.run(token, userId, expiresAt);
  return { token, expiresAt };
}

export function getSession(token) {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT sessions.token, sessions.user_id, sessions.expires_at,
           users.id, users.username, users.role, users.status, users.token_quota, users.tokens_used, users.workspace_path
    FROM sessions
    JOIN users ON sessions.user_id = users.id
    WHERE sessions.token = ?
  `);
  const session = stmt.get(token);
  if (!session) return null;

  if (Date.now() > session.expires_at) {
    deleteSession(token);
    return null;
  }
  return session;
}

export function deleteSession(token) {
  const db = getDb();
  const stmt = db.prepare('DELETE FROM sessions WHERE token = ?');
  stmt.run(token);
}

/**
 * Token Quota & Usage Metering
 */
export function consumeTokens(userId, tokenCount, action = 'chat') {
  const db = getDb();
  const user = findUserById(userId);
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }

  const count = Number(tokenCount);
  if (!Number.isFinite(count) || count <= 0) {
    const err = new Error('Invalid token count');
    err.status = 400;
    throw err;
  }

  if (user.tokens_used + count > user.token_quota) {
    const remaining = Math.max(0, user.token_quota - user.tokens_used);
    const err = new Error(`Quota exceeded: Not enough tokens. Remaining: ${remaining}, Requested: ${count}`);
    err.status = 402;
    err.remaining = remaining;
    err.token_quota = user.token_quota;
    err.tokens_used = user.tokens_used;
    throw err;
  }

  // Execute update and log
  db.exec('BEGIN TRANSACTION;');
  try {
    const updateStmt = db.prepare('UPDATE users SET tokens_used = tokens_used + ? WHERE id = ?');
    updateStmt.run(count, userId);

    const logStmt = db.prepare('INSERT INTO token_logs (user_id, tokens, action) VALUES (?, ?, ?)');
    logStmt.run(userId, count, action);

    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }

  const updatedUser = findUserById(userId);
  return {
    success: true,
    tokens_used: updatedUser.tokens_used,
    remaining: Math.max(0, updatedUser.token_quota - updatedUser.tokens_used),
    token_quota: updatedUser.token_quota
  };
}

/**
 * List all users without password_hash
 */
export function listAllUsers() {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT id, username, role, status, token_quota, tokens_used, workspace_path, created_at
    FROM users
    ORDER BY id ASC
  `);
  return stmt.all();
}

/**
 * Update token quota for a user
 */
export function updateUserQuota(username, newQuota) {
  const db = getDb();
  const quota = Number(newQuota);
  if (!Number.isFinite(quota) || quota < 0) {
    const err = new Error('Invalid quota value');
    err.status = 400;
    throw err;
  }

  const user = findUserByUsername(username);
  if (!user) {
    const err = new Error(`User "${username}" not found`);
    err.status = 404;
    throw err;
  }

  const stmt = db.prepare('UPDATE users SET token_quota = ? WHERE id = ?');
  stmt.run(quota, user.id);
  return findUserById(user.id);
}

/**
 * Reset tokens_used to 0 for a user
 */
export function resetUserUsage(username) {
  const db = getDb();
  const user = findUserByUsername(username);
  if (!user) {
    const err = new Error(`User "${username}" not found`);
    err.status = 404;
    throw err;
  }

  const stmt = db.prepare('UPDATE users SET tokens_used = 0 WHERE id = ?');
  stmt.run(user.id);
  return findUserById(user.id);
}
