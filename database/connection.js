import { Sequelize } from 'sequelize';

const DB_HOST = process.env.POSTGRES_HOST || '127.0.0.1';
const DB_PORT = parseInt(process.env.POSTGRES_PORT || '5432', 10);
const DB_USER = process.env.POSTGRES_USER || 'dsh_admin';
const DB_PASS = process.env.POSTGRES_PASSWORD || 'dsh_secure_password_2026';
const DB_NAME = process.env.POSTGRES_DB || 'dsh_enterprise_db';

const DATABASE_URL = process.env.DATABASE_URL || `postgres://${DB_USER}:${DB_PASS}@${DB_HOST}:${DB_PORT}/${DB_NAME}`;

export const sequelize = new Sequelize(DATABASE_URL, {
  dialect: 'postgres',
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
    return true;
  } catch (error) {
    console.error('[PostgreSQL] Connection failed:', error.message);
    throw error;
  }
}

