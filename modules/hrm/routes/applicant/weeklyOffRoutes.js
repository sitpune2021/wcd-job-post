/**
 * Weekly Off Claim Routes — Employee/Applicant facing
 * Mounted at: /api/hrm/applicant/weekly-off
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../../../../middleware/auth');
const { checkHRMEnabled } = require('../../middleware/hrmFeatureFlag');
const weeklyOffClaimService = require('../../services/weeklyOffClaimService');
const ApiResponse = require('../../../../utils/ApiResponse');
const { ApiError } = require('../../../../middleware/errorHandler');
const logger = require('../../../../config/logger');

router.use(authenticate);
router.use(checkHRMEnabled);

/**
 * @route GET /api/hrm/applicant/weekly-off
 * @desc  Get all weekly off claims for the logged-in employee
 */
router.get('/', async (req, res, next) => {
  try {
    const db = require('../../../../models');
    const { getEmployeeFromUser } = require('../../utils/hrmHelpers');
    const employee = await getEmployeeFromUser(req.user, db.EmployeeMaster);
    
    if (!employee) {
      throw ApiError.forbidden('Employee profile not found for this user');
    }
    
    const employeeId = employee.employee_id;

    const { status, month } = req.query;
    const filters = {};
    if (status) filters.status = status;
    if (month)  filters.monthCode = parseInt(month);

    let claims = await weeklyOffClaimService.getEmployeeWeeklyOffClaims(employeeId, filters);
    
    // Check for new entitlements for current employee only (much faster)
    try {
      logger.info('Checking for new weekly off entitlements for current employee');
      await weeklyOffClaimService.generateWeeklyOffEntitlements(employeeId);
      
      // Fetch again after generation to get latest data
      claims = await weeklyOffClaimService.getEmployeeWeeklyOffClaims(employeeId, filters);
    } catch (genError) {
      logger.warn('Failed to auto-generate weekly off entitlements:', genError.message);
      // Continue with existing claims if generation fails
    }
    
    return ApiResponse.success(res, claims, 'Weekly off claims retrieved successfully');
  } catch (error) {
    logger.error('Error fetching employee weekly off claims:', error);
    next(error);
  }
});

/**
 * @route POST /api/hrm/applicant/weekly-off/generate
 * @desc  Manually trigger weekly off entitlement generation (for testing)
 */
router.post('/generate', async (req, res, next) => {
  try {
    const db = require('../../../../models');
    const { getEmployeeFromUser } = require('../../utils/hrmHelpers');
    const employee = await getEmployeeFromUser(req.user, db.EmployeeMaster);
    
    if (!employee) {
      throw ApiError.forbidden('Employee profile not found for this user');
    }

    logger.info('Manual weekly off entitlement generation triggered by employee', {
      employeeId: employee.employee_id
    });

    await weeklyOffClaimService.generateWeeklyOffEntitlements();
    
    return ApiResponse.success(res, null, 'Weekly off entitlements generated successfully');
  } catch (error) {
    logger.error('Error generating weekly off entitlements:', error);
    next(error);
  }
});

/**
 * @route POST /api/hrm/applicant/weekly-off/:claimId/claim
 * @desc  Submit or update a weekly off claim
 */
router.post('/:claimId/claim', async (req, res, next) => {
  try {
    const db = require('../../../../models');
    const { getEmployeeFromUser } = require('../../utils/hrmHelpers');
    const employee = await getEmployeeFromUser(req.user, db.EmployeeMaster);
    
    if (!employee) {
      throw ApiError.forbidden('Employee profile not found for this user');
    }
    
    const employeeId = employee.employee_id;
    const { claimId } = req.params;
    const { claimed_off_date } = req.body;

    if (!claimed_off_date) {
      return res.status(400).json({ success: false, message: 'Claimed off date is required' });
    }

    const claim = await weeklyOffClaimService.submitWeeklyOffClaim(
      employeeId,
      parseInt(claimId),
      claimed_off_date,
      req.user.id
    );

    return ApiResponse.success(res, claim, 'Weekly off claim submitted successfully');
  } catch (error) {
    logger.error('Error submitting weekly off claim:', error);
    next(error);
  }
});

module.exports = router;
