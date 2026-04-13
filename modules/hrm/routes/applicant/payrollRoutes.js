const express = require('express');
const router = express.Router();
const { authenticate } = require('../../../../middleware/auth');
const { hrmFeatureFlag } = require('../../middleware');
const payrollService = require('../../services/payrollService');
const { payrollQuerySchema } = require('../../validators');
const ApiResponse = require('../../../../utils/ApiResponse');

router.use(hrmFeatureFlag.checkHRMEnabled);
router.use(authenticate);

// Get my payslips
router.get('/my', async (req, res, next) => {
  try {
    const { error, value } = payrollQuerySchema.validate(req.query);
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const employeeId = req.user.employee_id;
    if (!employeeId) {
      return res.status(403).json({ success: false, message: 'Employee profile not found' });
    }

    const result = await payrollService.getEmployeePayslips(employeeId, value);
    return ApiResponse.success(res, result, 'Payslips retrieved');
  } catch (err) {
    next(err);
  }
});

// Get single payslip detail (my own)
router.get('/:id', async (req, res, next) => {
  try {
    const employeeId = req.user.employee_id;
    if (!employeeId) {
      return res.status(403).json({ success: false, message: 'Employee profile not found' });
    }

    const result = await payrollService.getPayslipById(parseInt(req.params.id), employeeId);
    return ApiResponse.success(res, result, 'Payslip details retrieved');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
