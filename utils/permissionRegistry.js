/**
 * Permission Registry - Dynamic API-based Permission System
 * 
 * This utility provides industry-standard dynamic permission management:
 * 1. Auto-registers permissions from API routes
 * 2. Supports wildcard permissions (e.g., masters.* grants all master permissions)
 * 3. Follows resource.action naming convention
 * 4. Syncs permissions to database on startup
 * 
 * Permission Code Format: {module}.{resource}.{action}
 * Examples:
 *   - users.view, users.create, users.edit, users.delete
 *   - masters.districts.view, masters.districts.create
 *   - applications.review, applications.approve
 * 
 * Wildcard Examples:
 *   - users.* → all user permissions
 *   - masters.* → all master data permissions
 *   - *.view → all view permissions (read-only access)
 *   - * → superadmin (all permissions)
 */

const logger = require('../config/logger');

// In-memory registry of all permissions
const permissionRegistry = new Map();

// Action to HTTP method mapping
const ACTION_METHOD_MAP = {
  view: ['GET'],
  list: ['GET'],
  create: ['POST'],
  edit: ['PUT', 'PATCH'],
  delete: ['DELETE'],
  manage: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  export: ['GET'],
  import: ['POST'],
  approve: ['POST', 'PUT'],
  reject: ['POST', 'PUT'],
  publish: ['POST', 'PUT'],
  assign: ['POST', 'PUT'],
  reset: ['POST'],
  verify: ['POST', 'PUT']
};

// Standard actions for CRUD operations
const STANDARD_ACTIONS = ['view', 'create', 'edit', 'delete'];

/**
 * Register a permission in the registry
 * @param {Object} permission - Permission object
 * @param {string} permission.code - Permission code (e.g., 'users.view')
 * @param {string} permission.name - Human-readable name
 * @param {string} permission.description - Description
 * @param {string} permission.module - Module name
 * @param {string} permission.resource - Resource name (optional)
 * @param {string} permission.action - Action name (optional)
 * @param {string} permission.httpMethod - HTTP method (optional)
 * @param {string} permission.apiPath - API path pattern (optional)
 */
const registerPermission = (permission) => {
  const { code, name, description, module, resource, action, httpMethod, apiPath } = permission;
  
  if (!code || !name || !module) {
    logger.warn(`Invalid permission registration: ${JSON.stringify(permission)}`);
    return false;
  }

  permissionRegistry.set(code, {
    code,
    name,
    description: description || `${name} permission`,
    module,
    resource: resource || null,
    action: action || null,
    httpMethod: httpMethod || null,
    apiPath: apiPath || null,
    isActive: true,
    registeredAt: new Date()
  });

  return true;
};

/**
 * Register multiple permissions for a resource with standard CRUD actions
 * @param {string} module - Module name (e.g., 'users', 'masters')
 * @param {string} resource - Resource name (e.g., 'districts', 'posts')
 * @param {Object} options - Options
 * @param {string[]} options.actions - Actions to register (default: CRUD)
 * @param {string} options.basePath - Base API path
 */
const registerResourcePermissions = (module, resource, options = {}) => {
  const { actions = STANDARD_ACTIONS, basePath = '' } = options;
  const resourceName = resource ? `${module}.${resource}` : module;
  const displayName = resource 
    ? `${capitalize(resource)}` 
    : `${capitalize(module)}`;

  actions.forEach(action => {
    const code = resource ? `${module}.${resource}.${action}` : `${module}.${action}`;
    const methods = ACTION_METHOD_MAP[action] || ['GET'];
    
    registerPermission({
      code,
      name: `${getActionLabel(action)} ${displayName}`,
      description: `${getActionLabel(action)} ${displayName.toLowerCase()} data`,
      module,
      resource,
      action,
      httpMethod: methods[0],
      apiPath: basePath
    });
  });
};

/**
 * Register a single API route as a permission
 * @param {string} method - HTTP method
 * @param {string} path - API path
 * @param {string} permissionCode - Permission code
 * @param {Object} options - Additional options
 */
const registerRoutePermission = (method, path, permissionCode, options = {}) => {
  const parts = permissionCode.split('.');
  const module = parts[0];
  const action = parts[parts.length - 1];
  const resource = parts.length > 2 ? parts.slice(1, -1).join('.') : null;

  registerPermission({
    code: permissionCode,
    name: options.name || `${getActionLabel(action)} ${capitalize(resource || module)}`,
    description: options.description || `Permission for ${method} ${path}`,
    module,
    resource,
    action,
    httpMethod: method,
    apiPath: path
  });
};

/**
 * Get all registered permissions
 * @returns {Object[]} Array of permission objects
 */
const getAllPermissions = () => {
  return Array.from(permissionRegistry.values());
};

/**
 * Get permissions grouped by module
 * @returns {Object} Permissions grouped by module
 */
const getPermissionsByModule = () => {
  const grouped = {};
  
  permissionRegistry.forEach((permission) => {
    if (!grouped[permission.module]) {
      grouped[permission.module] = [];
    }
    grouped[permission.module].push(permission);
  });

  // Sort permissions within each module
  Object.keys(grouped).forEach(module => {
    grouped[module].sort((a, b) => a.code.localeCompare(b.code));
  });

  return grouped;
};

/**
 * Check if a user has a specific permission
 * Supports wildcard matching:
 *   - '*' matches all permissions
 *   - 'module.*' matches all permissions in module
 *   - 'module.resource.*' matches all actions on resource
 * 
 * @param {string[]} userPermissions - User's assigned permission codes
 * @param {string} requiredPermission - Required permission code
 * @returns {boolean} True if user has permission
 */
const hasPermission = (userPermissions, requiredPermission) => {
  if (!userPermissions || !Array.isArray(userPermissions)) {
    return false;
  }

  // Direct match
  if (userPermissions.includes(requiredPermission)) {
    return true;
  }

  // Check wildcard permissions
  for (const userPerm of userPermissions) {
    // Full wildcard (superadmin)
    if (userPerm === '*') {
      return true;
    }

    // Module wildcard (e.g., 'users.*' matches 'users.view')
    if (userPerm.endsWith('.*')) {
      const prefix = userPerm.slice(0, -1); // Remove '*'
      if (requiredPermission.startsWith(prefix)) {
        return true;
      }
    }

    // Action wildcard (e.g., '*.view' matches 'users.view')
    if (userPerm.startsWith('*.')) {
      const suffix = userPerm.slice(1); // Remove '*'
      if (requiredPermission.endsWith(suffix)) {
        return true;
      }
    }
  }

  return false;
};

/**
 * Check if user has ANY of the required permissions
 * @param {string[]} userPermissions - User's assigned permission codes
 * @param {string[]} requiredPermissions - Required permission codes (OR logic)
 * @returns {boolean} True if user has at least one permission
 */
const hasAnyPermission = (userPermissions, requiredPermissions) => {
  return requiredPermissions.some(perm => hasPermission(userPermissions, perm));
};

/**
 * Check if user has ALL of the required permissions
 * @param {string[]} userPermissions - User's assigned permission codes
 * @param {string[]} requiredPermissions - Required permission codes (AND logic)
 * @returns {boolean} True if user has all permissions
 */
const hasAllPermissions = (userPermissions, requiredPermissions) => {
  return requiredPermissions.every(perm => hasPermission(userPermissions, perm));
};

/**
 * Expand wildcard permissions to actual permission codes
 * @param {string[]} permissions - Permission codes (may include wildcards)
 * @returns {string[]} Expanded permission codes
 */
const expandWildcards = (permissions) => {
  const expanded = new Set();

  permissions.forEach(perm => {
    if (perm === '*') {
      // Add all permissions
      permissionRegistry.forEach((_, code) => expanded.add(code));
    } else if (perm.endsWith('.*')) {
      // Module wildcard
      const prefix = perm.slice(0, -1);
      permissionRegistry.forEach((_, code) => {
        if (code.startsWith(prefix)) {
          expanded.add(code);
        }
      });
    } else if (perm.startsWith('*.')) {
      // Action wildcard
      const suffix = perm.slice(1);
      permissionRegistry.forEach((_, code) => {
        if (code.endsWith(suffix)) {
          expanded.add(code);
        }
      });
    } else {
      expanded.add(perm);
    }
  });

  return Array.from(expanded);
};

/**
 * Sync registered permissions to database
 * @param {Object} sequelize - Sequelize instance
 * @returns {Object} Sync result with counts
 */
const syncToDatabase = async (sequelize) => {
  try {
    const permissions = getAllPermissions();
    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const perm of permissions) {
      const [result, wasCreated] = await sequelize.query(
        `INSERT INTO ms_permissions (permission_name, permission_code, description, module, is_active, created_at)
         VALUES (:name, :code, :description, :module, true, NOW())
         ON CONFLICT (permission_code) DO UPDATE SET
           permission_name = EXCLUDED.permission_name,
           description = EXCLUDED.description,
           module = EXCLUDED.module,
           is_active = true
         RETURNING permission_id, (xmax = 0) as was_inserted`,
        {
          replacements: {
            name: perm.name,
            code: perm.code,
            description: perm.description,
            module: perm.module
          }
        }
      );

      if (result[0]?.was_inserted) {
        created++;
      } else {
        updated++;
      }
    }

    logger.info(`Permission sync complete: ${created} created, ${updated} updated`);
    return { created, updated, skipped, total: permissions.length };
  } catch (error) {
    logger.error('Error syncing permissions to database:', error);
    throw error;
  }
};

/**
 * Get permission code from HTTP method and path
 * @param {string} method - HTTP method
 * @param {string} path - API path
 * @returns {string|null} Permission code or null
 */
const getPermissionFromRoute = (method, path) => {
  // Find matching permission by route
  for (const [code, perm] of permissionRegistry) {
    if (perm.httpMethod === method && perm.apiPath === path) {
      return code;
    }
  }
  return null;
};

// Helper functions
function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).replace(/_/g, ' ');
}

function getActionLabel(action) {
  const labels = {
    view: 'View',
    list: 'List',
    create: 'Create',
    edit: 'Edit',
    delete: 'Delete',
    manage: 'Manage',
    export: 'Export',
    import: 'Import',
    approve: 'Approve',
    reject: 'Reject',
    publish: 'Publish',
    assign: 'Assign',
    reset: 'Reset',
    verify: 'Verify'
  };
  return labels[action] || capitalize(action);
}

// ============================================
// REGISTER ALL APPLICATION PERMISSIONS
// ============================================

// User Management
registerResourcePermissions('users', null, { 
  actions: ['view', 'create', 'edit', 'delete', 'assign_roles', 'reset_password'] 
});

// Role Management
registerResourcePermissions('roles', null, { 
  actions: ['view', 'create', 'edit', 'delete', 'manage_permissions'] 
});

// Permission Management
registerResourcePermissions('permissions', null, { 
  actions: ['view', 'create', 'edit', 'delete'] 
});

// Master Data - Districts
registerResourcePermissions('masters', 'districts', { 
  actions: ['view', 'create', 'edit', 'delete'] 
});

// Master Data - Talukas
registerResourcePermissions('masters', 'talukas', { 
  actions: ['view', 'create', 'edit', 'delete'] 
});

// Master Data - Components
registerResourcePermissions('masters', 'components', { 
  actions: ['view', 'create', 'edit', 'delete'] 
});

// Master Data - Posts
registerResourcePermissions('masters', 'posts', { 
  actions: ['view', 'create', 'edit', 'delete'] 
});

// Master Data - Document Types
registerResourcePermissions('masters', 'document_types', { 
  actions: ['view', 'create', 'edit', 'delete'] 
});

// Master Data - Education Levels
registerResourcePermissions('masters', 'education_levels', { 
  actions: ['view', 'create', 'edit', 'delete'] 
});

// Master Data - Categories
registerResourcePermissions('masters', 'categories', { 
  actions: ['view', 'create', 'edit', 'delete'] 
});

// Master Data - Experience Domains
registerResourcePermissions('masters', 'experience_domains', { 
  actions: ['view', 'create', 'edit', 'delete'] 
});

// Master Data - Application Statuses
registerResourcePermissions('masters', 'application_statuses', { 
  actions: ['view', 'create', 'edit', 'delete'] 
});

// Master Data - Banners
registerResourcePermissions('masters', 'banners', { 
  actions: ['view', 'create', 'edit', 'delete'] 
});

// Posts/Jobs Management
registerResourcePermissions('posts', null, { 
  actions: ['view', 'create', 'edit', 'delete', 'publish'] 
});

// Application Management
registerResourcePermissions('applications', null, { 
  actions: ['view', 'review', 'approve', 'reject', 'export', 'verify'] 
});

// Applicant Management
registerResourcePermissions('applicants', null, { 
  actions: ['view', 'edit', 'verify_documents'] 
});

// Eligibility & Merit
registerResourcePermissions('eligibility', null, { 
  actions: ['check', 'view'] 
});

registerResourcePermissions('merit', null, { 
  actions: ['view', 'generate', 'publish'] 
});

// Reports & Analytics
registerResourcePermissions('reports', null, { 
  actions: ['view', 'export'] 
});

registerResourcePermissions('analytics', null, { 
  actions: ['view'] 
});

// Audit & Logs
registerResourcePermissions('audit', null, { 
  actions: ['view', 'login_attempts'] 
});

// Notifications
registerResourcePermissions('notifications', null, { 
  actions: ['send', 'view_logs'] 
});

// Dashboard
registerResourcePermissions('dashboard', null, { 
  actions: ['view', 'stats'] 
});

// System Settings
registerResourcePermissions('settings', null, { 
  actions: ['view', 'edit'] 
});

module.exports = {
  registerPermission,
  registerResourcePermissions,
  registerRoutePermission,
  getAllPermissions,
  getPermissionsByModule,
  hasPermission,
  hasAnyPermission,
  hasAllPermissions,
  expandWildcards,
  syncToDatabase,
  getPermissionFromRoute,
  permissionRegistry,
  STANDARD_ACTIONS,
  ACTION_METHOD_MAP
};
