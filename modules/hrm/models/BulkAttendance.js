const { DataTypes } = require('sequelize');
const sequelize = require('../../../config/db');

const BulkAttendance = sequelize.define('BulkAttendance', {
  bulk_id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  bulk_no: {
    type: DataTypes.STRING(50),
    allowNull: false,
    unique: true,
    comment: 'Unique bulk identifier (e.g., ATT-2026-04-0001)'
  },
  uploaded_by: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'ms_admin_users',
      key: 'admin_id'
    },
    comment: 'Admin who uploaded the bulk attendance'
  },
  upload_date: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    comment: 'Date for which attendance is being uploaded'
  },
  month: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'Month (1-12)'
  },
  year: {
    type: DataTypes.INTEGER,
    allowNull: false,
    comment: 'Year'
  },
  total_records: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    comment: 'Total number of attendance records'
  },
  pending_records: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    comment: 'Number of records pending approval'
  },
  approved_records: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    comment: 'Number of approved records'
  },
  rejected_records: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
    comment: 'Number of rejected records'
  },
  status: {
    type: DataTypes.ENUM('PENDING', 'PARTIALLY_APPROVED', 'APPROVED', 'REJECTED'),
    allowNull: false,
    defaultValue: 'PENDING',
    comment: 'Overall bulk status'
  },
  file_path: {
    type: DataTypes.STRING(500),
    allowNull: true,
    comment: 'Path to uploaded Excel file'
  },
  remarks: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Any remarks from uploader'
  },
  approved_by: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'ms_admin_users',
      key: 'admin_id'
    },
    comment: 'Admin who approved this bulk'
  },
  approved_at: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'When bulk was approved'
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
  }
}, {
  tableName: 'ms_hrm_bulk_attendance',
  timestamps: false,
  indexes: [
    {
      fields: ['uploaded_by', 'status']
    },
    {
      fields: ['upload_date', 'status']
    },
    {
      fields: ['month', 'year']
    }
  ]
});

module.exports = BulkAttendance;
