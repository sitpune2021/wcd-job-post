// ============================================================================
// RBAC SERVICES INDEX
// ============================================================================
// Purpose: Central export for all RBAC services
// Usage: const rbacService = require('./services/rbac');
//        or: const { userService, roleService } = require('./services/rbac');
// ============================================================================

const userService = require('./userService');
const roleService = require('./roleService');
const permissionService = require('./permissionService');

// Re-export individual services for granular imports
module.exports = {
  userService,
  roleService,
  permissionService,
  
  // Flat exports for backward compatibility with old rbacService
  // Users
  getAllUsers: userService.getAllUsers,
  getUserById: userService.getUserById,
  createUser: userService.createUser,
  updateUser: userService.updateUser,
  deleteUser: userService.deleteUser,
  assignRoleToUser: userService.assignRoleToUser,
  resetUserPassword: userService.resetUserPassword,
  getUserEffectivePermissions: userService.getUserEffectivePermissions,
  
  // Roles
  getAllRoles: roleService.getAllRoles,
  getRoleById: roleService.getRoleById,
  createRole: roleService.createRole,
  updateRole: roleService.updateRole,
  deleteRole: roleService.deleteRole,
  assignPermissionsToRole: roleService.assignPermissionsToRole,
  removePermissionFromRole: roleService.removePermissionFromRole,
  
  // Wildcard Permissions
  getRoleWildcardPermissions: roleService.getRoleWildcardPermissions,
  assignWildcardToRole: roleService.assignWildcardToRole,
  removeWildcardFromRole: roleService.removeWildcardFromRole,
  getRoleEffectivePermissions: roleService.getRoleEffectivePermissions,
  
  // Permissions
  getAllPermissions: permissionService.getAllPermissions,
  getPermissionById: permissionService.getPermissionById,
  createPermission: permissionService.createPermission,
  updatePermission: permissionService.updatePermission,
  deletePermission: permissionService.deletePermission,
  
  // Sync
  syncPermissionsFromRegistry: permissionService.syncPermissionsFromRegistry,
  getAvailableWildcardPatterns: permissionService.getAvailableWildcardPatterns
};
