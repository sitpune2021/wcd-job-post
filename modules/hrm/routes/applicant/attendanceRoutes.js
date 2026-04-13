const express = require('express');
const router = express.Router();
const path = require('path');
const { authenticate } = require('../../../../middleware/auth');
const attendanceService = require('../../services/attendanceService');
const { markAttendanceSchema, attendanceQuerySchema } = require('../../validators');
const ApiResponse = require('../../../../utils/ApiResponse');
const logger = require('../../../../config/logger');
const { uploadHrmFile, compressImage, getRelativePath, getFileSize } = require('../../../../utils/fileUpload');

router.use(authenticate);

// Attendance upload middleware using centralized HRM file handler
const attendanceUpload = async (req, res, next) => {
  try {
    logger.info('Attendance upload middleware called', { 
      userId: req.user?.id,
      applicantId: req.user?.applicant_id,
      userEmail: req.user?.email
    });
    
    // Get employee details for folder structure
    const employeeService = require('../../services/employeeService');
    const employee = await employeeService.getEmployeeByApplicantId(req.user.applicant_id);
    
    if (!employee) {
      logger.error('Employee not found in attendance upload', { 
        applicantId: req.user?.applicant_id,
        userId: req.user?.id 
      });
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }
    
    logger.info('Employee found for attendance upload', { 
      applicantId: req.user.applicant_id,
      employeeId: employee.employee_id,
      employeeCode: employee.employee_code 
    });

    // Store employee info for the centralized upload handler
    req.employee = employee;
    
    // Use centralized HRM file upload handler
    const upload = uploadHrmFile('attendance_image', 'attendance');
    upload(req, res, next);
  } catch (error) {
    next(error);
  }
};

// Mark attendance with image
router.post('/mark', attendanceUpload, async (req, res, next) => {
  try {
    const { error, value } = markAttendanceSchema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    let imageData = null;
    
    // Handle uploaded image or existing duplicate file
    if (req.file || req.existingFilePath) {
      try {
        let filePath, originalName, fileSize;
        
        if (req.existingFilePath) {
          // Use existing file (duplicate detected)
          filePath = path.join(__dirname, '..', '..', '..', 'uploads', req.existingFilePath);
          originalName = 'existing_image';
          fileSize = await getFileSize(filePath);
          
          logger.info('Using existing attendance image (duplicate prevented)', { 
            employeeId: req.employee.employee_id,
            employeeCode: req.employee.employee_code,
            filePath: req.existingFilePath,
            fileSize
          });
        } else {
          // Use original image without compression for attendance
          fileSize = await getFileSize(req.file.path);
          filePath = req.file.path;
          originalName = req.file.originalname;
          
          logger.info('New attendance image saved (no compression)', { 
            employeeId: req.employee.employee_id,
            employeeCode: req.employee.employee_code,
            fileSize: fileSize
          });
        }
        
        // Get relative path for database storage
        const relativePath = getRelativePath(filePath);
        
        imageData = {
          path: relativePath,
          originalName: originalName,
          size: fileSize,
          isDuplicate: !!req.existingFilePath
        };
        
      } catch (imageError) {
        logger.error('Error processing attendance image', { error: imageError.message });
        // Continue without image if processing fails
      }
    }

    // Prepare attendance data
    const attendanceData = {
      latitude: value.latitude,
      longitude: value.longitude,
      geo_address: value.geo_address,
      remarks: value.remarks,
      image: imageData,
      userAgent: req.headers['user-agent'] // For device detection in geofencing
    };

    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    const result = await attendanceService.markAttendance(req.user, attendanceData, ip);
    
    // Add file URL if image was uploaded
    if (result.attendance_image_path) {
      const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
      result.attendance_image_url = `${baseUrl}/${result.attendance_image_path}`;
    }
    
    return ApiResponse.success(res, result, 'Attendance marked successfully');
  } catch (err) {
    next(err);
  }
});

// Get my attendance
router.get('/my', async (req, res, next) => {
  try {
    const { error, value } = attendanceQuerySchema.validate(req.query);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const result = await attendanceService.getMyAttendance(req.user, value);
    return ApiResponse.success(res, result, 'Attendance retrieved successfully');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
