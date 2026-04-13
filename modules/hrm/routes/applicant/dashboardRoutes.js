/**
 * HRM Employee Dashboard Routes
 * Employee dashboard, contract details, documents, and calendar
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../../../../middleware/auth');
const { hrmFeatureFlag } = require('../../middleware');
const employeeService = require('../../services/employeeService');
const hrmDashboardService = require('../../services/hrmDashboardService');
const ApiResponse = require('../../../../utils/ApiResponse');
const { ApiError } = require('../../../../middleware/errorHandler');
const logger = require('../../../../config/logger');

// Apply HRM feature flag check to all routes
router.use(hrmFeatureFlag.checkHRMEnabled);
router.use(authenticate);

/**
 * @route GET /api/hrm/applicant/dashboard
 * @desc Get employee HRM dashboard (attendance, leave, reports, performance)
 * @access Employee only
 */
router.get('/', async (req, res, next) => {
  try {
    const dashboardData = await hrmDashboardService.getEmployeeDashboard(req.user);
    return ApiResponse.success(res, dashboardData, 'Employee dashboard retrieved successfully');
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/hrm/applicant/dashboard/contract-details
 * @desc Get employee contract details
 * @access Employee only
 */
router.get('/contract-details', async (req, res, next) => {
  try {
    const contract = await employeeService.getEmployeeContractDetails(req.user.applicant_id);
    return ApiResponse.success(res, contract, 'Contract details retrieved successfully');
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/hrm/applicant/dashboard/documents
 * @desc Get employee uploaded documents
 * @access Employee only
 */
router.get('/documents', async (req, res, next) => {
  try {
    const documents = await employeeService.getEmployeeDocuments(req.user.applicant_id);
    return ApiResponse.success(res, documents, 'Employee documents retrieved successfully');
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/hrm/applicant/dashboard/calendar
 * @desc Get calendar events (leaves, visits, reports, holidays, evaluations)
 * @access Employee only
 */
router.get('/calendar', async (req, res, next) => {
  try {
    const result = await hrmDashboardService.getCalendarEvents(req.user, req.query);
    return ApiResponse.success(res, result, 'Calendar events retrieved');
  } catch (error) {
    next(error);
  }
});

module.exports = router;
