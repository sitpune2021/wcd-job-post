const express = require('express');
const router = express.Router();
const { authenticate } = require('../../../../middleware/auth');
const performanceService = require('../../services/performanceService');
const { selfEvaluationSchema, performanceQuerySchema } = require('../../validators');
const ApiResponse = require('../../../../utils/ApiResponse');

router.use(authenticate);

// Submit self-evaluation
router.post('/self-evaluation', async (req, res, next) => {
  try {
    const { error, value } = selfEvaluationSchema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const result = await performanceService.submitSelfEvaluation(req.user, value);
    return ApiResponse.created(res, result, 'Self evaluation submitted');
  } catch (err) {
    next(err);
  }
});

// Get my performance history
router.get('/history', async (req, res, next) => {
  try {
    const { error, value } = performanceQuerySchema.validate(req.query);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const result = await performanceService.getMyPerformance(req.user, value);
    return ApiResponse.success(res, result, 'Performance history retrieved');
  } catch (err) {
    next(err);
  }
});

// Get single review detail
router.get('/:id', async (req, res, next) => {
  try {
    const result = await performanceService.getReviewById(parseInt(req.params.id), req.user, false);
    return ApiResponse.success(res, result, 'Review details retrieved');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
