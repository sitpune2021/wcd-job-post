const express = require('express');
const router = express.Router();
const dashboardService = require('../../services/dashboardService');
const ApiResponse = require('../../utils/ApiResponse');
const { authenticate, requirePermission, auditLog } = require('../../middleware/auth');

/**
 * @route   GET /api/admin/dashboard/summary-by-district
 * @desc    Get a summary of posts and applications by district
 * @access  Private (requires 'dashboard.view' permission)
 */
router.get(
  '/recruitment-drives',
  authenticate,
  requirePermission(['dashboard.view', 'posts.view', 'applications.view']),
  auditLog('VIEW_DASHBOARD_RECRUITMENT_DRIVES'),
  async (_req, res, next) => {
    try {
      const drives = await dashboardService.getRecruitmentDrives();
      return ApiResponse.success(res, drives, 'Dashboard recruitment drives retrieved successfully');
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/summary-by-district',
  authenticate,
  requirePermission(['dashboard.view', 'posts.view', 'applications.view']),
  auditLog('VIEW_DASHBOARD_SUMMARY'),
  async (req, res, next) => {
    try {
      const summary = await dashboardService.getSummaryByDistrict(req.query.recruitment_drive_id);
      return ApiResponse.success(res, summary, 'Dashboard summary retrieved successfully');
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
