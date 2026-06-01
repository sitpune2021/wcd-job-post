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

// Calculation utilities
const attendanceCalculations = require('./attendanceCalculations');
const salaryCalculations = require('./salaryCalculations');
const workingDayHelpers = require('./workingDayHelpers');
const hrmHelpers = require('./hrmHelpers');
const dateTimeHelpers = require('./dateTimeHelpers');
const safeQueryHelpers = require('./safeQueryHelpers');

module.exports = {
  excelUtils,
  employeeCodeGenerator,
  hrmHierarchy,
  hrmFeatureFlag,
  // Calculation utilities
  attendanceCalculations,
  salaryCalculations,
  workingDayHelpers,
  hrmHelpers,
  dateTimeHelpers,
  safeQueryHelpers
};
