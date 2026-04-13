const Joi = require('joi');
const { marathiString } = require('../common');

const departmentFields = {
  department_name: Joi.string().trim().min(2).max(150).required(),
  department_name_mr: marathiString(),
  description: Joi.string().trim().max(500).allow('', null),
  description_mr: marathiString(),
  is_active: Joi.boolean().default(true)
};

const createDepartment = Joi.object(departmentFields);

const updateDepartment = Joi.object({
  department_name: Joi.string().trim().min(2).max(150),
  department_name_mr: marathiString(),
  description: Joi.string().trim().max(500).allow('', null),
  description_mr: marathiString(),
  is_active: Joi.boolean()
}).min(1);

const departmentIdParam = Joi.object({
  id: Joi.number().integer().positive().required()
});

module.exports = {
  createDepartment,
  updateDepartment,
  departmentIdParam
};
