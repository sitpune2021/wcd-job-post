const Joi = require('joi');
const { marathiString } = require('../common');

const hubFields = {
  hub_code: Joi.string().trim().min(2).max(50).required(),
  hub_name: Joi.string().trim().min(2).max(150).required(),
  hub_name_mr: marathiString(),
  district_id: Joi.number().integer().positive().required(),
  // Geofencing fields (optional for backward compatibility)
  latitude: Joi.number().min(-90).max(90).precision(8).allow(null),
  longitude: Joi.number().min(-180).max(180).precision(8).allow(null),
  geofence_radius_meters: Joi.number().integer().min(1).max(1000).allow(null),
  is_active: Joi.boolean().default(true)
};

const createHub = Joi.object(hubFields);

const updateHub = Joi.object({
  hub_code: Joi.string().trim().min(2).max(50),
  hub_name: Joi.string().trim().min(2).max(150),
  hub_name_mr: marathiString(),
  district_id: Joi.number().integer().positive(),
  // Geofencing fields (optional for backward compatibility)
  latitude: Joi.number().min(-90).max(90).precision(8).allow(null),
  longitude: Joi.number().min(-180).max(180).precision(8).allow(null),
  geofence_radius_meters: Joi.number().integer().min(1).max(1000).allow(null),
  is_active: Joi.boolean()
}).min(1);

const hubIdParam = Joi.object({
  id: Joi.number().integer().positive().required()
});

module.exports = {
  createHub,
  updateHub,
  hubIdParam
};
