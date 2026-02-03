const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const ApplicantSkill = sequelize.define('ApplicantSkill', {
  applicant_skill_id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  applicant_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'applicant_master',
      key: 'applicant_id'
    }
  },
  skill_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'ms_skill_master',
      key: 'skill_id'
    },
    comment: 'FK to ms_skill_master'
  },
  notes: {
    type: DataTypes.TEXT,
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
  is_deleted: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  deleted_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  certificate_path: {
    type: DataTypes.STRING(500),
    allowNull: true,
    comment: 'Optional skill certificate/image path (future)'
  }
}, {
  tableName: 'ms_applicant_skills',
  timestamps: false,
  defaultScope: {
    where: {
      is_deleted: false
    }
  },
  scopes: {
    withDeleted: {}
  }
});

module.exports = ApplicantSkill;
