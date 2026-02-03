const { getPermissionsByUserId } = require('../services/rbac/permissionService');
const { getUserById } = require('../services/rbac/userService');

const checkPermission = (permission) => {
  return async (req, res, next) => {
    try {
      const userId = req.user?.id;
      
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized: No user ID found' });
      }

      const user = await getUserById(userId);
      if (!user) {
        return res.status(401).json({ error: 'Unauthorized: User not found' });
      }

      const permissions = await getPermissionsByUserId(userId);
      const hasPermission = permissions.some(p => p.name === permission);

      if (!hasPermission) {
        return res.status(403).json({ 
          error: 'Forbidden: Insufficient permissions',
          required: permission
        });
      }

      next();
    } catch (error) {
      console.error('Permission check error:', error);
      res.status(500).json({ error: 'Internal server error during permission check' });
    }
  };
};

module.exports = { checkPermission };
