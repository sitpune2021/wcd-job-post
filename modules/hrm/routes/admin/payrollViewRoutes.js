const express = require('express');
const router = express.Router();
const { authenticate } = require('../../../../middleware/auth');
const { hrmFeatureFlag } = require('../../middleware');
const { requireHRMAdminPermission } = require('../../middleware/permissionGuard');
const { ApiError } = require('../../../../middleware/errorHandler');
const Joi = require('joi');
const ApiResponse = require('../../../../utils/ApiResponse');
const simplePayrollViewService = require('../../services/simplePayrollViewService');

// Apply common middleware
router.use(hrmFeatureFlag.checkHRMEnabled);
router.use(authenticate);
router.use(requireHRMAdminPermission('hrm.payroll.view'));

// Validation schemas
const payslipQuerySchema = Joi.object({
  month: Joi.number().integer().min(1).max(12).required(),
  year: Joi.number().integer().min(2020).max(2100).required(),
  employee_id: Joi.number().integer().optional(),
  district_id: Joi.number().integer().optional(),
  search: Joi.string().max(100).optional(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10)
});

const singlePayslipSchema = Joi.object({
  employee_id: Joi.number().integer().required(),
  month: Joi.number().integer().min(1).max(12).required(),
  year: Joi.number().integer().min(2020).max(2030).required()
});

/**
 * @route GET /api/hrm/admin/payroll-view/payslips
 * @desc Get payslips for multiple employees with filters
 * @access Admin
 */
router.get('/payslips', async (req, res, next) => {
  try {
    const { error, value } = payslipQuerySchema.validate(req.query);
    if (error) {
      throw ApiError.badRequest(error.details[0].message);
    }

    const result = await simplePayrollViewService.getEmployeesPayslips(req.user, value);
    return ApiResponse.success(res, result, 'Payslips retrieved successfully');
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/hrm/admin/payroll-view/payslip
 * @desc Get single employee payslip
 * @access Admin
 */
router.get('/payslip', async (req, res, next) => {
  try {
    const { error, value } = singlePayslipSchema.validate(req.query);
    if (error) {
      throw ApiError.badRequest(error.details[0].message);
    }

    const result = await simplePayrollViewService.getEmployeePayslip(
      req.user,
      value.employee_id,
      value.month,
      value.year
    );
    return ApiResponse.success(res, result, 'Payslip retrieved successfully');
  } catch (error) {
    next(error);
  }
});


/**
 * @route GET /api/hrm/admin/payroll-view/payslips/export
 * @desc Export payslips as Excel or PDF
 * @access Admin
 */
router.get('/payslips/export', async (req, res, next) => {
  try {
    const { error, value } = payslipQuerySchema.validate(req.query);
    if (error) {
      throw ApiError.badRequest(error.details[0].message);
    }

    const { format = 'excel' } = req.query;
    
    // Get payslips data
    const result = await simplePayrollViewService.getEmployeesPayslips(req.user, value);
    
    if (format === 'excel') {
      const { sendXlsxFromRows, sanitizeFileName } = require('../../../../utils/reportExport');
      
      const columns = [
        { header: 'Employee Code', key: 'employee_code', width: 15 },
        { header: 'District', key: 'district_name', width: 15 },
        { header: 'Post', key: 'post_name', width: 20 },
        { header: 'Basic Salary', key: 'basic_salary', width: 12 },
        { header: 'Deductions', key: 'deducted_amount', width: 12 },
        { header: 'Net Pay', key: 'net_pay', width: 12 }
      ];

      const rows = result.employees || [];
      const filename = sanitizeFileName(`payslips_${value.month}_${value.year}`);
      
      await sendXlsxFromRows(res, filename, columns, rows);
    } else if (format === 'pdf') {
      const { sendPdfFromHtml, sanitizeFileName } = require('../../../../utils/reportExport');
      
      // Generate HTML for PDF
      const html = generatePayslipHtml(result, value);
      const filename = sanitizeFileName(`payslips_${value.month}_${value.year}`);
      
      await sendPdfFromHtml(res, filename, html);
    } else {
      throw ApiError.badRequest('Invalid format. Use excel or pdf');
    }
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/hrm/admin/payroll-view/payslip/:employeeId/export
 * @desc Export single employee payslip as PDF
 * @access Admin
 */
router.get('/payslip/:employeeId/export', async (req, res, next) => {
  try {
    const { employeeId } = req.params;
    const { month, year, format = 'pdf' } = req.query;
    
    if (!month || !year) {
      throw ApiError.badRequest('Month and year are required');
    }

    const result = await simplePayrollViewService.getEmployeePayslip(
      req.user,
      parseInt(employeeId),
      parseInt(month),
      parseInt(year)
    );
    
    if (format === 'pdf') {
      const { sendPdfFromHtml, sanitizeFileName } = require('../../../../utils/reportExport');
      
      const html = generateSinglePayslipHtml(result, { month, year });
      const filename = sanitizeFileName(`payslip_${result.employee.employee_code}_${month}_${year}`);
      
      await sendPdfFromHtml(res, filename, html);
    } else {
      throw ApiError.badRequest('Only PDF format is supported for individual payslips');
    }
  } catch (error) {
    next(error);
  }
});

// Helper function to generate payslip HTML
const generatePayslipHtml = (data, filters) => {
  const { summary, employees } = data;
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Payslips Report - ${filters.month} ${filters.year}</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .header { text-align: center; margin-bottom: 30px; }
        .summary { background: #f5f5f5; padding: 15px; margin-bottom: 20px; border-radius: 5px; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; font-weight: bold; }
        .text-right { text-align: right; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>Payslips Report</h1>
        <h2>${filters.month} ${filters.year}</h2>
      </div>
      
      <div class="summary">
        <h3>Summary</h3>
        <p><strong>Total Employees:</strong> ${summary.total_employees}</p>
        <p><strong>Total Gross Salary:</strong> INR ${summary.total_gross_salary.toLocaleString()}</p>
        <p><strong>Total Deductions:</strong> INR ${summary.total_deduction.toLocaleString()}</p>
        <p><strong>Total Net Pay:</strong> INR ${summary.total_net_pay.toLocaleString()}</p>
      </div>
      
      <table>
        <thead>
          <tr>
            <th>Employee Code</th>
            <th>District</th>
            <th>Post</th>
            <th>Basic Salary</th>
            <th>Deductions</th>
            <th>Net Pay</th>
          </tr>
        </thead>
        <tbody>
          ${employees.map(emp => `
            <tr>
              <td>${emp.employee_code}</td>
              <td>${emp.district_name}</td>
              <td>${emp.post_name}</td>
              <td class="text-right">INR ${emp.basic_salary.toLocaleString()}</td>
              <td class="text-right">INR ${emp.deducted_amount.toLocaleString()}</td>
              <td class="text-right"><strong>INR ${emp.net_pay.toLocaleString()}</strong></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </body>
    </html>
  `;
};

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

/**
 * @route GET /api/hrm/admin/payroll-view/payslip/export
 * @desc Export single employee payslip as Excel
 * @access Admin
 */
router.get('/payslip/export', async (req, res, next) => {
  try {
    const { error, value } = singlePayslipSchema.validate(req.query);
    if (error) {
      throw ApiError.badRequest(error.details[0].message);
    }

    const payslipData = await simplePayrollViewService.getEmployeePayslip(
      req.user,
      value.employee_id,
      value.month,
      value.year
    );

    // Generate Excel file using existing reportExport utility
    const reportExport = require('../../../../utils/reportExport');
    
    // Prepare payslip data for Excel
    const columns = [
      { key: 'label', header: 'Description', width: 30 },
      { key: 'value', header: 'Amount', width: 20 }
    ];
    
    const rows = [
      { label: 'Employee Code', value: payslipData.employee.employee_code },
      { label: 'Employee Name', value: payslipData.employee.full_name },
      { label: 'Post', value: payslipData.employee.post_name },
      { label: 'District', value: payslipData.employee.district_name },
      { label: 'Pay Period', value: `${payslipData.pay_period.month_name} ${payslipData.pay_period.year}` },
      { label: '', value: '' },
      { label: 'Monthly Pay', value: `₹${payslipData.salary.monthly_pay.toLocaleString('en-IN')}` },
      { label: 'Calculated Salary', value: `₹${payslipData.salary.calculated_salary.toLocaleString('en-IN')}` },
      { label: 'Attendance Deduction', value: `₹${payslipData.salary.attendance_deduction.toLocaleString('en-IN')}` },
      { label: 'Additional Deductions', value: `₹${payslipData.salary.additional_deductions.toLocaleString('en-IN')}` },
      { label: 'Total Deduction', value: `₹${payslipData.salary.total_deduction.toLocaleString('en-IN')}` },
      { label: 'Net Salary', value: `₹${payslipData.salary.net_salary.toLocaleString('en-IN')}` }
    ];
    
    // Add deduction breakdown if exists
    if (payslipData.salary.deduction_breakdown && payslipData.salary.deduction_breakdown.length > 0) {
      rows.push({ label: '', value: '' });
      rows.push({ label: 'Deduction Breakdown', value: '' });
      payslipData.salary.deduction_breakdown.forEach(deduction => {
        rows.push({ label: deduction.name, value: `₹${deduction.amount.toLocaleString('en-IN')}` });
        rows.push({ label: `  ${deduction.reason}`, value: '' });
      });
    }
    
    const filename = `payslip_${payslipData.employee.employee_code}_${value.month}_${value.year}`;
    await reportExport.sendXlsxFromRows(res, filename, columns, rows);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
