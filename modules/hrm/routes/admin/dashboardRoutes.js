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

// Get scheme-wise attendance data with filtering
router.get('/scheme-wise-attendance', async (req, res, next) => {
  try {
    const { district_id, scheme_type, date } = req.query;
    const result = await hrmDashboardService.getSchemeWiseAttendance(req.user, {
      district_id: district_id ? parseInt(district_id) : null,
      scheme_type: scheme_type || null,
      date: date || new Date().toISOString().split('T')[0]
    });
    return ApiResponse.success(res, result, 'Scheme-wise attendance data retrieved successfully');
  } catch (err) {
    next(err);
  }
});

// Download scheme-wise attendance PDF
router.get('/scheme-wise-attendance/pdf', async (req, res, next) => {
  try {
    const { district_id, scheme_type, date } = req.query;
    const pdfBuffer = await hrmDashboardService.generateSchemeWiseAttendancePDF(req.user, {
      district_id: district_id ? parseInt(district_id) : null,
      scheme_type: scheme_type || null,
      date: date || new Date().toISOString().split('T')[0]
    });
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="scheme-wise-attendance-${date || 'today'}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    next(err);
  }
});

// Get districts for filtering
router.get('/districts', async (req, res, next) => {
  try {
    const result = await hrmDashboardService.getDistrictsForFiltering(req.user);
    return ApiResponse.success(res, result, 'Districts retrieved successfully');
  } catch (err) {
    next(err);
  }
});

// Get schemes for filtering
router.get('/schemes', async (req, res, next) => {
  try {
    const { district_id } = req.query;
    const result = await hrmDashboardService.getSchemesForFiltering(req.user, {
      district_id: district_id ? parseInt(district_id) : null
    });
    return ApiResponse.success(res, result, 'Schemes retrieved successfully');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
