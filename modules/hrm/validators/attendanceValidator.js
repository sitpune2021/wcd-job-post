const Joi = require('joi');

const markAttendance = Joi.object({
  attendance_date: Joi.date().optional().default(() => new Date().toISOString().split('T')[0]),
  latitude: Joi.number().min(-90).max(90).allow(null),
  longitude: Joi.number().min(-180).max(180).allow(null),
  geo_address: Joi.string().max(500).allow('', null),
  remarks: Joi.string().max(500).allow('', null),
  shift_type_id: Joi.number().integer().positive().optional(),
  attendance_image: Joi.any().optional()
});

const attendanceQuery = Joi.object({
  month: Joi.number().integer().min(1).max(12),
  year: Joi.number().integer().min(2020).max(2100),
  yearly: Joi.boolean(),
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
  employee_id: Joi.number().integer().min(1),
  district_id: Joi.number().integer().min(1),
  scheme_type_id: Joi.number().integer().min(1),
  scheme_id: Joi.number().integer().min(1),
  filter_type: Joi.string().valid('all', 'osc_only', 'hub_only').default('all'),
  status: Joi.string().valid('PRESENT', 'ABSENT', 'HALF_DAY', 'ON_LEAVE', 'HOLIDAY', 'SUNDAY'),
  from_date: Joi.date().iso(),
  to_date: Joi.date().iso().min(Joi.ref('from_date')),
  search: Joi.string().max(100).allow(''),
  }).xor('month', 'from_date'); // Either month/year OR date range, not both

// Admin attendance marking schema
const markAttendanceByAdmin = Joi.object({
  employee_ids: Joi.array().items(Joi.number().integer().min(1)).min(1).required(),
  attendance_date: Joi.date().required().max('now'),
  status: Joi.string().valid('PRESENT', 'ABSENT', 'HALF_DAY', 'ON_LEAVE', 'WORK_FROM_HOME', 'WEEKLY_OFF').required(),
  remarks: Joi.string().max(500).allow('', null),
  half_day_type: Joi.string().valid('FIRST_HALF', 'SECOND_HALF').optional(),
  shift_type_id: Joi.number().integer().positive().optional(),
  admin_remark: Joi.string().trim().max(1000).optional().allow('', null),
  audit_remark: Joi.string().trim().max(1000).optional().allow('', null)
});

module.exports = {
  markAttendanceSchema: markAttendance,
  attendanceQuerySchema: attendanceQuery,
  markAttendanceByAdminSchema: markAttendanceByAdmin
};
