const express = require('express');
const router = express.Router();
const { authenticate } = require('../../../../middleware/auth');
const leaveService = require('../../services/leaveService');
const { applyLeaveSchema, leaveQuerySchema } = require('../../validators');
const ApiResponse = require('../../../../utils/ApiResponse');
const logger = require('../../../../config/logger');
const { uploadHrmFile, getRelativePath } = require('../../../../utils/fileUpload');

router.use(authenticate);

// Leave upload middleware using centralized HRM file handler
const leaveUpload = async (req, res, next) => {
  try {
    logger.info('Leave document upload middleware called', { 
      userId: req.user?.id,
      applicantId: req.user?.applicant_id,
      userEmail: req.user?.email
    });
    
    // Get employee details for folder structure
    const employeeService = require('../../services/employeeService');
    const employee = await employeeService.getEmployeeByApplicantId(req.user.applicant_id);
    
    if (!employee) {
      logger.error('Employee not found in leave upload', { 
        applicantId: req.user?.applicant_id,
        userId: req.user?.id 
      });
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }
    
    logger.info('Employee found for leave upload', { 
      applicantId: req.user.applicant_id,
      employeeId: employee.employee_id,
      employeeCode: employee.employee_code 
    });

    // Store employee info for the centralized upload handler
    req.employee = employee;
    
    // Use centralized HRM file upload handler
    const upload = uploadHrmFile('file', 'leave');
    upload(req, res, next);
  } catch (error) {
    logger.error('Error in leave upload middleware:', error);
    return res.status(500).json({ success: false, message: 'Upload preparation failed' });
  }
};

// Get leave types
router.get('/types', async (req, res, next) => {
  try {
    const result = await leaveService.getLeaveTypes();
    return ApiResponse.success(res, result, 'Leave types retrieved');
  } catch (err) {
    next(err);
  }
});

// Get my leave balances my not be used
router.get('/balances', async (req, res, next) => {
  try {
    const result = await leaveService.getMyLeaveBalances(req.user);
    return ApiResponse.success(res, result, 'Leave balances retrieved');
  } catch (err) {
    next(err);
  }
});

// Apply for leave
router.post('/apply', leaveUpload, async (req, res, next) => {
  try {
    // Add file path to request body if file was uploaded
    if (req.file) {
      // Convert absolute path to relative path for database storage
      req.body.supporting_document = getRelativePath(req.file.path);
      logger.info('Leave document uploaded', {
        employeeId: req.employee?.employee_id,
        employeeCode: req.employee?.employee_code,
        filePath: req.file.path,
        relativePath: req.body.supporting_document,
        originalName: req.file.originalname
      });
    }

    const { error, value } = applyLeaveSchema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const result = await leaveService.applyLeave(req.user, value);
    return ApiResponse.created(res, result, 'Leave application submitted');
  } catch (err) {
    next(err);
  }
});

// Get my leaves
router.get('/my', async (req, res, next) => {
  try {
    const { error, value } = leaveQuerySchema.validate(req.query);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const result = await leaveService.getMyLeaves(req.user, value);
    return ApiResponse.success(res, result, 'Leaves retrieved');
  } catch (err) {
    next(err);
  }
});

// Cancel a leave
router.patch('/:id/cancel', async (req, res, next) => {
  try {
    const result = await leaveService.cancelLeave(req.user, parseInt(req.params.id));
    return ApiResponse.success(res, result, 'Leave cancelled');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
