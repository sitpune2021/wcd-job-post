const { DataTypes } = require('sequelize');
const sequelize = require('../../../config/db');

const ShiftType = sequelize.define('HrmShiftType', {
  shift_type_id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  shift_name: {
    type: DataTypes.STRING(50),
    allowNull: false,
    unique: true,
    comment: 'Shift type name (e.g., Day Shift, Night Shift, General Shift)'
  },
  shift_code: {
    type: DataTypes.STRING(20),
    allowNull: false,
    unique: true,
    comment: 'Short code for shift (e.g., DAY, NIGHT, GENERAL)'
  },
  start_time: {
    type: DataTypes.TIME,
    allowNull: true,
    comment: 'Standard start time for this shift'
  },
  end_time: {
    type: DataTypes.TIME,
    allowNull: true,
    comment: 'Standard end time for this shift'
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Description of shift type'
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    comment: 'Whether this shift type is active'
  },
  sort_order: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: 'Order for displaying shift types'
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
    allowNull: true,
    comment: 'Admin who created this shift type'
  },
  updated_by: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'Admin who last updated this shift type'
  }
}, {
  tableName: 'ms_hrm_shift_types',
  timestamps: false
});

module.exports = ShiftType;
