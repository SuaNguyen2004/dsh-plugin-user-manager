import { Sequelize } from 'sequelize';
import path from 'node:path';

const SQLITE_STORAGE = process.env.SQLITE_PATH || path.resolve(process.cwd(), 'data', 'users.db');

export const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: SQLITE_STORAGE,
  logging: process.env.NODE_ENV === 'development' ? console.log : false,
  pool: {
    max: 10,
    min: 0,
    acquire: 30000,
    idle: 10000
  }
});

export async function testConnection() {
  try {
    await sequelize.authenticate();
    console.log(`[SQLite] Connected successfully to database: ${SQLITE_STORAGE}`);
    return true;
  } catch (error) {
    console.error('[SQLite] Connection failed:', error.message);
    throw error;
  }
}

