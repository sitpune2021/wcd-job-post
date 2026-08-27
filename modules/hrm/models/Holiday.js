const { DataTypes } = require('sequelize');
const sequelize = require('../../../config/db');

const Holiday = sequelize.define('HrmHoliday', {
  holiday_id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  holiday_date: {
    type: DataTypes.DATEONLY,
    allowNull: false
  },
  holiday_name: {
    type: DataTypes.STRING(100),
    allowNull: false
  },
  year: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'Year for which this holiday is applicable'
  },
  holiday_type: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'NATIONAL',
    validate: {
      isIn: [['NATIONAL', 'STATE', 'OPTIONAL']]
    }
  },
  district_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'district_master',
      key: 'district_id'
    },
    comment: 'Optional district scope for HRM holiday'
  },
  scheme_type_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'ms_scheme_types',
      key: 'scheme_type_id'
    },
    comment: 'Optional scheme type scope for HRM holiday'
  },
  scheme_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'ms_schemes',
      key: 'scheme_id'
    },
    comment: 'Optional scheme scope for HRM holiday'
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Additional details about the holiday'
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
  tableName: 'ms_hrm_holidays',
  timestamps: false
});

module.exports = Holiday;
