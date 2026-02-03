const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const ApplicantDocument = sequelize.define('ApplicantDocument', {
  document_id: {
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
  doc_type_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'document_types',
      key: 'doc_type_id'
    },
    comment: 'FK to document_types master'
  },
  doc_type: {
    type: DataTypes.STRING(50),
    allowNull: false
  },
  file_path: {
    type: DataTypes.STRING(500),
    allowNull: false
  },
  original_name: {
    type: DataTypes.STRING(255),
    allowNull: true
  },
  file_size: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  mime_type: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  is_verified: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  verified_by: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  verified_at: {
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
  tableName: 'ms_applicant_documents',
  timestamps: false
});

module.exports = ApplicantDocument;
