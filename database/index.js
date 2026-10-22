import { sequelize, testConnection } from './connection.js';
import { defineUserModel, hashPassword, verifyPassword } from './models/User.js';
import { defineSessionModel, generateToken } from './models/Session.js';
import { defineUserSessionModel } from './models/UserSession.js';
import { defineAttachmentModel } from './models/Attachment.js';

// Initialize Models
export const User = defineUserModel(sequelize);
export const Session = defineSessionModel(sequelize);
export const UserSession = defineUserSessionModel(sequelize);
export const Attachment = defineAttachmentModel(sequelize);

// Define Associations
User.hasMany(Session, { foreignKey: 'user_id', as: 'sessions', onDelete: 'CASCADE' });
Session.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

// Sync database helper
export async function initDatabase(options = {}) {
  await testConnection();
  await sequelize.sync(options);
  console.log('[PostgreSQL] Database synchronized successfully with 4 core tables.');
}

export { sequelize, testConnection, hashPassword, verifyPassword, generateToken };

