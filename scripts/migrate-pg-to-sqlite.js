// scripts/migrate-pg-to-sqlite.js
// Migration tool: PostgreSQL -> SQLite (data/users.db) + Backup Model/API Keys
// Lite Enterprise Rebuild - Step 1

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';

const PG_CONFIG = {
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
  user: process.env.POSTGRES_USER || 'dsh_admin',
  password: process.env.POSTGRES_PASSWORD || 'dsh_secure_password_2026',
  database: process.env.POSTGRES_DB || 'dsh_enterprise_db'
};

const DATA_DIR = path.resolve(process.cwd(), 'data');
const SQLITE_FILE = path.join(DATA_DIR, 'users.db');
const BACKUP_DIR = path.join(DATA_DIR, 'backup_configs');

async function main() {
  console.log('===============================================================');
  console.log('🚀 [Step 1] BẮT ĐẦU TRÍCH XUẤT DỮ LIỆU: POSTGRESQL -> SQLITE 3');
  console.log('===============================================================\n');

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  // -----------------------------------------------------------------
  // 1. Sao lưu an toàn API Keys và Model Configurations
  // -----------------------------------------------------------------
  console.log('📦 [1/3] Đang kiểm tra và sao lưu file cấu hình Model & API Key...');

  const credSource = path.join(DATA_DIR, 'admin_dsh_home', '.credentials.yaml');
  const credDest = path.join(BACKUP_DIR, '.credentials.yaml.bak');
  let apiKeyCount = 0;

  if (fs.existsSync(credSource)) {
    fs.copyFileSync(credSource, credDest);
    console.log(`  ✅ Đã sao lưu: ${credSource} -> ${credDest}`);

    // Đọc trích xuất API Key ra file JSON dự phòng
    const credContent = fs.readFileSync(credSource, 'utf8');
    const openrouterMatch = credContent.match(/OPENROUTER_API_KEY:\s*([^\r\n]+)/);
    const orcarouterMatch = credContent.match(/ORCAROUTER_API_KEY:\s*([^\r\n]+)/);

    const keysBackup = {
      OPENROUTER_API_KEY: openrouterMatch ? openrouterMatch[1].trim() : null,
      ORCAROUTER_API_KEY: orcarouterMatch ? orcarouterMatch[1].trim() : null,
      backupTime: new Date().toISOString()
    };

    if (keysBackup.OPENROUTER_API_KEY || keysBackup.ORCAROUTER_API_KEY) {
      const keysJsonPath = path.join(BACKUP_DIR, 'api_keys_backup.json');
      fs.writeFileSync(keysJsonPath, JSON.stringify(keysBackup, null, 2), 'utf8');
      console.log(`  ✅ Đã lưu dự phòng API keys ra: ${keysJsonPath}`);
      apiKeyCount = (keysBackup.OPENROUTER_API_KEY ? 1 : 0) + (keysBackup.ORCAROUTER_API_KEY ? 1 : 0);
    }
  } else {
    console.log(`  ⚠️ Không tìm thấy ${credSource}, bỏ qua sao lưu .credentials.yaml.`);
  }

  // Kiểm tra file models_scope.json nếu có
  const modelScopeSources = [
    path.join(DATA_DIR, 'admin_dsh_home', 'models_scope.json'),
    path.join(DATA_DIR, 'models_scope.json'),
    path.join(process.cwd(), 'models_scope.json')
  ];
  for (const src of modelScopeSources) {
    if (fs.existsSync(src)) {
      const dest = path.join(BACKUP_DIR, 'models_scope.json.bak');
      fs.copyFileSync(src, dest);
      console.log(`  ✅ Đã sao lưu: ${src} -> ${dest}`);
      break;
    }
  }

  // -----------------------------------------------------------------
  // 2. Kết nối PostgreSQL & Đọc dữ liệu 4 bảng
  // -----------------------------------------------------------------
  console.log('\n🔌 [2/3] Đang kết nối PostgreSQL container (port 5432)...');
  const pgClient = new pg.Client(PG_CONFIG);
  await pgClient.connect();
  console.log(`  ✅ Kết nối PostgreSQL thành công tới database: ${PG_CONFIG.database}`);

  const usersRes = await pgClient.query('SELECT * FROM users ORDER BY id ASC');
  const sessionsRes = await pgClient.query('SELECT * FROM sessions ORDER BY "createdAt" ASC');
  const userSessionsRes = await pgClient.query('SELECT * FROM user_sessions ORDER BY "createdAt" ASC');
  const attachmentsRes = await pgClient.query('SELECT * FROM attachments ORDER BY id ASC');

  console.log(`  📊 Dữ liệu đọc được từ PostgreSQL:`);
  console.log(`     - Bảng 'users':         ${usersRes.rows.length} dòng`);
  console.log(`     - Bảng 'sessions':      ${sessionsRes.rows.length} dòng`);
  console.log(`     - Bảng 'user_sessions': ${userSessionsRes.rows.length} dòng`);
  console.log(`     - Bảng 'attachments':   ${attachmentsRes.rows.length} dòng`);

  // -----------------------------------------------------------------
  // 3. Khởi tạo SQLite và Ghi dữ liệu vào data/users.db
  // -----------------------------------------------------------------
  console.log('\n💾 [3/3] Đang ghi dữ liệu vào SQLite (data/users.db)...');

  // Khởi tạo Database SQLite Sync
  const sqlite = new DatabaseSync(SQLITE_FILE);

  // Bật foreign keys và tạo schema chuẩn
  sqlite.exec('PRAGMA foreign_keys = OFF;');

  sqlite.exec(`
    DROP TABLE IF EXISTS attachments;
    DROP TABLE IF EXISTS user_sessions;
    DROP TABLE IF EXISTS sessions;
    DROP TABLE IF EXISTS users;

    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      status TEXT NOT NULL DEFAULT 'pending',
      workspace_path TEXT,
      token_quota INTEGER NOT NULL DEFAULT 0,
      tokens_used INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE user_sessions (
      session_id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );

    CREATE TABLE attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      attachment_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_size INTEGER NOT NULL DEFAULT 0,
      session_id TEXT NOT NULL,
      username TEXT NOT NULL,
      file_path TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
  `);

  // Ghi bảng users
  const insertUser = sqlite.prepare(`
    INSERT INTO users (id, username, password_hash, role, status, workspace_path, token_quota, tokens_used, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  sqlite.exec('BEGIN TRANSACTION;');
  for (const u of usersRes.rows) {
    insertUser.run(
      u.id,
      u.username,
      u.password_hash,
      u.role,
      u.status,
      u.workspace_path || null,
      u.token_quota || 0,
      u.tokens_used || 0,
      new Date(u.createdAt).toISOString(),
      new Date(u.updatedAt).toISOString()
    );
  }
  sqlite.exec('COMMIT;');
  console.log(`  ✅ Đã chép ${usersRes.rows.length} tài khoản người dùng vào bảng 'users'.`);

  // Ghi bảng sessions
  if (sessionsRes.rows.length > 0) {
    const insertSession = sqlite.prepare(`
      INSERT INTO sessions (token, user_id, expires_at, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?)
    `);
    sqlite.exec('BEGIN TRANSACTION;');
    for (const s of sessionsRes.rows) {
      insertSession.run(
        s.token,
        s.user_id,
        parseInt(s.expires_at, 10),
        new Date(s.createdAt).toISOString(),
        new Date(s.updatedAt).toISOString()
      );
    }
    sqlite.exec('COMMIT;');
    console.log(`  ✅ Đã chép ${sessionsRes.rows.length} phiên vào bảng 'sessions'.`);
  }

  // Ghi bảng user_sessions
  if (userSessionsRes.rows.length > 0) {
    const insertUserSession = sqlite.prepare(`
      INSERT INTO user_sessions (session_id, username, workspace_id, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?)
    `);
    sqlite.exec('BEGIN TRANSACTION;');
    for (const us of userSessionsRes.rows) {
      insertUserSession.run(
        us.session_id,
        us.username,
        us.workspace_id,
        new Date(us.createdAt).toISOString(),
        new Date(us.updatedAt).toISOString()
      );
    }
    sqlite.exec('COMMIT;');
    console.log(`  ✅ Đã chép ${userSessionsRes.rows.length} bản ghi vào bảng 'user_sessions'.`);
  }

  // Ghi bảng attachments
  if (attachmentsRes.rows.length > 0) {
    const insertAttachment = sqlite.prepare(`
      INSERT INTO attachments (id, attachment_id, file_name, file_size, session_id, username, file_path, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    sqlite.exec('BEGIN TRANSACTION;');
    for (const a of attachmentsRes.rows) {
      insertAttachment.run(
        a.id,
        a.attachment_id,
        a.file_name,
        parseInt(a.file_size || '0', 10),
        a.session_id,
        a.username,
        a.file_path,
        new Date(a.createdAt).toISOString(),
        new Date(a.updatedAt).toISOString()
      );
    }
    sqlite.exec('COMMIT;');
    console.log(`  ✅ Đã chép ${attachmentsRes.rows.length} bản ghi vào bảng 'attachments'.`);
  }

  // -----------------------------------------------------------------
  // 4. Xác minh kết quả trong SQLite
  // -----------------------------------------------------------------
  console.log('\n🔍 [KIỂM TRA DỮ LIỆU ĐÃ LƯU TRONG SQLITE]:');
  const sqliteUsers = sqlite.prepare('SELECT id, username, role, status, createdAt FROM users ORDER BY id ASC').all();
  console.table(sqliteUsers);

  console.log(`\n🎉 MIGRATION HOÀN TẤT THÀNH CÔNG!`);
  console.log(`📁 File SQLite mới: ${SQLITE_FILE}`);
  console.log(`📁 File Backup cấu hình: ${BACKUP_DIR}`);
  console.log(`🔑 Số lượng API Keys đã bảo toàn: ${apiKeyCount}`);

  await pgClient.end();
  sqlite.close();
}

main().catch(err => {
  console.error('\n❌ Lỗi trong quá trình migration:', err);
  process.exit(1);
});
