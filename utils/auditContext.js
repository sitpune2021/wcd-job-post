// ============================================================================
// AUDIT CONTEXT UTILITY
// ============================================================================
// Purpose: Manage audit context (current user) for automatic population of
// created_by, updated_by, deleted_by columns in Sequelize models
//
// How it works:
// 1. Middleware extracts user from JWT token and stores in AsyncLocalStorage
// 2. Sequelize hooks read from AsyncLocalStorage to get current user
// 3. No need to manually pass user ID to every create/update operation
//
// Usage in middleware:
//   auditContext.run({ userId: req.user.id, userType: 'admin' }, next)
//
// Usage in models:
//   const { getCurrentUser } = require('../utils/auditContext');
//   beforeCreate: (instance) => { instance.created_by = getCurrentUser()?.userId; }
// ============================================================================

const { AsyncLocalStorage } = require('async_hooks');

// AsyncLocalStorage provides context that persists through async operations
// Each request gets its own isolated context
const auditStorage = new AsyncLocalStorage();

// ==================== CONTEXT MANAGEMENT ====================

/**
 * Run a function with audit context
 * Used by middleware to set the current user for the request lifecycle
 * @param {Object} context - { userId, userType: 'admin'|'applicant' }
 * @param {Function} callback - Function to run with this context
 */
const run = (context, callback) => {
  return auditStorage.run(context, callback);
};

/**
 * Get the current user from audit context
 * Returns null if no context is set (e.g., system operations, migrations)
 * @returns {Object|null} - { userId, userType } or null
 */
const getCurrentUser = () => {
  return auditStorage.getStore() || null;
};

/**
 * Get the current user ID for audit columns
 * @returns {number|null} - User ID or null
 */
const getCurrentUserId = () => {
  const context = getCurrentUser();
  return context?.userId || null;
};

/**
 * Get the current user type
 * @returns {string|null} - 'admin' or 'applicant' or null
 */
const getCurrentUserType = () => {
  const context = getCurrentUser();
  return context?.userType || null;
};

// ==================== SEQUELIZE HOOK HELPERS ====================
// These functions are called from Sequelize model hooks

/**
 * Set created_by field on new records
 * Call this in beforeCreate hook
 * @param {Object} instance - Sequelize model instance
 */
const setCreatedBy = (instance) => {
  const userId = getCurrentUserId();
  if (userId && !instance.created_by) {
    instance.created_by = userId;
  }
};

/**
 * Set updated_by field on modified records
 * Call this in beforeUpdate hook
 * @param {Object} instance - Sequelize model instance
 */
const setUpdatedBy = (instance) => {
  const userId = getCurrentUserId();
  if (userId) {
    instance.updated_by = userId;
  }
};

/**
 * Set deleted_by and deleted_at fields for soft delete
 * Call this in beforeDestroy hook (if using paranoid: true)
 * @param {Object} instance - Sequelize model instance
 */
const setDeletedBy = (instance) => {
  const userId = getCurrentUserId();
  if (userId) {
    instance.deleted_by = userId;
    instance.deleted_at = new Date();
  }
};

/**
 * Apply all audit hooks to a Sequelize model
 * Call this in model definition to add automatic audit tracking
 * @param {Object} model - Sequelize model
 */
const applyAuditHooks = (model) => {
  model.addHook('beforeCreate', 'auditCreate', (instance) => {
    setCreatedBy(instance);
  });
  
  model.addHook('beforeUpdate', 'auditUpdate', (instance) => {
    setUpdatedBy(instance);
  });
  
  model.addHook('beforeDestroy', 'auditDestroy', (instance) => {
    setDeletedBy(instance);
  });
};

module.exports = {
  run,
  getCurrentUser,
  getCurrentUserId,
  getCurrentUserType,
  setCreatedBy,
  setUpdatedBy,
  setDeletedBy,
  applyAuditHooks
};
