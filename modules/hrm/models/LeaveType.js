const { DataTypes } = require('sequelize');
const sequelize = require('../../../config/db');

const LeaveType = sequelize.define('HrmLeaveType', {
  leave_type_id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  leave_code: {
    type: DataTypes.STRING(10),
    allowNull: false,
    unique: true
  },
  leave_name: {
    type: DataTypes.STRING(50),
    allowNull: false
  },
  default_days_per_year: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 12
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  requires_document: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  max_consecutive_days: {
    type: DataTypes.INTEGER,
    defaultValue: 7
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  is_deleted: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  updated_at: {
    type: DataTypes.DATE,
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
  tableName: 'ms_hrm_leave_types',
  timestamps: false
});

module.exports = LeaveType;
