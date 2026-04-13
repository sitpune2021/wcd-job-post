/**
 * HRM Services Index
 * Central export point for all HRM services
 */

// Phase 1 services
const employeeService = require('./employeeService');
const employeeOnboardingService = require('./employeeOnboardingService');
const attendanceService = require('./attendanceService');
const leaveService = require('./leaveService');
const monthlyReportService = require('./monthlyReportService');
const fieldVisitService = require('./fieldVisitService');
const performanceService = require('./performanceService');
const hrmDashboardService = require('./hrmDashboardService');
const payrollService = require('./payrollService');

module.exports = {
  employeeService,
  employeeOnboardingService,
  attendanceService,
  leaveService,
  monthlyReportService,
  fieldVisitService,
  performanceService,
  hrmDashboardService,
  payrollService
};
