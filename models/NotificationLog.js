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
  }
}, {
  tableName: 'ms_notification_log',
  timestamps: false
});

module.exports = NotificationLog;
