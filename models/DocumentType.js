const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const DocumentType = sequelize.define('DocumentType', {
  doc_type_id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  doc_type_code: {
    type: DataTypes.STRING(50),
    allowNull: false,
    unique: true
  },
  doc_code: {
    type: DataTypes.STRING(50),
    allowNull: true
  },
  doc_type_name: {
    type: DataTypes.STRING(100),
    allowNull: false
  },
  doc_type_name_mr: {
    type: DataTypes.STRING(100),
    allowNull: true,
    comment: 'Document type name in Marathi'
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  description_mr: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  is_mandatory: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  is_mandatory_for_all: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  required_for_eligibility: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  check_against: {
    type: DataTypes.STRING(50),
    allowNull: true
  },
  field_linked_to: {
    type: DataTypes.STRING(50),
    allowNull: true
  },
  allowed_formats: {
    type: DataTypes.STRING(100),
    defaultValue: 'pdf,jpg,jpeg,png'
  },
  allowed_file_types: {
    type: DataTypes.STRING(100),
    allowNull: true
  },
  max_size_mb: {
    type: DataTypes.INTEGER,
    defaultValue: 2
  },
  max_file_size_mb: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  multiple_files_allowed: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  display_order: {
    type: DataTypes.INTEGER,
    defaultValue: 0
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
  }
}, {
  tableName: 'ms_document_types',
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

module.exports = DocumentType;
