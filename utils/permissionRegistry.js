/**
 * Permission Registry - Matches Exactly What's Used in Routes
 * 
 * This registry defines ONLY the 68 permissions actively used in route files
 * Scanned from: /routes and /modules/hrm/routes
 * Date: 2026-04-07
 * 
 * These permissions match exactly what requirePermission() calls use
 */

const logger = require('../config/logger');

// In-memory registry of all permissions
const permissionRegistry = new Map();

/**
 * Register a permission in the registry
 * @param {Object} permission - Permission object
 */
const registerPermission = (permission) => {
  if (!permission.code || !permission.name) {
    throw new Error('Permission must have code and name');
  }
  
  permissionRegistry.set(permission.code, {
    code: permission.code,
    name: permission.name,
    description: permission.description || permission.name,
    module: permission.module || permission.code.split('.')[0],
    is_active: true,
    created_at: new Date(),
    updated_at: new Date()
  });
};

/**
 * Get all permissions from registry
 */
const getAllPermissions = () => {
  return Array.from(permissionRegistry.values());
};

// ==================== REGISTER EXACTLY USED PERMISSIONS ====================

// Applicants Module (2)
registerPermission({
  code: 'applicants.edit',
  name: 'Edit Applicants',
  description: 'Edit applicant information',
  module: 'applicants'
});

registerPermission({
  code: 'applicants.view',
  name: 'View Applicants',
  description: 'View applicant details',
  module: 'applicants'
});

// Applications Module (6)
registerPermission({
  code: 'applications.edit',
  name: 'Edit Applications',
  description: 'Edit application details',
  module: 'applications'
});

registerPermission({
  code: 'applications.final_select',
  name: 'Final Select Applications',
  description: 'Final select applications',
  module: 'applications'
});

registerPermission({
  code: 'applications.provisional_select',
  name: 'Provisionally Select Applications',
  description: 'Provisionally select applications',
  module: 'applications'
});

registerPermission({
  code: 'applications.update_status',
  name: 'Update Application Status',
  description: 'Update application status',
  module: 'applications'
});

registerPermission({
  code: 'applications.verify_documents',
  name: 'Verify Application Documents',
  description: 'Verify applicant documents',
  module: 'applications'
});

registerPermission({
  code: 'applications.view',
  name: 'View Applications',
  description: 'View application details',
  module: 'applications'
});

registerPermission({
  code: 'applications.approve',
  name: 'Approve Applications',
  description: 'Approve applications',
  module: 'applications'
});

registerPermission({
  code: 'applications.reject',
  name: 'Reject Applications',
  description: 'Reject applications',
  module: 'applications'
});

// Dashboard Module (1)
registerPermission({
  code: 'dashboard.view',
  name: 'View Dashboard',
  description: 'View dashboard',
  module: 'dashboard'
});

// Masters Module (37)

// Application Statuses
registerPermission({
  code: 'masters.application_statuses.create',
  name: 'Create Application Status',
  description: 'Create application status',
  module: 'masters'
});

registerPermission({
  code: 'masters.application_statuses.delete',
  name: 'Delete Application Status',
  description: 'Delete application status',
  module: 'masters'
});

registerPermission({
  code: 'masters.application_statuses.edit',
  name: 'Edit Application Status',
  description: 'Edit application status',
  module: 'masters'
});

// Banners
registerPermission({
  code: 'masters.banners.create',
  name: 'Create Banner',
  description: 'Create banner',
  module: 'masters'
});

registerPermission({
  code: 'masters.banners.delete',
  name: 'Delete Banner',
  description: 'Delete banner',
  module: 'masters'
});

registerPermission({
  code: 'masters.banners.edit',
  name: 'Edit Banner',
  description: 'Edit banner',
  module: 'masters'
});

registerPermission({
  code: 'masters.banners.view',
  name: 'View Banners',
  description: 'View banners',
  module: 'masters'
});

// Categories
registerPermission({
  code: 'masters.categories.create',
  name: 'Create Category',
  description: 'Create category',
  module: 'masters'
});

registerPermission({
  code: 'masters.categories.delete',
  name: 'Delete Category',
  description: 'Delete category',
  module: 'masters'
});

registerPermission({
  code: 'masters.categories.edit',
  name: 'Edit Category',
  description: 'Edit category',
  module: 'masters'
});

// Components
registerPermission({
  code: 'masters.components.create',
  name: 'Create Component',
  description: 'Create component/OSC',
  module: 'masters'
});

registerPermission({
  code: 'masters.components.delete',
  name: 'Delete Component',
  description: 'Delete component/OSC',
  module: 'masters'
});

registerPermission({
  code: 'masters.components.edit',
  name: 'Edit Component',
  description: 'Edit component/OSC',
  module: 'masters'
});

// Departments
registerPermission({
  code: 'masters.departments.create',
  name: 'Create Department',
  description: 'Create department',
  module: 'masters'
});

registerPermission({
  code: 'masters.departments.delete',
  name: 'Delete Department',
  description: 'Delete department',
  module: 'masters'
});

registerPermission({
  code: 'masters.departments.edit',
  name: 'Edit Department',
  description: 'Edit department',
  module: 'masters'
});

// Districts
registerPermission({
  code: 'masters.districts.create',
  name: 'Create District',
  description: 'Create district',
  module: 'masters'
});

registerPermission({
  code: 'masters.districts.delete',
  name: 'Delete District',
  description: 'Delete district',
  module: 'masters'
});

registerPermission({
  code: 'masters.districts.edit',
  name: 'Edit District',
  description: 'Edit district',
  module: 'masters'
});

// Document Types
registerPermission({
  code: 'masters.document_types.create',
  name: 'Create Document Type',
  description: 'Create document type',
  module: 'masters'
});

registerPermission({
  code: 'masters.document_types.delete',
  name: 'Delete Document Type',
  description: 'Delete document type',
  module: 'masters'
});

registerPermission({
  code: 'masters.document_types.edit',
  name: 'Edit Document Type',
  description: 'Edit document type',
  module: 'masters'
});

// Education Levels
registerPermission({
  code: 'masters.education_levels.create',
  name: 'Create Education Level',
  description: 'Create education level',
  module: 'masters'
});

registerPermission({
  code: 'masters.education_levels.delete',
  name: 'Delete Education Level',
  description: 'Delete education level',
  module: 'masters'
});

registerPermission({
  code: 'masters.education_levels.edit',
  name: 'Edit Education Level',
  description: 'Edit education level',
  module: 'masters'
});

// Hubs
registerPermission({
  code: 'masters.hubs.create',
  name: 'Create Hub',
  description: 'Create hub',
  module: 'masters'
});

registerPermission({
  code: 'masters.hubs.delete',
  name: 'Delete Hub',
  description: 'Delete hub',
  module: 'masters'
});

registerPermission({
  code: 'masters.hubs.edit',
  name: 'Edit Hub',
  description: 'Edit hub',
  module: 'masters'
});

// Posts
registerPermission({
  code: 'masters.posts.create',
  name: 'Create Post',
  description: 'Create post',
  module: 'masters'
});

registerPermission({
  code: 'masters.posts.delete',
  name: 'Delete Post',
  description: 'Delete post',
  module: 'masters'
});

registerPermission({
  code: 'masters.posts.edit',
  name: 'Edit Post',
  description: 'Edit post',
  module: 'masters'
});

// Skills
registerPermission({
  code: 'masters.skills.create',
  name: 'Create Skill',
  description: 'Create skill',
  module: 'masters'
});

registerPermission({
  code: 'masters.skills.delete',
  name: 'Delete Skill',
  description: 'Delete skill',
  module: 'masters'
});

registerPermission({
  code: 'masters.skills.edit',
  name: 'Edit Skill',
  description: 'Edit skill',
  module: 'masters'
});

// Talukas
registerPermission({
  code: 'masters.talukas.create',
  name: 'Create Taluka',
  description: 'Create taluka',
  module: 'masters'
});

registerPermission({
  code: 'masters.talukas.delete',
  name: 'Delete Taluka',
  description: 'Delete taluka',
  module: 'masters'
});

registerPermission({
  code: 'masters.talukas.edit',
  name: 'Edit Taluka',
  description: 'Edit taluka',
  module: 'masters'
});

// Permissions Module (4)
registerPermission({
  code: 'permissions.create',
  name: 'Create Permission',
  description: 'Create permission',
  module: 'permissions'
});

registerPermission({
  code: 'permissions.delete',
  name: 'Delete Permission',
  description: 'Delete permission',
  module: 'permissions'
});

registerPermission({
  code: 'permissions.edit',
  name: 'Edit Permission',
  description: 'Edit permission',
  module: 'permissions'
});

registerPermission({
  code: 'permissions.view',
  name: 'View Permissions',
  description: 'View permissions',
  module: 'permissions'
});

// Posts Module (6)
registerPermission({
  code: 'posts.close',
  name: 'Close Posts',
  description: 'Close posts',
  module: 'posts'
});

registerPermission({
  code: 'posts.create',
  name: 'Create Post',
  description: 'Create post',
  module: 'posts'
});

registerPermission({
  code: 'posts.delete',
  name: 'Delete Post',
  description: 'Delete post',
  module: 'posts'
});

registerPermission({
  code: 'posts.edit',
  name: 'Edit Post',
  description: 'Edit post',
  module: 'posts'
});

registerPermission({
  code: 'posts.publish',
  name: 'Publish Posts',
  description: 'Publish posts',
  module: 'posts'
});

registerPermission({
  code: 'posts.view',
  name: 'View Posts',
  description: 'View posts',
  module: 'posts'
});

// Reports Module (1)
registerPermission({
  code: 'reports.view',
  name: 'View Reports',
  description: 'View reports',
  module: 'reports'
});

// Roles Module (5)
registerPermission({
  code: 'roles.create',
  name: 'Create Role',
  description: 'Create role',
  module: 'roles'
});

registerPermission({
  code: 'roles.delete',
  name: 'Delete Role',
  description: 'Delete role',
  module: 'roles'
});

registerPermission({
  code: 'roles.edit',
  name: 'Edit Role',
  description: 'Edit role',
  module: 'roles'
});

registerPermission({
  code: 'roles.manage_permissions',
  name: 'Manage Role Permissions',
  description: 'Manage role permissions',
  module: 'roles'
});

registerPermission({
  code: 'roles.view',
  name: 'View Roles',
  description: 'View roles',
  module: 'roles'
});

// Users Module (6)
registerPermission({
  code: 'users.assign_roles',
  name: 'Assign Roles to Users',
  description: 'Assign roles to users',
  module: 'users'
});

registerPermission({
  code: 'users.create',
  name: 'Create User',
  description: 'Create user',
  module: 'users'
});

registerPermission({
  code: 'users.delete',
  name: 'Delete User',
  description: 'Delete user',
  module: 'users'
});

registerPermission({
  code: 'users.edit',
  name: 'Edit User',
  description: 'Edit user',
  module: 'users'
});

registerPermission({
  code: 'users.reset_password',
  name: 'Reset User Password',
  description: 'Reset user password',
  module: 'users'
});

registerPermission({
  code: 'users.view',
  name: 'View Users',
  description: 'View users',
  module: 'users'
});

// ==================== PERMISSION HELPER FUNCTIONS ====================

/**
 * Check if user has a specific permission (with wildcard support)
 * @param {Array} userPermissions - User's permissions array
 * @param {string} requiredPermission - Required permission to check
 * @returns {boolean} - Whether user has the permission
 */
const hasPermission = (userPermissions, requiredPermission) => {
  if (!userPermissions || !requiredPermission) {
    return false;
  }
  
  // Check for wildcard permission
  if (userPermissions.includes('*')) {
    return true;
  }
  
  // Check for exact match
  if (userPermissions.includes(requiredPermission)) {
    return true;
  }
  
  // Check for wildcard patterns (e.g., 'masters.*' matches 'masters.view')
  const wildcardPermissions = userPermissions.filter(p => p.endsWith('.*'));
  for (const wildcard of wildcardPermissions) {
    const prefix = wildcard.slice(0, -2); // Remove '.*' from end
    if (requiredPermission.startsWith(prefix + '.')) {
      return true;
    }
  }
  
  return false;
};

/**
 * Check if user has any of the required permissions
 * @param {Array} userPermissions - User's permissions array
 * @param {Array} requiredPermissions - Array of required permissions (OR logic)
 * @returns {boolean} - Whether user has at least one of the required permissions
 */
const hasAnyPermission = (userPermissions, requiredPermissions) => {
  if (!userPermissions || !requiredPermissions || requiredPermissions.length === 0) {
    return false;
  }
  
  // Check if user has wildcard permission
  if (userPermissions.includes('*')) {
    return true;
  }
  
  // Check each required permission
  return requiredPermissions.some(permission => hasPermission(userPermissions, permission));
};

// ==================== DATABASE SYNC ====================

/**
 * Sync permissions to database
 * @param {Object} sequelize - Sequelize instance
 * @returns {Object} Sync result with counts
 */
const syncToDatabase = async (sequelize) => {
  try {
    const { Permission } = sequelize.models;
    const permissions = getAllPermissions();
    
    let created = 0;
    let updated = 0;
    let skipped = 0;
    
    // Process permissions one by one without transaction to avoid conflicts
    for (const permission of permissions) {
      try {
        const [dbPermission, isNew] = await Permission.findOrCreate({
          where: { permission_code: permission.code },
          defaults: {
            permission_code: permission.code,
            permission_name: permission.name,
            description: permission.description,
            module: permission.module,
            is_active: true
          }
        });
        
        if (isNew) {
          created++;
        } else if (dbPermission.description !== permission.description || 
                   dbPermission.module !== permission.module) {
          await dbPermission.update({
            description: permission.description,
            module: permission.module,
            is_active: true
          });
          updated++;
        } else {
          skipped++;
        }
      } catch (error) {
        // Log error for individual permission but continue with others
        logger.warn(`Failed to sync permission ${permission.code}:`, error.message);
        skipped++;
      }
    }
    
    logger.info(`Permission sync complete: ${created} created, ${updated} updated, ${skipped} skipped`);
    return { created, updated, skipped, total: permissions.length };
  } catch (error) {
    logger.error('Error syncing permissions to database:', error);
    throw error;
  }
};

module.exports = {
  registerPermission,
  getAllPermissions,
  syncToDatabase,
  permissionRegistry,
  hasPermission,
  hasAnyPermission
};
