const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const ApplicantEducation = sequelize.define('ApplicantEducation', {
  education_id: {
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
  education_level_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'education_levels',
      key: 'level_id'
    },
    comment: 'FK to education_levels master'
  },
  stream_subject: {
    type: DataTypes.STRING(100),
    allowNull: true,
    comment: 'Stream/Subject for this qualification'
  },
  qualification_level: {
    type: DataTypes.STRING(50),
    allowNull: true,
    comment: 'Legacy field - use education_level_id instead'
  },
  degree_name: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  specialization: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  university_board: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  seatnumber: {
    type: DataTypes.STRING(50),
    allowNull: true,
    field: 'seatnumber',
    comment: 'Seat number or roll number'
  },
  passing_year: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  percentage: {
    type: DataTypes.DECIMAL(5, 2),
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
  certificate_path: {
    type: DataTypes.STRING(500),
    allowNull: true,
    comment: 'Path to education certificate/marksheet'
  },
  is_deleted: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  deleted_at: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  tableName: 'ms_applicant_education',
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

// Instance method to get total months of education
ApplicantEducation.prototype.getEducationLevel = async function () {
  if (this.education_level_id) {
    const EducationLevel = require('./EducationLevel');
    return await EducationLevel.findByPk(this.education_level_id);
  }
  return null;
};

module.exports = ApplicantEducation;
