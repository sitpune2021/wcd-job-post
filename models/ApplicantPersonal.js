const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const calculateAge = (dob, asOf = new Date()) => {
  if (!dob) return null;

  let birthDate = dob;
  if (typeof dob === 'string') {
    const parts = dob.split('-').map(n => Number.parseInt(n, 10));
    if (parts.length === 3 && parts.every(n => Number.isFinite(n))) {
      birthDate = new Date(parts[0], parts[1] - 1, parts[2]);
    } else {
      birthDate = new Date(dob);
    }
  }

  if (!(birthDate instanceof Date) || Number.isNaN(birthDate.getTime())) return null;

  let age = asOf.getFullYear() - birthDate.getFullYear();
  const monthDiff = asOf.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && asOf.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
};

const ApplicantPersonal = sequelize.define('ApplicantPersonal', {
    personal_id: {
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
    full_name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    dob: {
      type: DataTypes.DATEONLY,
      allowNull: false
    },
    age: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    gender: {
      type: DataTypes.STRING,
      allowNull: false,
    
    },
    category: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'DEPRECATED: Use category_id instead. Kept for backward compatibility.',
      validate: {
        isIn: [['General', 'OBC', 'SC', 'ST', 'Other']]
      }
    },
    category_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'category_master',
        key: 'category_id'
      },
      comment: 'Foreign key to category_master table'
    },
    domicile_maharashtra: {
      type: DataTypes.BOOLEAN,
      allowNull: false
    },
    has_experience: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      comment: 'Applicant indicates whether they want to add experience (true=yes, false=no, null=not set)'
    },
    aadhar_no: {
      type: DataTypes.STRING,
      allowNull: true,
      validate: {
        is: /^\d{12}$/
      }
    },
    pan_no: {
      type: DataTypes.STRING,
      allowNull: true
    },
    father_name: {
      type: DataTypes.STRING,
      allowNull: true
    },
    mother_name: {
      type: DataTypes.STRING,
      allowNull: true
    },
    marital_status: {
      type: DataTypes.STRING,
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
    photo_path: {
      type: DataTypes.STRING(500),
      allowNull: true,
      comment: 'Path to applicant photo'
    },
    aadhaar_path: {
      type: DataTypes.STRING(500),
      allowNull: true,
      comment: 'Path to Aadhaar card document'
    },
    pan_path: {
      type: DataTypes.STRING(500),
      allowNull: true,
      comment: 'Path to PAN card document'
    },
    resume_path: {
      type: DataTypes.STRING(500),
      allowNull: true,
      comment: 'Path to resume/CV document'
    },
    domicile_path: {
      type: DataTypes.STRING(500),
      allowNull: true,
      comment: 'Path to domicile certificate document (if domicile_maharashtra = true)'
    },
    signature_path: {
      type: DataTypes.STRING(500),
      allowNull: true,
      comment: 'Path to applicant signature image'
    }
  }, {
    tableName: 'ms_applicant_personal',
    timestamps: false,
    hooks: {
      beforeCreate: (personal) => {
        // Calculate age based on DOB and application closing date
        if (personal.dob) {
          personal.age = calculateAge(personal.dob);
        }
      },
      beforeUpdate: (personal) => {
        // Recalculate age if DOB changes
        if (personal.changed('dob')) {
          personal.age = calculateAge(personal.dob);
        }
      }
    }
  });

module.exports = ApplicantPersonal;
