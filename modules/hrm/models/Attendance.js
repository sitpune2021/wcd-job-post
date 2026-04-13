const { DataTypes } = require('sequelize');
const sequelize = require('../../../config/db');

const Attendance = sequelize.define('HrmAttendance', {
  attendance_id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  employee_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: { model: 'ms_employee_master', key: 'employee_id' }
  },
  attendance_date: {
    type: DataTypes.DATEONLY,
    allowNull: false
  },
  check_in_time: {
    type: DataTypes.TIME,
    allowNull: true
  },
  status: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'PRESENT',
    validate: {
      isIn: [['PRESENT', 'ABSENT', 'HALF_DAY', 'ON_LEAVE', 'HOLIDAY', 'SUNDAY']]
    }
  },
  half_day_type: {
    type: DataTypes.STRING(15),
    allowNull: true,
    validate: {
      isIn: [['FIRST_HALF', 'SECOND_HALF']]
    }
  },
  ip_address: {
    type: DataTypes.STRING(45),
    allowNull: true
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
  attendance_image_path: {
    type: DataTypes.STRING(500),
    allowNull: true,
    comment: 'Path to attendance proof image'
  },
  attendance_image_name: {
    type: DataTypes.STRING(255),
    allowNull: true,
    comment: 'Original image file name'
  },
  attendance_image_size: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'Image file size in bytes'
  },
  device_type: {
    type: DataTypes.STRING(20),
    allowNull: true,
    comment: 'Device type used for marking attendance: mobile or desktop',
    validate: {
      isIn: [['mobile', 'desktop']]
    }
  },
  remarks: {
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
  tableName: 'ms_hrm_attendance',
  timestamps: false
});

module.exports = Attendance;
