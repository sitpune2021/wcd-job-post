/**
 * HRM Bulk Attendance Management Routes
 * Simple bulk attendance upload and approval workflow
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../../../../middleware/auth');
const { hrmFeatureFlag } = require('../../middleware');
const { requireHRMAdminPermission } = require('../../middleware/permissionGuard');
const bulkAttendanceService = require('../../services/bulkAttendanceService');
const multer = require('multer');
const path = require('path');
const ApiResponse = require('../../../../utils/ApiResponse');
const logger = require('../../../../config/logger');
const Joi = require('joi');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(process.cwd(), 'uploads', 'hrm', 'attendance_bulks');
    // Ensure directory exists
    const fs = require('fs');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `attendance_bulk_${uniqueSuffix}.xlsx`);
  }
});

const fileFilter = (req, file, cb) => {
  // Accept only Excel files
  if (file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.mimetype === 'application/vnd.ms-excel') {
    cb(null, true);
  } else {
    cb(new Error('Only Excel files are allowed'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// Apply common middleware
router.use(hrmFeatureFlag.checkHRMEnabled);
router.use(authenticate);
router.use(requireHRMAdminPermission('hrm.attendance.manage'));

// Validation schemas
const templateQuerySchema = Joi.object({
  date: Joi.date().optional(),
  month: Joi.number().integer().min(1).max(12).required(),
  year: Joi.number().integer().min(2020).max(2100).required(),
  district_id: Joi.number().integer().positive().optional(),
  component_id: Joi.number().integer().positive().optional(),
  hub_id: Joi.number().integer().positive().optional()
});

const bulkUploadSchema = Joi.object({
  remarks: Joi.string().max(1000).optional().allow('')
});

const approvalActionSchema = Joi.object({
  action: Joi.string().valid('APPROVE', 'REJECT').required(),
  remarks: Joi.string().max(1000).required(),
  record_ids: Joi.array().items(Joi.number()).optional()
});

const bulkQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10),
  status: Joi.string().valid('all', 'PENDING', 'APPROVED', 'REJECTED', 'PARTIALLY_APPROVED').optional()
});

/**
 * @route GET /api/hrm/admin/attendance/bulk-template
 * @desc Download attendance template with employee list
 * @access Admin with attendance.manage permission
 */
router.get('/bulk-template', async (req, res, next) => {
  try {
    const { error, value } = templateQuerySchema.validate(req.query);
    if (error) {
      return res.status(400).json({ 
        success: false, 
        message: error.details[0].message 
      });
    }

    const result = await bulkAttendanceService.downloadTemplate(req.user, value);
    
    // Send file for download
    res.download(result.filePath, result.fileName, (err) => {
      if (err) {
        logger.error('Error downloading template:', err);
        if (!res.headersSent) {
          return res.status(500).json({
            success: false,
            message: 'Error downloading template'
          });
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route POST /api/hrm/admin/attendance/bulk-upload
 * @desc Upload bulk attendance from Excel
 * @access Admin with attendance.manage permission
 */
router.post('/bulk-upload', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    // Validate query params for month/year (optional for upload)
    let month, year;
    
    if (req.query.month && req.query.year) {
      const { error: queryError, value: queryValue } = templateQuerySchema.validate(req.query);
      if (queryError) {
        return res.status(400).json({ 
          success: false, 
          message: queryError.details[0].message 
        });
      }
      month = queryValue.month;
      year = queryValue.year;
    } else {
      // Try to extract month/year from filename
      const filename = req.file.originalname;
      // Match patterns like "attendance_template_1_2026-04-23.xlsx" or template with month-year
      const match = filename.match(/attendance_template.*_(\d{4})[-_](\d{1,2})[-_](\d{1,2})/) || 
                   filename.match(/template.*?(\d{1,2})[-_](\d{4})/);
      
      if (match) {
        if (match[0].includes('attendance_template')) {
          // Pattern: attendance_template_1_2026-04-23.xlsx - extract from date
          year = parseInt(match[1]);
          month = parseInt(match[2]);
        } else {
          // Pattern: template_2_2026.xlsx
          month = parseInt(match[1]);
          year = parseInt(match[2]);
        }
      } else {
        // Default to current month/year if not found
        const now = new Date();
        month = now.getMonth() + 1;
        year = now.getFullYear();
        logger.warn(`Could not extract month/year from filename, using current: ${month}/${year}`, { filename });
      }
      
      logger.info(`Using month/year for upload: ${month}/${year}`, { filename });
    }

    // Validate body data
    const { error, value } = bulkUploadSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ 
        success: false, 
        message: error.details[0].message 
      });
    }

    const result = await bulkAttendanceService.uploadBulkAttendance(
      req.user, 
      req.file, 
      {
        ...value,
        month,
        year
      }
    );

    logger.info(`Bulk attendance uploaded`, {
      bulkId: result.bulk.bulk_id,
      uploadedBy: req.user.admin_id,
      totalRecords: result.totalRecords
    });

    return ApiResponse.created(res, result, 'Bulk attendance uploaded successfully');
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/hrm/admin/attendance/bulk-pending
 * @desc Get pending bulk attendance for approval
 * @access Admin with attendance.manage permission
 */
router.get('/bulk-pending', async (req, res, next) => {
  try {
    const { error, value } = bulkQuerySchema.validate(req.query);
    if (error) {
      return res.status(400).json({ 
        success: false, 
        message: error.details[0].message 
      });
    }

    const result = await bulkAttendanceService.getPendingBulks(req.user, value);
    
    return ApiResponse.success(res, result, 'Pending bulk attendance retrieved successfully');
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/hrm/admin/attendance/bulk/:bulkId
 * @desc Get bulk details with all records
 * @access Admin with attendance.manage permission
 */
router.get('/bulk/:bulkId', async (req, res, next) => {
  try {
    const bulkId = parseInt(req.params.bulkId);
    
    if (isNaN(bulkId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid bulk ID'
      });
    }

    const result = await bulkAttendanceService.getBulkDetails(bulkId, req.user);
    
    return ApiResponse.success(res, result, 'Bulk details retrieved successfully');
  } catch (error) {
    next(error);
  }
});

/**
 * @route POST /api/hrm/admin/attendance/bulk/:bulkId/approve
 * @desc Approve or reject bulk attendance
 * @access Admin with attendance.manage permission
 */
router.post('/bulk/:bulkId/approve', async (req, res, next) => {
  try {
    const bulkId = parseInt(req.params.bulkId);
    
    if (isNaN(bulkId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid bulk ID'
      });
    }

    const { error, value } = approvalActionSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ 
        success: false, 
        message: error.details[0].message 
      });
    }

    const result = await bulkAttendanceService.processBulkApproval(
      req.user, 
      bulkId, 
      value
    );

    logger.info(`Bulk approval processed`, {
      bulkId,
      approverId: req.user.admin_id,
      action: value.action,
      recordsUpdated: result.recordsUpdated
    });

    return ApiResponse.success(res, result, `Bulk ${value.action.toLowerCase()}d successfully`);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
