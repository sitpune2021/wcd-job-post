const Joi = require('joi');

const submitReport = Joi.object({
  report_month: Joi.number().integer().min(1).max(12).required(),
  report_year: Joi.number().integer().min(2020).max(2100).required(),
  work_category: Joi.string().max(100).allow('', null),
  nature_of_work: Joi.string().min(5).max(2000).required(),
  beneficiaries_reached: Joi.number().integer().min(0).default(0),
  field_visits_conducted: Joi.number().integer().min(0).default(0),
  key_achievements: Joi.string().max(2000).allow('', null),
  challenges_faced: Joi.string().max(2000).allow('', null),
  improvement_plan: Joi.string().max(2000).allow('', null)
});

const reviewReport = Joi.object({
  status: Joi.string().valid('APPROVED', 'REJECTED').required(),
  appraiser_remarks: Joi.string().max(1000).when('status', {
    is: 'REJECTED',
    then: Joi.required(),
    otherwise: Joi.allow('', null)
  })
});

const reportQuery = Joi.object({
  status: Joi.string().valid('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'),
  month: Joi.number().integer().min(1).max(12),
  year: Joi.number().integer().min(2020).max(2100),
  employee_id: Joi.number().integer().min(1),
  district_id: Joi.number().integer().min(1),
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100)
});

module.exports = {
  submitReportSchema: submitReport,
  reviewReportSchema: reviewReport,
  reportQuerySchema: reportQuery
};
