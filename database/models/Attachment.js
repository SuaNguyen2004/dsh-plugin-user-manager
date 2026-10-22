import { DataTypes } from 'sequelize';

export function defineAttachmentModel(sequelize) {
  const Attachment = sequelize.define('Attachment', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    attachment_id: {
      type: DataTypes.STRING(128),
      allowNull: false
    },
    file_name: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    file_size: {
      type: DataTypes.BIGINT,
      allowNull: false,
      defaultValue: 0
    },
    session_id: {
      type: DataTypes.STRING(128),
      allowNull: false
    },
    username: {
      type: DataTypes.STRING(50),
      allowNull: false
    },
    file_path: {
      type: DataTypes.TEXT,
      allowNull: false
    }
  }, {
    tableName: 'attachments',
    timestamps: true,
    indexes: [
      { fields: ['attachment_id'] },
      { fields: ['session_id'] },
      { fields: ['username'] },
      { unique: true, fields: ['username', 'session_id', 'attachment_id'] }
    ]
  });

  return Attachment;
}

