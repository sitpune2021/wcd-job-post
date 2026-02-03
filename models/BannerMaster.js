const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const BannerMaster = sequelize.define('BannerMaster', {
  banner_id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  banner_image_path: {
    type: DataTypes.STRING(500),
    allowNull: false,
    comment: 'Path to the English banner image file'
  },
  banner_image_path_mr: {
    type: DataTypes.STRING(500),
    allowNull: true,
    comment: 'Path to the Marathi banner image file (optional)'
  },
  display_order: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: 'Order in which banner should be displayed'
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
  tableName: 'ms_banner_master',
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

module.exports = BannerMaster;
