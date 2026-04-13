const express = require('express');
const router = express.Router();
const { authenticate } = require('../../../../middleware/auth');
const monthlyReportService = require('../../services/monthlyReportService');
const { submitReportSchema, reportQuerySchema } = require('../../validators');
const ApiResponse = require('../../../../utils/ApiResponse');
const { upload, getRelativePath } = require('../../../../utils/fileUpload');

router.use(authenticate);

// Submit monthly report
router.post('/submit', async (req, res, next) => {
  try {
    const { error, value } = submitReportSchema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const result = await monthlyReportService.submitReport(req.user, value);
    return ApiResponse.created(res, result, 'Report submitted successfully');
  } catch (err) {
    next(err);
  }
});

// Get my reports
router.get('/my', async (req, res, next) => {
  try {
    const { error, value } = reportQuerySchema.validate(req.query);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const result = await monthlyReportService.getMyReports(req.user, value);
    return ApiResponse.success(res, result, 'Reports retrieved');
  } catch (err) {
    next(err);
  }
});

// Get my report stats
router.get('/stats', async (req, res, next) => {
  try {
    const result = await monthlyReportService.getMyReportStats(req.user);
    return ApiResponse.success(res, result, 'Report stats retrieved');
  } catch (err) {
    next(err);
  }
});

// Upload document for a report
router.post('/:id/upload', upload.single('document'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    
    // Convert absolute path to relative path for database storage
    const relativePath = getRelativePath(req.file.path);
    const result = await monthlyReportService.uploadReportDocument(req.user, parseInt(req.params.id), relativePath);
    return ApiResponse.success(res, result, 'Document uploaded');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
