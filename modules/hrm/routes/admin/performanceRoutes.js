const express = require('express');
const router = express.Router();
const { authenticate } = require('../../../../middleware/auth');
const { hrmFeatureFlag } = require('../../middleware');
const { requireHRMAdminPermission } = require('../../middleware/permissionGuard');
const performanceService = require('../../services/performanceService');
const { appraiserReviewSchema, performanceQuerySchema } = require('../../validators');
const ApiResponse = require('../../../../utils/ApiResponse');

router.use(hrmFeatureFlag.checkHRMEnabled);
router.use(authenticate);
router.use(requireHRMAdminPermission('hrm.performance.view'));

// Get staff reviews for appraisal (employees under jurisdiction)
router.get('/staff-reviews', async (req, res, next) => {
  try {
    const { error, value } = performanceQuerySchema.validate(req.query);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const result = await performanceService.getStaffReviews(req.user, value);
    return ApiResponse.success(res, result, 'Staff reviews retrieved');
  } catch (err) {
    next(err);
  }
});

// Get performance summary
router.get('/summary', async (req, res, next) => {
  try {
    const { error, value } = performanceQuerySchema.validate(req.query);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const result = await performanceService.getPerformanceSummary(req.user, value);
    return ApiResponse.success(res, result, 'Performance summary retrieved');
  } catch (err) {
    next(err);
  }
});

// Get single review detail
router.get('/:id', async (req, res, next) => {
  try {
    const result = await performanceService.getReviewById(parseInt(req.params.id), req.user, true);
    return ApiResponse.success(res, result, 'Review details retrieved');
  } catch (err) {
    next(err);
  }
});

// Submit appraiser review (admin action)
router.patch('/:id/review', requireHRMAdminPermission('hrm.performance.manage'), async (req, res, next) => {
  try {
    const { error, value } = appraiserReviewSchema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const result = await performanceService.submitAppraiserReview(req.user, parseInt(req.params.id), value);
    return ApiResponse.success(res, result, 'Appraisal submitted successfully');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
