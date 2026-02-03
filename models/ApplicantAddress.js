const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const ApplicantAddress = sequelize.define('ApplicantAddress', {
  address_id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  applicant_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'applicant_master',
      key: 'applicant_id'
    }
  },
  address_line: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  address_line2: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  district_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'district_master',
      key: 'district_id'
    }
  },
  taluka_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'taluka_master',
      key: 'taluka_id'
    }
  },
  pincode: {
    type: DataTypes.STRING(10),
    allowNull: true
  },
  permanent_address_same: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  permanent_address_line: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  permanent_address_line2: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  permanent_district_id: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  permanent_taluka_id: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  permanent_pincode: {
    type: DataTypes.STRING(10),
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
  tableName: 'ms_applicant_address',
  timestamps: false
});

module.exports = ApplicantAddress;
