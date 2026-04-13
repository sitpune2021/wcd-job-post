const Joi = require('joi');
const { marathiString } = require('../common');

const experienceDomainFields = {
  domain_name: Joi.string().trim().min(2).max(150).required(),
  domain_name_mr: marathiString(),
  description: Joi.string().trim().max(500).allow('', null),
  description_mr: marathiString(),
  is_active: Joi.boolean().default(true)
};

const createExperienceDomain = Joi.object(experienceDomainFields);

const updateExperienceDomain = Joi.object({
  domain_name: Joi.string().trim().min(2).max(150),
  domain_name_mr: marathiString(),
  description: Joi.string().trim().max(500).allow('', null),
  description_mr: marathiString(),
  is_active: Joi.boolean()
}).min(1);

const experienceDomainIdParam = Joi.object({
  id: Joi.number().integer().positive().required()
});

module.exports = {
  createExperienceDomain,
  updateExperienceDomain,
  experienceDomainIdParam
};
