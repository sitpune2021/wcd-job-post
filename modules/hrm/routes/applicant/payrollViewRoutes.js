const express = require('express');
const router = express.Router();
const { authenticate } = require('../../../../middleware/auth');
const { hrmFeatureFlag } = require('../../middleware');
const { ApiError } = require('../../../../middleware/errorHandler');
const Joi = require('joi');
const ApiResponse = require('../../../../utils/ApiResponse');
const simplePayrollViewService = require('../../services/simplePayrollViewService');

// Apply common middleware
router.use(hrmFeatureFlag.checkHRMEnabled);
router.use(authenticate);

// Validation schema
const payslipQuerySchema = Joi.object({
  month: Joi.number().integer().min(1).max(12).required(),
  year: Joi.number().integer().min(2020).max(2030).required()
});

/**
 * @route GET /api/hrm/applicant/payroll-view/mypayslip
 * @desc Get own payslip for specific month and year
 * @access Employee  may not be used
 */
router.get('/mypayslip', async (req, res, next) => {
  try {
    // Check if user is an employee
    const { getEmployeeFromUser } = require('../../utils/hrmHelpers');
    const db = require('../../../../models');
    const EmployeeMaster = db.EmployeeMaster;
    
    const employee = await getEmployeeFromUser(req.user, EmployeeMaster);
    if (!employee) {
      throw ApiError.forbidden('Access denied. Employee profile not found.');
    }

    const { error, value } = payslipQuerySchema.validate(req.query);
    if (error) {
      throw ApiError.badRequest(error.details[0].message);
    }

    const result = await simplePayrollViewService.getMyPayslip(
      employee.employee_id,
      value.month,
      value.year
    );
    return ApiResponse.success(res, result, 'Payslip retrieved successfully');
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/hrm/applicant/payroll-view/mypayslips
 * @desc Get own payslips for multiple months with pagination
 * @access Employee
 */
router.get('/mypayslips', async (req, res, next) => {
  try {
    // Check if user is an employee
    const { getEmployeeFromUser } = require('../../utils/hrmHelpers');
    const db = require('../../../../models');
    const EmployeeMaster = db.EmployeeMaster;
    
    const employee = await getEmployeeFromUser(req.user, EmployeeMaster);
    
    if (!employee) {
      throw ApiError.forbidden('Access denied. Employee profile not found.');
    }

    const { month, year, page = 1, limit = 12 } = req.query;
    
    let employeeDetails;
    try {
      // Use Sequelize model with only existing columns
      employeeDetails = await EmployeeMaster.findOne({
        where: { 
          employee_id: employee.employee_id,
          is_deleted: false 
        },
        attributes: ['employee_id', 'employee_code', 'contract_start_date', 'contract_end_date', 'employee_pay', 'post_id', 'district_id']
      });
    } catch (queryError) {
      throw queryError;
    }

    if (!employeeDetails) {
      throw ApiError.notFound('Employee not found');
    }

    // Get employee pay - try employee record first, then post
    let monthlyPay = parseFloat(employeeDetails.employee_pay || 0);
    
    // If employee pay is not set, try to get from post
    if (monthlyPay === 0 && employeeDetails.post_id) {
      try {
        const post = await db.PostMaster.findOne({
          where: { post_id: employeeDetails.post_id },
          attributes: ['amount']
        });
        monthlyPay = parseFloat(post?.amount || 0);
      } catch (postError) {
        // Silently handle post fetch error
      }
    }
    
    // Calculate contract info
    const today = new Date();
    const contractStart = employeeDetails.contract_start_date ? new Date(employeeDetails.contract_start_date) : null;
    const contractEnd = employeeDetails.contract_end_date ? new Date(employeeDetails.contract_end_date) : null;
    
    let monthsWorked = 0;
    let monthsLeft = 0;
    
    if (contractStart && contractEnd) {
      // Total contract period in months (typically 11 months)
      const diffTime = Math.abs(contractEnd - contractStart);
      const contractPeriod = Math.ceil(diffTime / (1000 * 60 * 60 * 24 * 30));
      
      // Months worked
      if (today >= contractStart) {
        const workedTime = Math.abs(today - contractStart);
        monthsWorked = Math.ceil(workedTime / (1000 * 60 * 60 * 24 * 30));
      }
      
      // Months left
      if (today < contractEnd) {
        const leftTime = Math.abs(contractEnd - today);
        monthsLeft = Math.ceil(leftTime / (1000 * 60 * 60 * 24 * 30));
      }
    }

    // Build list of months to fetch (paginated)
    const payslips = [];
    const currentPage = parseInt(page);
    const pageSize = parseInt(limit);
    const offset = (currentPage - 1) * pageSize;
    
    // Start from current month or specified month
    const startMonth = month ? parseInt(month) : new Date().getMonth() + 1;
    const startYear = year ? parseInt(year) : new Date().getFullYear();
    
    // Calculate total months to check
    const totalMonths = monthsWorked || 12; // Default to 12 if no contract
    const totalPages = Math.ceil(totalMonths / pageSize);
    
    // Fetch payslips for the current page
    for (let i = offset; i < offset + pageSize && i < totalMonths; i++) {
      let currentMonth = startMonth - i;
      let currentYear = startYear;
      
      if (currentMonth < 1) {
        currentMonth += 12;
        currentYear -= 1;
      }

      try {
        const attendance = await simplePayrollViewService.calculateAttendanceSummary(
          employee.employee_id,
          currentMonth,
          currentYear
        );
        
        const perDaySalary = monthlyPay / attendance.working_days;
        const calculatedSalary = perDaySalary * attendance.paid_days;
        const deductionAmount = perDaySalary * attendance.absent_days;

        payslips.push({
          month: currentMonth,
          year: currentYear,
          month_name: new Date(currentYear, currentMonth - 1).toLocaleString('default', { month: 'long' }),
          gross_salary: parseFloat(monthlyPay.toFixed(2)),
          deducted_amount: parseFloat(deductionAmount.toFixed(2)),
          net_pay: parseFloat(calculatedSalary.toFixed(2)),
          working_days: attendance.working_days,
          present_days: attendance.present_days,
          leave_days: attendance.leave_days,
          absent_days: attendance.absent_days
        });
      } catch (error) {
        // Skip months with errors
        continue;
      }
    }

    // Get last paid info (previous month with data)
    let lastPaidGross = 0;
    let lastPaidMonth = null;
    let lastPaidYear = null;
    
    if (payslips.length > 0 && payslips[payslips.length - 1]) {
      const lastPayslip = payslips[payslips.length - 1];
      lastPaidGross = lastPayslip.gross_salary;
      lastPaidMonth = lastPayslip.month;
      lastPaidYear = lastPayslip.year;
    }

    return ApiResponse.success(res, {
      employee: {
        employee_id: employeeDetails.employee_id,
        employee_code: employeeDetails.employee_code
      },
      last_paid: {
        gross_total: lastPaidGross,
        month: lastPaidMonth,
        year: lastPaidYear,
        month_name: lastPaidMonth ? new Date(lastPaidYear, lastPaidMonth - 1).toLocaleString('default', { month: 'long' }) : null
      },
      contract: {
        start_date: employeeDetails.contract_start_date,
        end_date: employeeDetails.contract_end_date,
        months_left: monthsLeft
      },
      payslips: payslips,
      pagination: {
        current_page: currentPage,
        total_pages: totalPages,
        total_records: totalMonths,
        records_on_page: payslips.length
      }
    }, 'Payslips retrieved successfully');
  } catch (error) {
    next(error);
  }
});

module.exports = router;
