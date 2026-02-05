const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const Payment = sequelize.define('Payment', {
  payment_id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
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
  post_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'ms_post_master',
      key: 'post_id'
    }
  },
  post_name: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  district_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'ms_district_master',
      key: 'district_id'
    }
  },
  razorpay_order_id: {
    type: DataTypes.STRING(100),
    allowNull: false,
    unique: true
  },
  razorpay_payment_id: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  razorpay_signature: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  amount: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false
  },
  base_fee: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false
  },
  platform_fee: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false
  },
  cgst: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false
  },
  sgst: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false
  },
  payment_status: {
    type: DataTypes.ENUM('PENDING', 'SUCCESS', 'FAILED', 'REFUNDED'),
    defaultValue: 'PENDING'
  },
  payment_method: {
    type: DataTypes.STRING(50),
    allowNull: true
  },
  paid_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  failure_reason: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  metadata: {
    type: DataTypes.JSONB,
    allowNull: true
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
  }
}, {
  tableName: 'ms_payments',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    { fields: ['applicant_id'] },
    { fields: ['application_id'] },
    { fields: ['post_id'] },
    { fields: ['district_id'] },
    { fields: ['razorpay_order_id'], unique: true },
    { fields: ['payment_status'] },
    { fields: ['post_name', 'district_id', 'applicant_id'] }
  ]
});

module.exports = Payment;
