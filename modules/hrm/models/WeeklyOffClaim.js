const { DataTypes } = require('sequelize');
const sequelize = require('../../../config/db');

const WeeklyOffClaim = sequelize.define('HrmWeeklyOffClaim', {
  claim_id: {
    type: DataTypes.BIGINT,
    primaryKey: true,
    autoIncrement: true
  },
  employee_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'ms_employee_master',
      key: 'employee_id'
    }
  },
  entitlement_week_start: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    comment: 'Start of the 7-day entitlement window (Sunday)'
  },
  entitlement_week_end: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    comment: 'End of the 7-day entitlement window (Saturday)'
  },
  entitlement_month: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'YYYYMM format for month-end expiry tracking'
  },
  claimed_off_date: {
    type: DataTypes.DATEONLY,
    allowNull: true,
    comment: 'The date employee wants as weekly off'
  },
  claim_status: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'PENDING',
    validate: {
      isIn: [['ELIGIBLE', 'PENDING', 'APPROVED', 'EXPIRED', 'USED']]
    },
    comment: 'Tracks weekly-off entitlement and claim processing state'
  },
  requested_at: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'When employee submitted the claim'
  },
  approved_by: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'ms_admin_users',
      key: 'admin_id'
    },
    comment: 'Admin who approved the claim'
  },
  approved_at: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'When the claim was approved'
  },
  admin_remarks: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Remarks added by admin during approval'
  },
  auto_approved: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    comment: 'True if auto-approved after 24 hours'
  },
  attendance_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'ms_hrm_attendance',
      key: 'attendance_id'
    },
    comment: 'Link to attendance record when weekly off is marked'
  },
  created_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  updated_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  created_by: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  updated_by: {
    type: DataTypes.INTEGER,
    allowNull: true
  }
}, {
  tableName: 'ms_hrm_weekly_off_claims',
  timestamps: false,
  indexes: [
    {
      fields: ['employee_id', 'claim_status'],
      name: 'idx_weekly_off_employee_status'
    },
    {
      fields: ['employee_id', 'entitlement_month'],
      name: 'idx_weekly_off_month_expiry'
    },
    {
      fields: ['claim_status', 'requested_at'],
      name: 'idx_weekly_off_requested_at'
    },
    {
      fields: ['claimed_off_date'],
      name: 'idx_weekly_off_claimed_date'
    },
    {
      unique: true,
      fields: ['employee_id', 'entitlement_week_start', 'entitlement_week_end'],
      name: 'uq_weekly_off_employee_week'
    }
  ]
});

module.exports = WeeklyOffClaim;
