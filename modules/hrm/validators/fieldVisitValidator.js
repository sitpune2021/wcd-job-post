const Joi = require('joi');

const logFieldVisit = Joi.object({
  visit_date: Joi.date().iso().required(),
  location: Joi.string().min(3).max(500).required(),
  purpose: Joi.string().min(3).max(1000).required(),
  observations: Joi.string().max(2000).allow('', null),
  beneficiaries_count: Joi.number().integer().min(0).default(0),
  latitude: Joi.number().min(-90).max(90).allow(null),
  longitude: Joi.number().min(-180).max(180).allow(null),
  geo_address: Joi.string().max(500).allow('', null)
});

const reviewFieldVisit = Joi.object({
  status: Joi.string().valid('APPROVED', 'REJECTED').required(),
  reviewer_remarks: Joi.string().max(1000).when('status', {
    is: 'REJECTED',
    then: Joi.required(),
    otherwise: Joi.allow('', null)
  })
});

const fieldVisitQuery = Joi.object({
  status: Joi.string().valid('SUBMITTED', 'REVIEWED', 'APPROVED', 'REJECTED'),
  month: Joi.number().integer().min(1).max(12),
  year: Joi.number().integer().min(2020).max(2100),
  employee_id: Joi.number().integer().min(1),
  district_id: Joi.number().integer().min(1),
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100)
});

module.exports = {
  logFieldVisitSchema: logFieldVisit,
  reviewFieldVisitSchema: reviewFieldVisit,
  fieldVisitQuerySchema: fieldVisitQuery
};
