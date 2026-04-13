const { DataTypes } = require('sequelize');
const sequelize = require('../../../config/db');

const LeaveBalance = sequelize.define('HrmLeaveBalance', {
  balance_id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  employee_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'ms_employee_master', key: 'employee_id' }
  },
  leave_type_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'ms_hrm_leave_types', key: 'leave_type_id' }
  },
  year: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  total_allocated: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  used: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  remaining: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  carry_forward: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
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
  tableName: 'ms_hrm_leave_balance',
  timestamps: false
});

module.exports = LeaveBalance;
