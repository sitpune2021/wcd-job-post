const { requirePermission } = require('../../../middleware/auth');

const isHRMAdminPermissionCheckEnabled = () => {
  return process.env.HRM_ADMIN_PERMISSION_CHECK_ENABLED !== 'false';
};

const requireHRMAdminPermission = (permissions) => {
  const permissionMiddleware = requirePermission(permissions);

  return (req, res, next) => {
    if (!isHRMAdminPermissionCheckEnabled()) {
      return next();
    }

    return permissionMiddleware(req, res, next);
  };
};

module.exports = {
  isHRMAdminPermissionCheckEnabled,
  requireHRMAdminPermission
};
