const express = require('express');
const router = express.Router();
const { authenticate } = require('../../../../middleware/auth');
const { hrmFeatureFlag } = require('../../middleware');
const { requireHRMAdminPermission } = require('../../middleware/permissionGuard');
const simplePayrollService = require('../../services/simplePayrollService');
const ApiResponse = require('../../../../utils/ApiResponse');

router.use(hrmFeatureFlag.checkHRMEnabled);
router.use(authenticate);
router.use(requireHRMAdminPermission('hrm.payroll.view'));

/**
 * Generate simplified payroll calculation
 * Just calculates and shows payslips - no cycles, no persistence
 */
router.post('/calculate', async (req, res, next) => {
  try {
    const { month, year } = req.body;
    
    if (!month || !year) {
      return res.status(400).json({ 
        success: false, 
        message: 'Month and year are required' 
      });
    }

    const result = await simplePayrollService.generatePayroll(req.user, { month, year });
    return ApiResponse.success(res, result, 'Payroll calculated successfully');
  } catch (err) {
    next(err);
  }
});

/**
 * Get payroll summary with detailed payslips
 */
router.get('/summary', async (req, res, next) => {
  try {
    const { month, year } = req.query;
    
    if (!month || !year) {
      return res.status(400).json({ 
        success: false, 
        message: 'Month and year are required' 
      });
    }

    const result = await simplePayrollService.getPayrollSummary(req.user, { month, year });
    return ApiResponse.success(res, result, 'Payroll summary retrieved');
  } catch (err) {
    next(err);
  }
});

/**
 * Calculate payslip for a specific employee
 */
router.get('/employee/:employeeId', async (req, res, next) => {
  try {
    const { employeeId } = req.params;
    const { month, year } = req.query;
    
    if (!month || !year) {
      return res.status(400).json({ 
        success: false, 
        message: 'Month and year are required' 
      });
    }

    // Get employee details
    const EmployeeMaster = require('../../../../models').EmployeeMaster;
    const employee = await EmployeeMaster.findOne({
      where: { 
        employee_id: parseInt(employeeId), 
        is_active: true, 
        is_deleted: false 
      },
      attributes: ['employee_id', 'employee_code', 'post_id']
    });

    if (!employee) {
      return res.status(404).json({ 
        success: false, 
        message: 'Employee not found' 
      });
    }

    const result = await simplePayrollService.calculateSalaryForEmployee(
      employee, 
      parseInt(month), 
      parseInt(year)
    );
    
    return ApiResponse.success(res, result, 'Employee payslip calculated');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
