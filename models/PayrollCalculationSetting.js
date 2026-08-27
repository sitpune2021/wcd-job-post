const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const PayrollCalculationSetting = sequelize.define('PayrollCalculationSetting', {
  setting_id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  scheme_id: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  scheme_type_id: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  rounding_basis: {
    type: DataTypes.STRING(30),
    allowNull: true
  },
  rounding_method: {
    type: DataTypes.STRING(30),
    allowNull: true
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true
  },
  created_by: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  updated_by: {
    type: DataTypes.INTEGER,
    allowNull: true
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
  tableName: 'ms_hrm_payroll_calculation_settings',
  timestamps: false
});

module.exports = PayrollCalculationSetting;
