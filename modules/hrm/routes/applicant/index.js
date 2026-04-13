/**
 * HRM Applicant/Employee Routes Index
 * Mounts all employee-facing HRM routes
 */

const express = require('express');
const router = express.Router();

// Phase 1 routes
const profileRoutes = require('./profileRoutes');
const dashboardRoutes = require('./dashboardRoutes');

// Phase 2 routes
const attendanceRoutes = require('./attendanceRoutes');
const leaveRoutes = require('./leaveRoutes');
const reportRoutes = require('./reportRoutes');
const performanceRoutes = require('./performanceRoutes');
const calendarRoutes = require('./calendarRoutes');
const payrollViewRoutes = require('./payrollViewRoutes');

// Mount routes
router.use('/profile', profileRoutes);
router.use('/attendance', attendanceRoutes);
router.use('/leave', leaveRoutes);
router.use('/reports', reportRoutes);
router.use('/performance', performanceRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/calendar', calendarRoutes);
router.use('/payroll-view', payrollViewRoutes);

module.exports = router;
