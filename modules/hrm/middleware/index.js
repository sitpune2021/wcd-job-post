/**
 * HRM Middleware Index
 * Central export point for all HRM middleware
 */

const hrmFeatureFlag = require('./hrmFeatureFlag');
const hrmHierarchy = require('./hrmHierarchy');
const permissionGuard = require('./permissionGuard');

module.exports = {
  hrmFeatureFlag,
  hrmHierarchy,
  permissionGuard
};
