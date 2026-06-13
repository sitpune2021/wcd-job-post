const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const NotificationLog = sequelize.define('NotificationLog', {
  notification_id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  applicant_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'applicant_master',
      key: 'applicant_id'
    }
  },
  admin_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'admin_users',
      key: 'admin_id'
    }
  },
  channel: {
    type: DataTypes.STRING(20),
    allowNull: false
  },
  message: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  title: DataTypes.STRING(255),
  title_mr: DataTypes.STRING(255),
  message_mr: DataTypes.TEXT,
  notification_type: DataTypes.STRING(40),
  event_code: DataTypes.STRING(60),
  action_url: DataTypes.STRING(500),
  recruitment_drive_id: DataTypes.INTEGER,
  application_id: DataTypes.INTEGER,
  post_id: DataTypes.INTEGER,
  is_read: { type: DataTypes.BOOLEAN, defaultValue: false },
  read_at: DataTypes.DATE,
  metadata: DataTypes.JSONB,
  is_deleted: { type: DataTypes.BOOLEAN, defaultValue: false },
  deleted_at: DataTypes.DATE,
  status: {
    type: DataTypes.STRING(20),
    defaultValue: 'PENDING'
  },
  sent_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  created_by: DataTypes.INTEGER,
  updated_at: DataTypes.DATE,
  updated_by: DataTypes.INTEGER
}, {
  tableName: 'ms_notification_log',
  timestamps: false
});

module.exports = NotificationLog;
