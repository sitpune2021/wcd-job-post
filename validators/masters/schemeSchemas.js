const Joi = require('joi');
const { marathiString } = require('../common');

const schemeFields = {
  scheme_code: Joi.string().trim().min(2).max(50).required(),
  scheme_name: Joi.string().trim().min(2).max(200).required(),
  scheme_name_mr: marathiString(),
  scheme_type_id: Joi.number().integer().positive().required(),
  description: Joi.string().trim().max(1000).allow('', null),
  description_mr: marathiString(),
  district_id: Joi.number().integer().positive().allow(null),
  latitude: Joi.number().min(-90).max(90).precision(8).allow(null),
  longitude: Joi.number().min(-180).max(180).precision(8).allow(null),
  geofence_radius_meters: Joi.number().integer().min(0).allow(null),
  is_active: Joi.boolean().default(true)
};

const createScheme = Joi.object(schemeFields);

const updateScheme = Joi.object({
  scheme_code: Joi.string().trim().min(2).max(50),
  scheme_name: Joi.string().trim().min(2).max(200),
  scheme_name_mr: marathiString(),
  scheme_type_id: Joi.number().integer().positive(),
  description: Joi.string().trim().max(1000).allow('', null),
  description_mr: marathiString(),
  district_id: Joi.number().integer().positive().allow(null),
  latitude: Joi.number().min(-90).max(90).precision(8).allow(null),
  longitude: Joi.number().min(-180).max(180).precision(8).allow(null),
  geofence_radius_meters: Joi.number().integer().min(0).allow(null),
  is_active: Joi.boolean()
}).min(1);

const schemeIdParam = Joi.object({
  id: Joi.number().integer().positive().required()
});

module.exports = {
  createScheme,
  updateScheme,
  schemeIdParam
};
