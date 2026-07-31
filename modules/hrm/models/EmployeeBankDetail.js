const { DataTypes } = require('sequelize');
const sequelize = require('../../../config/db');

const EmployeeBankDetail = sequelize.define('EmployeeBankDetail', {
  bank_detail_id: {
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
  applicant_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'ms_applicant_master',
      key: 'applicant_id'
    }
  },
  bank_name: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  account_number: {
    type: DataTypes.STRING(30),
    allowNull: true
  },
  ifsc_code: {
    type: DataTypes.STRING(15),
    allowNull: true
  },
  aadhar_number: {
    type: DataTypes.STRING(20),
    allowNull: true
  },
  state: {
    type: DataTypes.STRING(50),
    allowNull: true
  },
  district: {
    type: DataTypes.STRING(50),
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
  tableName: 'ms_hrm_employee_bank_details',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at'
});

module.exports = EmployeeBankDetail;
