const express = require('express');
const router = express.Router();

// Import route modules
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

// Mount routes
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

module.exports = router;
