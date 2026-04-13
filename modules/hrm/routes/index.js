/**
 * HRM Routes Index
 * Mounts all HRM module routes with proper organization
 */

const express = require('express');
const router = express.Router();

// Import route modules
const adminRoutes = require('./admin');
const applicantRoutes = require('./applicant');

// Apply HRM feature flag check to all routes
const { checkHRMEnabled } = require('../middleware/hrmFeatureFlag');
router.use(checkHRMEnabled);

// Mount route modules
router.use('/admin', adminRoutes);    // Admin-only routes
router.use('/applicant', applicantRoutes); // Employee/applicant routes (desktop)

module.exports = router;
