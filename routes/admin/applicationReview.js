const express = require('express');
const router = express.Router();
const { authenticate, requireRole, requirePermission, auditLog } = require('../../middleware/auth');
const { ApiError } = require('../../middleware/errorHandler');
const ApiResponse = require('../../utils/ApiResponse');
const applicationReviewService = require('../../services/admin/applicationReviewService');
const meritListService = require('../../services/meritListService');
const cronService = require('../../services/cronService');
const documentVerificationService = require('../../services/documentVerificationService');
const provisionalSelectionService = require('../../services/provisionalSelectionService');
const {
  toBool,
  buildFileUrl,
  sendPdfFromHtml: sendApplicationPdfFromHtml,
  buildApplicationPdfHtml
} = require('../../utils/applicationPdf');
const { Op } = require('sequelize');
const {
  sanitizeFileName,
  sendXlsxFromRows,
  sendPdfFromHtml: sendReportPdfFromHtml,
  buildSimpleReportHtml
} = require('../../utils/reportExport');

const STAGE_LABELS = {
  ELIGIBLE: 'Eligible List',
  PROVISIONAL_SELECTED: 'Provisional Selected List',
  SELECTED: 'Final Selected List'
};

const formatDateTime = (value) => {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleString('en-IN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
};

const mapStageHistoryToRows = (stageHistory = [], stage) => {
  const stageLabel = STAGE_LABELS[stage] || stage;
  return stageHistory.map((record, index) => {
    const application = record?.application;
    const personal = application?.applicant?.personal;
    return {
      sr_no: index + 1,
      application_no: application?.application_no || application?.application_number || '',
      applicant_name: personal?.full_name || '',
      gender: personal?.gender || application?.gender || '',
      district_name: application?.district?.district_name || '',
      post_code: application?.post?.post_code || '',
      stage_status: stageLabel,
   
      current_status: application?.status || '',
      selected_at: formatDateTime(application?.selected_at)
    };
  });
};

const stageReportColumns = [
  { key: 'sr_no', header: 'Sr No.', width: 10, value: (_row, idx) => idx + 1 },
  { key: 'application_no', header: 'Application No.', width: 18 },
  { key: 'applicant_name', header: 'Applicant Name', width: 32 },
  { key: 'gender', header: 'Gender', width: 12 },
  { key: 'district_name', header: 'District', width: 20 },
  { key: 'post_code', header: 'Post Code', width: 16 },
  { key: 'stage_status', header: 'Stage', width: 20 },
 
  { key: 'current_status', header: 'Current Status', width: 18 },
  { key: 'selected_at', header: 'Selected At', width: 24 }
];

// All routes require authentication
router.use(authenticate);

// ==================== POSTS FOR MERIT REVIEW ====================

/**
 * @route GET /api/v1/admin/review/posts
 * @desc Get all active posts with application counts (for merit page)
 * @access Private (Admin)
 */
router.get('/posts', requirePermission('applications.view'), auditLog('VIEW_POSTS_FOR_REVIEW'), async (req, res, next) => {
  try {
    const posts = await applicationReviewService.getActivePostsWithCounts({
      component_id: req.query.component_id,
      district_id: req.query.district_id,
      search: req.query.search
    });
    return ApiResponse.success(res, posts, 'Posts retrieved successfully');
  } catch (error) {
    next(error);
  }
});

// ==================== APPLICATIONS FOR A POST (MERIT VIEW) ====================

/**
 * @route GET /api/v1/admin/review/posts/:postId/applications
 * @desc Get applications for a specific post, ordered by merit score
 * @access Private (Admin)
 */
router.get('/posts/:postId/applications', requirePermission('applications.view'), auditLog('VIEW_POST_APPLICATIONS'), async (req, res, next) => {
  try {
    const result = await applicationReviewService.getApplicationsForPost(req.params.postId, {
      status: req.query.status,
      district_id: req.query.district_id,
      search: req.query.search,
      page: req.query.page,
      limit: req.query.limit
    });
    return ApiResponse.success(res, result, 'Applications retrieved successfully');
  } catch (error) {
    next(error);
  }
});

// ==================== ALL APPLICATIONS VIEW ====================

/**
 * @route GET /api/v1/admin/review/applications
 * @desc Get all applications with filters (candidates pool)
 * @access Private (Admin)
 */
router.get('/applications', requirePermission('applications.view'), auditLog('VIEW_ALL_APPLICATIONS'), async (req, res, next) => {
  try {
    const result = await applicationReviewService.getAllApplications({
      status: req.query.status,
      post_id: req.query.post_id,
      district_id: req.query.district_id,
      search: req.query.search,
      page: req.query.page,
      limit: req.query.limit
    });
    return ApiResponse.success(res, result, 'Applications retrieved successfully');
  } catch (error) {
    next(error);
  }
});

// ==================== APPLICATION DETAIL ====================

/**
 * @route GET /api/v1/admin/review/applications/:id
 * @desc Get application detail with full history
 * @access Private (Admin)
 */
router.get('/applications/:id', requirePermission('applications.view'), auditLog('VIEW_APPLICATION_DETAIL'), async (req, res, next) => {
  try {
    const application = await applicationReviewService.getApplicationDetail(req.params.id);
    return ApiResponse.success(res, application, 'Application retrieved successfully');
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/v1/admin/review/applications/:id/history
 * @desc Get application status history
 * @access Private (Admin)
 */
router.get('/applications/:id/history', requirePermission('applications.view'), auditLog('VIEW_APPLICATION_HISTORY'), async (req, res, next) => {
  try {
    const history = await applicationReviewService.getApplicationHistory(req.params.id);
    return ApiResponse.success(res, history, 'History retrieved successfully');
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/v1/admin/review/applications/:id/required-documents
 * @desc Get required document types for this application (mandatory-for-all + post mandatory docs) with upload status
 * @access Private (Admin)
 */
router.get('/applications/:id/required-documents', requirePermission('applications.view'), auditLog('VIEW_REQUIRED_DOCUMENTS'), async (req, res, next) => {
  try {
    const docs = await applicationReviewService.getApplicationRequiredDocuments(req.params.id);
    return ApiResponse.success(res, docs, 'Required documents retrieved successfully');
  } catch (error) {
    next(error);
  }
});

/**
 * @route POST /api/v1/admin/review/applications/:id/pdf
 * @desc Download printable application PDF (form-only)
 * @access Private (Admin)
 * @body include_images boolean (optional)
 */
router.post('/applications/:id/pdf', requirePermission('applications.view'), auditLog('EXPORT_APPLICATION_PDF'), async (req, res, next) => {
  try {
    const includeImages = toBool(req?.query?.include_images ?? req?.body?.include_images, true);
    const application = await applicationReviewService.getApplicationDetail(req.params.id);

    const db = require('../../models');
    const acknowledgement = await db.ApplicantAcknowledgement.findOne({
      where: {
        application_id: req.params.id,
        action_type: {
          [Op.in]: ['APPLICATION_DECLARATION', 'APPLICATION_SUBMIT']
        },
        checkbox_code: 'DECLARATION_ACCEPTED'
      },
      order: [['accepted_at', 'DESC'], ['acknowledgement_id', 'DESC']]
    });

    const applicant = application?.applicant || {};
    const personal = applicant?.personal || {};
    const docs = Array.isArray(applicant?.documents) ? applicant.documents : [];

    const photoPath = personal?.photo_path || docs.find(d => d?.doc_type === 'PHOTO')?.file_path || null;
    const signaturePath = personal?.signature_path || docs.find(d => d?.doc_type === 'SIGNATURE')?.file_path || null;

    const photoUrl = includeImages ? buildFileUrl(req, photoPath) : null;
    const signatureUrl = includeImages ? buildFileUrl(req, signaturePath) : null;

    const html = buildApplicationPdfHtml(req, application, {
      includeImages,
      photoUrl,
      signatureUrl,
      acknowledgement: acknowledgement ? acknowledgement.toJSON() : null
    });

    const safeNo = application?.application_no || application?.application_id || req.params.id;
    return await sendApplicationPdfFromHtml(res, `application_${safeNo}`, html);
  } catch (error) {
    next(error);
  }
});

// ==================== STATUS ACTIONS ====================

/**
 * @route PUT /api/v1/admin/review/applications/:id/status
 * @desc Update single application status
 * @access Private (Admin with applications.edit permission)
 */
router.put('/applications/:id/status', requirePermission('applications.edit'), auditLog('UPDATE_APPLICATION_STATUS'), async (req, res, next) => {
  try {
    const { status, remarks } = req.body;
    
    if (!status) {
      throw ApiError.badRequest('Status is required');
    }
    
    const application = await applicationReviewService.updateApplicationStatus(
      req.params.id,
      status,
      { adminId: req.user.admin_id, remarks }
    );
    return ApiResponse.success(res, application, 'Application status updated successfully');
  } catch (error) {
    next(error);
  }
});

/**
 * @route POST /api/v1/admin/review/applications/bulk-action
 * @desc Bulk update application status (hold/select/reject)
 * @access Private (Admin with applications.edit permission)
 */
router.post('/applications/bulk-action', requirePermission('applications.edit'), auditLog('BULK_UPDATE_STATUS'), async (req, res, next) => {
  try {
    const { application_ids, action, remarks } = req.body;
    
    if (!application_ids || !Array.isArray(application_ids) || application_ids.length === 0) {
      throw ApiError.badRequest('application_ids array is required');
    }
    
    if (!action) {
      throw ApiError.badRequest('action is required (ON_HOLD, SELECTED, or REJECTED)');
    }
    
    const result = await applicationReviewService.bulkUpdateStatus(
      application_ids,
      action,
      { adminId: req.user.admin_id, remarks }
    );
    
    return ApiResponse.success(res, result, `Bulk ${action} completed: ${result.success.length} success, ${result.failed.length} failed`);
  } catch (error) {
    next(error);
  }
});

// ==================== MERIT LIST OPERATIONS ====================

/**
 * @route POST /api/v1/admin/review/posts/:postId/generate-merit
 * @desc Generate merit list for a post and district
 * @access Private (Admin with applications.edit permission)
 */
router.post('/posts/:postId/generate-merit', requirePermission('applications.edit'), auditLog('GENERATE_MERIT_LIST'), async (req, res, next) => {
  try {
    const { district_id } = req.body;
    
    if (!district_id) {
      throw ApiError.badRequest('district_id is required');
    }
    
    const result = await meritListService.generateMeritList(
      parseInt(req.params.postId),
      parseInt(district_id),
      req.user.admin_id
    );
    
    return ApiResponse.success(res, result, `Merit list generated: ${result.count} entries`);
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/v1/admin/review/posts/:postId/merit-list
 * @desc Get merit list for a post and district
 * @access Private (Admin)
 */
router.get('/posts/:postId/merit-list', requirePermission('applications.view'), auditLog('VIEW_MERIT_LIST'), async (req, res, next) => {
  try {
    const { district_id, page, limit } = req.query;
    
    if (!district_id) {
      throw ApiError.badRequest('district_id query parameter is required');
    }
    
    const result = await meritListService.getMeritList(
      parseInt(req.params.postId),
      parseInt(district_id),
      { page: parseInt(page) || 1, limit: parseInt(limit) || 50 }
    );
    
    return ApiResponse.success(res, result, 'Merit list retrieved successfully');
  } catch (error) {
    next(error);
  }
});

// ==================== DOCUMENT VERIFICATION OPERATIONS ====================

/**
 * @route GET /api/v1/admin/review/applications/:id/documents
 * @desc Get all documents for an application with verification status
 * @access Private (Admin with applications.view permission)
 */
router.get('/applications/:id/documents', requirePermission('applications.view'), auditLog('VIEW_APPLICATION_DOCUMENTS'), async (req, res, next) => {
  try {
    const documents = await documentVerificationService.getApplicationDocuments(parseInt(req.params.id));
    return ApiResponse.success(res, { documents }, 'Documents retrieved successfully');
  } catch (error) {
    next(error);
  }
});

/**
 * @route POST /api/v1/admin/review/applications/:id/verify-documents
 * @desc Verify one or more documents for an application
 * @access Private (Admin with applications.verify_documents permission)
 */
router.post('/applications/:id/verify-documents', requirePermission('applications.verify_documents'), auditLog('VERIFY_DOCUMENTS'), async (req, res, next) => {
  try {
    const { documents } = req.body;
    
    if (!documents || !Array.isArray(documents) || documents.length === 0) {
      throw ApiError.badRequest('documents array is required with at least one document');
    }
    
    const result = await documentVerificationService.verifyDocuments(
      parseInt(req.params.id),
      documents,
      req.user.admin_id
    );
    
    return ApiResponse.success(res, result, `${result.verifiedCount} document(s) verified`);
  } catch (error) {
    next(error);
  }
});

/**
 * @route POST /api/v1/admin/review/applications/:id/verify-all-documents
 * @desc Bulk verify all documents for an application
 * @access Private (Admin with applications.verify_documents permission)
 */
router.post('/applications/:id/verify-all-documents', requirePermission('applications.verify_documents'), auditLog('VERIFY_ALL_DOCUMENTS'), async (req, res, next) => {
  try {
    const { status } = req.body;
    
    if (!status || !['VERIFIED', 'REJECTED'].includes(status)) {
      throw ApiError.badRequest('status must be VERIFIED or REJECTED');
    }
    
    const result = await documentVerificationService.bulkVerifyAllDocuments(
      parseInt(req.params.id),
      req.user.admin_id,
      status
    );
    
    return ApiResponse.success(res, result, `All documents marked as ${status}`);
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/v1/admin/review/applications/:id/verification-summary
 * @desc Get verification summary for an application
 * @access Private (Admin with applications.view permission)
 */
router.get('/applications/:id/verification-summary', requirePermission('applications.view'), auditLog('VIEW_VERIFICATION_SUMMARY'), async (req, res, next) => {
  try {
    const summary = await documentVerificationService.getVerificationSummary(parseInt(req.params.id));
    return ApiResponse.success(res, summary, 'Verification summary retrieved');
  } catch (error) {
    next(error);
  }
});

// ==================== PROVISIONAL SELECTION OPERATIONS ====================

/**
 * @route POST /api/v1/admin/review/applications/:id/provisional-action
 * @desc Move application to provisional selected, hold, or reject
 * @access Private (Admin with applications.provisional_select permission)
 */
router.post('/applications/:id/provisional-action', requirePermission('applications.provisional_select'), auditLog('PROVISIONAL_ACTION'), async (req, res, next) => {
  try {
    const { action, remarks } = req.body;
    
    if (!action || !['PROVISIONAL_SELECT', 'HOLD', 'REJECT'].includes(action)) {
      throw ApiError.badRequest('action must be PROVISIONAL_SELECT, HOLD, or REJECT');
    }
    
    const result = await provisionalSelectionService.moveToProvisionalSelected(
      parseInt(req.params.id),
      req.user.admin_id,
      action,
      remarks
    );
    
    return ApiResponse.success(res, result, `Application ${action} completed`);
  } catch (error) {
    next(error);
  }
});

/**
 * @route POST /api/v1/admin/review/applications/:id/final-selection
 * @desc Final selection or rejection from provisional selected
 * @access Private (Admin with applications.final_select permission)
 */
router.post('/applications/:id/final-selection', requirePermission('applications.final_select'), auditLog('FINAL_SELECTION'), async (req, res, next) => {
  try {
    const { action, remarks } = req.body;
    
    if (!action || !['SELECT', 'REJECT'].includes(action)) {
      throw ApiError.badRequest('action must be SELECT or REJECT');
    }
    
    const result = await provisionalSelectionService.finalSelection(
      parseInt(req.params.id),
      req.user.admin_id,
      action,
      remarks
    );
    
    return ApiResponse.success(res, result, `Application ${action === 'SELECT' ? 'selected' : 'rejected'}`);
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/v1/admin/review/posts/:postId/stage-report
 * @desc Get applications by stage for reporting (ELIGIBLE, PROVISIONAL_SELECTED, SELECTED)
 * @access Private (Admin with applications.view permission)
 */
router.get('/posts/:postId/stage-report', requirePermission('applications.view'), auditLog('VIEW_STAGE_REPORT'), async (req, res, next) => {
  try {
    const { stage } = req.query;
    const rawDistrictId = typeof req.query.district_id === 'string' ? req.query.district_id.trim() : '';
    const isAllDistricts = rawDistrictId && rawDistrictId.toUpperCase() === 'ALL';
    const districtId = rawDistrictId && !isAllDistricts ? parseInt(rawDistrictId, 10) : null;
    const format = String(req.query.format || 'json').toLowerCase();
    
    if (rawDistrictId && !isAllDistricts && Number.isNaN(districtId)) {
      throw ApiError.badRequest('district_id must be a valid number');
    }
    
    if (!stage || !['ELIGIBLE', 'PROVISIONAL_SELECTED', 'SELECTED'].includes(stage)) {
      throw ApiError.badRequest('stage must be ELIGIBLE, PROVISIONAL_SELECTED, or SELECTED');
    }
    
    if (!['json', 'pdf', 'xlsx'].includes(format)) {
      throw ApiError.badRequest('format must be json, pdf, or xlsx');
    }
    
    const stageHistory = await provisionalSelectionService.getApplicationsByStage(
      parseInt(req.params.postId, 10),
      districtId,
      stage
    );
    
    const rows = mapStageHistoryToRows(stageHistory, stage);
    const stageLabel = STAGE_LABELS[stage] || stage;
    
    if (format === 'json') {
      return ApiResponse.success(
        res,
        { stageHistory, rows, count: stageHistory.length },
        `${stageLabel} report retrieved`
      );
    }
    
    const filename = sanitizeFileName(`post_${req.params.postId}_${stageLabel.replace(/\s+/g, '_').toLowerCase()}`);
    
    if (format === 'xlsx') {
      return await sendXlsxFromRows(res, filename, stageReportColumns, rows);
    }
    
    const html = buildSimpleReportHtml(`${stageLabel}`, stageReportColumns, rows);
    return await sendReportPdfFromHtml(res, filename, html);
  } catch (error) {
    next(error);
  }
});

// ==================== SELECTION OPERATIONS (LEGACY - kept for backward compatibility) ====================

/**
 * @route POST /api/v1/admin/review/applications/:id/select
 * @desc Mark application as SELECTED and auto-reject other applications (LEGACY)
 * @access Private (Admin with applications.edit permission)
 * @deprecated Use /final-selection with action=SELECT instead
 */
router.post('/applications/:id/select', requirePermission('applications.edit'), auditLog('SELECT_APPLICATION'), async (req, res, next) => {
  try {
    const result = await cronService.markAsSelected(
      parseInt(req.params.id),
      req.user.admin_id
    );
    
    return ApiResponse.success(res, result, `Application selected. ${result.autoRejectedCount} other applications auto-rejected.`);
  } catch (error) {
    next(error);
  }
});

// ==================== CRON OPERATIONS (MANUAL TRIGGER) ====================

/**
 * @route POST /api/v1/admin/review/cron/close-expired-posts
 * @desc Manually trigger post closure cron job
 * @access Private (Super Admin only)
 */
router.post('/cron/close-expired-posts', requireRole(['SUPER_ADMIN']), auditLog('MANUAL_CLOSE_POSTS'), async (req, res, next) => {
  try {
    const result = await cronService.closeExpiredPosts();
    return ApiResponse.success(res, result, `Closed ${result.closedCount} expired posts`);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
