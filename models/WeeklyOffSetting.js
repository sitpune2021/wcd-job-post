const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const WeeklyOffSetting = sequelize.define('WeeklyOffSetting', {
  setting_id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  scheme_type_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    unique: true,
    references: {
      model: 'ms_scheme_types',
      key: 'scheme_type_id'
    }
  },
  monthly_quota: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 4,
    validate: {
      min: 0,
      max: 10
    }
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
  tableName: 'ms_hrm_weekly_off_settings',
  timestamps: false
});

module.exports = WeeklyOffSetting;
