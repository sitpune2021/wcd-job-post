const express = require('express');
const router = express.Router();
const { authenticate } = require('../../../../middleware/auth');
const { hrmFeatureFlag } = require('../../middleware');
const { requireHRMAdminPermission } = require('../../middleware/permissionGuard');
const monthlyReportService = require('../../services/monthlyReportService');
const { reviewReportSchema, reportQuerySchema } = require('../../validators');
const ApiResponse = require('../../../../utils/ApiResponse');

router.use(hrmFeatureFlag.checkHRMEnabled);
router.use(authenticate);
router.use(requireHRMAdminPermission('hrm.reports.view'));

// Get reports for review (from employees under jurisdiction)
router.get('/for-review', async (req, res, next) => {
  try {
    const { error, value } = reportQuerySchema.validate(req.query);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const result = await monthlyReportService.getReportsForReview(req.user, value);
    return ApiResponse.success(res, result, 'Reports for review retrieved');
  } catch (err) {
    next(err);
  }
});

// Review a monthly report (approve/reject)
router.patch('/:id/review', requireHRMAdminPermission('hrm.reports.manage'), async (req, res, next) => {
  try {
    const { error, value } = reviewReportSchema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const result = await monthlyReportService.reviewReport(req.user, parseInt(req.params.id), value);
    return ApiResponse.success(res, result, `Report ${value.status.toLowerCase()} successfully`);
  } catch (err) {
    next(err);
  }
});

// Get report summary
router.get('/summary', async (req, res, next) => {
  try {
    const { error, value } = reportQuerySchema.validate(req.query);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const result = await monthlyReportService.getReportSummary(req.user, value);
    return ApiResponse.success(res, result, 'Report summary retrieved');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
