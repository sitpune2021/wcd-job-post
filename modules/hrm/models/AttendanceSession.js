const { DataTypes } = require('sequelize');
const sequelize = require('../../../config/db');

const AttendanceSession = sequelize.define('HrmAttendanceSession', {
  session_id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  attendance_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'ms_hrm_attendance',
      key: 'attendance_id'
    }
  },
  check_in_time: {
    type: DataTypes.TIME,
    allowNull: false
  },
  check_out_time: {
    type: DataTypes.TIME,
    allowNull: true
  },
  check_in_photo_path: {
    type: DataTypes.STRING(500),
    allowNull: true
  },
  check_out_photo_path: {
    type: DataTypes.STRING(500),
    allowNull: true
  },
  duration_hours: {
    type: DataTypes.DECIMAL(4, 2),
    allowNull: true
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
  tableName: 'ms_hrm_attendance_sessions',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at'
});

module.exports = AttendanceSession;
