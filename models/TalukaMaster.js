const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const TalukaMaster = sequelize.define('TalukaMaster', {
  taluka_id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  taluka_name: {
    type: DataTypes.STRING(100),
    allowNull: false
  },
  taluka_name_mr: {
    type: DataTypes.STRING(255),
    allowNull: true,
    comment: 'Taluka name in Marathi'
  },
  district_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'district_master',
      key: 'district_id'
    }
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  is_deleted: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  created_by: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  updated_by: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  deleted_by: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  deleted_at: {
    type: DataTypes.DATE,
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
  tableName: 'ms_taluka_master',
  timestamps: false,
  defaultScope: {
    where: { is_deleted: false }
  },
  scopes: {
    withDeleted: {},
    onlyActive: {
      where: { is_deleted: false, is_active: true }
    }
  }
});

module.exports = TalukaMaster;
