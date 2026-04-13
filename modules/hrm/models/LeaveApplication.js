const { DataTypes } = require('sequelize');
const sequelize = require('../../../config/db');

const LeaveApplication = sequelize.define('HrmLeaveApplication', {
  leave_id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  employee_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'ms_employee_master', key: 'employee_id' }
  },
  leave_type_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'ms_hrm_leave_types', key: 'leave_type_id' }
  },
  from_date: {
    type: DataTypes.DATEONLY,
    allowNull: false
  },
  to_date: {
    type: DataTypes.DATEONLY,
    allowNull: false
  },
  total_days: {
    type: DataTypes.DECIMAL(3, 1),
    allowNull: false,
    defaultValue: 1
  },
  is_half_day: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  half_day_type: {
    type: DataTypes.STRING(15),
    allowNull: true,
    validate: {
      isIn: [['FIRST_HALF', 'SECOND_HALF']]
    }
  },
  reason: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  supporting_document_path: {
    type: DataTypes.STRING(500),
    allowNull: true
  },
  status: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'PENDING',
    validate: {
      isIn: [['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']]
    }
  },
  approved_by: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: { model: 'ms_admin_users', key: 'admin_id' }
  },
  approved_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  rejection_reason: {
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
  tableName: 'ms_hrm_leave_applications',
  timestamps: false
});

module.exports = LeaveApplication;
