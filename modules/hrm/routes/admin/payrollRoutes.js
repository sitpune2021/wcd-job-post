const express = require('express');
const router = express.Router();
const { authenticate } = require('../../../../middleware/auth');
const { hrmFeatureFlag } = require('../../middleware');
const { requireHRMAdminPermission } = require('../../middleware/permissionGuard');
const payrollService = require('../../services/payrollService');
const { generatePayrollSchema, payrollQuerySchema } = require('../../validators');
const ApiResponse = require('../../../../utils/ApiResponse');

router.use(hrmFeatureFlag.checkHRMEnabled);
router.use(authenticate);
router.use(requireHRMAdminPermission('hrm.payroll.view'));

// Generate payroll for a month
router.post('/generate', requireHRMAdminPermission('hrm.payroll.manage'), async (req, res, next) => {
  try {
    const { error, value } = generatePayrollSchema.validate(req.body);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const result = await payrollService.generatePayroll(req.user, value);
    return ApiResponse.success(res, result, 'Payroll generated successfully');
  } catch (err) {
    next(err);
  }
});

// Get payroll cycles
router.get('/cycles', async (req, res, next) => {
  try {
    const { error, value } = payrollQuerySchema.validate(req.query);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const result = await payrollService.getPayrollCycles(req.user, value);
    return ApiResponse.success(res, result, 'Payroll cycles retrieved');
  } catch (err) {
    next(err);
  }
});

// Mark payroll cycle as paid
router.patch('/cycles/:id/mark-paid', requireHRMAdminPermission('hrm.payroll.manage'), async (req, res, next) => {
  try {
    const result = await payrollService.markPayrollAsPaid(req.user, parseInt(req.params.id));
    return ApiResponse.success(res, result, 'Payroll cycle marked as paid successfully');
  } catch (err) {
    next(err);
  }
});

// Get payslips (admin view)
router.get('/payslips', async (req, res, next) => {
  try {
    const { error, value } = payrollQuerySchema.validate(req.query);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const result = await payrollService.getPayslips(req.user, value);
    return ApiResponse.success(res, result, 'Payslips retrieved');
  } catch (err) {
    next(err);
  }
});

// Get single payslip detail
router.get('/payslips/:id', async (req, res, next) => {
  try {
    const result = await payrollService.getPayslipById(parseInt(req.params.id));
    return ApiResponse.success(res, result, 'Payslip details retrieved');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
