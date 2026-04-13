const { ApiError } = require('../../../middleware/errorHandler');
const logger = require('../../../config/logger');

/**
 * Middleware to filter HRM data based on admin hierarchy
 * State Level → sees all
 * District Level → sees only their district
 * OSC/Hub Level → sees only their OSC/Hub
 * Post Level → sees only their specific post
 */
const applyHRMHierarchyFilter = (req, res, next) => {
  if (!req.user) {
    return next(new ApiError(401, 'Authentication required'));
  }

  const userRole = req.user.dataValues?.role_code || req.user.role;
  
  // SUPER_ADMIN and STATE_ADMIN can see everything
  if (userRole === 'SUPER_ADMIN' || userRole === 'STATE_ADMIN') {
    logger.info('State Admin detected', {
      admin_id: req.user.admin_id,
      role: userRole
    });
    
    req.hrmScope = { level: 'STATE', filters: {} };
    logger.info('HRM Scope set to STATE', { 
      admin_id: req.user.admin_id,
      hrmScope: req.hrmScope 
    });
    return next();
  }

  // District-level admins
  if (userRole === 'DISTRICT_ADMIN' && req.user.district_id) {
    logger.info('District Admin detected', {
      admin_id: req.user.admin_id,
      district_id: req.user.district_id
    });
    
    req.hrmScope = {
      level: 'DISTRICT',
      filters: { district_id: req.user.district_id }
    };
    logger.info('HRM Scope set to DISTRICT', { 
      admin_id: req.user.admin_id,
      hrmScope: req.hrmScope 
    });
    return next();
  }

  // Hub Admin
  if (req.user.hub_id) {
    logger.info('Hub Admin detected', {
      admin_id: req.user.admin_id,
      hub_id: req.user.hub_id,
      district_id: req.user.district_id
    });
    
    req.hrmScope = {
      level: 'HUB',
      filters: { 
        district_id: req.user.district_id,
        hub_id: req.user.hub_id 
      }
    };
    logger.info('HRM Scope set to HUB', { 
      admin_id: req.user.admin_id,
      hrmScope: req.hrmScope 
    });
    return next();
  }

  // OSC Admin
  if (req.user.component_id) {
    logger.info('OSC Admin detected', {
      admin_id: req.user.admin_id,
      component_id: req.user.component_id,
      district_id: req.user.district_id
    });
    
    req.hrmScope = {
      level: 'OSC',
      filters: { 
        district_id: req.user.district_id,
        component_id: req.user.component_id 
      }
    };
    logger.info('HRM Scope set to OSC', { 
      admin_id: req.user.admin_id,
      hrmScope: req.hrmScope 
    });
    return next();
  }

  // Default: district-level if district_id is set
  if (req.user.district_id) {
    logger.info('District Admin detected', {
      admin_id: req.user.admin_id,
      district_id: req.user.district_id
    });
    
    req.hrmScope = {
      level: 'DISTRICT',
      filters: { district_id: req.user.district_id }
    };
    logger.info('HRM Scope set to DISTRICT', { 
      admin_id: req.user.admin_id,
      hrmScope: req.hrmScope 
    });
    return next();
  }

  // If no hierarchy info (no district/OSC/hub), show all employees
  logger.info('Admin user has no hierarchy assignment - showing all employees', {
    admin_id: req.user.admin_id,
    role: userRole,
    district_id: req.user.district_id,
    component_id: req.user.component_id,
    hub_id: req.user.hub_id
  });
  
  req.hrmScope = { level: 'ALL', filters: {} };
  logger.info('HRM Scope set to ALL', { 
    admin_id: req.user.admin_id,
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
  
  if (hrmScope.filters.district_id) {
    where.district_id = hrmScope.filters.district_id;
  }
  
  if (hrmScope.filters.component_id) {
    where.component_id = hrmScope.filters.component_id;
  }
  
  if (hrmScope.filters.hub_id) {
    where.hub_id = hrmScope.filters.hub_id;
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

  if (filters.district_id && employee.district_id !== filters.district_id) {
    return false;
  }

  if (filters.component_id && employee.component_id !== filters.component_id) {
    return false;
  }

  if (filters.hub_id && employee.hub_id !== filters.hub_id) {
    return false;
  }

  return true;
};

module.exports = {
  applyHRMHierarchyFilter,
  buildEmployeeWhereClause,
  canAccessEmployee
};
