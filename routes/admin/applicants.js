const express = require('express');
const router = express.Router();
const { authenticate, auditLog, requirePermission } = require('../../middleware/auth');
const { ApiError } = require('../../middleware/errorHandler');
const ApiResponse = require('../../utils/ApiResponse');
const applicantService = require('../../services/admin/applicantService');

// All routes require authentication
router.use(authenticate);

/**
 * @route GET /api/v1/admin/applicants
 * @desc Get all registered applicants (for admin viewing)
 * @access Private (Admin - requires applicants.view permission)
 */
router.get('/', requirePermission('applicants.view'), auditLog('ADMIN_VIEW_APPLICANTS'), async (req, res, next) => {
  try {
    const result = await applicantService.getApplicants(req.query);
    return ApiResponse.success(res, result, 'Applicants retrieved successfully');
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/v1/admin/applicants/:id
 * @desc Get applicant full profile by ID
 * @access Private (Admin - requires applicants.view permission)
 */
router.get('/:id', requirePermission('applicants.view'), auditLog('ADMIN_VIEW_APPLICANT_DETAIL'), async (req, res, next) => {
  try {
    const applicant = await applicantService.getApplicantById(req.params.id);
    if (!applicant) {
      throw ApiError.notFound('Applicant not found');
    }
    return ApiResponse.success(res, applicant, 'Applicant retrieved successfully');
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/v1/admin/applicants/:id/applications
 * @desc Get applications for a specific applicant
 * @access Private (Admin - requires applicants.view permission)
 */
router.get('/:id/applications', requirePermission('applicants.view'), auditLog('ADMIN_VIEW_APPLICANT_APPLICATIONS'), async (req, res, next) => {
  try {
    const applicant = await applicantService.getApplicantById(req.params.id);
    if (!applicant) {
      throw ApiError.notFound('Applicant not found');
    }
    return ApiResponse.success(res, { applications: applicant.applications || [] }, 'Applicant applications retrieved successfully');
  } catch (error) {
    next(error);
  }
});

/**
 * @route PATCH /api/v1/admin/applicants/ocr
 * @desc Bulk toggle OCR for applicants
 * @access Private (Admin - requires applicants.edit permission)
 */
router.patch('/ocr', requirePermission('applicants.edit'), auditLog('ADMIN_UPDATE_APPLICANT_OCR'), async (req, res, next) => {
  try {
    const { applicant_ids: applicantIds, ocr_disabled: ocrDisabled } = req.body || {};

    if (!Array.isArray(applicantIds) || applicantIds.length === 0) {
      throw ApiError.badRequest('applicant_ids array is required');
    }

    const result = await applicantService.updateApplicantOCR(applicantIds, !!ocrDisabled);
    return ApiResponse.success(res, result, 'Applicant OCR settings updated successfully');
  } catch (error) {
    next(error);
  }
});

module.exports = router;
