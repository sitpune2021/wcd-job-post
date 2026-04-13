const { DataTypes } = require('sequelize');
const sequelize = require('../../../config/db');

const MonthlyReport = sequelize.define('HrmMonthlyReport', {
  report_id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  employee_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'ms_employee_master', key: 'employee_id' }
  },
  report_month: {
    type: DataTypes.INTEGER,
    allowNull: false,
    validate: { min: 1, max: 12 }
  },
  report_year: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  work_category: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  nature_of_work: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  beneficiaries_reached: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: 0
  },
  field_visits_conducted: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: 0
  },
  key_achievements: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  challenges_faced: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  improvement_plan: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  document_path: {
    type: DataTypes.STRING(500),
    allowNull: true
  },
  status: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'DRAFT',
    validate: {
      isIn: [['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED']]
    }
  },
  appraiser_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'ms_admin_users', key: 'admin_id' }
  },
  appraiser_remarks: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  reviewed_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  submitted_at: {
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
  tableName: 'ms_hrm_monthly_reports',
  timestamps: false
});

module.exports = MonthlyReport;
