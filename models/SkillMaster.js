const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const SkillMaster = sequelize.define('SkillMaster', {
  skill_id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  skill_name: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  skill_name_mr: {
    type: DataTypes.STRING(255),
    allowNull: true,
    comment: 'Skill name in Marathi'
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  description_mr: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Skill description in Marathi'
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
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  updated_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  deleted_at: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  tableName: 'ms_skill_master',
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

module.exports = SkillMaster;
