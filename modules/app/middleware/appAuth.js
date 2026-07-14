const { authenticate } = require('../../../middleware/auth');
const { ApiError } = require('../../../middleware/errorHandler');

const getUserRole = (user) => (
  user?.dataValues?.role
  || user?.dataValues?.role_code
  || user?.role
);

const requireAppEmployee = [
  authenticate,
  (req, res, next) => {
    const role = getUserRole(req.user);
    if (role !== 'EMPLOYEE') {
      return next(new ApiError(403, 'Employee app access is required'));
    }

    if (!req.user.is_active || req.user.is_deleted) {
      return next(new ApiError(403, 'Employee account is not active'));
    }

    return next();
  }
];

module.exports = {
  requireAppEmployee
};
