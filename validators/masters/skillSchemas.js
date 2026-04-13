const Joi = require('joi');
const { marathiString } = require('../common');

const skillFields = {
  skill_name: Joi.string().trim().min(2).max(150).required(),
  skill_name_mr: marathiString(),
  description: Joi.string().trim().max(500).allow('', null),
  description_mr: marathiString(),
  is_active: Joi.boolean().default(true)
};

const createSkill = Joi.object(skillFields);

const updateSkill = Joi.object({
  skill_name: Joi.string().trim().min(2).max(150),
  skill_name_mr: marathiString(),
  description: Joi.string().trim().max(500).allow('', null),
  description_mr: marathiString(),
  is_active: Joi.boolean()
}).min(1);

const skillIdParam = Joi.object({
  id: Joi.number().integer().positive().required()
});

module.exports = {
  createSkill,
  updateSkill,
  skillIdParam
};
