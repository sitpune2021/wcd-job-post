const Joi = require('joi');

const markAttendance = Joi.object({
  attendance_date: Joi.date().optional().default(() => new Date().toISOString().split('T')[0]),
  latitude: Joi.number().min(-90).max(90).allow(null),
  longitude: Joi.number().min(-180).max(180).allow(null),
  geo_address: Joi.string().max(500).allow('', null),
  remarks: Joi.string().max(500).allow('', null),
  attendance_image: Joi.any().optional()
});

const attendanceQuery = Joi.object({
  month: Joi.number().integer().min(1).max(12),
  year: Joi.number().integer().min(2020).max(2100),
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
  employee_id: Joi.number().integer().min(1),
  district_id: Joi.number().integer().min(1),
  status: Joi.string().valid('PRESENT', 'ABSENT', 'HALF_DAY', 'ON_LEAVE', 'HOLIDAY', 'SUNDAY'),
  from_date: Joi.date().iso(),
  to_date: Joi.date().iso().min(Joi.ref('from_date')),
  search: Joi.string().max(100).allow('')
});

// Admin attendance marking schema
const markAttendanceByAdmin = Joi.object({
  employee_ids: Joi.array().items(Joi.number().integer().min(1)).min(1).required(),
  attendance_date: Joi.date().required().max('now'),
  status: Joi.string().valid('PRESENT', 'ABSENT', 'HALF_DAY', 'ON_LEAVE', 'WORK_FROM_HOME').required(),
  remarks: Joi.string().max(500).allow('', null),
  half_day_type: Joi.string().valid('FIRST_HALF', 'SECOND_HALF').when('status', {
    is: 'HALF_DAY',
    then: Joi.required(),
    otherwise: Joi.optional()
  })
});

module.exports = {
  markAttendanceSchema: markAttendance,
  attendanceQuerySchema: attendanceQuery,
  markAttendanceByAdminSchema: markAttendanceByAdmin
};
