const { ApiError } = require('../../../middleware/errorHandler');
const logger = require('../../../config/logger');

/**
 * Middleware to check if HRM module is enabled
 * Returns 403 with module disabled message if HRM_ENABLED is not true
 */
const checkHRMEnabled = (req, res, next) => {
  const hrmEnabled = process.env.HRM_ENABLED === 'true';
  
  if (!hrmEnabled) {
    logger.warn('HRM module access attempted but module is disabled', {
      path: req.path,
      method: req.method,
      ip: req.ip,
      user: req.user?.admin_id || req.user?.applicant_id
    });
    
    return res.status(403).json({
      success: false,
      moduleEnabled: false,
      message: 'HRM module is currently disabled. Please contact administrator.'
    });
  }
  
  next();
};

/**
 * Check if HRM module is enabled (for use in services/controllers)
 */
const isHRMEnabled = () => {
  return process.env.HRM_ENABLED === 'true';
};

module.exports = {
  checkHRMEnabled,
  isHRMEnabled
};
