const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const AdminUserScheme = sequelize.define('AdminUserScheme', {
  admin_user_scheme_id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  admin_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'ms_admin_users',
      key: 'admin_id'
    }
  },
  scheme_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'ms_schemes',
      key: 'scheme_id'
    }
  },
  is_primary: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true
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
  tableName: 'ms_admin_user_schemes',
  timestamps: false
});

module.exports = AdminUserScheme;
