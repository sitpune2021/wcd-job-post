const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const DocumentVerification = sequelize.define('DocumentVerification', {
  verification_id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  application_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'ms_applications',
      key: 'application_id'
    },
    comment: 'Application being verified'
  },
  document_type: {
    type: DataTypes.STRING(100),
    allowNull: false,
    comment: 'Type of document: PHOTO, AADHAAR, PAN, RESUME, DOMICILE, SIGNATURE, EDUCATION_CERT, EXPERIENCE_CERT'
  },
  document_reference_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'Reference ID for education_id or experience_id if applicable'
  },
  document_path: {
    type: DataTypes.STRING(500),
    allowNull: true,
    comment: 'Path to the document being verified'
  },
  verification_status: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'PENDING',
    comment: 'PENDING, VERIFIED, REJECTED'
  },
  verified_by: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'ms_admin_users',
      key: 'admin_id'
    },
    comment: 'Admin who verified the document'
  },
  verified_at: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'Timestamp when document was verified'
  },
  remarks: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Optional remarks about verification'
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
  tableName: 'ms_document_verifications',
  timestamps: false,
  indexes: [
    {
      fields: ['application_id']
    },
    {
      fields: ['verification_status']
    },
    {
      fields: ['verified_by']
    }
  ]
});

module.exports = DocumentVerification;
