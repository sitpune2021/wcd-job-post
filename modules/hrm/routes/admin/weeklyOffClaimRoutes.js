/**
 * Weekly Off Claim Routes — Admin facing
 * Mounted at: /api/hrm/admin/weekly
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../../../../middleware/auth');
const { hrmFeatureFlag, hrmHierarchy } = require('../../middleware');
const { requireHRMAdminPermission } = require('../../middleware/permissionGuard');
const weeklyOffClaimService = require('../../services/weeklyOffClaimService');
const ApiResponse = require('../../../../utils/ApiResponse');
const logger = require('../../../../config/logger');

router.use(authenticate);
router.use(hrmFeatureFlag.checkHRMEnabled);
router.use(hrmHierarchy.applyHRMHierarchyFilter);

/**
 * @route GET /api/hrm/admin/weekly/pending
 * @desc  Get all pending weekly off claims for admin approval
 * @access Admin with hrm.weekly_off.manage permission
 */
router.get('/pending',
  requireHRMAdminPermission(['hrm.weekly_off.manage', 'hrm.*']),
  async (req, res, next) => {
    try {
      const { employee_id, district_id, search, page, limit } = req.query;

      const filters = {
        employeeId: employee_id ? parseInt(employee_id) : undefined,
        districtId: district_id ? parseInt(district_id) : undefined,
        search: search || undefined,
        limit: limit ? parseInt(limit) : 50,
        offset: page ? (parseInt(page) - 1) * (limit ? parseInt(limit) : 50) : 0
      };

      if (req.hrmScope && req.hrmScope.filters) {
        if (req.hrmScope.filters.district_id) filters.districtId = req.hrmScope.filters.district_id;
        if (req.hrmScope.filters.employee_id) filters.employeeId = req.hrmScope.filters.employee_id;
      }

      const result = await weeklyOffClaimService.getPendingWeeklyOffClaims(filters);
      return ApiResponse.success(res, result, 'Pending weekly off claims retrieved successfully');
    } catch (error) {
      logger.error('Error fetching pending weekly off claims:', error);
      next(error);
    }
  }
);

/**
 * @route POST /api/hrm/admin/weekly/:claimId/approve
 * @desc  Approve a weekly off claim
 * @access Admin with hrm.weekly_off.manage permission
 */
router.post('/:claimId/approve',
  requireHRMAdminPermission(['hrm.weekly_off.manage', 'hrm.*']),
  async (req, res, next) => {
    try {
      const { claimId } = req.params;
      const { remarks } = req.body;

      if (!remarks || remarks.trim().length === 0) {
        return res.status(400).json({ success: false, message: 'Admin remarks are required for approval' });
      }

      const claim = await weeklyOffClaimService.approveWeeklyOffClaim(
        parseInt(claimId),
        req.user.id,
        remarks
      );
      return ApiResponse.success(res, claim, 'Weekly off claim approved successfully');
    } catch (error) {
      logger.error('Error approving weekly off claim:', error);
      next(error);
    }
  }
);

/**
 * @route GET /api/hrm/admin/weekly/employee/:employeeId
 * @desc  Get all weekly off claims for a specific employee
 * @access Admin with hrm.weekly_off.view permission
 */
router.get('/employee/:employeeId',
  requireHRMAdminPermission(['hrm.weekly_off.view', 'hrm.weekly_off.manage', 'hrm.*']),
  async (req, res, next) => {
    try {
      const { employeeId } = req.params;
      const { status, month } = req.query;

      const filters = {};
      if (status) filters.status = status;
      if (month)  filters.monthCode = parseInt(month);

      const claims = await weeklyOffClaimService.getEmployeeWeeklyOffClaims(parseInt(employeeId), filters);
      return ApiResponse.success(res, claims, 'Employee weekly off claims retrieved successfully');
    } catch (error) {
      logger.error('Error fetching employee weekly off claims (admin):', error);
      next(error);
    }
  }
);

module.exports = router;
