const express = require('express');
const router = express.Router();
const { authenticate } = require('../../../../middleware/auth');
const { hrmFeatureFlag } = require('../../middleware');
const { requireHRMAdminPermission } = require('../../middleware/permissionGuard');
const { ApiError } = require('../../../../middleware/errorHandler');
const Joi = require('joi');
const ApiResponse = require('../../../../utils/ApiResponse');
const simplePayrollViewService = require('../../services/simplePayrollViewService');

// Apply common middleware
router.use(hrmFeatureFlag.checkHRMEnabled);
router.use(authenticate);
router.use(requireHRMAdminPermission('hrm.payroll.view'));

// Validation schemas
const payslipQuerySchema = Joi.object({
  month: Joi.number().integer().min(1).max(12).required(),
  year: Joi.number().integer().min(2020).max(2030).required(),
  employee_id: Joi.number().integer().optional(),
  district_id: Joi.number().integer().optional(),
  search: Joi.string().max(100).optional(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10)
});

const singlePayslipSchema = Joi.object({
  employee_id: Joi.number().integer().required(),
  month: Joi.number().integer().min(1).max(12).required(),
  year: Joi.number().integer().min(2020).max(2030).required()
});

/**
 * @route GET /api/hrm/admin/payroll-view/payslips
 * @desc Get payslips for multiple employees with filters
 * @access Admin
 */
router.get('/payslips', async (req, res, next) => {
  try {
    const { error, value } = payslipQuerySchema.validate(req.query);
    if (error) {
      throw ApiError.badRequest(error.details[0].message);
    }

    const result = await simplePayrollViewService.getEmployeesPayslips(req.user, value);
    return ApiResponse.success(res, result, 'Payslips retrieved successfully');
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/hrm/admin/payroll-view/payslip
 * @desc Get single employee payslip
 * @access Admin
 */
router.get('/payslip', async (req, res, next) => {
  try {
    const { error, value } = singlePayslipSchema.validate(req.query);
    if (error) {
      throw ApiError.badRequest(error.details[0].message);
    }

    const result = await simplePayrollViewService.getEmployeePayslip(
      req.user,
      value.employee_id,
      value.month,
      value.year
    );
    return ApiResponse.success(res, result, 'Payslip retrieved successfully');
  } catch (error) {
    next(error);
  }
});


module.exports = router;
