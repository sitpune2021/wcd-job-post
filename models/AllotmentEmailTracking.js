const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

/**
 * AllotmentEmailTracking Model
 * Tracks individual email sends to prevent duplicates
 * Ensures each applicant receives allotment email only once per post
 */
const AllotmentEmailTracking = sequelize.define('AllotmentEmailTracking', {
  tracking_id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  schedule_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'ms_allotment_email_schedules',
      key: 'schedule_id'
    },
    comment: 'Reference to the schedule that sent this email'
  },
  post_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'ms_post_master',
      key: 'post_id'
    }
  },
  applicant_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'ms_applicant_master',
      key: 'applicant_id'
    }
  },
  application_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'ms_applications',
      key: 'application_id'
    }
  },
  email: {
    type: DataTypes.STRING(255),
    allowNull: false,
    comment: 'Email address where the allotment PDF was sent'
  },
  sent_at: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'Timestamp when email was successfully sent'
  },
  status: {
    type: DataTypes.ENUM('PENDING', 'SENT', 'FAILED', 'BOUNCED'),
    allowNull: false,
    defaultValue: 'PENDING'
  },
  error_message: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Error details if email failed to send'
  },
  retry_count: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: 'Number of retry attempts for failed emails'
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  updated_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'ms_allotment_email_tracking',
  timestamps: false,
  indexes: [
    {
      unique: true,
      name: 'uq_post_applicant',
      fields: ['post_id', 'applicant_id']
    },
    {
      name: 'idx_tracking_schedule',
      fields: ['schedule_id']
    },
    {
      name: 'idx_tracking_post_status',
      fields: ['post_id', 'status']
    },
    {
      name: 'idx_tracking_applicant',
      fields: ['applicant_id']
    }
  ]
});

module.exports = AllotmentEmailTracking;
