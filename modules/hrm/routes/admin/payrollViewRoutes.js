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
  scheme_type_id: Joi.number().integer().optional(),
  scheme_id: Joi.number().integer().optional(),
  search: Joi.string().max(100).optional(),
  format: Joi.string().valid('excel', 'pdf').optional(),
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

    const { format = 'excel' } = value;
    const columns = [
      { header: 'Beneficiary Name', key: 'beneficiary_name', width: 30 },
      { header: 'Beneficiary Name as per Bank', key: 'beneficiary_name_as_per_bank', width: 32 },
      { header: 'Bank Name', key: 'bank_name', width: 24 },
      { header: 'Aadhaar Number', key: 'aadhaar_number', width: 18 },
      { header: 'Account Number', key: 'account_number', width: 22 },
      { header: 'IFSC Code', key: 'ifsc_code', width: 16 },
      { header: 'State', key: 'state', width: 18 },
      { header: 'District', key: 'district', width: 18 },
      { header: 'Scheme Type', key: 'scheme_type_name', width: 22 },
      { header: 'Scheme Name', key: 'scheme_name', width: 28 },
      { header: 'Present Days', key: 'present_days', width: 14 },
      { header: 'Absent Days', key: 'absent_days', width: 14 },
      { header: 'Total Days', key: 'total_days', width: 14 },
      { header: 'Weekly Off Days', key: 'weekly_off_days', width: 16 },
      { header: 'Leave Days', key: 'leave_days', width: 14 },
      { header: 'Half Days', key: 'half_days', width: 14 },
      { header: 'Paid Days', key: 'paid_days', width: 14 },
      { header: 'Deducted Days', key: 'deducted_days', width: 16 },
      { header: 'Centre Share Payment Amount', key: 'center_share_payment_amount', width: 24 },
      { header: 'State Share Payment Amount', key: 'state_share_payment_amount', width: 24 },
      { header: 'Total', key: 'total_amount', width: 16 }
    ];
    
    if (format === 'excel') {
      const { sendXlsxFromRows, sanitizeFileName } = require('../../../../utils/reportExport');

      const rows = await simplePayrollViewService.getPayrollPaymentLogRows(req.user, value);
      const filename = sanitizeFileName(`salary_payment_log_${value.month}_${value.year}`);
      
      await sendXlsxFromRows(res, filename, columns, rows);
    } else if (format === 'pdf') {
      const { sendPdfFromHtml, sanitizeFileName, buildSimpleReportHtml } = require('../../../../utils/reportExport');
      const rows = await simplePayrollViewService.getPayrollPaymentLogRows(req.user, value);
      const filterLabels = await simplePayrollViewService.resolvePayrollFilterLabels(value);
      const subtitleParts = [`Month: ${value.month}/${value.year}`];
      if (filterLabels.district_name) subtitleParts.push(`District: ${filterLabels.district_name}`);
      if (filterLabels.scheme_type_name) subtitleParts.push(`Scheme Type: ${filterLabels.scheme_type_name}`);
      if (filterLabels.scheme_name) subtitleParts.push(`Scheme: ${filterLabels.scheme_name}`);
      if (value.employee_id) subtitleParts.push(`Employee ID: ${value.employee_id}`);
      if (value.search) subtitleParts.push(`Search: ${value.search}`);

      const html = buildSimpleReportHtml(
        'Salary Payment Log',
        columns,
        rows,
        {
          landscape: true,
          margin: '8mm',
          subtitle: subtitleParts.join(' | ')
        }
      );
      const filename = sanitizeFileName(`salary_payment_log_${value.month}_${value.year}`);
      
      await sendPdfFromHtml(res, filename, html, {
        landscape: true,
        format: 'A4',
        margin: { top: '6mm', right: '5mm', bottom: '6mm', left: '5mm' }
      });
    } else {
      throw ApiError.badRequest('Invalid format. Use excel or pdf');
    }
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/hrm/admin/payroll-view/payslip/export
 * @desc Export single employee payslip as PDF
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

    // Generate PDF file using reportExport utility
    const reportExport = require('../../../../utils/reportExport');
    
    const html = reportExport.buildPayslipHtml(payslipData);
    const filename = `payslip_${payslipData.employee.employee_code}_${value.month}_${value.year}`;
    
    await reportExport.sendPdfFromHtml(res, filename, html);
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
const generatePaymentLogPdfHtml = (rows, filters) => {
  const filterBadges = [
    `Month: ${filters.month}/${filters.year}`,
    filters.district_id ? `District: ${filters.district_id}` : null,
    filters.scheme_id ? `Scheme: ${filters.scheme_id}` : null,
    filters.employee_id ? `Employee ID: ${filters.employee_id}` : null,
    filters.search ? `Search: ${filters.search}` : null
  ].filter(Boolean);

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Salary Payment Log - ${filters.month} ${filters.year}</title>
      <style>
        @page { size: A4 landscape; margin: 6mm 5mm; }
        body { font-family: Arial, sans-serif; margin: 0; color: #111827; font-size: 8px; }
        .page { padding: 2mm 0 0; }
        .header { text-align: center; margin-bottom: 6px; }
        .header h1 { margin: 0; font-size: 14px; line-height: 1.15; }
        .meta { display: flex; flex-wrap: wrap; gap: 4px; justify-content: center; margin: 6px 0 8px; }
        .meta span { border: 1px solid #d1d5db; background: #f8fafc; padding: 2px 6px; border-radius: 999px; font-size: 8px; line-height: 1.1; white-space: nowrap; }
        table { width: 100%; border-collapse: collapse; table-layout: fixed; }
        th, td { border: 1px solid #d4d4d8; padding: 3px 4px; text-align: left; font-size: 7.5px; line-height: 1.15; vertical-align: top; word-break: break-word; }
        th { background-color: #eef2f7; font-weight: bold; white-space: nowrap; }
        td.text-right, .text-right { text-align: right; }
        .subtle { color: #6b7280; font-size: 8px; }
        .table-wrap { width: 100%; overflow: hidden; }
        .nowrap { white-space: nowrap; }
        .small { font-size: 7px; }
      </style>
    </head>
    <body>
      <div class="page">
        <div class="header">
          <h1>Salary Payment Log</h1>
          <div class="subtle">Landscape export aligned to the Excel payment log</div>
        </div>
        <div class="meta">
          ${filterBadges.map((badge) => `<span>${badge}</span>`).join('')}
        </div>
        <div class="table-wrap">
          <table>
            <colgroup>
              <col style="width: 8%;" />
              <col style="width: 8%;" />
              <col style="width: 8%;" />
              <col style="width: 7%;" />
              <col style="width: 8%;" />
              <col style="width: 7%;" />
              <col style="width: 6%;" />
              <col style="width: 7%;" />
              <col style="width: 5.5%;" />
              <col style="width: 5.5%;" />
              <col style="width: 5.5%;" />
              <col style="width: 6%;" />
              <col style="width: 5.5%;" />
              <col style="width: 5.5%;" />
              <col style="width: 8.5%;" />
              <col style="width: 8.5%;" />
              <col style="width: 6.5%;" />
            </colgroup>
            <thead>
              <tr>
                <th>Beneficiary Name</th>
                <th>Beneficiary Name as per Bank</th>
                <th>Bank Name</th>
                <th>Aadhaar Number</th>
                <th>Account Number</th>
                <th>IFSC Code</th>
                <th>State</th>
                <th>District</th>
                <th class="nowrap">Present Days</th>
                <th class="nowrap">Absent Days</th>
                <th class="nowrap">Total Days</th>
                <th class="nowrap">Weekly Off Days</th>
                <th class="nowrap">Leave Days</th>
                <th class="nowrap">Half Days</th>
                <th class="nowrap">Centre Share Payment Amount</th>
                <th class="nowrap">State Share Payment Amount</th>
                <th class="nowrap">Total</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(row => `
                <tr>
                  <td>${row.beneficiary_name || ''}</td>
                  <td>${row.beneficiary_name_as_per_bank || ''}</td>
                  <td>${row.bank_name || ''}</td>
                  <td>${row.aadhaar_number || ''}</td>
                  <td>${row.account_number || ''}</td>
                  <td>${row.ifsc_code || ''}</td>
                  <td>${row.state || ''}</td>
                  <td>${row.district || ''}</td>
                  <td class="text-right">${row.present_days || 0}</td>
                  <td class="text-right">${row.absent_days || 0}</td>
                  <td class="text-right">${row.total_days || 0}</td>
                  <td class="text-right">${row.weekly_off_days || 0}</td>
                  <td class="text-right">${row.leave_days || 0}</td>
                  <td class="text-right">${row.half_days || 0}</td>
                  <td class="text-right">INR ${Number(row.center_share_payment_amount || 0).toLocaleString('en-IN')}</td>
                  <td class="text-right">INR ${Number(row.state_share_payment_amount || 0).toLocaleString('en-IN')}</td>
                  <td class="text-right"><strong>INR ${Number(row.total_amount || 0).toLocaleString('en-IN')}</strong></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
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

module.exports = router;
