const { ApiError } = require('../../../middleware/errorHandler');
const logger = require('../../../config/logger');
const db = require('../../../models');
const Scheme = require('../../../models/Scheme');

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

  // Scheme-only approach: Check for scheme-based admin
  if (req.user.scheme_id) {
    try {
      logger.info('Checking scheme-based admin', {
        admin_id: req.user.admin_id,
        scheme_id: req.user.scheme_id,
        district_id: req.user.district_id
      });

      const adminUser = await db.AdminUser.findByPk(req.user.admin_id, {
        include: [
          {
            model: Scheme,
            as: 'scheme',
            include: [
              {
                model: db.SchemeType,
                as: 'schemeType',
                attributes: ['scheme_type_id', 'scheme_code', 'scheme_name'],
                required: false // Make this optional to avoid errors
              }
            ],
            required: false // Make this optional to avoid errors
          }
        ]
      });

      logger.info('Admin user query result', {
        admin_id: req.user.admin_id,
        adminUserFound: !!adminUser,
        schemeFound: !!(adminUser && adminUser.scheme),
        schemeTypeFound: !!(adminUser && adminUser.scheme && adminUser.scheme.schemeType)
      });

      if (adminUser && adminUser.scheme && adminUser.scheme.schemeType) {
        const schemeType = adminUser.scheme.schemeType.scheme_code;
        
        logger.info('Scheme type found', {
          admin_id: req.user.admin_id,
          scheme_type: schemeType
        });
        
        if (schemeType === 'HUB' || schemeType === 'OSC') {
          logger.info('Scheme-based Admin detected', {
            admin_id: req.user.admin_id,
            scheme_id: req.user.scheme_id,
            scheme_code: adminUser.scheme.scheme_code,
            scheme_type: schemeType,
            district_id: req.user.district_id
          });
          
          req.hrmScope = { 
            level: 'SCHEME',
            filters: { 
              district_id: req.user.district_id,
              scheme_id: req.user.scheme_id
            }
          };
          logger.info('HRM Scope set to SCHEME', { 
            admin_id: req.user.admin_id,
            hrmScope: req.hrmScope 
          });
          return next();
        }
      } else {
        logger.info('No valid scheme found for admin, falling back to district level', {
          admin_id: req.user.admin_id,
          scheme_id: req.user.scheme_id
        });
      }
    } catch (error) {
      logger.error('Error checking scheme-based admin', {
        admin_id: req.user.admin_id,
        scheme_id: req.user.scheme_id,
        error: error.message,
        stack: error.stack
      });
      // Don't return error, fall back to district level
    }
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

  // If no hierarchy info (no district/scheme), show all employees
  logger.info('Admin user has no hierarchy assignment - showing all employees', {
    admin_id: req.user.admin_id,
    role: userRole,
    district_id: req.user.district_id,
    scheme_id: req.user.scheme_id
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
  
  if (hrmScope.filters.scheme_id) {
    where.scheme_id = hrmScope.filters.scheme_id;
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

  if (filters.scheme_id && employee.scheme_id !== filters.scheme_id) {
    return false;
  }

  return true;
};

module.exports = {
  applyHRMHierarchyFilter,
  buildEmployeeWhereClause,
  canAccessEmployee
};
