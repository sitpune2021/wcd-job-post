const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const Hub = sequelize.define('Hub', {
  hub_id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  hub_code: {
    type: DataTypes.STRING(50),
    allowNull: false,
    unique: true
  },
  hub_name: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  hub_name_mr: {
    type: DataTypes.STRING(255),
    allowNull: true,
    comment: 'Hub name in Marathi'
  },
  district_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'ms_district_master',
      key: 'district_id'
    },
    comment: 'Linked district for Hub'
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  description_mr: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Description in Marathi'
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  is_deleted: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
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
  tableName: 'ms_hub_master',
  timestamps: false,
  defaultScope: {
    where: { is_deleted: false }
  },
  scopes: {
    withDeleted: {
      where: {}
    }
  }
});

module.exports = Hub;
