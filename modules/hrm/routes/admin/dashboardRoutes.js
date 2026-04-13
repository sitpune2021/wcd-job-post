const express = require('express');
const router = express.Router();
const { authenticate } = require('../../../../middleware/auth');
const { hrmFeatureFlag } = require('../../middleware');
const { requireHRMAdminPermission } = require('../../middleware/permissionGuard');
const hrmDashboardService = require('../../services/hrmDashboardService');
const ApiResponse = require('../../../../utils/ApiResponse');

router.use(hrmFeatureFlag.checkHRMEnabled);
router.use(authenticate);
router.use(requireHRMAdminPermission('hrm.dashboard.view'));

// Get admin HRM dashboard with stats
router.get('/', async (req, res, next) => {
  try {
    const result = await hrmDashboardService.getAdminDashboard(req.user);
    return ApiResponse.success(res, result, 'Admin dashboard retrieved successfully');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
