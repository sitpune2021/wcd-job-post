/**
 * HRM Admin Routes Index
 * Mounts all admin-only HRM routes
 */

const express = require('express');
const router = express.Router();

// Phase 1 routes
const employeeRoutes = require('./employeeRoutes');
const onboardingRoutes = require('./onboardingRoutes');

// Phase 2 routes
const attendanceRoutes = require('./attendanceRoutes');
const bulkAttendanceRoutes = require('./bulkAttendanceRoutes');
const leaveRoutes = require('./leaveRoutes');
const reportRoutes = require('./reportRoutes');
const performanceRoutes = require('./performanceRoutes');
const dashboardRoutes = require('./dashboardRoutes');
const simplePayrollRoutes = require('./simplePayrollRoutes');
const holidayRoutes = require('./holidayRoutes');
const payrollViewRoutes = require('./payrollViewRoutes');
// const leaveDaysRoutes = require('./leaveDaysRoutes');

// Mount routes
router.use('/employees', employeeRoutes);
router.use('/onboarding', onboardingRoutes);
router.use('/attendance', attendanceRoutes);
router.use('/attendance', bulkAttendanceRoutes);
router.use('/leave', leaveRoutes);
router.use('/reports', reportRoutes);
router.use('/performance', performanceRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/simple-payroll', simplePayrollRoutes);
router.use('/holidays', holidayRoutes);
router.use('/payroll-view', payrollViewRoutes);
// router.use('/leave-days', leaveDaysRoutes);

module.exports = router;
