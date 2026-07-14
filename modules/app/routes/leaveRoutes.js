const express = require('express');
const Joi = require('joi');
const { requireAppEmployee } = require('../middleware/appAuth');
const appEmployeeService = require('../services/appEmployeeService');
const { applyLeaveSchema, leaveQuerySchema } = require('../../hrm/validators');
const db = require('../../../models');
const ApiResponse = require('../../../utils/ApiResponse');
const logger = require('../../../config/logger');
const { uploadHrmFile, getRelativePath } = require('../../../utils/fileUpload');

const router = express.Router();

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

const leaveDatesSchema = Joi.object({
  month: Joi.number().integer().min(1).max(12).default(new Date().getMonth() + 1),
  year: Joi.number().integer().min(2020).max(2100).default(new Date().getFullYear())
});

const prepareLeaveUpload = async (req, res, next) => {
  try {
    const employee = await db.EmployeeMaster.findOne({
      where: {
        applicant_id: req.user.applicant_id,
        is_deleted: false,
        is_active: true
      },
      attributes: ['employee_id', 'employee_code', 'applicant_id']
    });

    if (!employee) {
      return res.status(404).json({ success: false, message: 'Employee record not found' });
    }

    req.employee = employee;
    return uploadHrmFile('file', 'leave')(req, res, next);
  } catch (error) {
    next(error);
  }
};

router.get('/types', requireAppEmployee, async (req, res, next) => {
  try {
    const types = await appEmployeeService.getLeaveTypes();
    return ApiResponse.success(res, types, 'Leave types retrieved successfully');
  } catch (error) {
    next(error);
  }
});

router.get('/balance', requireAppEmployee, async (req, res, next) => {
  try {
    const balances = await appEmployeeService.getLeaveBalances(req.user);
    return ApiResponse.success(res, balances, 'Leave balance retrieved successfully');
  } catch (error) {
    next(error);
  }
});

router.get('/dates', requireAppEmployee, async (req, res, next) => {
  try {
    const value = validate(leaveDatesSchema, req.query);
    const dates = await appEmployeeService.getLeaveDatesForMonth(req.user, value.month, value.year);
    return ApiResponse.success(res, dates, 'Leave dates retrieved successfully');
  } catch (error) {
    next(error);
  }
});

router.get('/', requireAppEmployee, async (req, res, next) => {
  try {
    const query = validate(leaveQuerySchema, req.query);
    const leaves = await appEmployeeService.getLeaves(req.user, query);
    return ApiResponse.success(res, leaves, 'Leaves retrieved successfully');
  } catch (error) {
    next(error);
  }
});

router.post('/apply', requireAppEmployee, prepareLeaveUpload, async (req, res, next) => {
  try {
    if (req.file) {
      req.body.supporting_document = getRelativePath(req.file.path);
    }

    const value = validate(applyLeaveSchema, req.body);
    const result = await appEmployeeService.applyLeave(req.user, value);
    return ApiResponse.created(res, result, 'Leave application submitted successfully');
  } catch (error) {
    logger.error('App leave apply failed', { error: error.message });
    next(error);
  }
});

router.patch('/:id/cancel', requireAppEmployee, async (req, res, next) => {
  try {
    const leaveId = parseInt(req.params.id, 10);
    if (!Number.isInteger(leaveId) || leaveId <= 0) {
      return res.status(400).json({ success: false, message: 'Valid leave id is required' });
    }

    const result = await appEmployeeService.cancelLeave(req.user, leaveId);
    return ApiResponse.success(res, result, 'Leave cancelled successfully');
  } catch (error) {
    next(error);
  }
});

module.exports = router;
