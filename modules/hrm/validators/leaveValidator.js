const Joi = require('joi');

const applyLeave = Joi.object({
  leave_type_id: Joi.number().integer().required(),
  from_date: Joi.date().iso().required(),
  to_date: Joi.date().iso().min(Joi.ref('from_date')).required(),
  is_half_day: Joi.boolean().default(false),
  half_day_type: Joi.string().valid('FIRST_HALF', 'SECOND_HALF').when('is_half_day', {
    is: true,
    then: Joi.required(),
    otherwise: Joi.allow(null)
  }),
  reason: Joi.string().min(3).max(500).required(),
  supporting_document: Joi.string().max(500).optional().allow(null, '')
});

const leaveAction = Joi.object({
  status: Joi.string().valid('APPROVED', 'REJECTED').required(),
  rejection_reason: Joi.string().max(500).when('status', {
    is: 'REJECTED',
    then: Joi.required(),
    otherwise: Joi.allow('', null)
  })
});

const leaveQuery = Joi.object({
  status: Joi.string().valid('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'),
  month: Joi.number().integer().min(1).max(12),
  year: Joi.number().integer().min(2020).max(2100),
  employee_id: Joi.number().integer().min(1),
  district_id: Joi.number().integer().min(1),
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100)
});

module.exports = {
  applyLeaveSchema: applyLeave,
  leaveActionSchema: leaveAction,
  leaveQuerySchema: leaveQuery
};
