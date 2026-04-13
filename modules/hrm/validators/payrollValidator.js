const Joi = require('joi');

const generatePayrollSchema = Joi.object({
  month: Joi.number().integer().min(1).max(12).required(),
  year: Joi.number().integer().min(2020).max(2100).required(),
  payment_date: Joi.date().optional().allow(null)
});

const payrollQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).optional(),
  limit: Joi.number().integer().min(1).max(100).optional(),
  status: Joi.string().valid('DRAFT', 'GENERATED', 'APPROVED', 'PAID', 'CANCELLED').optional(),
  year: Joi.number().integer().min(2020).max(2100).optional(),
  month: Joi.number().integer().min(1).max(12).optional(),
  employee_id: Joi.number().integer().optional()
});

module.exports = {
  generatePayrollSchema,
  payrollQuerySchema
};
