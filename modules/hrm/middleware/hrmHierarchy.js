const { ApiError } = require('../../../middleware/errorHandler');
const logger = require('../../../config/logger');
const { Op } = require('sequelize');
const { resolveAdminHRMScope, getAdminRoleCode } = require('../utils/adminScopeResolver');

/**
 * Middleware to filter HRM data based on admin hierarchy
 * State Level → sees all
 * District Level → sees only their district
 * Scheme Level → sees only their Scheme
 * Post Level → sees only their specific post
 */
const applyHRMHierarchyFilter = async (req, res, next) => {
  if (!req.user) {
    return next(new ApiError(401, 'Authentication required'));
  }

  const userRole = getAdminRoleCode(req.user);
  req.hrmScope = await resolveAdminHRMScope(req.user);
  logger.info('HRM Scope resolved', {
    admin_id: req.user.admin_id,
    role: userRole,
    hrmScope: req.hrmScope
  });
  return next();
};

/**
 * Build WHERE clause for employee queries based on admin scope
 */
const buildEmployeeWhereClause = (baseWhere, hrmScope) => {
  if (!hrmScope || ['STATE', 'ALL'].includes(hrmScope.level)) {
    return baseWhere;
  }

  // Build the WHERE clause properly for Sequelize
  const where = { ...baseWhere };

  if (hrmScope.filters.block_all) {
    where.employee_id = { [Op.in]: [] };
    return where;
  }
  
  if (hrmScope.filters.district_id) {
    where.district_id = hrmScope.filters.district_id;
  }
  
  if (hrmScope.filters.scheme_id) {
    where.scheme_id = hrmScope.filters.scheme_id;
  }

  if (Array.isArray(hrmScope.filters.scheme_ids) && hrmScope.filters.scheme_ids.length > 0) {
    where.scheme_id = { [Op.in]: hrmScope.filters.scheme_ids };
  }

  return where;
};

/**
 * Check if admin can access specific employee record
 */
const canAccessEmployee = (employee, hrmScope) => {
  if (!hrmScope || ['STATE', 'ALL'].includes(hrmScope.level)) {
    return true;
  }

  const filters = hrmScope.filters;

  if (filters.block_all) {
    return false;
  }

  if (filters.district_id && employee.district_id !== filters.district_id) {
    return false;
  }

  if (filters.scheme_id && employee.scheme_id !== filters.scheme_id) {
    return false;
  }

  if (Array.isArray(filters.scheme_ids) && filters.scheme_ids.length > 0 && !filters.scheme_ids.includes(employee.scheme_id)) {
    return false;
  }

  return true;
};

module.exports = {
  applyHRMHierarchyFilter,
  buildEmployeeWhereClause,
  canAccessEmployee
};
