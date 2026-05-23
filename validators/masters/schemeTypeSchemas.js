const Joi = require('joi');

const createSchemeType = Joi.object({
  scheme_code: Joi.string().trim().min(2).max(20).uppercase().optional(),
  scheme_name: Joi.string().trim().min(2).max(100).required(),
  description: Joi.string().trim().max(500).allow('', null),
  is_active: Joi.boolean().default(true)
});

const updateSchemeType = Joi.object({
  scheme_code: Joi.string().trim().min(2).max(20).uppercase(),
  scheme_name: Joi.string().trim().min(2).max(100),
  description: Joi.string().trim().max(500).allow('', null),
  is_active: Joi.boolean()
}).min(1);

const schemeTypeIdParam = Joi.object({
  id: Joi.number().integer().positive().required()
});

module.exports = {
  createSchemeType,
  updateSchemeType,
  schemeTypeIdParam
};
