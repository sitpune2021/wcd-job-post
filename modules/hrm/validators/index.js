const { markAttendanceSchema, markAttendanceByAdminSchema, attendanceQuerySchema } = require('./attendanceValidator');
const { applyLeaveSchema, leaveActionSchema, leaveQuerySchema } = require('./leaveValidator');
const { submitReportSchema, reviewReportSchema, reportQuerySchema } = require('./reportValidator');
const { selfEvaluationSchema, appraiserReviewSchema, performanceQuerySchema } = require('./performanceValidator');
const { logFieldVisitSchema, fieldVisitQuerySchema } = require('./fieldVisitValidator');
const { generatePayrollSchema, payrollQuerySchema } = require('./payrollValidator');

module.exports = {
  markAttendanceSchema,
  markAttendanceByAdminSchema,
  attendanceQuerySchema,
  applyLeaveSchema,
  leaveActionSchema,
  leaveQuerySchema,
  submitReportSchema,
  reviewReportSchema,
  reportQuerySchema,
  selfEvaluationSchema,
  appraiserReviewSchema,
  performanceQuerySchema,
  logFieldVisitSchema,
  fieldVisitQuerySchema,
  generatePayrollSchema,
  payrollQuerySchema
};
