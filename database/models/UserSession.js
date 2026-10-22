import { DataTypes } from 'sequelize';

export function defineUserSessionModel(sequelize) {
  const UserSession = sequelize.define('UserSession', {
    session_id: {
      type: DataTypes.STRING(128),
      primaryKey: true
    },
    username: {
      type: DataTypes.STRING(50),
      allowNull: false
    },
    workspace_id: {
      type: DataTypes.STRING(128),
      allowNull: false
    }
  }, {
    tableName: 'user_sessions',
    timestamps: true,
    indexes: [
      { fields: ['username'] },
      { fields: ['workspace_id'] }
    ]
  });

  return UserSession;
}

