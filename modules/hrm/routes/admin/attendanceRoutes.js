const express = require('express');
const router = express.Router();
const { authenticate } = require('../../../../middleware/auth');
const { hrmFeatureFlag } = require('../../middleware');
const { requireHRMAdminPermission } = require('../../middleware/permissionGuard');
const attendanceService = require('../../services/attendanceService');
const { markAttendanceByAdminSchema, attendanceQuerySchema } = require('../../validators');
const ApiResponse = require('../../../../utils/ApiResponse');

router.use(hrmFeatureFlag.checkHRMEnabled);
router.use(authenticate);
router.use(requireHRMAdminPermission('hrm.attendance.view'));

// Get attendance records for employees under admin's jurisdiction
router.get('/records', async (req, res, next) => {
  try {
    const { error, value } = attendanceQuerySchema.validate(req.query);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const result = await attendanceService.getAttendanceRecords(req.user, value);
    return ApiResponse.success(res, result, 'Attendance records retrieved');
  } catch (err) {
    next(err);
  }
});

// Mark attendance for employees (admin function)
router.post('/mark', requireHRMAdminPermission('hrm.attendance.manage'), async (req, res, next) => {
  try {
    const { error, value } = markAttendanceByAdminSchema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const result = await attendanceService.markAttendanceByAdmin(req.user, value);
    return ApiResponse.success(res, result, result.message);
  } catch (err) {
    next(err);
  }
});

// Get attendance summary (district-wise aggregation)
router.get('/summary', async (req, res, next) => {
  try {
    const { error, value } = attendanceQuerySchema.validate(req.query);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const result = await attendanceService.getAttendanceSummary(req.user, value);
    return ApiResponse.success(res, result, 'Attendance summary retrieved');
  } catch (err) {
    next(err);
  }
});

// Admin can only view attendance records and summaries
// Employees mark their own attendance via applicant routes

module.exports = router;
