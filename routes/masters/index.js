// ============================================================================
// MASTER DATA ROUTES INDEX
// ============================================================================
// Purpose: Aggregates all master data routes into a single router
// Mounts: /api/masters/*
// 
// Sub-routes:
// - /districts - District CRUD
// - /talukas - Taluka CRUD
// - /components - Component CRUD
// - /hubs - Hub CRUD
// - /posts - Post/Job CRUD
// - /document-types - Document type CRUD
// - /education-levels - Education level CRUD
// - /categories - Category CRUD
// - /experience-domains - Experience domain CRUD
// ============================================================================

const express = require('express');
const router = express.Router();

// Import sub-routers
const districtRoutes = require('./districts');
const talukaRoutes = require('./talukas');
const componentRoutes = require('./components');
const hubRoutes = require('./hubs');
const departmentRoutes = require('./departments');
const postRoutes = require('./posts');
const documentTypeRoutes = require('./documentTypes');
const educationLevelRoutes = require('./educationLevels');
const categoryRoutes = require('./categories');
const experienceDomainRoutes = require('./experienceDomains');
const applicationStatusRoutes = require('./applicationStatuses');
const skillRoutes = require('./skills');
const bannerRoutes = require('./banners');

// Mount sub-routers
router.use('/districts', districtRoutes);
router.use('/talukas', talukaRoutes);
router.use('/components', componentRoutes);
router.use('/hubs', hubRoutes);
router.use('/departments', departmentRoutes);
router.use('/posts', postRoutes);
router.use('/document-types', documentTypeRoutes);
router.use('/application-statuses', applicationStatusRoutes);
router.use('/education-levels', educationLevelRoutes);
router.use('/categories', categoryRoutes);
router.use('/experience-domains', experienceDomainRoutes);
router.use('/skills', skillRoutes);
router.use('/banners', bannerRoutes);

module.exports = router;
