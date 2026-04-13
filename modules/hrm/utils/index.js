/**
 * HRM Utils Index
 * Central export point for all HRM utilities
 */

// Excel utilities
const excelUtils = require('./excelUtils');

// Employee code generator
const employeeCodeGenerator = require('./employeeCodeGenerator');

// HRM hierarchy middleware
const hrmHierarchy = require('../middleware/hrmHierarchy');

// HRM feature flag middleware
const hrmFeatureFlag = require('../middleware/hrmFeatureFlag');

module.exports = {
  excelUtils,
  employeeCodeGenerator,
  hrmHierarchy,
  hrmFeatureFlag
};
