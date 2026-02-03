const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const ApplicationStageHistory = sequelize.define('ApplicationStageHistory', {
  stage_history_id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  application_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'ms_applications',
      key: 'application_id'
    },
    comment: 'Application being tracked'
  },
  stage: {
    type: DataTypes.STRING(50),
    allowNull: false,
    comment: 'Stage name: ELIGIBLE, PROVISIONAL_SELECTED, SELECTED'
  },
  entered_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    comment: 'When application entered this stage'
  },
  exited_at: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'When application exited this stage (null if still in stage)'
  },
  entered_by: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'ms_admin_users',
      key: 'admin_id'
    },
    comment: 'Admin who moved application to this stage'
  },
  entered_by_type: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'ADMIN',
    comment: 'ADMIN or SYSTEM'
  },
  exited_by: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'ms_admin_users',
      key: 'admin_id'
    },
    comment: 'Admin who moved application out of this stage'
  },
  exited_by_type: {
    type: DataTypes.STRING(20),
    allowNull: true,
    comment: 'ADMIN or SYSTEM'
  },
  remarks: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Remarks about stage entry/exit'
  },
  metadata: {
    type: DataTypes.JSONB,
    allowNull: true,
    comment: 'Additional metadata (e.g., merit score, rank at time of entry)'
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'ms_application_stage_history',
  timestamps: false,
  indexes: [
    {
      fields: ['application_id']
    },
    {
      fields: ['stage']
    },
    {
      fields: ['entered_at']
    }
  ]
});

module.exports = ApplicationStageHistory;
