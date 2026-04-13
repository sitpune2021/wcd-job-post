const Joi = require('joi');
const { marathiString } = require('../common');

const documentTypeFields = {
  doc_type_code: Joi.string().trim().min(2).max(50).required(),
  doc_code: Joi.string().trim().max(50).allow('', null),
  doc_type_name: Joi.string().trim().min(2).max(150).required(),
  doc_type_name_mr: marathiString(),
  description: Joi.string().trim().max(500).allow('', null),
  description_mr: marathiString(),
  is_mandatory: Joi.boolean().default(false),
  is_mandatory_for_all: Joi.boolean().default(false),
  required_for_eligibility: Joi.boolean().default(false),
  allowed_formats: Joi.string().trim().max(200).allow('', null),
  allowed_file_types: Joi.string().trim().max(200).allow('', null),
  max_size_mb: Joi.number().integer().positive().max(500).default(2),
  max_file_size_mb: Joi.number().integer().positive().max(500).allow(null),
  multiple_files_allowed: Joi.boolean().default(false),
  display_order: Joi.number().integer().min(0).default(0),
  is_active: Joi.boolean().default(true)
};

const createDocumentType = Joi.object(documentTypeFields);

const updateDocumentType = Joi.object({
  doc_type_code: Joi.string().trim().min(2).max(50),
  doc_code: Joi.string().trim().max(50).allow('', null),
  doc_type_name: Joi.string().trim().min(2).max(150),
  doc_type_name_mr: marathiString(),
  description: Joi.string().trim().max(500).allow('', null),
  description_mr: marathiString(),
  is_mandatory: Joi.boolean(),
  is_mandatory_for_all: Joi.boolean(),
  required_for_eligibility: Joi.boolean(),
  allowed_formats: Joi.string().trim().max(200).allow('', null),
  allowed_file_types: Joi.string().trim().max(200).allow('', null),
  max_size_mb: Joi.number().integer().positive().max(500),
  max_file_size_mb: Joi.number().integer().positive().max(500).allow(null),
  multiple_files_allowed: Joi.boolean(),
  display_order: Joi.number().integer().min(0),
  is_active: Joi.boolean()
}).min(1);

const documentTypeIdParam = Joi.object({
  id: Joi.number().integer().positive().required()
});

module.exports = {
  createDocumentType,
  updateDocumentType,
  documentTypeIdParam
};
