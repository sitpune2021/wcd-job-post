const express = require('express');
const router = express.Router();
const dashboardService = require('../../services/dashboardService');
const ApiResponse = require('../../utils/ApiResponse');
// const { requirePermission } = require('../../middlewares/permission.middleware');
const { authenticate, requirePermission } = require('../../middleware/auth');
const { auditLog } = require('../../middlewares/audit.middleware');

/**
 * @route   GET /api/admin/dashboard/summary-by-district
 * @desc    Get a summary of posts and applications by district
 * @access  Private (requires 'dashboard.view' permission)
 */
router.get(
  '/summary-by-district',
  authenticate,
  requirePermission('dashboard.view'),
  auditLog('VIEW_DASHBOARD_SUMMARY'),
  async (req, res, next) => {
    try {
      const summary = await dashboardService.getSummaryByDistrict();
      return ApiResponse.success(res, summary, 'Dashboard summary retrieved successfully');
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
