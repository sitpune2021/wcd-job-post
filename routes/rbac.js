const express = require('express');
const router = express.Router();
const rbacService = require('../services/rbac');
const { authenticate, requirePermission } = require('../middleware/auth');
const { ApiError } = require('../middleware/errorHandler');
const ApiResponse = require('../utils/ApiResponse');

/**
 * RBAC Routes - Users, Roles, Permissions
 * All routes require authentication and specific permissions
 */

// ==================== USER MANAGEMENT ====================

// Get all users
router.get('/users', authenticate, requirePermission(['users.view']), async (req, res, next) => {
  try {
    const filters = {
      role_id: req.query.role_id,
      is_active: req.query.is_active,
      search: req.query.search
    };
    const users = await rbacService.getAllUsers(filters);
    return ApiResponse.success(res, users, 'Users retrieved successfully');
  } catch (error) {
    next(error);
  }
});

// Get user by ID
router.get('/users/:id', authenticate, requirePermission(['users.view']), async (req, res, next) => {
  try {
    const user = await rbacService.getUserById(req.params.id);
    if (!user) {
      return next(ApiError.notFound('User not found'));
    }
    return ApiResponse.success(res, user, 'User retrieved successfully');
  } catch (error) {
    next(error);
  }
});

// Create user
router.post('/users', authenticate, requirePermission(['users.create']), async (req, res, next) => {
  try {
    const result = await rbacService.createUser(req.body, req.user.admin_id);
    return ApiResponse.created(res, { user: result.user, tempPassword: result.tempPassword }, 'User created successfully');
  } catch (error) {
    next(error);
  }
});

// Update user
router.put('/users/:id', authenticate, requirePermission(['users.edit']), async (req, res, next) => {
  try {
    const user = await rbacService.updateUser(req.params.id, req.body, req.user.admin_id);
    if (!user) {
      return next(ApiError.notFound('User not found'));
    }
    return ApiResponse.success(res, user, 'User updated successfully');
  } catch (error) {
    next(error);
  }
});

// Delete user
router.delete('/users/:id', authenticate, requirePermission(['users.delete']), async (req, res, next) => {
  try {
    const deleted = await rbacService.deleteUser(req.params.id, req.user.admin_id);
    if (!deleted) {
      return next(ApiError.notFound('User not found'));
    }
    return ApiResponse.deleted(res, 'User deleted successfully');
  } catch (error) {
    next(error);
  }
});

// Assign role to user
router.post('/users/:id/assign-role', authenticate, requirePermission(['users.assign_roles']), async (req, res, next) => {
  try {
    const user = await rbacService.assignRoleToUser(req.params.id, req.body.role_id, req.user.admin_id);
    if (!user) {
      return next(ApiError.notFound('User not found'));
    }
    return ApiResponse.success(res, user, 'Role assigned successfully');
  } catch (error) {
    next(error);
  }
});

// Reset user password
router.post('/users/:id/reset-password', authenticate, requirePermission(['users.reset_password']), async (req, res, next) => {
  try {
    const result = await rbacService.resetUserPassword(req.params.id, req.user.admin_id);
    if (!result) {
      return next(ApiError.notFound('User not found'));
    }
    return ApiResponse.success(res, { tempPassword: result.tempPassword }, 'Password reset successfully');
  } catch (error) {
    next(error);
  }
});

// ==================== ROLE MANAGEMENT ====================

// Get all roles (supports optional pagination and search)
router.get('/roles', authenticate, requirePermission(['roles.view']), async (req, res, next) => {
  try {
    const includeInactive = req.query.include_inactive === 'true';

    const result = await rbacService.getAllRoles({
      includeInactive,
      page: req.query.page,
      limit: req.query.limit,
      search: req.query.search
    });

    return ApiResponse.success(res, result, 'Roles retrieved successfully');
  } catch (error) {
    next(error);
  }
});

// Get role by ID with permissions
router.get('/roles/:id', authenticate, requirePermission(['roles.view']), async (req, res, next) => {
  try {
    const role = await rbacService.getRoleById(req.params.id);
    if (!role) {
      return next(ApiError.notFound('Role not found'));
    }
    return ApiResponse.success(res, role, 'Role retrieved successfully');
  } catch (error) {
    next(error);
  }
});

// Create role (CREATE ANY CUSTOM ROLE!)
router.post('/roles', authenticate, requirePermission(['roles.create']), async (req, res, next) => {
  try {
    const role = await rbacService.createRole(req.body, req.user.admin_id);
    return ApiResponse.created(res, role, 'Role created successfully');
  } catch (error) {
    next(error);
  }
});

// Update role
router.put('/roles/:id', authenticate, requirePermission(['roles.edit']), async (req, res, next) => {
  try {
    const role = await rbacService.updateRole(req.params.id, req.body, req.user.admin_id);
    if (!role) {
      return next(ApiError.notFound('Role not found'));
    }
    return ApiResponse.success(res, role, 'Role updated successfully');
  } catch (error) {
    next(error);
  }
});

// Delete role
router.delete('/roles/:id', authenticate, requirePermission(['roles.delete']), async (req, res, next) => {
  try {
    const deleted = await rbacService.deleteRole(req.params.id, req.user.admin_id);
    if (!deleted) {
      return next(ApiError.notFound('Role not found or cannot be deleted'));
    }
    return ApiResponse.deleted(res, 'Role deleted successfully');
  } catch (error) {
    next(error);
  }
});

// Assign permissions to role (ASSIGN ANY PERMISSIONS!)
router.post('/roles/:id/permissions', authenticate, requirePermission(['roles.manage_permissions']), async (req, res, next) => {
  try {
    const role = await rbacService.assignPermissionsToRole(req.params.id, req.body.permission_ids, req.user.admin_id);
    return ApiResponse.success(res, role, 'Permissions assigned successfully');
  } catch (error) {
    next(error);
  }
});

// Remove permission from role
router.delete('/roles/:roleId/permissions/:permissionId', authenticate, requirePermission(['roles.manage_permissions']), async (req, res, next) => {
  try {
    await rbacService.removePermissionFromRole(req.params.roleId, req.params.permissionId);
    return ApiResponse.success(res, null, 'Permission removed successfully');
  } catch (error) {
    next(error);
  }
});

// ==================== PERMISSION MANAGEMENT ====================

// Get all permissions
// Query params:
//   - format=flat (returns array) or format=grouped (returns object grouped by module, default)
router.get('/permissions', authenticate, requirePermission(['permissions.view']), async (req, res, next) => {
  try {
    const permissions = await rbacService.getAllPermissions();
    
    // If format=flat requested, flatten the grouped object to array
    if (req.query.format === 'flat') {
      const flatPermissions = Object.values(permissions).flat();
      return ApiResponse.success(res, flatPermissions, 'Permissions retrieved successfully');
    }
    
    return ApiResponse.success(res, permissions, 'Permissions retrieved successfully');
  } catch (error) {
    next(error);
  }
});

// Get permission by ID
router.get('/permissions/:id', authenticate, requirePermission(['permissions.view']), async (req, res, next) => {
  try {
    const permission = await rbacService.getPermissionById(req.params.id);
    if (!permission) {
      return next(ApiError.notFound('Permission not found'));
    }
    return ApiResponse.success(res, permission, 'Permission retrieved successfully');
  } catch (error) {
    next(error);
  }
});

// Create permission (CREATE NEW PERMISSIONS!)
router.post('/permissions', authenticate, requirePermission(['permissions.create']), async (req, res, next) => {
  try {
    const permission = await rbacService.createPermission(req.body, req.user.admin_id);
    return ApiResponse.created(res, permission, 'Permission created successfully');
  } catch (error) {
    next(error);
  }
});

// Update permission
router.put('/permissions/:id', authenticate, requirePermission(['permissions.edit']), async (req, res, next) => {
  try {
    const permission = await rbacService.updatePermission(req.params.id, req.body, req.user.admin_id);
    if (!permission) {
      return next(ApiError.notFound('Permission not found'));
    }
    return ApiResponse.success(res, permission, 'Permission updated successfully');
  } catch (error) {
    next(error);
  }
});

// Delete permission
router.delete('/permissions/:id', authenticate, requirePermission(['permissions.delete']), async (req, res, next) => {
  try {
    const deleted = await rbacService.deletePermission(req.params.id, req.user.admin_id);
    if (!deleted) {
      return next(ApiError.notFound('Permission not found'));
    }
    return ApiResponse.deleted(res, 'Permission deleted successfully');
  } catch (error) {
    next(error);
  }
});

// ==================== WILDCARD PERMISSION MANAGEMENT ====================

// Get available wildcard patterns
router.get('/wildcard-patterns', authenticate, requirePermission(['roles.manage_permissions']), async (req, res, next) => {
  try {
    const patterns = await rbacService.getAvailableWildcardPatterns();
    return ApiResponse.success(res, patterns, 'Wildcard patterns retrieved successfully');
  } catch (error) {
    next(error);
  }
});

// Get wildcard permissions for a role
router.get('/roles/:id/wildcards', authenticate, requirePermission(['roles.view']), async (req, res, next) => {
  try {
    const wildcards = await rbacService.getRoleWildcardPermissions(req.params.id);
    return ApiResponse.success(res, wildcards, 'Wildcard permissions retrieved successfully');
  } catch (error) {
    next(error);
  }
});

// Assign wildcard permission to role
router.post('/roles/:id/wildcards', authenticate, requirePermission(['roles.manage_permissions']), async (req, res, next) => {
  try {
    const { wildcard_pattern, description } = req.body;
    if (!wildcard_pattern) {
      return next(ApiError.badRequest('wildcard_pattern is required'));
    }
    const result = await rbacService.assignWildcardToRole(
      req.params.id, 
      wildcard_pattern, 
      description, 
      req.user.admin_id
    );
    return ApiResponse.success(res, result, 'Wildcard permission assigned successfully');
  } catch (error) {
    if (error.message.includes('Invalid wildcard pattern')) {
      return next(ApiError.badRequest(error.message));
    }
    next(error);
  }
});

// Remove wildcard permission from role
router.delete('/roles/:id/wildcards/:pattern', authenticate, requirePermission(['roles.manage_permissions']), async (req, res, next) => {
  try {
    const pattern = decodeURIComponent(req.params.pattern);
    const removed = await rbacService.removeWildcardFromRole(req.params.id, pattern);
    if (!removed) {
      return next(ApiError.notFound('Wildcard permission not found'));
    }
    return ApiResponse.deleted(res, 'Wildcard permission removed successfully');
  } catch (error) {
    next(error);
  }
});

// Get effective permissions for a role (expanded wildcards)
router.get('/roles/:id/effective-permissions', authenticate, requirePermission(['roles.view']), async (req, res, next) => {
  try {
    const permissions = await rbacService.getRoleEffectivePermissions(req.params.id);
    return ApiResponse.success(res, permissions, 'Effective permissions retrieved successfully');
  } catch (error) {
    next(error);
  }
});

// Get effective permissions for current user
router.get('/my-permissions', authenticate, async (req, res, next) => {
  try {
    const permissions = await rbacService.getUserEffectivePermissions(req.user.admin_id);
    return ApiResponse.success(res, {
      user_id: req.user.admin_id,
      role_code: req.user.dataValues?.role_code,
      permissions
    }, 'User permissions retrieved successfully');
  } catch (error) {
    next(error);
  }
});

// Sync permissions from registry to database (admin only)
router.post('/permissions/sync', authenticate, requirePermission(['permissions.create']), async (req, res, next) => {
  try {
    const result = await rbacService.syncPermissionsFromRegistry();
    return ApiResponse.success(res, result, 'Permissions synced successfully');
  } catch (error) {
    next(error);
  }
});

module.exports = router;
