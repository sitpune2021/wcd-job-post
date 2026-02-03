const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const ApplicationStatus = sequelize.define('ApplicationStatus', {
  status_id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  status_code: {
    type: DataTypes.STRING(50),
    allowNull: false,
    unique: true
  },
  status_name: {
    type: DataTypes.STRING(100),
    allowNull: false
  },
  status_name_mr: {
    type: DataTypes.STRING(100),
    allowNull: true,
    comment: 'Status name in Marathi'
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  description_mr: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Status description in Marathi'
  },
  display_order: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'ms_application_statuses',
  timestamps: false
});

module.exports = ApplicationStatus;
