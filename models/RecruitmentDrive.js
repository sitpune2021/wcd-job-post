const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const RecruitmentDrive = sequelize.define('RecruitmentDrive', {
  recruitment_drive_id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  drive_code: {
    type: DataTypes.STRING(50),
    allowNull: false,
    unique: true
  },
  drive_name: {
    type: DataTypes.STRING(200),
    allowNull: false
  },
  status: {
    type: DataTypes.STRING(30),
    allowNull: false,
    defaultValue: 'DRAFT'
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  registration_open: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  applications_open: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  registration_start_at: DataTypes.DATE,
  registration_end_at: DataTypes.DATE,
  application_start_at: DataTypes.DATE,
  application_end_at: DataTypes.DATE,
  applications_closed_at: DataTypes.DATE,
  merit_generated_at: DataTypes.DATE,
  closed_at: DataTypes.DATE,
  closed_by: DataTypes.INTEGER,
  created_by: DataTypes.INTEGER,
  updated_by: DataTypes.INTEGER,
  created_at: DataTypes.DATE,
  updated_at: DataTypes.DATE
}, {
  tableName: 'ms_recruitment_drives',
  timestamps: false
});

module.exports = RecruitmentDrive;

