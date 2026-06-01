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

// Export attendance logs as PDF
router.get('/my/export', async (req, res, next) => {
  try {
    const { error, value } = attendanceQuerySchema.validate(req.query);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const result = await attendanceService.getMyAttendance(req.user, value);
    // API response is nested: { data: { records: { records: [...] }, summary: {} } }
    const raw = result?.data?.records?.records
      || result?.data?.records
      || result?.records
      || [];
    const records = Array.isArray(raw) ? raw : [];
    
    // Get employee details for PDF header
    const employeeService = require('../../services/employeeService');
    const employee = await employeeService.getEmployeeByApplicantId(req.user.applicant_id);
    
    // Get applicant personal details for name
    const ApplicantMaster = require('../../../../models/ApplicantMaster');
    const applicant = await ApplicantMaster.findOne({
      where: { applicant_id: req.user.applicant_id },
      include: [{
        model: require('../../../../models/ApplicantPersonal'),
        as: 'personal',
        attributes: ['full_name'],
        required: false
      }]
    });
    
    // Enhance user object with employee details
    const userWithEmployee = {
      ...req.user,
      employee_code: employee?.employee_code || 'N/A',
      name: applicant?.personal?.full_name || employee?.applicant?.personal?.full_name || req.user.name || 'N/A',
      email: req.user.email || 'N/A'
    };
    
    const htmlToPdf = require('html-pdf-node');
    
    // Generate HTML for PDF
    const html = generateMyAttendancePDF(records, value, userWithEmployee);
    
    // PDF options
    const pdfOptions = {
      format: 'A4',
      printBackground: true,
      margin: { 
        top: '15mm', 
        right: '15mm', 
        bottom: '15mm', 
        left: '15mm' 
      },
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    };

    const pdfBuffer = await htmlToPdf.generatePdf(
      { content: html },
      pdfOptions
    );

    // Set response headers
    const month = value.month || (new Date().getMonth() + 1);
    const year = value.year || new Date().getFullYear();
    const filename = `attendance_${year}_${String(month).padStart(2, '0')}.pdf`;
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    
    res.send(pdfBuffer);
  } catch (err) {
    next(err);
  }
});

// Helper function to generate PDF HTML for my attendance
const generateMyAttendancePDF = (records, filters, user) => {
  const { month, year } = filters;
  
  const escapeHtml = (value) => {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  const formatDateForPDF = (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    return date.toLocaleDateString('en-IN', { 
      day: '2-digit', 
      month: '2-digit', 
      year: 'numeric',
      timeZone: 'Asia/Kolkata'
    });
  };

  const calculateWorkHours = (checkInTime, checkOutTime) => {
    if (!checkInTime || !checkOutTime) return '--';
    
    try {
      const [inHours, inMinutes, inSeconds] = checkInTime.split(':').map(Number);
      const [outHours, outMinutes, outSeconds] = checkOutTime.split(':').map(Number);
      
      const baseDate = new Date();
      const checkIn = new Date(baseDate.setHours(inHours, inMinutes, inSeconds || 0, 0));
      const checkOut = new Date(baseDate.setHours(outHours, outMinutes, outSeconds || 0, 0));
      
      const diffMs = checkOut - checkIn;
      
      if (diffMs <= 0) return '--';
      
      const hours = diffMs / (1000 * 60 * 60);
      return hours.toFixed(2);
    } catch (error) {
      return '--';
    }
  };

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                      'July', 'August', 'September', 'October', 'November', 'December'];
  const monthName = monthNames[month - 1];
  
  const generatedOn = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

  let html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>My Attendance Report</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .header { text-align: center; margin-bottom: 30px; }
        .title { font-size: 18px; font-weight: bold; margin-bottom: 10px; }
        .subtitle { font-size: 12px; color: #666; margin-bottom: 5px; }
        .employee-info { font-size: 10px; color: #888; margin-bottom: 20px; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; font-size: 10px; }
        th { background-color: #f5f5f5; font-weight: bold; }
        .footer { text-align: center; font-size: 10px; color: #888; margin-top: 30px; }
        .no-records { text-align: center; color: #666; margin: 50px 0; }
        .date-col { width: 80px; }
        .time-col { width: 70px; }
        .status-col { width: 60px; }
        .hours-col { width: 50px; }
        .location-col { width: 120px; }
        .device-col { width: 80px; }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="title">My Attendance Report</div>
        <div class="subtitle">Month: ${monthName} ${year}</div>
        <div class="employee-info">
          Employee: ${escapeHtml(user.name || 'N/A')} (${escapeHtml(user.email || 'N/A')}) | Employee Code: ${escapeHtml(user.employee_code || 'N/A')} | Generated on: ${generatedOn}
        </div>
      </div>
      
      ${records.length === 0 ? 
        '<div class="no-records">No attendance records found for the selected month.</div>' :
        `
        <table>
          <thead>
            <tr>
              <th class="date-col">Date</th>
              <th class="time-col">Check-In</th>
              <th class="time-col">Check-Out</th>
              <th class="status-col">Status</th>
              <th class="hours-col">Hours</th>
              <th class="location-col">Location</th>
              <th class="device-col">Device</th>
            </tr>
          </thead>
          <tbody>
            ${records.map(record => {
              const location = (record.latitude && record.longitude) 
                ? `${parseFloat(record.latitude).toFixed(4)}, ${parseFloat(record.longitude).toFixed(4)}` 
                : '--';
              
              return `
              <tr>
                <td class="date-col">${escapeHtml(formatDateForPDF(record.attendance_date || ''))}</td>
                <td class="time-col">${escapeHtml(record.check_in_time || '')}</td>
                <td class="time-col">${escapeHtml(record.check_out_time || '')}</td>
                <td class="status-col">${escapeHtml(record.status || '')}</td>
                <td class="hours-col">${escapeHtml(calculateWorkHours(record.check_in_time, record.check_out_time))}</td>
                <td class="location-col"><small>${escapeHtml(location)}</small></td>
                <td class="device-col">${escapeHtml(record.device_type || '--')}</td>
              </tr>
            `;
            }).join('')}
          </tbody>
        </table>
        `
      }
      
      <div class="footer">
        Total Records: ${records.length} | Generated on: ${generatedOn}
      </div>
    </body>
    </html>
  `;

  return html;
};

// Simple check-out endpoint using existing attendance structure
router.post('/check-out', attendanceUpload, async (req, res, next) => {
  try {
    // Handle uploaded image or existing duplicate file
    let photoData = null;
    
    if (req.file || req.existingFilePath) {
      try {
        let filePath, originalName, fileSize;
        
        if (req.existingFilePath) {
          filePath = path.join(__dirname, '..', '..', '..', 'uploads', req.existingFilePath);
          originalName = 'existing_image';
          fileSize = await getFileSize(filePath);
        } else {
          fileSize = await getFileSize(req.file.path);
          filePath = req.file.path;
          originalName = req.file.originalname;
        }
        
        const relativePath = getRelativePath(filePath);
        photoData = {
          path: relativePath,
          name: originalName,
          size: fileSize
        };
      } catch (imageError) {
        logger.error('Error processing check-out photo:', { error: imageError.message });
        return res.status(500).json({ success: false, message: 'Failed to process photo.' });
      }
    }

    const attendanceData = {
      photoPath: photoData?.path,
      latitude: req.body.latitude,
      longitude: req.body.longitude,
      geo_address: req.body.geo_address
    };

    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    const result = await attendanceService.checkOutSimple(req.user, attendanceData, ip);
    
    return ApiResponse.success(res, result.data, result.message);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
