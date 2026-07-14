const express = require('express');
const Joi = require('joi');
const { requireAppEmployee } = require('../middleware/appAuth');
const appEmployeeService = require('../services/appEmployeeService');
const ApiResponse = require('../../../utils/ApiResponse');

const router = express.Router();

const querySchema = Joi.object({
  status: Joi.string().valid('PENDING', 'CLAIMED', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED'),
  month: Joi.number().integer().min(1).max(12)
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

router.post('/:claimId/claim', requireAppEmployee, async (req, res, next) => {
  try {
    const claimId = parseInt(req.params.claimId, 10);
    if (!Number.isInteger(claimId) || claimId <= 0) {
      return res.status(400).json({ success: false, message: 'Valid claim id is required' });
    }

    const value = validate(claimSchema, req.body);
    const claim = await appEmployeeService.claimWeeklyOff(req.user, claimId, value.claimed_off_date);
    return ApiResponse.success(res, claim, 'Weekly off claim submitted successfully');
  } catch (error) {
    next(error);
  }
});

module.exports = router;
