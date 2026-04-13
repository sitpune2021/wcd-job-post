const { DataTypes } = require('sequelize');
const sequelize = require('../../../config/db');

const EmployeeOnboardingLog = sequelize.define('EmployeeOnboardingLog', {
  log_id: {
    type: DataTypes.INTEGER,
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
  action: {
    type: DataTypes.STRING(50),
    allowNull: false,
    comment: 'Action performed (e.g., CREATED, EMAIL_SENT, PASSWORD_CHANGED, ALLOTMENT_UPLOADED, CONFIRMED, REJECTED)'
  },
  details: {
    type: DataTypes.JSONB,
    allowNull: true,
    comment: 'Additional details about the action'
  },
  performed_by: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'ms_admin_users',
      key: 'admin_id'
    }
  },
  performed_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  ip_address: {
    type: DataTypes.STRING(45),
    allowNull: true
  }
}, {
  tableName: 'ms_employee_onboarding_log',
  timestamps: false
});

module.exports = EmployeeOnboardingLog;
