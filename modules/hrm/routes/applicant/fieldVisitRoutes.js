const express = require('express');
const router = express.Router();
const { authenticate } = require('../../../../middleware/auth');
const fieldVisitService = require('../../services/fieldVisitService');
const { logFieldVisitSchema, fieldVisitQuerySchema } = require('../../validators');
const ApiResponse = require('../../../../utils/ApiResponse');
const { upload, getRelativePath } = require('../../../../utils/fileUpload');

router.use(authenticate);

// Log a field visit
router.post('/log', async (req, res, next) => {
  try {
    const { error, value } = logFieldVisitSchema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const result = await fieldVisitService.logVisit(req.user, value);
    return ApiResponse.created(res, result, 'Field visit logged successfully');
  } catch (err) {
    next(err);
  }
});

// Get my field visits
router.get('/my', async (req, res, next) => {
  try {
    const { error, value } = fieldVisitQuerySchema.validate(req.query);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const result = await fieldVisitService.getMyVisits(req.user, value);
    return ApiResponse.success(res, result, 'Field visits retrieved');
  } catch (err) {
    next(err);
  }
});

// Get visit detail
router.get('/:id', async (req, res, next) => {
  try {
    const result = await fieldVisitService.getVisitById(parseInt(req.params.id), req.user, false);
    return ApiResponse.success(res, result, 'Visit details retrieved');
  } catch (err) {
    next(err);
  }
});

// Upload photos for a visit
router.post('/:id/photos', upload.array('photos', 5), async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, message: 'No photos uploaded' });
    }
    // Convert absolute paths to relative paths for database storage
    const paths = req.files.map(f => getRelativePath(f.path));
    const result = await fieldVisitService.uploadVisitPhotos(req.user, parseInt(req.params.id), paths);
    return ApiResponse.success(res, result, 'Photos uploaded');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
