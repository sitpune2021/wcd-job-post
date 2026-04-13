const { DataTypes } = require('sequelize');
const sequelize = require('../../../config/db');

const Payslip = sequelize.define('HrmPayslip', {
  payslip_id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  cycle_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'ms_hrm_payroll_cycles', key: 'cycle_id' }
  },
  employee_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'ms_employee_master', key: 'employee_id' }
  },
  payslip_number: {
    type: DataTypes.STRING(50),
    allowNull: false,
    unique: true
  },
  pay_month: {
    type: DataTypes.INTEGER,
    allowNull: false,
    validate: { min: 1, max: 12 }
  },
  pay_year: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  post_salary: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0
  },
  working_days: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  present_days: {
    type: DataTypes.DECIMAL(4, 1),
    allowNull: false,
    defaultValue: 0
  },
  leave_days: {
    type: DataTypes.DECIMAL(4, 1),
    allowNull: false,
    defaultValue: 0
  },
  absent_days: {
    type: DataTypes.DECIMAL(4, 1),
    allowNull: false,
    defaultValue: 0
  },
  paid_days: {
    type: DataTypes.DECIMAL(4, 1),
    allowNull: false,
    defaultValue: 0
  },
  per_day_salary: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0
  },
  calculated_salary: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0
  },
  remarks: {
    type: DataTypes.TEXT,
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
  payment_mode: {
    type: DataTypes.STRING(20),
    allowNull: true
  },
  payment_reference: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  payment_date: {
    type: DataTypes.DATEONLY,
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
  tableName: 'ms_hrm_payslips',
  timestamps: false
});

module.exports = Payslip;
