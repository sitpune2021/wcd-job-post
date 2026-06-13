const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const ApplicationPreference = sequelize.define('ApplicationPreference', {
  application_preference_id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  recruitment_drive_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  applicant_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  application_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  preference_rank: {
    type: DataTypes.INTEGER,
    allowNull: false,
    validate: { min: 1, max: 6 }
  },
  created_at: DataTypes.DATE,
  updated_at: DataTypes.DATE
}, {
  tableName: 'ms_application_preferences',
  timestamps: false
});

module.exports = ApplicationPreference;

