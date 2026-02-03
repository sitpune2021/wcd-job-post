const express = require('express');
const router = express.Router();
const { authenticate, requirePermission, auditLog } = require('../../middleware/auth');
const ApiResponse = require('../../utils/ApiResponse');
const reportsService = require('../../services/admin/reportsService');
const postAllotmentUploadService = require('../../services/admin/postAllotmentUploadService');
const allotmentEmailService = require('../../services/admin/allotmentEmailService');
const ExcelJS = require('exceljs');
const htmlToPdf = require('html-pdf-node');
const { ApiError } = require('../../middleware/errorHandler');
const logger = require('../../config/logger');
const multer = require('multer');
const path = require('path');
const { ensureDir } = require('../../utils/fileUpload');

// All routes require authentication
router.use(authenticate);

/**
 * @route GET /api/admin/reports/post-wise
 * @desc Post-wise report: post code/name + total applications + selected applications
 * @access Private (Admin with reports.view permission)
 */
router.get('/post-wise', requirePermission('reports.view'), auditLog('VIEW_REPORT_POST_WISE'), async (req, res, next) => {
  try {
    const rows = await reportsService.getPostWiseReport({
      component_id: req.query.component_id,
      district_id: req.query.district_id,
      post_id: req.query.post_id
    });

    return ApiResponse.success(res, { rows, total: rows.length }, 'Post wise report generated successfully');
  } catch (error) {
    next(error);
  }
});

const allotmentUploadStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    try {
      const { postId } = req.params;
      if (!postId) {
        return cb(new ApiError(400, 'postId is required'));
      }

      const uploadPath = path.join(
        __dirname,
        '..',
        '..',
        'uploads',
        'allotment',
        postId.toString()
      );

      ensureDir(uploadPath)
        .then(() => cb(null, uploadPath))
        .catch((err) => cb(err));
    } catch (err) {
      cb(err);
    }
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    const nameWithoutExt = path.basename(file.originalname, ext);
    cb(null, `${nameWithoutExt}_${uniqueSuffix}${ext}`);
  }
});

const allotmentUploadFileFilter = (req, file, cb) => {
  const allowedMimes = [
    'application/pdf',
    'image/jpeg',
    'image/jpg',
    'image/png'
  ];

  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new ApiError(400, 'Invalid file type. Only PDF, JPEG, and PNG are allowed.'), false);
  }
};

const allotmentUpload = multer({
  storage: allotmentUploadStorage,
  fileFilter: allotmentUploadFileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024
  }
});
router.get('/post-selected/:postId/allotment-upload', requirePermission('reports.view'), auditLog('VIEW_POST_ALLOTMENT_UPLOAD'), async (req, res, next) => {
  try {
    const data = await postAllotmentUploadService.getByPostId(req.params.postId);
    return ApiResponse.success(res, data, 'Post allotment upload retrieved successfully');
  } catch (error) {
    next(error);
  }
});
router.post('/post-selected/:postId/allotment-upload', requirePermission('reports.view'), auditLog('UPLOAD_POST_ALLOTMENT_UPLOAD'), allotmentUpload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      throw new ApiError(400, 'No file uploaded');
    }

    const saved = await postAllotmentUploadService.upsertForPost(req.params.postId, req.file);
    return ApiResponse.success(res, saved, 'Allotment file uploaded successfully');
  } catch (error) {
    next(error);
  }
});
router.delete('/post-selected/:postId/allotment-upload', requirePermission('reports.view'), auditLog('DELETE_POST_ALLOTMENT_UPLOAD'), async (req, res, next) => {
  try {
    await postAllotmentUploadService.softDeleteForPost(req.params.postId);
    return ApiResponse.success(res, null, 'Allotment file deleted successfully');
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/admin/reports/post-selected
 * @desc Post report: post code/name + selected candidate full names
 * @access Private (Admin with reports.view permission)
 */
router.get('/post-selected', requirePermission('reports.view'), auditLog('VIEW_REPORT_POST_SELECTED'), async (req, res, next) => {
  try {
    const rows = await reportsService.getPostSelectedCandidatesReport({
      component_id: req.query.component_id,
      district_id: req.query.district_id,
      post_id: req.query.post_id
    });

    return ApiResponse.success(res, { rows, total: rows.length }, 'Post selected candidates report generated successfully');
  } catch (error) {
    next(error);
  }
});

const sanitizeFileName = (value) => {
  if (!value) return 'report';
  return String(value).replace(/[^a-z0-9\-_]+/gi, '_').slice(0, 80);
};

const sendCsvFromRows = async (res, filename, columns, rows) => {
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

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
  await workbook.csv.write(res);
  res.end();
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

  // Calculate column widths as percentages
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
      table-layout: fixed; /* This is fine now with colgroup */
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

/**
 * @route GET /api/admin/reports/post-wise/export
 * @desc Export post-wise report in CSV or PDF
 * @access Private (Admin with reports.view permission)
 */
router.get('/post-wise/export', requirePermission('reports.view'), auditLog('EXPORT_REPORT_POST_WISE'), async (req, res, next) => {
  try {
    const format = String(req.query.format || '').toLowerCase();
    if (!format || !['csv', 'pdf', 'xlsx'].includes(format)) {
      throw new ApiError(400, 'Invalid export format. Use csv, xlsx or pdf.');
    }

    const rows = await reportsService.getPostWiseReport({
      component_id: req.query.component_id,
      district_id: req.query.district_id,
      post_id: req.query.post_id
    });

    const columns = [
      { key: 'sr_no', header: 'Sr No.', width: 10, value: (_r, idx) => idx + 1 },
      { key: 'post_code', header: 'Post Code', width: 18 },
      { key: 'post_name', header: 'Post Name', width: 40 },
      { key: 'application_count', header: 'Applications', width: 16 },
      { key: 'selected_count', header: 'Selected', width: 16 }
    ];

    const filename = sanitizeFileName('post_wise_report');
    if (format === 'csv') {
      return await sendCsvFromRows(res, filename, columns, rows);
    }

    if (format === 'xlsx') {
      return await sendXlsxFromRows(res, filename, columns, rows);
    }

    const html = buildSimpleReportHtml('Post Wise Report', columns, rows);
    return await sendPdfFromHtml(res, filename, html);
  } catch (error) {
    next(error);
  }
});

router.post('/post-wise/export', requirePermission('reports.view'), auditLog('EXPORT_REPORT_POST_WISE'), async (req, res, next) => {
  try {
    const format = String(req.body?.format || req.query.format || '').toLowerCase();
    if (!format || !['csv', 'pdf', 'xlsx'].includes(format)) {
      throw new ApiError(400, 'Invalid export format. Use csv, xlsx or pdf.');
    }

    const rows = await reportsService.getPostWiseReport({
      component_id: req.body?.component_id ?? req.query.component_id,
      district_id: req.body?.district_id ?? req.query.district_id,
      post_id: req.body?.post_id ?? req.query.post_id
    });

    const columns = [
      { key: 'sr_no', header: 'Sr No.', width: 10, value: (_r, idx) => idx + 1 },
      { key: 'post_code', header: 'Post Code', width: 18 },
      { key: 'post_name', header: 'Post Name', width: 40 },
      { key: 'application_count', header: 'Applications', width: 16 },
      { key: 'selected_count', header: 'Selected', width: 16 }
    ];

    const filename = sanitizeFileName('post_wise_report');
    if (format === 'csv') {
      return await sendCsvFromRows(res, filename, columns, rows);
    }

    if (format === 'xlsx') {
      return await sendXlsxFromRows(res, filename, columns, rows);
    }

    const html = buildSimpleReportHtml('Post Wise Report', columns, rows);
    return await sendPdfFromHtml(res, filename, html);
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/admin/reports/district-wise
 */
router.get('/district-wise', requirePermission('reports.view'), auditLog('VIEW_REPORT_DISTRICT_WISE'), async (req, res, next) => {
  try {
    const rows = await reportsService.getDistrictWiseReport({
      component_id: req.query.component_id,
      district_id: req.query.district_id
    });
    return ApiResponse.success(res, { rows, total: rows.length }, 'District wise report generated successfully');
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/admin/reports/district-wise/export
 */
router.get('/district-wise/export', requirePermission('reports.view'), auditLog('EXPORT_REPORT_DISTRICT_WISE'), async (req, res, next) => {
  try {
    const format = String(req.query.format || '').toLowerCase();
    if (!format || !['csv', 'pdf', 'xlsx'].includes(format)) {
      throw new ApiError(400, 'Invalid export format.');
    }

    const rows = await reportsService.getDistrictWiseReport({
      component_id: req.query.component_id,
      district_id: req.query.district_id
    });

    const columns = [
      { key: 'sr_no', header: 'Sr No.', width: 10, value: (_r, idx) => idx + 1 },
      { key: 'district_name', header: 'District Name', width: 30 },
      { key: 'application_count', header: 'Applications', width: 20 },
      { key: 'selected_count', header: 'Selected', width: 20 }
    ];

    const filename = sanitizeFileName('district_wise_report');
    if (format === 'csv') return await sendCsvFromRows(res, filename, columns, rows);
    if (format === 'xlsx') return await sendXlsxFromRows(res, filename, columns, rows);

    const html = buildSimpleReportHtml('District Wise Report', columns, rows);
    return await sendPdfFromHtml(res, filename, html);
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/admin/reports/component-wise
 */
router.get('/component-wise', requirePermission('reports.view'), auditLog('VIEW_REPORT_COMPONENT_WISE'), async (req, res, next) => {
  try {
    const rows = await reportsService.getComponentWiseReport({
      component_id: req.query.component_id,
      district_id: req.query.district_id
    });
    return ApiResponse.success(res, { rows, total: rows.length }, 'Component wise report generated successfully');
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/admin/reports/component-wise/export
 */
router.get('/component-wise/export', requirePermission('reports.view'), auditLog('EXPORT_REPORT_COMPONENT_WISE'), async (req, res, next) => {
  try {
    const format = String(req.query.format || '').toLowerCase();
    if (!format || !['csv', 'pdf', 'xlsx'].includes(format)) {
      throw new ApiError(400, 'Invalid export format.');
    }

    const rows = await reportsService.getComponentWiseReport({
      component_id: req.query.component_id,
      district_id: req.query.district_id
    });

    const columns = [
      { key: 'sr_no', header: 'Sr No.', width: 10, value: (_r, idx) => idx + 1 },
      { key: 'component_name', header: 'Component Name', width: 40 },
      { key: 'application_count', header: 'Applications', width: 20 },
      { key: 'selected_count', header: 'Selected', width: 20 }
    ];

    const filename = sanitizeFileName('component_wise_report');
    if (format === 'csv') return await sendCsvFromRows(res, filename, columns, rows);
    if (format === 'xlsx') return await sendXlsxFromRows(res, filename, columns, rows);

    const html = buildSimpleReportHtml('Component Wise Report', columns, rows);
    return await sendPdfFromHtml(res, filename, html);
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/admin/reports/post-selected/export
 * @desc Export post-selected report in CSV or PDF
 * @access Private (Admin with reports.view permission)
 */
router.get('/post-selected/export', requirePermission('reports.view'), auditLog('EXPORT_REPORT_POST_SELECTED'), async (req, res, next) => {
  try {
    const format = String(req.query.format || '').toLowerCase();
    if (!format || !['csv', 'pdf', 'xlsx'].includes(format)) {
      throw new ApiError(400, 'Invalid export format. Use csv, xlsx or pdf.');
    }

    const rows = await reportsService.getPostSelectedCandidatesReport({
      component_id: req.query.component_id,
      district_id: req.query.district_id,
      post_id: req.query.post_id
    });

    const flattened = (Array.isArray(rows) ? rows : []).flatMap((r) => {
      const list = Array.isArray(r.selected_candidates) ? r.selected_candidates : [];
      if (list.length === 0) {
        return [{
          component_id: r.component_id,
          component_name: r.component_name,
          post_code: r.post_code,
          post_name: r.post_name,
          candidate_name: ''
        }];
      }
      return list.map((name) => ({
        component_id: r.component_id,
        component_name: r.component_name,
        post_code: r.post_code,
        post_name: r.post_name,
        candidate_name: name
      }));
    });

    const columns = [
      { key: 'sr_no', header: 'Sr No.', width: 10, value: (_r, idx) => idx + 1 },
      {
        key: 'component',
        header: 'Component',
        width: 35,
        value: (r) => {
          const name = r.component_name || '';
          return name;
        }
      },
      { key: 'post_code', header: 'Post Code', width: 18 },
      { key: 'post_name', header: 'Post Name', width: 40 },
      { key: 'candidate_name', header: 'Candidate Name', width: 40 }
    ];

    const filename = sanitizeFileName('allotment_report');
    if (format === 'csv') {
      return await sendCsvFromRows(res, filename, columns, flattened);
    }

    if (format === 'xlsx') {
      return await sendXlsxFromRows(res, filename, columns, flattened);
    }

    const html = buildSimpleReportHtml('Allotment Report', columns, flattened);
    return await sendPdfFromHtml(res, filename, html);
  } catch (error) {
    next(error);
  }
});

router.post('/post-selected/export', requirePermission('reports.view'), auditLog('EXPORT_REPORT_POST_SELECTED'), async (req, res, next) => {
  try {
    const format = String(req.body?.format || req.query.format || '').toLowerCase();
    if (!format || !['csv', 'pdf', 'xlsx'].includes(format)) {
      throw new ApiError(400, 'Invalid export format. Use csv, xlsx or pdf.');
    }

    const rows = await reportsService.getPostSelectedCandidatesReport({
      component_id: req.body?.component_id ?? req.query.component_id,
      district_id: req.body?.district_id ?? req.query.district_id,
      post_id: req.body?.post_id ?? req.query.post_id
    });

    const flattened = (Array.isArray(rows) ? rows : []).flatMap((r) => {
      const list = Array.isArray(r.selected_candidates) ? r.selected_candidates : [];
      if (list.length === 0) {
        return [{
          component_id: r.component_id,
          component_name: r.component_name,
          post_code: r.post_code,
          post_name: r.post_name,
          candidate_name: ''
        }];
      }
      return list.map((name) => ({
        component_id: r.component_id,
        component_name: r.component_name,
        post_code: r.post_code,
        post_name: r.post_name,
        candidate_name: name
      }));
    });

    const columns = [
      { key: 'sr_no', header: 'Sr No.', width: 10, value: (_r, idx) => idx + 1 },
      {
        key: 'component',
        header: 'Component',
        width: 35,
        value: (r) => {
          const name = r.component_name || '';
          return name;
        }
      },
      { key: 'post_code', header: 'Post Code', width: 18 },
      { key: 'post_name', header: 'Post Name', width: 40 },
      { key: 'candidate_name', header: 'Candidate Name', width: 40 }
    ];

    const filename = sanitizeFileName('allotment_report');
    if (format === 'csv') {
      return await sendCsvFromRows(res, filename, columns, flattened);
    }

    if (format === 'xlsx') {
      return await sendXlsxFromRows(res, filename, columns, flattened);
    }

    const html = buildSimpleReportHtml('Allotment Report', columns, flattened);
    return await sendPdfFromHtml(res, filename, html);
  } catch (error) {
    next(error);
  }
});

// ==================== ALLOTMENT EMAIL DISTRIBUTION ====================

/**
 * @route POST /api/admin/reports/post-selected/:postId/schedule-email
 * @desc Schedule email distribution of allotment PDF to selected candidates
 * @access Private (Admin with reports.view permission)
 */
router.post('/post-selected/:postId/schedule-email',
  requirePermission('reports.view'),
  auditLog('SCHEDULE_ALLOTMENT_EMAIL'),
  async (req, res, next) => {
    try {
      const { scheduled_date } = req.body;
      const postId = parseInt(req.params.postId, 10);

      if (!scheduled_date) {
        throw new ApiError(400, 'scheduled_date is required');
      }

      if (Number.isNaN(postId)) {
        throw new ApiError(400, 'Invalid post ID');
      }

      // Verify upload exists for this post
      const upload = await postAllotmentUploadService.getByPostId(postId);
      if (!upload) {
        throw new ApiError(400, 'No allotment file uploaded for this post. Please upload the allotment PDF first.');
      }

      // Schedule the email - Parse datetime-local input (no timezone) as IST and convert to UTC
      // Example input: "2026-01-31T15:25"
      const inputAsUtc = new Date(`${scheduled_date}:00Z`); // treat input as UTC for parsing
      const scheduledDate = new Date(inputAsUtc.getTime() - (330 * 60 * 1000)); // shift minus 5h30 to get true UTC

      logger.info('Scheduling allotment email', {
        scheduled_date_input: scheduled_date,
        parsed_as_utc: inputAsUtc.toISOString(),
        stored_utc: scheduledDate.toISOString(),
        stored_ist: scheduledDate.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false })
      });

      const result = await allotmentEmailService.scheduleEmail(
        postId,
        upload.upload_id,
        scheduledDate,
        req.user.admin_id
      );

      if (!result.success) {
        return ApiResponse.success(res, result, result.message);
      }

      return ApiResponse.success(
        res,
        {
          schedule_id: result.schedule.schedule_id,
          new_recipients: result.newRecipients,
          already_sent: result.alreadySent,
          total_selected: result.totalSelected,
          scheduled_date: result.scheduledDate
        },
        `Email scheduled successfully for ${result.newRecipients} new recipient(s)`
      );
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @route GET /api/admin/reports/post-selected/:postId/email-status
 * @desc Get email distribution status for a post
 * @access Private (Admin with reports.view permission)
 */
router.get('/post-selected/:postId/email-status',
  requirePermission('reports.view'),
  async (req, res, next) => {
    try {
      const postId = parseInt(req.params.postId, 10);

      if (Number.isNaN(postId)) {
        throw new ApiError(400, 'Invalid post ID');
      }

      const status = await allotmentEmailService.getEmailStatus(postId);

      return ApiResponse.success(res, status, 'Email status retrieved successfully');
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @route POST /api/admin/reports/post-selected/schedule/:scheduleId/cancel
 * @desc Cancel a scheduled email batch
 * @access Private (Admin with reports.view permission)
 */
router.post('/post-selected/schedule/:scheduleId/cancel',
  requirePermission('reports.view'),
  auditLog('CANCEL_ALLOTMENT_EMAIL_SCHEDULE'),
  async (req, res, next) => {
    try {
      const scheduleId = parseInt(req.params.scheduleId, 10);

      if (Number.isNaN(scheduleId)) {
        throw new ApiError(400, 'Invalid schedule ID');
      }

      const result = await allotmentEmailService.cancelSchedule(scheduleId, req.user.admin_id);

      return ApiResponse.success(res, result, result.message);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @route POST /api/admin/reports/post-selected/schedule/:scheduleId/retry
 * @desc Retry failed emails for a schedule
 * @access Private (Admin with reports.view permission)
 */
router.post('/post-selected/schedule/:scheduleId/retry',
  requirePermission('reports.view'),
  auditLog('RETRY_ALLOTMENT_EMAIL_SCHEDULE'),
  async (req, res, next) => {
    try {
      const scheduleId = parseInt(req.params.scheduleId, 10);

      if (Number.isNaN(scheduleId)) {
        throw new ApiError(400, 'Invalid schedule ID');
      }

      const result = await allotmentEmailService.retryFailedEmails(scheduleId);

      return ApiResponse.success(res, result, result.message);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @route POST /api/admin/reports/post-selected/process-scheduled-emails
 * @desc Manually trigger email processing (for testing cron job)
 * @access Private (Admin with reports.view permission)
 */
router.post('/post-selected/process-scheduled-emails',
  requirePermission('reports.view'),
  auditLog('MANUAL_PROCESS_SCHEDULED_EMAILS'),
  async (req, res, next) => {
    try {
      const result = await allotmentEmailService.processScheduledEmails();
      
      return ApiResponse.success(
        res,
        result,
        `Processed ${result.processed} scheduled email batch(es)`
      );
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
