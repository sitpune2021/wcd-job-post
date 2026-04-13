/**
 * HRM Onboarding Routes (Admin)
 * Handles employee onboarding workflows, Excel import, and applicant management
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../../../../middleware/auth');
const { hrmFeatureFlag, hrmHierarchy } = require('../../middleware');
const { requireHRMAdminPermission } = require('../../middleware/permissionGuard');
const { applyHRMHierarchyFilter } = hrmHierarchy;
const employeeOnboardingService = require('../../services/employeeOnboardingService');
const ApiResponse = require('../../../../utils/ApiResponse');
const { ApiError } = require('../../../../middleware/errorHandler');
const logger = require('../../../../config/logger');
const { excelUtils } = require('../../utils');
const { generateTemplate, parseExcelFile, validateHRMScope, upload } = excelUtils;

// Apply authentication and hierarchy filter
router.use(authenticate);
router.use(applyHRMHierarchyFilter);

// ==================== APPLICANT LISTS ====================

/**
 * @route GET /api/hrm/admin/onboarding/applicants/excel-imported
 * @desc Get list of applicants onboarded via Excel import
 * @access Admin only
 */
router.get('/applicants/excel-imported', 
  requireHRMAdminPermission(['hrm.onboarding.view', 'hrm.*']), 
  async (req, res, next) => {
  try {
    const filters = {
      district_id: req.query.district_id ? parseInt(req.query.district_id) : undefined,
      component_id: req.query.component_id ? parseInt(req.query.component_id) : undefined,
      hub_id: req.query.hub_id ? parseInt(req.query.hub_id) : undefined,
      onboarding_type: 'excel_import', // Filter for Excel imports only
      page: parseInt(req.query.page) || 1,
      limit: parseInt(req.query.limit) || 50
    };

    // Apply HRM scope filters
    if (req.hrmScope && req.hrmScope.filters) {
      Object.assign(filters, req.hrmScope.filters);
    }

    const result = await employeeOnboardingService.getOnboardedApplicants(filters);
    
    return ApiResponse.success(res, {
      data: result.applications,
      pagination: {
        page: filters.page,
        limit: filters.limit,
        total: result.total,
        totalPages: Math.ceil(result.total / filters.limit),
        hasNext: filters.page < Math.ceil(result.total / filters.limit),
        hasPrev: filters.page > 1
      }
    }, 'Excel imported applicants retrieved successfully');
  } catch (error) {
    next(error);
  }
});

// ==================== EXCEL IMPORT ====================
/**
 * @route POST /api/hrm/admin/onboarding/create-existing
 * @desc Create employee record (manual form)
 * @access Admin only
 */
router.post('/create-existing',
  requireHRMAdminPermission(['hrm.onboarding.import', 'hrm.*']),
  async (req, res, next) => {
  try {
    const employeeData = req.body;

    // Validate required fields
    const requiredFields = ['district_id', 'post_id', 'full_name', 'email', 'contract_start_date', 'dob', 'gender'];
    for (const field of requiredFields) {
      if (!employeeData[field]) {
        throw ApiError.badRequest(`${field} is required`);
      }
    }

    // Validate either component_id or hub_id is provided
    if (!employeeData.component_id && !employeeData.hub_id) {
      throw ApiError.badRequest('Either component_id or hub_id must be provided');
    }

    // Validate password if provided
    if (employeeData.password) {
      if (!employeeData.confirm_password) {
        throw ApiError.badRequest('confirm_password is required when password is provided');
      }
      if (employeeData.password !== employeeData.confirm_password) {
        throw ApiError.badRequest('Password and confirm password do not match');
      }
    }

    const adminId = req.user.admin_id;
    const ipAddress = req.ip;

    const result = await employeeOnboardingService.onboardExistingEmployee(
      employeeData,
      adminId,
      ipAddress,
      req.hrmScope
    );

    return ApiResponse.success(res, result, 'Employee created successfully');
  } catch (error) {
    logger.error('Onboarding route error:', {
      email: req.body.email,
      error: error.message,
      stack: error.stack
    });
    next(error);
  }
});

// ==================== EXCEL IMPORT/EXPORT ====================

/**
 * @route GET /api/hrm/admin/onboarding/download-template
 * @desc Download Excel template for bulk employee import
 * @access Admin only
 */
router.get('/download-template', 
  requireHRMAdminPermission(['hrm.onboarding.import', 'hrm.*']), 
  async (req, res, next) => {
  try {
    await generateTemplate(res);
  } catch (error) {
    next(error);
  }
});

/**
 * @route POST /api/hrm/admin/onboarding/import-excel
 * @desc Import employees from Excel file
 * @access Admin only
 */
router.post('/import-excel',
  requireHRMAdminPermission(['hrm.onboarding.import', 'hrm.*']),
  upload.single('file'),
  async (req, res, next) => {
  try {
    if (!req.file) {
      throw ApiError.badRequest('Excel file is required');
    }

    // Parse Excel file
    const employees = await parseExcelFile(req.file.buffer);

    // Validate HRM scope
    validateHRMScope(employees, req.hrmScope);

    // Import employees
    const result = await employeeOnboardingService.bulkImportExistingEmployees(
      employees,
      req.user.admin_id,
      req.ip,
      req.hrmScope
    );

    const createdCount = result.success.filter(item => item.action === 'created').length;
    const updatedCount = result.success.filter(item => item.action === 'updated').length;
    
    let message = `Successfully processed ${result.success.length} employees`;
    if (createdCount > 0) message += ` (${createdCount} created`;
    if (updatedCount > 0) message += `${createdCount > 0 ? ', ' : '('}${updatedCount} updated`;
    if (createdCount > 0 || updatedCount > 0) message += ')';
    if (result.failed.length > 0) message += ` (${result.failed.length} failed)`;

    return ApiResponse.success(res, result, message);
  } catch (error) {
    next(error);
  }
});

// ==================== ONBOARDING ACTIONS ====================

/**
 * @route GET /api/hrm/admin/onboarding/pending-applications
 * @desc Get selected applications pending onboarding (from CRM)
 * @access Admin only
 */
router.get('/pending-applications', 
  requireHRMAdminPermission(['hrm.onboarding.view', 'hrm.*']), 
  async (req, res, next) => {
  try {
    const filters = {
      district_id: req.query.district_id ? parseInt(req.query.district_id) : undefined,
      component_id: req.query.component_id ? parseInt(req.query.component_id) : undefined,
      hub_id: req.query.hub_id ? parseInt(req.query.hub_id) : undefined,
      page: parseInt(req.query.page) || 1,
      limit: parseInt(req.query.limit) || 50
    };

    // Apply HRM scope filters
    if (req.hrmScope && req.hrmScope.filters) {
      Object.assign(filters, req.hrmScope.filters);
    }

    const result = await employeeOnboardingService.getPendingSelectedApplicants(filters);
    
    return ApiResponse.success(res, {
      data: result.applications,
      pagination: {
        page: filters.page,
        limit: filters.limit,
        total: result.total,
        totalPages: Math.ceil(result.total / filters.limit),
        hasNext: filters.page < Math.ceil(result.total / filters.limit),
        hasPrev: filters.page > 1
      }
    }, 'Pending applications retrieved successfully');
  } catch (error) {
    next(error);
  }
});

/**
 * @route POST /api/hrm/admin/onboarding/confirm-selected
 * @desc Flow A: Confirm and onboard selected applicant from CRM
 * @access Admin only
 */
router.post('/confirm-selected',
  requireHRMAdminPermission(['hrm.onboarding.confirm', 'hrm.*']),
  async (req, res, next) => {
  try {
    const { applicant_id, employee_data } = req.body;

    if (!applicant_id) {
      throw ApiError.badRequest('applicant_id is required');
    }

    const adminId = req.user.admin_id;
    const ipAddress = req.ip;

    const result = await employeeOnboardingService.onboardSelectedApplicant(
      applicant_id,
      employee_data,
      adminId,
      ipAddress,
      req.hrmScope
    );

    return ApiResponse.success(res, result, 'Applicant confirmed and onboarded successfully');
  } catch (error) {
    next(error);
  }
});

/**
 * @route POST /api/hrm/admin/onboarding/send-email
 * @desc Flow B: Send onboarding email to selected applicants
 * @access Admin only
 */
router.post('/send-email',
  requireHRMAdminPermission(['hrm.onboarding.email', 'hrm.*']),
  async (req, res, next) => {
  try {
    const { applicant_ids, custom_message, force_resend = false } = req.body;

    // Convert string boolean to actual boolean
    const forceResend = force_resend === true || force_resend === 'true';

    if (!applicant_ids || !Array.isArray(applicant_ids) || applicant_ids.length === 0) {
      throw ApiError.badRequest('applicant_ids array is required');
    }

    const adminId = req.user.admin_id;
    const ipAddress = req.ip;

    const result = await employeeOnboardingService.sendOnboardingEmails(
      applicant_ids,
      custom_message,
      adminId,
      ipAddress,
      req.hrmScope,
      forceResend
    );

    return ApiResponse.success(res, result, 'Onboarding email sent successfully');
  } catch (error) {
    next(error);
  }
});

module.exports = router;
