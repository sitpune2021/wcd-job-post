const { DataTypes } = require('sequelize');
const sequelize = require('../../../config/db');

const PayrollCycle = sequelize.define('HrmPayrollCycle', {
  cycle_id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  cycle_month: {
    type: DataTypes.INTEGER,
    allowNull: false,
    validate: { min: 1, max: 12 }
  },
  cycle_year: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  cycle_name: {
    type: DataTypes.STRING(50),
    allowNull: false
  },
  payment_date: {
    type: DataTypes.DATEONLY,
    allowNull: true
  },
  status: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'DRAFT',
    validate: {
      isIn: [['DRAFT', 'GENERATED', 'PAID']]
    }
  },
  total_employees: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  total_amount: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    defaultValue: 0
  },
  generated_by: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'ms_admin_users', key: 'admin_id' }
  },
  generated_at: {
    type: DataTypes.DATE,
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
  tableName: 'ms_hrm_payroll_cycles',
  timestamps: false
});

module.exports = PayrollCycle;
