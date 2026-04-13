const { DataTypes } = require('sequelize');
const sequelize = require('../../../config/db');

const FieldVisit = sequelize.define('HrmFieldVisit', {
  visit_id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  employee_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'ms_employee_master', key: 'employee_id' }
  },
  visit_date: {
    type: DataTypes.DATEONLY,
    allowNull: false
  },
  location: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  purpose: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  observations: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  beneficiaries_count: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: 0
  },
  latitude: {
    type: DataTypes.DECIMAL(10, 6),
    allowNull: true
  },
  longitude: {
    type: DataTypes.DECIMAL(10, 6),
    allowNull: true
  },
  geo_address: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  photo_paths: {
    type: DataTypes.JSONB,
    allowNull: true,
    defaultValue: []
  },
  status: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'SUBMITTED',
    validate: {
      isIn: [['SUBMITTED', 'REVIEWED', 'APPROVED', 'REJECTED']]
    }
  },
  reviewed_by: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'ms_admin_users', key: 'admin_id' }
  },
  reviewed_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  reviewer_remarks: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  is_deleted: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  updated_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  created_by: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  updated_by: {
    type: DataTypes.INTEGER,
    allowNull: true
  }
}, {
  tableName: 'ms_hrm_field_visits',
  timestamps: false
});

module.exports = FieldVisit;
