const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

module.exports = sequelize.define('PortalSetting', {
  setting_id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  setting_key: { type: DataTypes.STRING(100), allowNull: false, unique: true },
  setting_value: { type: DataTypes.JSONB, allowNull: false },
  description: DataTypes.TEXT,
  created_by: DataTypes.INTEGER,
  updated_by: DataTypes.INTEGER,
  created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updated_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
}, {
  tableName: 'ms_portal_settings',
  timestamps: false
});
