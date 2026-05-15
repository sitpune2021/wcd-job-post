/**
 * HRM Employee Profile Routes
 * Employee profile management and document uploads
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { authenticate } = require('../../../../middleware/auth');
const employeeService = require('../../services/employeeService');
const ApiResponse = require('../../../../utils/ApiResponse');
const { ApiError } = require('../../../../middleware/errorHandler');
const logger = require('../../../../config/logger');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, '../../../uploads/hrm/temp/');
    // Ensure directory exists
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'allotment_letter_' + uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  // Get allowed file types from .env
  const allowedTypes = process.env.ALLOWED_FILE_TYPES?.split(',') || [
    'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/bmp', 
    'image/webp', 'image/tiff', 'application/pdf'
  ];
  
  // Also check file extension as fallback
  const allowedExtensions = allowedTypes.map(type => {
    if (type.startsWith('image/')) return '.' + type.replace('image/', '');
    if (type === 'application/pdf') return '.pdf';
    return '';
  }).filter(ext => ext);
  
  const fileExtension = path.extname(file.originalname).toLowerCase();
  
  if (allowedTypes.includes(file.mimetype) || allowedExtensions.includes(fileExtension)) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type. Allowed types: ${allowedExtensions.join(', ')}`), false);
  }
};

const upload = multer({ 
  storage: storage, 
  fileFilter: fileFilter,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 2097152 // Default 2MB from .env
  }
});

// Apply authentication middleware to all routes
router.use(authenticate);

/**
 * @route GET /api/hrm/applicant/profile
 * @desc Get current employee profile
 * @access Employee only
 */
router.get('/', async (req, res, next) => {
  try {
    const applicantId = req.user.applicant_id;
    
    const profile = await employeeService.getCompleteEmployeeProfile(applicantId);
    
    if (!profile) {
      throw ApiError.notFound('Employee profile not found for this applicant');
    }
    
    return ApiResponse.success(res, profile, 'Employee profile retrieved successfully');
  } catch (error) {
    next(error);
  }
});

/**
 * @route PUT /api/hrm/applicant/profile
 * @desc Update employee profile
 * @access Employee only
 */
router.put('/', async (req, res, next) => {
  try {
    const updateData = req.body;
    
    const employee = await employeeService.updateEmployeeProfile(
      req.user.applicant_id,
      updateData
    );
    
    return ApiResponse.success(res, employee, 'Employee profile updated successfully');
  } catch (error) {
    next(error);
  }
});

/**
 * @route POST /api/hrm/applicant/profile/upload-allotment-letter
 * @desc Upload allotment letter PDF
 * @access Employee only
 */
router.post('/upload-allotment-letter', 
  upload.single('allotment_letter'), 
  async (req, res, next) => {
  try {
    if (!req.file) {
      throw ApiError.badRequest('Allotment letter PDF is required');
    }

    const result = await employeeService.uploadAllotmentLetter(
      req.user.applicant_id,
      req.file
    );
    
    return ApiResponse.success(res, result, 'Allotment letter uploaded successfully');
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/hrm/applicant/profile/bank-details
 * @desc Get employee bank details
 * @access Employee only
 */
router.get('/bank-details', async (req, res, next) => {
  try {
    const db = require('../../../../models');
    const { getEmployeeFromUser } = require('../../utils/hrmHelpers');
    const employee = await getEmployeeFromUser(req.user, db.EmployeeMaster);
    if (!employee) throw ApiError.forbidden('Employee profile not found.');

    const bankDetail = await db.EmployeeBankDetail.findOne({
      where: { employee_id: employee.employee_id }
    });

    return ApiResponse.success(res, bankDetail || {}, 'Bank details retrieved successfully');
  } catch (error) {
    next(error);
  }
});

/**
 * @route PUT /api/hrm/applicant/profile/bank-details
 * @desc Create or update employee bank details
 * @access Employee only
 */
router.put('/bank-details', async (req, res, next) => {
  try {
    const db = require('../../../../models');
    const { getEmployeeFromUser } = require('../../utils/hrmHelpers');
    const employee = await getEmployeeFromUser(req.user, db.EmployeeMaster);
    if (!employee) throw ApiError.forbidden('Employee profile not found.');

    const { bank_name, account_number, ifsc_code, aadhar_number, state, district } = req.body;

    const [bankDetail, created] = await db.EmployeeBankDetail.upsert({
      employee_id: employee.employee_id,
      applicant_id: employee.applicant_id || null,
      bank_name: bank_name || null,
      account_number: account_number || null,
      ifsc_code: ifsc_code ? ifsc_code.toUpperCase() : null,
      aadhar_number: aadhar_number || null,
      state: state || null,
      district: district || null
    }, {
      returning: true
    });

    const msg = created ? 'Bank details saved successfully' : 'Bank details updated successfully';
    return ApiResponse.success(res, bankDetail, msg);
  } catch (error) {
    next(error);
  }
});

/**
 * @route POST /api/hrm/applicant/profile/change-password
 * @desc Change employee password
 * @access Employee only
 */
router.post('/change-password', async (req, res, next) => {
  try {
    // Simple debug to see if route is hit
    logger.info('CHANGE PASSWORD ROUTE HIT');
    
    const { current_password, new_password } = req.body;
    
    if (!current_password || !new_password) {
      throw ApiError.badRequest('Current password and new password are required');
    }
    
    if (new_password.length < 6) {
      throw ApiError.badRequest('New password must be at least 6 characters long');
    }
    
    // Debug: Log user object
    logger.info('User object in change-password:', JSON.stringify(req.user, null, 2));
    logger.info('User applicant_id:', req.user?.applicant_id);
    logger.info('User id:', req.user?.id);
    logger.info('User dataValues:', req.user?.dataValues);
    
    const result = await employeeService.changeEmployeePassword(
      req.user.applicant_id,
      current_password,
      new_password
    );
    
    return ApiResponse.success(res, result, 'Password changed successfully');
  } catch (error) {
    next(error);
  }
});

module.exports = router;
