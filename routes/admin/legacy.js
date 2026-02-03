const express = require('express');
const router = express.Router();
const { authenticate, requireRole, auditLog, requirePermission } = require('../../middleware/auth');
const { validate, schemas } = require('../../middleware/validate');
const { ApiError } = require('../../middleware/errorHandler');
const ApiResponse = require('../../utils/ApiResponse');
const adminService = require('../../services/admin/legacyAdminService');

// All routes require authentication
router.use(authenticate);

// All routes require admin role (state-level system)
router.use((req, res, next) => {
  const adminRoles = ['SUPER_ADMIN', 'STATE_ADMIN', 'POST_MANAGER', 'APP_REVIEWER', 'REPORT_VIEWER'];
  if (!req.user || !adminRoles.includes(req.user.role.role_code)) {
    return next(ApiError.forbidden('Admin access required'));
  }
  next();
});

// ==================== DASHBOARD ====================

/**
 * @route GET /api/v1/admin/dashboard
 * @desc Get admin dashboard data
 * @access Private (Admin)
 */
router.get('/dashboard', auditLog('ADMIN_VIEW_DASHBOARD'), async (req, res, next) => {
  try {
    const stats = await adminService.getDashboardStats(req.user);
    return ApiResponse.success(res, stats, 'Dashboard stats retrieved successfully');
  } catch (error) {
    next(error);
  }
});

// ==================== USER MANAGEMENT ====================

/**
 * @route POST /api/v1/admin/users
 * @desc Create a new admin user
 * @access Private (SUPER_ADMIN, STATE_USER, ZP_OWNER)
 */
router.post('/users', requireRole(['SUPER_ADMIN', 'STATE_USER', 'ZP_OWNER']), auditLog('CREATE_USER'), async (req, res, next) => {
  try {
    const { username, password, full_name, email, mobile_no, role_id } = req.body;

    if (!username || !password || !full_name || !role_id) {
      throw ApiError.badRequest('Username, password, full name, and role are required');
    }

    const user = await adminService.createUser(req.body, req.user);
    return ApiResponse.created(res, user, 'User created successfully');
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/v1/admin/users
 * @desc Get all admin users
 * @access Private (SUPER_ADMIN, STATE_USER, ZP_OWNER)
 */
router.get('/users', requireRole(['SUPER_ADMIN', 'STATE_USER', 'ZP_OWNER']), auditLog('VIEW_USERS'), async (req, res, next) => {
  try {
    const result = await adminService.getUsers(req.query, req.user);
    return ApiResponse.success(res, result, 'Users retrieved successfully');
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/v1/admin/users/:id
 * @desc Get admin user by ID
 * @access Private (SUPER_ADMIN, STATE_USER, ZP_OWNER)
 */
router.get('/users/:id', requireRole(['SUPER_ADMIN', 'STATE_USER', 'ZP_OWNER']), async (req, res, next) => {
  try {
    const user = await adminService.getUserById(req.params.id, req.user);
    return ApiResponse.success(res, user, 'User retrieved successfully');
  } catch (error) {
    next(error);
  }
});

/**
 * @route PUT /api/v1/admin/users/:id
 * @desc Update admin user
 * @access Private (SUPER_ADMIN, STATE_USER, ZP_OWNER)
 */
router.put('/users/:id', requireRole(['SUPER_ADMIN', 'STATE_USER', 'ZP_OWNER']), auditLog('UPDATE_USER'), async (req, res, next) => {
  try {
    const user = await adminService.updateUser(req.params.id, req.body, req.user);
    return ApiResponse.success(res, user, 'User updated successfully');
  } catch (error) {
    next(error);
  }
});

/**
 * @route DELETE /api/v1/admin/users/:id
 * @desc Delete admin user (soft delete)
 * @access Private (SUPER_ADMIN, STATE_USER, ZP_OWNER)
 */
router.delete('/users/:id', requireRole(['SUPER_ADMIN', 'STATE_USER', 'ZP_OWNER']), auditLog('DELETE_USER'), async (req, res, next) => {
  try {
    await adminService.deleteUser(req.params.id, req.user);
    return ApiResponse.deleted(res, 'User deleted successfully');
  } catch (error) {
    next(error);
  }
});

/**
 * @route POST /api/v1/admin/users/:id/reset-password
 * @desc Reset user password
 * @access Private (SUPER_ADMIN, STATE_USER, ZP_OWNER)
 */
router.post('/users/:id/reset-password', requireRole(['SUPER_ADMIN', 'STATE_USER', 'ZP_OWNER']), auditLog('RESET_PASSWORD'), async (req, res, next) => {
  try {
    const { password } = req.body;

    if (!password || password.length < 8) {
      throw ApiError.badRequest('Password must be at least 8 characters');
    }

    await adminService.resetPassword(req.params.id, password, req.user);
    return ApiResponse.success(res, null, 'Password reset successfully');
  } catch (error) {
    next(error);
  }
});

// ==================== ROLE MANAGEMENT ====================

/**
 * @route GET /api/v1/admin/roles
 * @desc Get roles with pagination and search
 * @access Private (SUPER_ADMIN, STATE_USER)
 */
router.get('/roles', requireRole(['SUPER_ADMIN', 'STATE_USER']), async (req, res, next) => {
  try {
    const result = await adminService.getRoles(req.query);
    return ApiResponse.success(res, result, 'Roles retrieved successfully');
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/v1/admin/permissions
 * @desc Get all permissions
 * @access Private (SUPER_ADMIN, STATE_USER)
 */
router.get('/permissions', requireRole(['SUPER_ADMIN', 'STATE_USER']), async (req, res, next) => {
  try {
    const permissions = await adminService.getPermissions();
    return ApiResponse.success(res, permissions, 'Permissions retrieved successfully');
  } catch (error) {
    next(error);
  }
});

/**
 * @route PUT /api/v1/admin/roles/:id/permissions
 * @desc Update role permissions
 * @access Private (SUPER_ADMIN)
 */
router.put('/roles/:id/permissions', requireRole(['SUPER_ADMIN']), auditLog('UPDATE_ROLE_PERMISSIONS'), async (req, res, next) => {
  try {
    const { permission_ids } = req.body;

    if (!Array.isArray(permission_ids)) {
      throw ApiError.badRequest('permission_ids must be an array');
    }

    const role = await adminService.updateRolePermissions(req.params.id, permission_ids);
    return ApiResponse.success(res, role, 'Role permissions updated successfully');
  } catch (error) {
    next(error);
  }
});

// ==================== APPLICATION MANAGEMENT ====================

/**
 * @route GET /api/v1/admin/applications
 * @desc Get all applications with filters
 * @access Private (Admin)
 */
router.get('/applications', auditLog('ADMIN_VIEW_APPLICATIONS'), async (req, res, next) => {
  try {
    const result = await adminService.getApplications(req.query, req.user);
    return ApiResponse.success(res, result, 'Applications retrieved successfully');
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/v1/admin/applications/:id
 * @desc Get application details
 * @access Private (Admin)
 */
router.get('/applications/:id', auditLog('ADMIN_VIEW_APPLICATION_DETAILS'), async (req, res, next) => {
  try {
    const application = await adminService.getApplicationById(req.params.id, req.user);
    return ApiResponse.success(res, application, 'Application retrieved successfully');
  } catch (error) {
    next(error);
  }
});

/**
 * @routeoute PUT /api/v1/admin/applications/:id/status
 * @desc Update application status
 * @access Private (Admin - SUPER_ADMIN, STATE_USER, ZP_OWNER, ZP_EDITOR)
 */
router.put('/applications/:id/status', requireRole(['SUPER_ADMIN', 'STATE_USER', 'ZP_OWNER', 'ZP_EDITOR']), auditLog('UPDATE_APPLICATION_STATUS'), async (req, res, next) => {
  try {
    const { status, remarks } = req.body;

    if (!status) {
      throw ApiError.badRequest('Status is required');
    }

    const application = await adminService.updateApplicationStatus(req.params.id, status, remarks, req.user);
    return ApiResponse.success(res, application, 'Application status updated successfully');
  } catch (error) {
    next(error);
  }
});

// ==================== ELIGIBILITY ====================

/**
 * @route POST /api/v1/admin/eligibility/:id/check
 * @desc Check eligibility for an application
 * @access Private (Admin - SUPER_ADMIN, STATE_USER, ZP_OWNER, ZP_EDITOR)
 */
router.post('/eligibility/:id/check', requireRole(['SUPER_ADMIN', 'STATE_USER', 'ZP_OWNER', 'ZP_EDITOR']), auditLog('CHECK_ELIGIBILITY'), async (req, res, next) => {
  try {
    const result = await adminService.checkEligibility(req.params.id, req.user);
    return ApiResponse.success(res, result, 'Eligibility check completed');
  } catch (error) {
    next(error);
  }
});

// ==================== MERIT LIST ====================

/**
 * @route POST /api/v1/admin/merit/:post_id
 * @desc Generate merit list for a post (optionally filtered by district)
 * @access Private (Admin - SUPER_ADMIN, STATE_ADMIN, MERIT_OFFICER)
 */
router.post('/merit/:post_id', requireRole(['SUPER_ADMIN', 'STATE_ADMIN', 'MERIT_OFFICER']), auditLog('GENERATE_MERIT_LIST'), async (req, res, next) => {
  try {
    const { district_id } = req.query;
    const result = await adminService.generateMeritList(district_id || null, req.params.post_id, req.user);
    return ApiResponse.success(res, result, 'Merit list generated successfully');
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/v1/admin/merit/:post_id
 * @desc Get merit list for a post (optionally filtered by district)
 * @access Private (Admin)
 */
router.get('/merit/:post_id', auditLog('VIEW_MERIT_LIST'), async (req, res, next) => {
  try {
    const { district_id } = req.query;
    const meritList = await adminService.getMeritList(district_id || null, req.params.post_id, req.user);
    return ApiResponse.success(res, meritList, 'Merit list retrieved successfully');
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/v1/admin/merit/export
 * @desc Export merit list (Excel/PDF) - placeholder
 * @access Private (Admin)
 */
router.get('/merit/export', auditLog('EXPORT_MERIT_LIST'), async (req, res, next) => {
  try {
    const { format, district_id, post_id } = req.query;

    if (!format || !['excel', 'pdf'].includes(format)) {
      throw ApiError.badRequest('Invalid export format. Use excel or pdf.');
    }

    if (!post_id) {
      throw ApiError.badRequest('Post ID is required for export.');
    }

    // Get merit list data
    const meritList = await adminService.getMeritList(district_id || null, post_id, req.user);

    // For now, return JSON - Excel/PDF export can be added later
    return ApiResponse.success(res, { format, meritList }, 'Export data ready');
  } catch (error) {
    next(error);
  }
});

/**
 * @route POST /api/v1/admin/notify
 * @desc Send notifications to applicants - placeholder
 * @access Private (Admin - SUPER_ADMIN, STATE_USER, ZP_OWNER)
 */
router.post('/notify', requireRole(['SUPER_ADMIN', 'STATE_USER', 'ZP_OWNER']), auditLog('SEND_NOTIFICATIONS'), async (req, res, next) => {
  try {
    const { applicant_ids, message, channel } = req.body;

    if (!applicant_ids || !Array.isArray(applicant_ids) || applicant_ids.length === 0) {
      throw ApiError.badRequest('Applicant IDs are required.');
    }

    if (!message) {
      throw ApiError.badRequest('Message is required.');
    }

    if (!channel || !['SMS', 'EMAIL', 'SYSTEM'].includes(channel)) {
      throw ApiError.badRequest('Valid channel is required (SMS, EMAIL, or SYSTEM).');
    }

    // Placeholder - actual notification sending can be implemented later
    return ApiResponse.success(res, { count: applicant_ids.length, channel }, 'Notifications queued');
  } catch (error) {
    next(error);
  }
});

module.exports = router;
