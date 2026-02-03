const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const EligibilityResult = sequelize.define('EligibilityResult', {
  eligibility_id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  application_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'applications',
      key: 'application_id'
    }
  },
  is_eligible: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  eligibility_status: {
    type: DataTypes.STRING(20),
    allowNull: true
  },
  rejection_reasons: {
    type: DataTypes.JSONB,
    allowNull: true
  },
  checked_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  checked_by: {
    type: DataTypes.INTEGER,
    allowNull: true
  }
}, {
  tableName: 'ms_eligibility_results',
  timestamps: false
});

module.exports = EligibilityResult;
