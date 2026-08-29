const express = require('express');
const router = express.Router();
const { authenticate } = require('../../../../middleware/auth');
const { hrmFeatureFlag } = require('../../middleware');
const { requireHRMAdminPermission } = require('../../middleware/permissionGuard');
const leaveService = require('../../services/leaveService');
const { leaveActionSchema, leaveQuerySchema } = require('../../validators');
const ApiResponse = require('../../../../utils/ApiResponse');
const db = require('../../../../models');
const adminActionAudit = require('../../services/adminActionAuditService');
const { sendPdfFromHtml, sanitizeFileName, buildSimpleReportHtml } = require('../../../../utils/reportExport');

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

// Get leave application history under admin CHRMS scope
router.get('/history', async (req, res, next) => {
  try {
    const { error, value } = leaveQuerySchema.validate(req.query);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const result = await leaveService.getLeaveHistory(req.user, value);
    return res.json(result);
  } catch (err) {
    next(err);
  }
});

// Approve or reject a leave application
router.patch('/:id/action',
  requireHRMAdminPermission('hrm.leave.manage'),
  adminActionAudit.requireAuditRemark,
  async (req, res, next) => {
  try {
    const { error, value } = leaveActionSchema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const before = await db.HrmLeaveApplication.findByPk(parseInt(req.params.id, 10), { raw: true });
    const result = await leaveService.actionLeave(req.user, parseInt(req.params.id), value);
    const after = await db.HrmLeaveApplication.findByPk(parseInt(req.params.id, 10), { raw: true });

    await adminActionAudit.recordAction(req, {
      entityType: 'HRM_LEAVE',
      entityId: req.params.id,
      requestData: value,
      oldData: before,
      newData: after || result
    });

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

router.get('/summary/pdf', async (req, res, next) => {
  try {
    const { error, value } = leaveQuerySchema.validate(req.query);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const rows = await leaveService.getAdminLeaveSummaryPdfRows(req.user, value);
    const columns = [
      { header: 'Emp Code', key: 'employee_code', width: 16 },
      { header: 'Name', key: 'full_name', width: 28 },
      { header: 'District', key: 'district_name', width: 18 },
      { header: 'Scheme Type', key: 'scheme_type_name', width: 20 },
      { header: 'Scheme Name', key: 'scheme_name', width: 26 },
      { header: 'Post', key: 'post_name', width: 18 },
      { header: 'Allocated', key: 'total_allocated', width: 12 },
      { header: 'Used', key: 'total_used', width: 10 },
      { header: 'Remaining', key: 'total_remaining', width: 12 },
      { header: 'Pending', key: 'pending_count', width: 10 },
      { header: 'Approved', key: 'approved_count', width: 10 },
      { header: 'Rejected', key: 'rejected_count', width: 10 },
      { header: 'Total', key: 'applications_count', width: 10 }
    ];

    const subtitleParts = [`Month: ${value.month}/${value.year}`];
    if (value.district_id) subtitleParts.push(`District ID: ${value.district_id}`);
    if (value.scheme_type_id) subtitleParts.push(`Scheme Type ID: ${value.scheme_type_id}`);
    if (value.scheme_id) subtitleParts.push(`Scheme ID: ${value.scheme_id}`);
    if (value.search) subtitleParts.push(`Search: ${value.search}`);

    const html = buildSimpleReportHtml('Leave Summary', columns, rows, {
      landscape: true,
      margin: '8mm',
      subtitle: subtitleParts.join(' | ')
    });

    const filename = sanitizeFileName(`leave_summary_${value.month}_${value.year}`);
    await sendPdfFromHtml(res, filename, html, {
      landscape: true,
      format: 'A4',
      margin: { top: '6mm', right: '5mm', bottom: '6mm', left: '5mm' }
    });
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
