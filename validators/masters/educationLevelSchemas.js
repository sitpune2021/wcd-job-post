const Joi = require('joi');
const { marathiString } = require('../common');

const educationLevelFields = {
  education_level: Joi.string().trim().min(2).max(150).optional(),
  level_code: Joi.string().trim().min(2).max(150).optional(),
  education_level_mr: marathiString(),
  description: Joi.string().trim().max(500).allow('', null),
  description_mr: marathiString(),
  display_order: Joi.number().integer().min(0).default(0),
  is_active: Joi.boolean().default(true)
};

const createEducationLevel = Joi.object(educationLevelFields).custom((value, helpers) => {
  if (!value.education_level && !value.level_code) {
    return helpers.error('custom.required', { message: 'Either education_level or level_code is required' });
  }
  return value;
});

const updateEducationLevel = Joi.object({
  education_level: Joi.string().trim().min(2).max(150),
  education_level_mr: marathiString(),
  description: Joi.string().trim().max(500).allow('', null),
  description_mr: marathiString(),
  display_order: Joi.number().integer().min(0),
  is_active: Joi.boolean()
}).min(1);

const educationLevelIdParam = Joi.object({
  id: Joi.number().integer().positive().required()
});

module.exports = {
  createEducationLevel,
  updateEducationLevel,
  educationLevelIdParam
};
