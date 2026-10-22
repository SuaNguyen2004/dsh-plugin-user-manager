import { DataTypes } from 'sequelize';
import { randomBytes } from 'node:crypto';

export function generateToken() {
  return randomBytes(32).toString('hex');
}

export function defineSessionModel(sequelize) {
  const Session = sequelize.define('Session', {
    token: {
      type: DataTypes.STRING(128),
      primaryKey: true
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    expires_at: {
      type: DataTypes.BIGINT,
      allowNull: false
    }
  }, {
    tableName: 'sessions',
    timestamps: true,
    indexes: [
      { fields: ['user_id'] },
      { fields: ['expires_at'] }
    ]
  });

  return Session;
}

