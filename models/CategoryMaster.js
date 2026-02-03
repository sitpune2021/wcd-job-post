const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

/**
 * Category Master Model
 * Master table for applicant categories (General, OBC, SC, ST, VJNT, SBC, EWS, etc.)
 * Used in applicant personal info and post eligibility criteria
 */
const CategoryMaster = sequelize.define('CategoryMaster', {
  category_id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  category_code: {
    type: DataTypes.STRING(20),
    allowNull: false,
    unique: true,
    comment: 'Unique code like GEN, OBC, SC, ST, VJNT, SBC, EWS'
  },
  category_name: {
    type: DataTypes.STRING(100),
    allowNull: false,
    comment: 'Category name in English'
  },
  category_name_mr: {
    type: DataTypes.STRING(100),
    allowNull: true,
    comment: 'Category name in Marathi'
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  description_mr: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Description in Marathi'
  },
  display_order: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: 'Order for display in dropdowns'
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
  deleted_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  created_by: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  updated_by: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  deleted_by: {
    type: DataTypes.INTEGER,
    allowNull: true
  }
}, {
  tableName: 'ms_category_master',
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

module.exports = CategoryMaster;
