const express = require('express');
const path = require('path');
const Joi = require('joi');
const { requireAppEmployee } = require('../middleware/appAuth');
const appEmployeeService = require('../services/appEmployeeService');
const attendanceService = require('../../hrm/services/attendanceService');
const { markAttendanceSchema, attendanceQuerySchema } = require('../../hrm/validators');
const db = require('../../../models');
const ApiResponse = require('../../../utils/ApiResponse');
const logger = require('../../../config/logger');
const { uploadHrmFile, getRelativePath, getFileSize } = require('../../../utils/fileUpload');

const router = express.Router();

const locationSchema = Joi.object({
  latitude: Joi.number().min(-90).max(90).required(),
  longitude: Joi.number().min(-180).max(180).required(),
  geo_address: Joi.string().max(500).allow('', null)
});

const calendarSchema = Joi.object({
  month: Joi.number().integer().min(1).max(12).default(new Date().getMonth() + 1),
  year: Joi.number().integer().min(2020).max(2100).default(new Date().getFullYear())
});

const validate = (schema, input) => {
  const { error, value } = schema.validate(input, { stripUnknown: true });
  if (error) {
    const err = new Error(error.details[0].message);
    err.statusCode = 400;
    err.isClientError = true;
    throw err;
  }
  return value;
};

const prepareEmployeeUpload = async (req, res, next) => {
  try {
    const employee = await db.EmployeeMaster.findOne({
      where: {
        applicant_id: req.user.applicant_id,
        is_deleted: false,
        is_active: true
      },
      attributes: ['employee_id', 'employee_code', 'applicant_id']
    });

    if (!employee) {
      return res.status(404).json({ success: false, message: 'Employee record not found' });
    }

    req.employee = employee;
    return uploadHrmFile('attendance_image', 'attendance')(req, res, next);
  } catch (error) {
    next(error);
  }
};

const buildImageData = async (req) => {
  if (!req.file && !req.existingFilePath) return null;

  if (req.existingFilePath) {
    const filePath = path.join(__dirname, '..', '..', '..', 'uploads', req.existingFilePath);
    return {
      path: req.existingFilePath,
      originalName: 'existing_image',
      size: await getFileSize(filePath),
      isDuplicate: true
    };
  }

  return {
    path: getRelativePath(req.file.path),
    originalName: req.file.originalname,
    size: await getFileSize(req.file.path),
    isDuplicate: false
  };
};

router.get('/today', requireAppEmployee, async (req, res, next) => {
  try {
    const today = await appEmployeeService.getTodayAttendance(req.user);
    return ApiResponse.success(res, today, 'Today attendance retrieved successfully');
  } catch (error) {
    next(error);
  }
});

router.get('/calendar', requireAppEmployee, async (req, res, next) => {
  try {
    const query = validate(calendarSchema, req.query);
    const calendar = await appEmployeeService.getCalendar(req.user, query);
    return ApiResponse.success(res, calendar, 'Attendance calendar retrieved successfully');
  } catch (error) {
    next(error);
  }
});

router.get('/history', requireAppEmployee, async (req, res, next) => {
  try {
    const query = validate(attendanceQuerySchema, req.query);
    const history = await appEmployeeService.getAttendanceHistory(req.user, query);
    return ApiResponse.success(res, history, 'Attendance history retrieved successfully');
  } catch (error) {
    next(error);
  }
});

router.post('/location-check', requireAppEmployee, async (req, res, next) => {
  try {
    const value = validate(locationSchema, req.body);
    const result = await appEmployeeService.checkLocation(req.user, value, req.headers['user-agent']);
    return ApiResponse.success(res, result, 'Location checked successfully');
  } catch (error) {
    next(error);
  }
});

router.post('/mark', requireAppEmployee, prepareEmployeeUpload, async (req, res, next) => {
  try {
    const value = validate(markAttendanceSchema, req.body);
    const imageData = await buildImageData(req);
    const attendanceData = {
      latitude: value.latitude,
      longitude: value.longitude,
      geo_address: value.geo_address,
      remarks: value.remarks,
      shift_type_id: value.shift_type_id,
      image: imageData,
      userAgent: req.headers['user-agent']
    };
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    const result = await attendanceService.markAttendance(req.user, attendanceData, ip);
    return ApiResponse.success(res, result, 'Attendance marked successfully');
  } catch (error) {
    logger.error('App attendance mark failed', { error: error.message });
    next(error);
  }
});

router.post('/check-in', requireAppEmployee, prepareEmployeeUpload, async (req, res, next) => {
  try {
    const value = validate(markAttendanceSchema, req.body);
    const imageData = await buildImageData(req);
    const attendanceData = {
      latitude: value.latitude,
      longitude: value.longitude,
      geo_address: value.geo_address,
      remarks: value.remarks,
      shift_type_id: value.shift_type_id,
      image: imageData,
      userAgent: req.headers['user-agent']
    };
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    const result = await attendanceService.markAttendance(req.user, attendanceData, ip);
    return ApiResponse.success(res, result, 'Check-in successful');
  } catch (error) {
    logger.error('App check-in failed', { error: error.message });
    next(error);
  }
});

router.post('/check-out', requireAppEmployee, prepareEmployeeUpload, async (req, res, next) => {
  try {
    const value = validate(markAttendanceSchema, req.body);
    const imageData = await buildImageData(req);
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    const result = await attendanceService.checkOutSimple(req.user, {
      latitude: value.latitude,
      longitude: value.longitude,
      geo_address: value.geo_address,
      remarks: value.remarks,
      photoPath: imageData?.path || null,
      userAgent: req.headers['user-agent']
    }, ip);
    return ApiResponse.success(res, result, 'Check-out successful');
  } catch (error) {
    logger.error('App check-out failed', { error: error.message });
    next(error);
  }
});

module.exports = router;
