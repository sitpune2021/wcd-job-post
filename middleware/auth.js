const passport = require('passport');
const { Strategy: JwtStrategy, ExtractJwt } = require('passport-jwt');
const { ApiError } = require('./errorHandler');
const db = require('../models');
const logger = require('../config/logger');
const { hasPermission, hasAnyPermission } = require('../utils/permissionRegistry');
const auditContext = require('../utils/auditContext');

// Initialize passport with JWT strategy
const initializePassport = () => {
  const options = {
    jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
    secretOrKey: process.env.JWT_SECRET
  };

  passport.use(
    new JwtStrategy(options, async (jwtPayload, done) => {
      try {
        let user;
        
        // Check if user is applicant or admin
        if (jwtPayload.role === 'APPLICANT') {
          user = await db.ApplicantMaster.findOne({ 
            where: { 
              applicant_id: jwtPayload.id,
              is_deleted: false
            }
          });
          
          if (user) {
            // Mark this principal as an applicant for downstream checks
            user.dataValues.role = 'APPLICANT';
            user.dataValues.permissions = [];
            // Also expose role directly for routes that read req.user.role
            user.role = 'APPLICANT';
          }
        } else {
          user = await db.AdminUser.findOne({ 
            where: { 
              admin_id: jwtPayload.id,
              is_deleted: false,
              is_active: true
            },
            include: [{
              model: db.Role,
              as: 'role',
              include: [{
                model: db.Permission,
                as: 'permissions',
                through: { attributes: [] }
              }]
            }]
          });
          
          if (user) {
            // Add role code and permissions to user object
            user.dataValues.role_code = user.role?.role_code || jwtPayload.role;

            const dbPermissions = user.role?.permissions?.map(p => p.permission_code) || [];
            const tokenPermissions = Array.isArray(jwtPayload.permissions) ? jwtPayload.permissions : [];
            // Merge and dedupe permissions from DB and token
            user.dataValues.permissions = Array.from(new Set([...dbPermissions, ...tokenPermissions]));
          }
        }

        if (!user) {
          return done(null, false);
        }

        return done(null, user);
      } catch (error) {
        logger.error('Error in JWT strategy:', error);
        return done(error, false);
      }
    })
  );
};

// Middleware to authenticate JWT and set audit context
// This wraps the request in audit context so all DB operations track the user
const authenticate = (req, res, next) => {
  passport.authenticate('jwt', { session: false }, (err, user, info) => {
    if (err) {
      return next(err);
    }
    if (!user) {
      return next(new ApiError(401, 'Authentication required'));
    }
    
    req.user = user;
    
    // Determine user ID and type for audit context
    let userId = null;
    let userType = null;
    
    if (user.applicant_id) {
      userId = user.applicant_id;
      userType = 'applicant';
    } else if (user.admin_id) {
      userId = user.admin_id;
      userType = 'admin';
    }
    
    // Wrap the rest of the request in audit context
    // This enables automatic population of created_by, updated_by, deleted_by
    auditContext.run({ userId, userType }, () => {
      next();
    });
  })(req, res, next);
};

// Alias for backward compatibility
const authenticateJWT = authenticate;

// Middleware to check user role
const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(new ApiError(401, 'Authentication required'));
    }

    const userRole = req.user.dataValues?.role_code || req.user.dataValues?.role || req.user.role;
    
    // Check if user has required role
    const allowedRoles = Array.isArray(roles) ? roles : [roles];
    if (!allowedRoles.includes(userRole)) {
      return next(new ApiError(403, 'Insufficient permissions'));
    }

    // Special handling for district-specific roles
    const districtRoles = ['DISTRICT_ADMIN', 'VERIFICATION_OFFICER', 'MERIT_OFFICER'];
    if (districtRoles.includes(userRole) && req.user.district_id) {
      // For district-specific endpoints that include district_id parameter
      if (req.params.district_id && parseInt(req.params.district_id) !== req.user.district_id) {
        return next(new ApiError(403, 'Access restricted to your assigned district only'));
      }
      
      // For district-specific endpoints that include district_id in query
      if (req.query.district_id && parseInt(req.query.district_id) !== req.user.district_id) {
        return next(new ApiError(403, 'Access restricted to your assigned district only'));
      }
    }

    // User has required role and passes district check
    next();
  };
};

// Middleware to check user permission
// Supports:
//   - Single permission: requirePermission('users.view')
//   - Multiple permissions (OR): requirePermission(['users.view', 'users.edit'])
//   - Wildcard matching: user with 'users.*' can access 'users.view'
//   - Full wildcard: user with '*' can access everything
const requirePermission = (permissions) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(new ApiError(401, 'Authentication required'));
    }

    const userPermissions = req.user.dataValues?.permissions || [];
    const userRole = req.user.dataValues?.role_code || req.user.dataValues?.role || req.user.role;

    // SUPER_ADMIN bypasses granular permission checks (has implicit '*' permission)
    if (userRole === 'SUPER_ADMIN') {
      return next();
    }

    // Check if user has wildcard all permission
    if (userPermissions.includes('*')) {
      return next();
    }

    const requiredPermissions = Array.isArray(permissions) ? permissions : [permissions];
    
    // Check if user has at least one of the required permissions (with wildcard support)
    const hasRequiredPermission = hasAnyPermission(userPermissions, requiredPermissions);
    
    if (!hasRequiredPermission) {
      logger.warn(`Permission denied for user ${req.user.admin_id || req.user.applicant_id}: required ${requiredPermissions.join(' OR ')}, has ${userPermissions.join(', ')}`);
      return next(new ApiError(403, 'You do not have permission to perform this action'));
    }

    // Special handling for district-specific users
    const districtRoles = ['DISTRICT_ADMIN', 'VERIFICATION_OFFICER', 'MERIT_OFFICER'];
    const userRoleForDistrict = req.user.dataValues?.role_code || req.user.role;
    if (districtRoles.includes(userRoleForDistrict) && req.user.district_id) {
      // For district-specific endpoints that include district_id parameter
      if (req.params.district_id && parseInt(req.params.district_id) !== req.user.district_id) {
        return next(new ApiError(403, 'Access restricted to your assigned district only'));
      }
      
      // For district-specific endpoints that include district_id in query
      if (req.query.district_id && parseInt(req.query.district_id) !== req.user.district_id) {
        return next(new ApiError(403, 'Access restricted to your assigned district only'));
      }
    }

    next();
  };
};

// Middleware to check ALL required permissions (AND logic)
const requireAllPermissions = (permissions) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(new ApiError(401, 'Authentication required'));
    }

    const userPermissions = req.user.dataValues?.permissions || [];
    const userRole = req.user.dataValues?.role_code || req.user.dataValues?.role || req.user.role;

    // SUPER_ADMIN bypasses granular permission checks
    if (userRole === 'SUPER_ADMIN' || userPermissions.includes('*')) {
      return next();
    }

    const requiredPermissions = Array.isArray(permissions) ? permissions : [permissions];
    
    // Check if user has ALL required permissions
    const missingPermissions = requiredPermissions.filter(p => !hasPermission(userPermissions, p));
    
    if (missingPermissions.length > 0) {
      logger.warn(`Permission denied for user ${req.user.admin_id}: missing ${missingPermissions.join(', ')}`);
      return next(new ApiError(403, `Missing permissions: ${missingPermissions.join(', ')}`));
    }

    next();
  };
};

// Middleware to log user actions
const auditLog = (action) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return next();
      }
      
      // Determine user type
      const userRole = req.user.dataValues?.role || req.user.role;
      const userType = userRole === 'APPLICANT' ? 'APPLICANT' : 'ADMIN';
      const userId = userType === 'APPLICANT' ? req.user.applicant_id : req.user.admin_id;
      
      // Create audit log entry
      await db.AuditLog.create({
        user_type: userType,
        user_id: userId,
        action: action,
        details: {
          path: req.path,
          method: req.method,
          query: req.query,
          params: req.params,
          body: req.method !== 'GET' ? req.body : undefined
        },
        ip_address: req.ip
      });
      
      next();
    } catch (error) {
      logger.error('Error creating audit log:', error);
      next(); // Continue even if audit log fails
    }
  };
};

module.exports = {
  initializePassport,
  authenticate,
  authenticateJWT,
  requireRole,
  requirePermission,
  requireAllPermissions,
  auditLog
};
