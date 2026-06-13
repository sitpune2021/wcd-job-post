const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const MeritGenerationRun = sequelize.define('MeritGenerationRun', {
  merit_run_id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  recruitment_drive_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  post_id: DataTypes.INTEGER,
  district_id: DataTypes.INTEGER,
  run_number: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  run_type: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'PREVIEW'
  },
  status: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'PROCESSING'
  },
  is_official: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  reason: DataTypes.TEXT,
  formula_snapshot: DataTypes.JSONB,
  total_applications: DataTypes.INTEGER,
  generated_by: DataTypes.INTEGER,
  started_at: DataTypes.DATE,
  completed_at: DataTypes.DATE,
  published_at: DataTypes.DATE,
  published_by: DataTypes.INTEGER,
  error_message: DataTypes.TEXT
}, {
  tableName: 'ms_merit_generation_runs',
  timestamps: false
});

module.exports = MeritGenerationRun;

