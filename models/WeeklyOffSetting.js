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
  quota_mode: {
    type: DataTypes.STRING(30),
    allowNull: true,
    defaultValue: 'COUNT_BASED',
    comment: 'COUNT_BASED uses monthly_quota. SUNDAY_BASED derives quota from Sundays in the month.'
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
