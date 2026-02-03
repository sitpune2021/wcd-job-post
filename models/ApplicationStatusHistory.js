const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const ApplicationStatusHistory = sequelize.define('ApplicationStatusHistory', {
  history_id: {
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
    }
  },
  old_status: {
    type: DataTypes.STRING(30),
    allowNull: true
  },
  new_status: {
    type: DataTypes.STRING(30),
    allowNull: false
  },
  changed_by: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'ms_admin_users',
      key: 'admin_id'
    }
  },
  changed_by_type: {
    type: DataTypes.STRING(20),
    defaultValue: 'SYSTEM',
    allowNull: false,
    validate: {
      isIn: [['SYSTEM', 'ADMIN', 'APPLICANT']]
    }
  },
  remarks: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  metadata: {
    type: DataTypes.JSONB,
    allowNull: true
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'ms_application_status_history',
  timestamps: false
});

module.exports = ApplicationStatusHistory;
