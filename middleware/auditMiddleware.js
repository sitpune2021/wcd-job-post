// ============================================================================
// AUDIT MIDDLEWARE
// ============================================================================
// Purpose: Extract user info from JWT token and set audit context
// This enables automatic population of created_by, updated_by, deleted_by
// columns in all Sequelize operations within the request lifecycle
//
// Must be applied AFTER authentication middleware (auth.js)
// ============================================================================

const auditContext = require('../utils/auditContext');

/**
 * Middleware to set audit context from authenticated user
 * Wraps the entire request in an audit context so all DB operations
 * within this request will have access to the current user
 */
const setAuditContext = (req, res, next) => {
  // Determine user info from request
  // req.user is set by passport authentication middleware
  let userId = null;
  let userType = null;
  
  if (req.user) {
    // Check if it's an admin user (has admin_id)
    if (req.user.admin_id) {
      userId = req.user.admin_id;
      userType = 'admin';
    }
    // Check if it's an applicant (has applicant_id)
    else if (req.user.applicant_id) {
      userId = req.user.applicant_id;
      userType = 'applicant';
    }
    // Fallback to generic id field
    else if (req.user.id) {
      userId = req.user.id;
      userType = req.user.role === 'applicant' ? 'applicant' : 'admin';
    }
  }
  
  // Run the rest of the request within audit context
  // All Sequelize operations will have access to getCurrentUser()
  auditContext.run({ userId, userType }, () => {
    next();
  });
};

/**
 * Middleware for routes that don't require authentication
 * but still want audit tracking (e.g., public registration)
 * Sets userType as 'system' for tracking purposes
 */
const setSystemAuditContext = (req, res, next) => {
  auditContext.run({ userId: null, userType: 'system' }, () => {
    next();
  });
};

module.exports = {
  setAuditContext,
  setSystemAuditContext
};
