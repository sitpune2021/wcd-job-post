const { DataTypes } = require('sequelize');
const sequelize = require('../../../config/db');

const PerformanceReview = sequelize.define('HrmPerformanceReview', {
  review_id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  employee_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'ms_employee_master', key: 'employee_id' }
  },
  review_period: {
    type: DataTypes.STRING(100),
    allowNull: false,
    comment: 'e.g. January - March 2026'
  },
  period_start: {
    type: DataTypes.DATEONLY,
    allowNull: false
  },
  period_end: {
    type: DataTypes.DATEONLY,
    allowNull: false
  },
  self_rating: {
    type: DataTypes.DECIMAL(2, 1),
    allowNull: true,
    validate: { min: 1, max: 5 }
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
  appraiser_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'ms_admin_users', key: 'admin_id' }
  },
  appraiser_rating: {
    type: DataTypes.DECIMAL(2, 1),
    allowNull: true,
    validate: { min: 1, max: 5 }
  },
  appraiser_remarks: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  grade: {
    type: DataTypes.STRING(5),
    allowNull: true,
    comment: 'A, B, C, D, F'
  },
  score: {
    type: DataTypes.INTEGER,
    allowNull: true,
    validate: { min: 0, max: 100 }
  },
  status: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'PENDING',
    validate: {
      isIn: [['PENDING', 'SELF_SUBMITTED', 'REVIEWED', 'COMPLETED']]
    }
  },
  self_submitted_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  reviewed_at: {
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
  tableName: 'ms_hrm_performance_reviews',
  timestamps: false
});

module.exports = PerformanceReview;
