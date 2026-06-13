const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const RecruitmentDriveHistory = sequelize.define('RecruitmentDriveHistory', {
  history_id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  recruitment_drive_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  action: {
    type: DataTypes.STRING(50),
    allowNull: false
  },
  old_status: DataTypes.STRING(30),
  new_status: DataTypes.STRING(30),
  remarks: DataTypes.TEXT,
  metadata: DataTypes.JSONB,
  performed_by: DataTypes.INTEGER,
  performed_at: DataTypes.DATE
}, {
  tableName: 'ms_recruitment_drive_history',
  timestamps: false
});

module.exports = RecruitmentDriveHistory;

