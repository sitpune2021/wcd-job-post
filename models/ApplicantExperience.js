const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const ApplicantExperience = sequelize.define('ApplicantExperience', {
  experience_id: {
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
  organization_name: {
    type: DataTypes.STRING(200),
    allowNull: true
  },
  designation: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  domain_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'experience_domains',
      key: 'id'
    },
    comment: 'FK to experience_domains master'
  },
  work_domain: {
    type: DataTypes.STRING(100),
    allowNull: true,
    comment: 'Legacy field - use domain_id instead'
  },
  employer_type: {
    type: DataTypes.STRING(50),
    allowNull: true,
    comment: 'Government/Private/NGO/Self-employed'
  },
  is_relevant_for_eligibility: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    comment: 'Whether this experience counts for eligibility'
  },
  total_months: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'Auto-calculated total months'
  },
  start_date: {
    type: DataTypes.DATEONLY,
    allowNull: true
  },
  end_date: {
    type: DataTypes.DATEONLY,
    allowNull: true
  },
  is_current: {
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
  certificate_path: {
    type: DataTypes.STRING(500),
    allowNull: true,
    comment: 'Path to experience certificate/letter'
  },
  offer_letter_path: {
    type: DataTypes.STRING(500),
    allowNull: true,
    comment: 'Path to offer letter document'
  },
  salary_slip_path: {
    type: DataTypes.STRING(500),
    allowNull: true,
    comment: 'Path to salary slip document'
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
  tableName: 'ms_applicant_experience',
  timestamps: false,
  defaultScope: {
    where: {
      is_deleted: false
    }
  },
  scopes: {
    withDeleted: {},
    relevant: {
      where: {
        is_relevant_for_eligibility: true,
        is_deleted: false
      }
    }
  },
  hooks: {
    beforeSave: (experience) => {
      // Auto-calculate total months
      if (!experience.start_date) {
        return;
      }

      // Normalize dates to JS Date instances (Sequelize DATEONLY can be string)
      const startDate = new Date(experience.start_date);

      let endDate;
      if (experience.is_current || !experience.end_date) {
        endDate = new Date();
      } else {
        endDate = new Date(experience.end_date);
      }

      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        // Invalid dates; don't set total_months
        return;
      }

      const months = (endDate.getFullYear() - startDate.getFullYear()) * 12 +
        (endDate.getMonth() - startDate.getMonth());
      experience.total_months = Math.max(0, months);
    }
  }
});

// Instance method to get domain details
ApplicantExperience.prototype.getDomain = async function () {
  if (this.domain_id) {
    const ExperienceDomain = require('./ExperienceDomain');
    return await ExperienceDomain.findByPk(this.domain_id);
  }
  return null;
};

module.exports = ApplicantExperience;
