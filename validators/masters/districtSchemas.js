const Joi = require('joi');
const { marathiString } = require('../common');

// Base schema for district fields
const districtFields = {
  district_name: Joi.string().trim().min(2).max(100).required(),
  district_name_mr: marathiString(),
  is_active: Joi.boolean().default(true)
};

// Create schema: all required as defined above
const createDistrict = Joi.object(districtFields);

// Update schema: optional fields, but at least one key should be present
const updateDistrict = Joi.object({
  district_name: Joi.string().trim().min(2).max(100),
  district_name_mr: marathiString(),
  is_active: Joi.boolean()
}).min(1);

// Param schema for :id
const districtIdParam = Joi.object({
  id: Joi.number().integer().positive().required()
});

module.exports = {
  createDistrict,
  updateDistrict,
  districtIdParam
};
