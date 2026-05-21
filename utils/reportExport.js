const ExcelJS = require('exceljs');
const htmlToPdf = require('html-pdf-node');
const logger = require('../config/logger');

const sanitizeFileName = (value) => {
  if (!value) return 'report';
  return String(value).replace(/[^a-z0-9\-_]+/gi, '_').slice(0, 80);
};

const sendXlsxFromRows = async (res, filename, columns, rows) => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Report');
  sheet.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width || 25 }));
  rows.forEach((r, idx) => {
    const rowData = {};
    columns.forEach((c) => {
      const raw = typeof c.value === 'function' ? c.value(r, idx) : r[c.key];
      rowData[c.key] = raw === null || raw === undefined ? '' : raw;
    });
    sheet.addRow(rowData);
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
};

const sendPdfFromHtml = async (res, filename, html) => {
  try {
    const pdfBuffer = await htmlToPdf.generatePdf(
      { content: html },
      {
        format: 'A4',
        printBackground: true,
        margin: { top: '14mm', right: '12mm', bottom: '14mm', left: '12mm' },
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
      }
    );
    
    // Validate PDF buffer
    if (!pdfBuffer || Buffer.byteLength(pdfBuffer) < 100) {
      throw new Error('PDF generation failed: Empty or invalid PDF buffer');
    }
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
    res.setHeader('Content-Length', Buffer.byteLength(pdfBuffer));
    return res.status(200).send(pdfBuffer);
  } catch (error) {
    logger.error('PDF export failed (html-pdf-node)', {
      filename,
      nodeVersion: process.version,
      errorMessage: error.message,
      stack: error?.stack || String(error)
    });
    res.status(500).json({ error: 'Failed to generate PDF', message: error.message });
  }
};

const buildPayslipHtml = (payslipData) => {
  const escapeHtml = (value) =>
    value === null || value === undefined
      ? ''
      : String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const now = new Date();
  const generatedAt = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(now);

  const salary = payslipData.salary || {};
  const employee = payslipData.employee || {};
  const payPeriod = payslipData.pay_period || { month_name: '', year: '' };

  const deductionRows = salary.deduction_breakdown && salary.deduction_breakdown.length > 0
    ? salary.deduction_breakdown.map(deduction => `
        <tr>
          <th style="padding-left: 20px; font-weight: 500;">${escapeHtml(deduction.name)}</th>
          <td class="amount">₹${escapeHtml(deduction.amount.toLocaleString('en-IN'))}</td>
        </tr>
        ${deduction.reason ? `
        <tr>
          <td colspan="2" style="padding-left: 30px; color: #666; font-size: 10px;">${escapeHtml(deduction.reason)}</td>
        </tr>
        ` : ''}
      `).join('')
    : '';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Payslip - ${escapeHtml(employee.employee_code)}</title>
  <style>
    @page { size: A4; margin: 20mm; }
    body {
      font-family: Arial, Helvetica, sans-serif;
      font-size: 11px;
      color: #333;
      background: #fff;
      margin: 0;
      padding: 0;
      line-height: 1.5;
    }
    .page {
      padding: 5px;
    }
    .title {
      text-align: center;
      font-size: 18px;
      font-weight: bold;
      margin-bottom: 5px;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    .subtitle {
      text-align: center;
      font-size: 10px;
      color: #666;
      margin-bottom: 25px;
    }
    .section {
      margin-bottom: 25px;
    }
    .section-title {
      font-size: 12px;
      font-weight: bold;
      margin-bottom: 10px;
      padding-bottom: 3px;
      border-bottom: 1px solid #333;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      margin-bottom: 0;
    }
    th, td {
      border: 1px solid #999;
      padding: 8px 12px;
      text-align: left;
      vertical-align: middle;
    }
    th {
      background: #f5f5f5;
      font-weight: 600;
      width: 40%;
      color: #333;
    }
    .amount {
      text-align: right;
      font-weight: 600;
      font-family: Arial, sans-serif;
    }
    .total-row {
      background: #e8e8e8;
      font-weight: bold;
    }
    .total-row th {
      background: #e8e8e8;
    }
    .net-salary {
      font-size: 13px;
      font-weight: bold;
      background: #d4edda;
    }
    .net-salary td {
      background: #d4edda;
    }
    .footer {
      margin-top: 35px;
      padding-top: 10px;
      border-top: 1px solid #ccc;
      text-align: center;
      font-size: 9px;
      color: #888;
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="title">Salary Slip</div>
    <div class="subtitle">Maharashtra State Commission for Women</div>

    <div class="section">
      <div class="section-title">Employee Information</div>
      <table>
        <tr><th>Employee Code</th><td>${escapeHtml(employee.employee_code)}</td></tr>
        <tr><th>Employee Name</th><td>${escapeHtml(employee.full_name)}</td></tr>
        <tr><th>Post</th><td>${escapeHtml(employee.post_name)}</td></tr>
        <tr><th>District</th><td>${escapeHtml(employee.district_name)}</td></tr>
        <tr><th>Pay Period</th><td>${escapeHtml(payPeriod.month_name)} ${escapeHtml(payPeriod.year)}</td></tr>
      </table>
    </div>

    <div class="section">
      <div class="section-title">Salary Details</div>
      <table>
        <tr><th>Monthly Pay</th><td class="amount">₹${escapeHtml((salary.monthly_pay || 0).toLocaleString('en-IN'))}</td></tr>
        <tr><th>Calculated Salary</th><td class="amount">₹${escapeHtml((salary.calculated_salary || 0).toLocaleString('en-IN'))}</td></tr>
        <tr><th>Attendance Deduction</th><td class="amount">-₹${escapeHtml((salary.attendance_deduction || 0).toLocaleString('en-IN'))}</td></tr>
        <tr><th>Additional Deductions</th><td class="amount">-₹${escapeHtml((salary.additional_deductions || 0).toLocaleString('en-IN'))}</td></tr>
        ${deductionRows ? `
        <tr><th colspan="2" style="background: #e8e8e8; font-weight: bold;">Deduction Breakdown</th></tr>
        ${deductionRows}
        ` : ''}
        <tr class="total-row"><th>Total Deduction</th><td class="amount">-₹${escapeHtml((salary.total_deduction || 0).toLocaleString('en-IN'))}</td></tr>
        <tr class="net-salary"><th>NET SALARY</th><td class="amount">₹${escapeHtml((salary.net_salary || 0).toLocaleString('en-IN'))}</td></tr>
      </table>
    </div>

    <div class="footer">
      Generated on ${generatedAt} • Computer Generated Document
    </div>
  </div>
</body>
</html>`;
};

const buildSimpleReportHtml = (title, columns, rows) => {
  const escapeHtml = (value) =>
    value === null || value === undefined
      ? ''
      : String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const now = new Date();
  const generatedAt = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(now);
  
  // Calculate total width and create colgroup with percentage-based widths
  const totalWidth = columns.reduce((sum, c) => sum + (c.width || 15), 0);
  const colgroup = columns.map(c => {
    const widthPercent = ((c.width || 15) / totalWidth * 100).toFixed(2);
    return `<col style="width: ${widthPercent}%;" />`;
  }).join('');
  
  const ths = columns.map((c) => `<th>${escapeHtml(c.header)}</th>`).join('');
  const trs =
    rows.length === 0
      ? `<tr class="empty"><td colspan="${columns.length}">No records found</td></tr>`
      : rows
          .map((r, idx) => {
            const tds = columns
              .map((c) => {
                const raw = typeof c.value === 'function' ? c.value(r, idx) : r[c.key];
                return `<td>${escapeHtml(raw)}</td>`;
              })
              .join('');
            return `<tr>${tds}</tr>`;
          })
          .join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <style>
    @page { size: A4; margin: 16mm; }
    :root {
      --text: #111827;
      --muted: #4b5563;
      --border: #e2e8f0;
      --header-bg: #111827;
      --header-text: #ffffff;
      --row-alt: #f9fafb;
    }
    body {
      font-family: "Segoe UI", Arial, Helvetica, sans-serif;
      font-size: 9px;
      color: var(--text);
      background: #ffffff;
      margin: 0;
      padding: 0;
    }
    .page {
      padding: 4px 2px 0 2px;
    }
    .title {
      text-align: center;
      font-size: 14px;
      font-weight: 700;
      letter-spacing: 0.1px;
      margin: 0 0 2px 0;
      color: var(--text);
    }
    .subdesc {
      text-align: center;
      font-size: 8px;
      color: var(--muted);
      margin: 0 0 6px 0;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      table-layout: fixed;
    }
    th, td {
      border: 1px solid var(--border);
      padding: 3px 4px;
      vertical-align: top;
      word-break: break-word;
      line-height: 1.2;
    }
    th {
      background: var(--header-bg);
      color: var(--header-text);
      font-weight: 700;
      font-size: 8px;
      text-transform: uppercase;
      letter-spacing: 0.25px;
    }
    tbody tr:nth-child(odd) { background: var(--row-alt); }
    td { font-size: 8px; }
    .empty td {
      text-align: center;
      font-style: italic;
      color: var(--muted);
      background: #f9fafb;
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="title">${title}</div>
    <div class="subdesc">Generated on ${generatedAt} • Records: ${rows.length}</div>
    <table>
      <colgroup>${colgroup}</colgroup>
      <thead><tr>${ths}</tr></thead>
      <tbody>${trs}</tbody>
    </table>
  </div>
</body>
</html>`;
};

module.exports = {
  sanitizeFileName,
  sendXlsxFromRows,
  sendPdfFromHtml,
  buildSimpleReportHtml,
  buildPayslipHtml
};
