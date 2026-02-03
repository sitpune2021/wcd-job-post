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
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
    return res.status(200).send(pdfBuffer);
  } catch (error) {
    logger.error('PDF export failed (html-pdf-node)', {
      filename,
      nodeVersion: process.version,
      stack: error?.stack || String(error)
    });
    throw error;
  }
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
      font-size: 11.5px;
      color: var(--text);
      background: #ffffff;
      margin: 0;
      padding: 0;
    }
    .page {
      padding: 6px 4px 0 4px;
    }
    .title {
      text-align: center;
      font-size: 18px;
      font-weight: 700;
      letter-spacing: 0.1px;
      margin: 0 0 4px 0;
      color: var(--text);
    }
    .subdesc {
      text-align: center;
      font-size: 10.5px;
      color: var(--muted);
      margin: 0 0 10px 0;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      table-layout: fixed;
    }
    th, td {
      border: 1px solid var(--border);
      padding: 6px 8px;
      vertical-align: top;
      word-break: break-word;
      line-height: 1.35;
    }
    th {
      background: var(--header-bg);
      color: var(--header-text);
      font-weight: 700;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.25px;
    }
    tbody tr:nth-child(odd) { background: var(--row-alt); }
    td { font-size: 11px; }
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
  buildSimpleReportHtml
};
