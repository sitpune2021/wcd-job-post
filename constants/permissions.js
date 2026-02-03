// ============================================================================
// PERMISSION CONSTANTS
// ============================================================================
// Purpose: Centralized permission codes used across the application
// Format: MODULE.RESOURCE.ACTION or MODULE.ACTION
// Usage: const { PERMISSIONS } = require('../constants');
//        requirePermission(PERMISSIONS.USERS.VIEW)
// ============================================================================

const PERMISSIONS = {
  // ==================== USER MANAGEMENT ====================
  USERS: {
    VIEW: 'users.view',
    CREATE: 'users.create',
    UPDATE: 'users.edit',
    DELETE: 'users.delete',
    MANAGE: 'users.*'
  },
  
  // ==================== ROLE MANAGEMENT ====================
  ROLES: {
    VIEW: 'roles.view',
    CREATE: 'roles.create',
    UPDATE: 'roles.edit',
    DELETE: 'roles.delete',
    ASSIGN: 'roles.assign',
    MANAGE: 'roles.*'
  },
  
  // ==================== MASTER DATA ====================
  MASTERS: {
    VIEW: 'masters.view',
    CREATE: 'masters.create',
    UPDATE: 'masters.edit',
    DELETE: 'masters.delete',
    MANAGE: 'masters.*',
    
    // Specific master data
    DISTRICTS: {
      VIEW: 'masters.districts.view',
      CREATE: 'masters.districts.create',
      UPDATE: 'masters.districts.edit',
      DELETE: 'masters.districts.delete'
    },
    TALUKAS: {
      VIEW: 'masters.talukas.view',
      CREATE: 'masters.talukas.create',
      UPDATE: 'masters.talukas.edit',
      DELETE: 'masters.talukas.delete'
    },
    POSTS: {
      VIEW: 'masters.posts.view',
      CREATE: 'masters.posts.create',
      UPDATE: 'masters.posts.edit',
      DELETE: 'masters.posts.delete'
    },
    COMPONENTS: {
      VIEW: 'masters.components.view',
      CREATE: 'masters.components.create',
      UPDATE: 'masters.components.edit',
      DELETE: 'masters.components.delete'
    },
    CATEGORIES: {
      VIEW: 'masters.categories.view',
      CREATE: 'masters.categories.create',
      UPDATE: 'masters.categories.edit',
      DELETE: 'masters.categories.delete'
    },
    EDUCATION_LEVELS: {
      VIEW: 'masters.education_levels.view',
      CREATE: 'masters.education_levels.create',
      UPDATE: 'masters.education_levels.edit',
      DELETE: 'masters.education_levels.delete'
    },
    DOCUMENT_TYPES: {
      VIEW: 'masters.document_types.view',
      CREATE: 'masters.document_types.create',
      UPDATE: 'masters.document_types.edit',
      DELETE: 'masters.document_types.delete'
    },
    BANNERS: {
      VIEW: 'masters.banners.view',
      CREATE: 'masters.banners.create',
      UPDATE: 'masters.banners.edit',
      DELETE: 'masters.banners.delete'
    }
  },
  
  // ==================== APPLICATIONS ====================
  APPLICATIONS: {
    VIEW: 'applications.view',
    VIEW_ALL: 'applications.view-all',
    UPDATE_STATUS: 'applications.edit-status',
    VERIFY: 'applications.verify',
    APPROVE: 'applications.approve',
    REJECT: 'applications.reject',
    EXPORT: 'applications.export',
    MANAGE: 'applications.*'
  },
  
  // ==================== APPLICANTS ====================
  APPLICANTS: {
    VIEW: 'applicants.view',
    VIEW_ALL: 'applicants.view-all',
    UPDATE: 'applicants.edit',
    DELETE: 'applicants.delete',
    EXPORT: 'applicants.export',
    MANAGE: 'applicants.*'
  },
  
  // ==================== REPORTS ====================
  REPORTS: {
    VIEW: 'reports.view',
    GENERATE: 'reports.generate',
    EXPORT: 'reports.export',
    MANAGE: 'reports.*'
  },
  
  // ==================== DASHBOARD ====================
  DASHBOARD: {
    VIEW: 'dashboard.view',
    MANAGE: 'dashboard.*'
  },

  // ==================== SYSTEM ====================
  SYSTEM: {
    SETTINGS: 'system.settings',
    AUDIT_LOGS: 'system.audit-logs',
    MANAGE: 'system.*'
  },
  
  // ==================== WILDCARDS ====================
  WILDCARDS: {
    SUPER_ADMIN: '*',
    ALL_VIEW: '*.view',
    ALL_CREATE: '*.create',
    ALL_UPDATE: '*.edit',
    ALL_DELETE: '*.delete'
  }
};

// Flatten permissions for easy iteration
const flattenPermissions = (obj, prefix = '') => {
  let result = [];
  for (const key in obj) {
    const value = obj[key];
    if (typeof value === 'string') {
      result.push(value);
    } else if (typeof value === 'object') {
      result = result.concat(flattenPermissions(value, `${prefix}${key}.`));
    }
  }
  return result;
};

const ALL_PERMISSIONS = flattenPermissions(PERMISSIONS);

module.exports = {
  PERMISSIONS,
  ALL_PERMISSIONS
};
