const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

/**
 * Education Level Master
 * Used in applicant education form and post eligibility criteria
 * Examples: 10th, 12th, Graduate, Post Graduate, Diploma, etc.
 */
const EducationLevel = sequelize.define('EducationLevel', {
  level_id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  doc_type_id: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  level_code: {
    type: DataTypes.STRING(50),
    allowNull: false,
    unique: true,
    comment: 'Unique code like 10TH, 12TH, GRADUATE, PG, DIPLOMA'
  },
  level_name: {
    type: DataTypes.STRING(100),
    allowNull: false
  },
  level_name_mr: {
    type: DataTypes.STRING(100),
    allowNull: true,
    comment: 'Education level name in Marathi'
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  description_mr: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  level_category: {
    type: DataTypes.STRING(50),
    allowNull: true
  },
  display_order: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: 'Order for display in dropdowns (lower = higher education)'
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  is_deleted: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  created_by: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  updated_by: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  deleted_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  deleted_by: {
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
  tableName: 'ms_education_levels',
  timestamps: false,
  defaultScope: {
    where: { is_deleted: false }
  },
  scopes: {
    withDeleted: {},
    onlyActive: {
      where: { is_deleted: false, is_active: true }
    }
  }
});

module.exports = EducationLevel;
