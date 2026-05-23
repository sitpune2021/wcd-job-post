const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const PaymentDistributionSetting = sequelize.define('PaymentDistributionSetting', {
  setting_id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  scheme_type_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'ms_scheme_types',
      key: 'scheme_type_id'
    }
  },
  center_share_percent: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: false,
    validate: {
      min: 0,
      max: 100
    }
  },
  state_share_percent: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: false,
    validate: {
      min: 0,
      max: 100
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
  tableName: 'ms_hrm_payment_distribution_settings',
  timestamps: false
});

module.exports = PaymentDistributionSetting;
