const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

/**
 * AllotmentEmailSchedule Model
 * Tracks scheduled email distributions for allotment PDFs
 */
const AllotmentEmailSchedule = sequelize.define('AllotmentEmailSchedule', {
  schedule_id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  post_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'ms_post_master',
      key: 'post_id'
    }
  },
  upload_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'ms_post_allotment_uploads',
      key: 'upload_id'
    }
  },
  scheduled_date: {
    type: DataTypes.DATE,
    allowNull: false,
    comment: 'Date and time when emails should be sent'
  },
  status: {
    type: DataTypes.ENUM('SCHEDULED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'),
    allowNull: false,
    defaultValue: 'SCHEDULED'
  },
  total_recipients: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: 'Total number of recipients for this schedule'
  },
  emails_sent: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: 'Number of emails successfully sent'
  },
  emails_failed: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: 'Number of emails that failed to send'
  },
  started_at: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'When the email sending process started'
  },
  completed_at: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'When the email sending process completed'
  },
  error_message: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Error message if the schedule failed'
  },
  created_by: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'ms_admin_users',
      key: 'admin_id'
    }
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  updated_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  is_deleted: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  }
}, {
  tableName: 'ms_allotment_email_schedules',
  timestamps: false,
  indexes: [
    {
      name: 'idx_schedule_post_status',
      fields: ['post_id', 'status'],
      where: { is_deleted: false }
    },
    {
      name: 'idx_schedule_date_status',
      fields: ['scheduled_date', 'status'],
      where: { is_deleted: false }
    }
  ]
});

module.exports = AllotmentEmailSchedule;
