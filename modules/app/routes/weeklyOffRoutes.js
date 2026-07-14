const express = require('express');
const Joi = require('joi');
const { requireAppEmployee } = require('../middleware/appAuth');
const appEmployeeService = require('../services/appEmployeeService');
const ApiResponse = require('../../../utils/ApiResponse');

const router = express.Router();

const querySchema = Joi.object({
  status: Joi.string().valid('PENDING', 'APPROVED', 'EXPIRED', 'USED'),
  month: Joi.number().integer().min(1).max(12),
  year: Joi.number().integer().min(2020).max(2100).default(new Date().getFullYear())
});

const claimSchema = Joi.object({
  claimed_off_date: Joi.date().iso().required()
});

const validate = (schema, input) => {
  const { error, value } = schema.validate(input, { stripUnknown: true });
  if (error) {
    const err = new Error(error.details[0].message);
    err.statusCode = 400;
    err.isClientError = true;
    throw err;
  }
  return value;
};

router.get('/', requireAppEmployee, async (req, res, next) => {
  try {
    const query = validate(querySchema, req.query);
    const claims = await appEmployeeService.getWeeklyOffs(req.user, query);
    return ApiResponse.success(res, claims, 'Weekly off claims retrieved successfully');
  } catch (error) {
    next(error);
  }
});

router.post('/claim', requireAppEmployee, async (req, res, next) => {
  try {
    const value = validate(claimSchema, req.body);
    const claim = await appEmployeeService.claimWeeklyOffForDate(req.user, value.claimed_off_date);
    return ApiResponse.success(res, claim, 'Weekly off claim submitted successfully');
  } catch (error) {
    next(error);
  }
});

module.exports = router;
