const express = require('express');
const router = express.Router();

// Import route modules
const healthRoutes = require('./health');
const authRoutes = require('./auth');
const authApplicantRoutes = require('./authApplicant');
const applicantRoutes = require('./applicant');
const adminRoutes = require('./admin/index.js');
const mastersRoutes = require('./masters/index');
const rbacRoutes = require('./rbac');
const postsRoutes = require('./posts');
const applicationsRoutes = require('./applications');
const publicMastersRoutes = require('./publicMasters');
const applicationReviewRoutes = require('./admin/applicationReview');
const adminReportsRoutes = require('./admin/reports');

// HRM Module Routes (conditionally loaded)
const hrmRoutes = require('../modules/hrm/routes');

// Mount routes
router.use('/health', healthRoutes); // Health check and metrics (no auth)
router.use('/auth', authRoutes); // Admin auth
router.use('/auth/applicant', authApplicantRoutes); // Applicant auth (email-based)
router.use('/applicant', applicantRoutes); // Applicant profile & applications
router.use('/admin/review', applicationReviewRoutes); // Application review & merit (admin)
router.use('/admin/reports', adminReportsRoutes); // Reports (admin)
router.use('/admin', adminRoutes); // Admin operations
router.use('/admin', rbacRoutes); // RBAC (users, roles, permissions)
router.use('/masters', mastersRoutes); // Master data (admin)
router.use('/posts', postsRoutes); // Job posts (admin)
router.use('/applications', applicationsRoutes); // Applications (admin)
router.use('/public', publicMastersRoutes); // Public master data (no auth required)

// HRM Module (modular and toggleable)
router.use('/hrm', hrmRoutes); // HRM employee management (admin & employee)

module.exports = router;
