const auditLog = (action) => (req, res, next) => {
  // In a real application, this would write to a database or a log file.
  console.log(`[AUDIT] User ${req.user?.id || 'anonymous'} performed action: ${action}`);
  next();
};

module.exports = { auditLog };
