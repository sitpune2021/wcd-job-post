const express = require('express');
const router = express.Router();
const { authenticate } = require('../../../../middleware/auth');
const { hrmFeatureFlag } = require('../../middleware');
const { requireHRMAdminPermission } = require('../../middleware/permissionGuard');
const leaveService = require('../../services/leaveService');
const { leaveActionSchema, leaveQuerySchema } = require('../../validators');
const ApiResponse = require('../../../../utils/ApiResponse');

router.use(hrmFeatureFlag.checkHRMEnabled);
router.use(authenticate);
router.use(requireHRMAdminPermission('hrm.leave.view'));

// Get leave approvals (pending leaves from employees under jurisdiction)
router.get('/approvals', async (req, res, next) => {
  try {
    const { error, value } = leaveQuerySchema.validate(req.query);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const result = await leaveService.getLeaveApprovals(req.user, value);
    return res.json(result);
  } catch (err) {
    next(err);
  }
});

// Approve or reject a leave application
router.patch('/:id/action', requireHRMAdminPermission('hrm.leave.manage'), async (req, res, next) => {
  try {
    const { error, value } = leaveActionSchema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const result = await leaveService.actionLeave(req.user, parseInt(req.params.id), value);
    return ApiResponse.success(res, result, `Leave ${value.status.toLowerCase()} successfully`);
  } catch (err) {
    next(err);
  }
});

// Get leave summary (per-employee breakdown)
router.get('/summary', async (req, res, next) => {
  try {
    const { error, value } = leaveQuerySchema.validate(req.query);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const result = await leaveService.getAdminLeaveSummary(req.user, value);
    return res.json(result);
  } catch (err) {
    next(err);
  }
});

// Get all leave types
router.get('/types', async (req, res, next) => {
  try {
    const result = await leaveService.getLeaveTypes();
    return ApiResponse.success(res, result, 'Leave types retrieved');
  } catch (err) {
    next(err);
  }
});

// Admin can only approve/reject leave applications and view summaries
// Employees apply for leave via applicant routes

module.exports = router;
