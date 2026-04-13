const Joi = require('joi');
const { marathiString } = require('../common');

const componentFields = {
  component_code: Joi.string().trim().min(2).max(50).required(),
  component_name: Joi.string().trim().min(2).max(150).required(),
  component_name_mr: marathiString(),
  description: Joi.string().trim().max(500).allow('', null),
  description_mr: marathiString(),
  district_id: Joi.number().integer().positive().optional(),
  // Geofencing fields (optional for backward compatibility)
  latitude: Joi.number().min(-90).max(90).precision(8).allow(null),
  longitude: Joi.number().min(-180).max(180).precision(8).allow(null),
  geofence_radius_meters: Joi.number().integer().min(1).max(1000).allow(null),
  is_active: Joi.boolean().default(true)
};

const createComponent = Joi.object(componentFields);

const updateComponent = Joi.object({
  component_code: Joi.string().trim().min(2).max(50),
  component_name: Joi.string().trim().min(2).max(150),
  component_name_mr: marathiString(),
  description: Joi.string().trim().max(500).allow('', null),
  description_mr: marathiString(),
  district_id: Joi.number().integer().positive().allow(null),
  // Geofencing fields (optional for backward compatibility)
  latitude: Joi.number().min(-90).max(90).precision(8).allow(null),
  longitude: Joi.number().min(-180).max(180).precision(8).allow(null),
  geofence_radius_meters: Joi.number().integer().min(1).max(1000).allow(null),
  is_active: Joi.boolean()
}).min(1);

const componentIdParam = Joi.object({
  id: Joi.number().integer().positive().required()
});

module.exports = {
  createComponent,
  updateComponent,
  componentIdParam
};
