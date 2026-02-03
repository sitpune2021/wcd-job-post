const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const ApplicantAcknowledgement = sequelize.define('ApplicantAcknowledgement', {
  acknowledgement_id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  applicant_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'ms_applicant_master',
      key: 'applicant_id'
    }
  },
  application_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'ms_applications',
      key: 'application_id'
    }
  },
  action_type: {
    type: DataTypes.STRING(50),
    allowNull: false,
    comment: 'Action type: GUIDELINES_DECLARATION (post-login), PROFILE_DECLARATION (during profile), APPLICATION_DECLARATION (application submit)'
  },
  checkbox_code: {
    type: DataTypes.STRING(100),
    allowNull: false,
    comment: 'Unique code for the checkbox: DECLARATION_ACCURACY, TERMS_ACCEPTED, etc.'
  },
  checkbox_label: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'The actual text of the checkbox shown to user'
  },
  accepted_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  ip_address: {
    type: DataTypes.STRING(45),
    allowNull: true
  },
  user_agent: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  place: {
    type: DataTypes.STRING(255),
    allowNull: true,
    comment: 'Location/place where the declaration was accepted and application was submitted'
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'ms_applicant_acknowledgements',
  timestamps: false,
  indexes: [
    { fields: ['applicant_id'] },
    { fields: ['application_id'] },
    { fields: ['action_type'] }
  ]
});

module.exports = ApplicantAcknowledgement;
