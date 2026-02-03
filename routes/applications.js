const express = require('express');
const router = express.Router();
const applicationService = require('../services/applicationService');
const applicantApplicationService = require('../services/applicant/applicationService');
const { authenticate, requirePermission } = require('../middleware/auth');

/**
 * Application Routes
 * Applicant routes for managing their applications
 * Admin routes for reviewing applications
 */

// ==================== APPLICANT ROUTES ====================

// Create application (draft)
router.post('/', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'APPLICANT') {
      return res.status(403).json({ success: false, message: 'Only applicants can create applications' });
    }
    const application = await applicationService.createApplication(req.user.applicant_id || req.user.id, req.body.post_id);
    res.status(201).json({ success: true, data: application, message: 'Application created successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get my applications
router.get('/my-applications', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'APPLICANT') {
      return res.status(403).json({ success: false, message: 'Only applicants can view their applications' });
    }
    const applications = await applicationService.getMyApplications(req.user.applicant_id || req.user.id);
    res.json({ success: true, data: applications });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Applicant: application status list (search/filter/pagination)
// NOTE: This route exists for backward compatibility with older frontend calls.
router.get('/status', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'APPLICANT') {
      return res.status(403).json({ success: false, message: 'Only applicants can view their applications' });
    }

    const result = await applicantApplicationService.getApplicationStatusList(
      req.user.applicant_id || req.user.id,
      req.query
    );

    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ==================== ADMIN ROUTES ====================

// Get all applications with filters
router.get('/admin/all', authenticate, requirePermission(['applications.view']), async (req, res) => {
  try {
    const filters = {
      status: req.query.status,
      post_id: req.query.post_id,
      search: req.query.search,
      from_date: req.query.from_date,
      to_date: req.query.to_date
    };
    const applications = await applicationService.getAllApplications(filters);
    res.json({ success: true, data: applications });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get application statistics
router.get('/admin/stats', authenticate, requirePermission(['applications.view']), async (req, res) => {
  try {
    const filters = {
      post_id: req.query.post_id
    };
    const stats = await applicationService.getApplicationStats(filters);
    res.json({ success: true, data: stats });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Update application status
router.put('/admin/:id/status', authenticate, requirePermission(['applications.update_status']), async (req, res) => {
  try {
    const application = await applicationService.updateApplicationStatus(
      req.params.id,
      req.body.status,
      req.user.admin_id,
      req.body.remarks
    );
    if (!application) {
      return res.status(404).json({ success: false, message: 'Application not found' });
    }
    res.json({ success: true, data: application, message: 'Application status updated successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Bulk status update
router.post('/admin/bulk-status', authenticate, requirePermission(['applications.update_status']), async (req, res) => {
  try {
    const count = await applicationService.bulkUpdateStatus(
      req.body.application_ids,
      req.body.status,
      req.user.admin_id,
      req.body.remarks
    );
    res.json({ success: true, message: `${count} applications updated successfully` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ==================== APPLICANT ROUTES (by id) ====================

// Get application by ID (own application)
router.get('/:id', authenticate, async (req, res) => {
  try {
    const applicantId = req.user.role === 'APPLICANT' ? (req.user.applicant_id || req.user.id) : null;
    const application = await applicationService.getApplicationById(req.params.id, applicantId);
    if (!application) {
      return res.status(404).json({ success: false, message: 'Application not found' });
    }
    res.json({ success: true, data: application });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Submit application
router.post('/:id/submit', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'APPLICANT') {
      return res.status(403).json({ success: false, message: 'Only applicants can submit applications' });
    }
    const application = await applicationService.submitApplication(req.params.id, req.user.applicant_id || req.user.id);
    res.json({ success: true, data: application, message: 'Application submitted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Withdraw application
router.post('/:id/withdraw', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'APPLICANT') {
      return res.status(403).json({ success: false, message: 'Only applicants can withdraw applications' });
    }
    const application = await applicationService.withdrawApplication(req.params.id, req.user.applicant_id || req.user.id);
    res.json({ success: true, data: application, message: 'Application withdrawn successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
