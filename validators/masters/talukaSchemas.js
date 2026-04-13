const Joi = require('joi');
const { marathiString } = require('../common');

const talukaFields = {
  taluka_name: Joi.string().trim().min(2).max(100).required(),
  taluka_name_mr: marathiString(),
  district_id: Joi.number().integer().positive().required(),
  is_active: Joi.boolean().default(true)
};

const createTaluka = Joi.object(talukaFields);

const updateTaluka = Joi.object({
  taluka_name: Joi.string().trim().min(2).max(100),
  taluka_name_mr: marathiString(),
  district_id: Joi.number().integer().positive(),
  is_active: Joi.boolean()
}).min(1);

const talukaIdParam = Joi.object({
  id: Joi.number().integer().positive().required()
});

module.exports = {
  createTaluka,
  updateTaluka,
  talukaIdParam
};
