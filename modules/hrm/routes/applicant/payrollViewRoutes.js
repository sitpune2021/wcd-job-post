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
      // Calculate months left more accurately
      if (today < contractEnd) {
        const yearsDiff = contractEnd.getFullYear() - today.getFullYear();
        const monthsDiff = contractEnd.getMonth() - today.getMonth();
        monthsLeft = yearsDiff * 12 + monthsDiff;
        
        // Adjust for partial months
        const dayDiff = contractEnd.getDate() - today.getDate();
        if (dayDiff < 0 && monthsLeft > 0) {
          monthsLeft--;
        }
      }
    }

    // Build list of months to fetch (paginated)
    const payslips = [];
    const currentPage = parseInt(page);
    const pageSize = parseInt(limit);
    const offset = (currentPage - 1) * pageSize;
    
    // Start from current month or specified month
    const baseMonth = month ? parseInt(month) : new Date().getMonth() + 1;
    const baseYear = year ? parseInt(year) : new Date().getFullYear();
    
    // Generate months going backwards from current month
    const monthsToGenerate = [];
    for (let i = 0; i < pageSize * 3; i++) { // Generate enough months
      let currentMonth = baseMonth - i;
      let currentYear = baseYear;
      
      if (currentMonth < 1) {
        currentMonth += 12;
        currentYear -= 1;
      }
      
      monthsToGenerate.push({ month: currentMonth, year: currentYear });
    }
    
    // Filter months within contract period
    const validMonths = monthsToGenerate.filter(({ month: currentMonth, year: currentYear }) => {
      const currentDate = new Date(currentYear, currentMonth - 1, 1);
      const monthEnd = new Date(currentYear, currentMonth, 0); // Last day of the month
      
      // Skip months before contract start date (allow current month if contract started within it)
      if (contractStart && monthEnd < contractStart) {
        return false;
      }
      
      // Skip months after contract end date
      if (contractEnd && currentDate > contractEnd) {
        return false;
      }
      
      return true;
    });
    
    // Paginate the valid months
    const paginatedMonths = validMonths.slice(offset, offset + pageSize);
    const totalMonths = validMonths.length;
    const totalPages = Math.ceil(totalMonths / pageSize);
    
    // Fetch payslips for the current page
    for (const { month: currentMonth, year: currentYear } of paginatedMonths) {
      console.log(`Processing payslip for employee ${employee.employee_id}, month ${currentMonth}, year ${currentYear}`);

      try {
        let attendance;
        try {
          attendance = await simplePayrollViewService.calculateAttendanceSummary(
            employee.employee_id,
            currentMonth,
            currentYear
          );
          console.log(`Attendance calculated:`, attendance);
        } catch (attendanceError) {
          console.log(`Attendance calculation failed, using defaults:`, attendanceError.message);
          // Use default attendance if calculation fails
          attendance = {
            working_days: 26,
            present_days: 26,
            leave_days: 0,
            absent_days: 0,
            paid_days: 26
          };
        }
        
        // Ensure attendance has valid values
        const workingDays = attendance.working_days || 26;
        const paidDays = attendance.paid_days || workingDays;
        const absentDays = attendance.absent_days || 0;
        
        const perDaySalary = monthlyPay / workingDays;
        const calculatedSalary = perDaySalary * paidDays;
        const deductionAmount = perDaySalary * absentDays;

        const payslipData = {
          month: currentMonth,
          year: currentYear,
          month_name: new Date(currentYear, currentMonth - 1).toLocaleString('default', { month: 'long' }),
          gross_salary: parseFloat(monthlyPay.toFixed(2)),
          deducted_amount: parseFloat(deductionAmount.toFixed(2)),
          net_pay: parseFloat(calculatedSalary.toFixed(2)),
          working_days: workingDays,
          present_days: attendance.present_days || paidDays,
          leave_days: attendance.leave_days || 0,
          absent_days: absentDays
        };
        
        console.log(`Generated payslip:`, payslipData);
        payslips.push(payslipData);
      } catch (error) {
        console.log(`Payslip generation failed, using defaults:`, error.message);
        // Add default payslip even if everything fails
        const workingDays = 26;
        const paidDays = 26;
        
        const defaultPayslip = {
          month: currentMonth,
          year: currentYear,
          month_name: new Date(currentYear, currentMonth - 1).toLocaleString('default', { month: 'long' }),
          gross_salary: parseFloat(monthlyPay.toFixed(2)),
          deducted_amount: 0,
          net_pay: parseFloat(monthlyPay.toFixed(2)),
          working_days: workingDays,
          present_days: paidDays,
          leave_days: 0,
          absent_days: 0
        };
        
        console.log(`Generated default payslip:`, defaultPayslip);
        payslips.push(defaultPayslip);
      }
    }

    console.log(`Final payslips array:`, payslips);
    console.log(`Total payslips generated: ${payslips.length}`);

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

/**
 * @route GET /api/hrm/applicant/payroll-view/mypayslip/export
 * @desc Export own payslip as PDF
 * @access Employee
 */
router.get('/mypayslip/export', async (req, res, next) => {
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
    
    const { sendPdfFromHtml, sanitizeFileName } = require('../../../../utils/reportExport');
    
    // Generate HTML for PDF
    const html = generateSinglePayslipHtml(result, value);
    const filename = sanitizeFileName(`payslip_${employee.employee_code}_${value.month}_${value.year}`);
    
    await sendPdfFromHtml(res, filename, html);
  } catch (error) {
    next(error);
  }
});

// Helper function to generate single payslip HTML
const generateSinglePayslipHtml = (data, filters) => {
  const { employee, attendance, payslip } = data;
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Payslip - ${employee.employee_code}</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .header { text-align: center; margin-bottom: 30px; }
        .employee-info { background: #f5f5f5; padding: 15px; margin-bottom: 20px; border-radius: 5px; }
        .salary-details { margin-bottom: 20px; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; font-weight: bold; }
        .text-right { text-align: right; }
        .total { font-weight: bold; background-color: #f9f9f9; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>Employee Payslip</h1>
        <h2>${filters.month} ${filters.year}</h2>
      </div>
      
      <div class="employee-info">
        <h3>Employee Information</h3>
        <p><strong>Employee Code:</strong> ${employee.employee_code}</p>
        <p><strong>District:</strong> ${employee.district_name}</p>
        <p><strong>Post:</strong> ${employee.post_name}</p>
      </div>
      
      <div class="salary-details">
        <h3>Attendance Details</h3>
        <table>
          <tr>
            <td>Working Days</td>
            <td class="text-right">${attendance.working_days}</td>
          </tr>
          <tr>
            <td>Present Days</td>
            <td class="text-right">${attendance.present_days}</td>
          </tr>
          <tr>
            <td>Leave Days</td>
            <td class="text-right">${attendance.leave_days}</td>
          </tr>
          <tr>
            <td>Absent Days</td>
            <td class="text-right">${attendance.absent_days}</td>
          </tr>
        </table>
      </div>
      
      <div class="salary-details">
        <h3>Salary Calculation</h3>
        <table>
          <tr>
            <td>Basic Salary</td>
            <td class="text-right">INR ${payslip.basic_salary.toLocaleString()}</td>
          </tr>
          <tr>
            <td>Deductions (Absent Days)</td>
            <td class="text-right">INR ${payslip.deducted_amount.toLocaleString()}</td>
          </tr>
          <tr class="total">
            <td><strong>Net Pay</strong></td>
            <td class="text-right"><strong>INR ${payslip.net_pay.toLocaleString()}</strong></td>
          </tr>
        </table>
      </div>
    </body>
    </html>
  `;
};

module.exports = router;
