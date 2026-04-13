const Joi = require('joi');
const { marathiString } = require('../common');

const statusFields = {
  status_code: Joi.string().trim().min(2).max(50).required(),
  status_name: Joi.string().trim().min(2).max(150).required(),
  status_name_mr: marathiString(),
  description: Joi.string().trim().max(500).allow('', null),
  description_mr: marathiString(),
  display_order: Joi.number().integer().min(0).default(0),
  is_active: Joi.boolean().default(true)
};

const createApplicationStatus = Joi.object(statusFields);

const updateApplicationStatus = Joi.object({
  status_code: Joi.string().trim().min(2).max(50),
  status_name: Joi.string().trim().min(2).max(150),
  status_name_mr: marathiString(),
  description: Joi.string().trim().max(500).allow('', null),
  description_mr: marathiString(),
  display_order: Joi.number().integer().min(0),
  is_active: Joi.boolean()
}).min(1);

const applicationStatusIdParam = Joi.object({
  id: Joi.number().integer().positive().required()
});

module.exports = {
  createApplicationStatus,
  updateApplicationStatus,
  applicationStatusIdParam
};
