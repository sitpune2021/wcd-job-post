// ============================================================================
// APPLICATION STATUS ROUTES
// ============================================================================
// Purpose: CRUD operations for application status master data
// Base path: /api/masters/application-statuses
// ============================================================================

const express = require('express');
const router = express.Router();
const { authenticate, requirePermission } = require('../../middleware/auth');
const { applicationStatusService } = require('../../services/masters');
const ApiResponse = require('../../utils/ApiResponse');
const { ApiError } = require('../../middleware/errorHandler');

// GET /api/masters/application-statuses - Get all statuses
router.get('/', async (req, res, next) => {
  try {
    const result = await applicationStatusService.getApplicationStatuses(req.query);
    return ApiResponse.success(res, result, 'Application statuses retrieved successfully');
  } catch (error) {
    next(error);
  }
});

// GET /api/masters/application-statuses/:id - Get status by ID
router.get('/:id', async (req, res, next) => {
  try {
    const status = await applicationStatusService.getApplicationStatusById(req.params.id, req.query.lang);
    if (!status) {
      throw ApiError.notFound('Application status not found');
    }
    return ApiResponse.success(res, status, 'Application status retrieved successfully');
  } catch (error) {
    next(error);
  }
});

// POST /api/masters/application-statuses - Create new status
router.post('/',
  authenticate,
  requirePermission('masters.application_statuses.create'),
  async (req, res, next) => {
    try {
      const status = await applicationStatusService.createApplicationStatus(req.body, req.user.admin_id);
      return ApiResponse.created(res, status, 'Application status created successfully');
    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/masters/application-statuses/:id - Update status
router.put('/:id',
  authenticate,
  requirePermission('masters.application_statuses.edit'),
  async (req, res, next) => {
    try {
      const status = await applicationStatusService.updateApplicationStatus(req.params.id, req.body, req.user.admin_id);
      if (!status) {
        throw ApiError.notFound('Application status not found');
      }
      return ApiResponse.success(res, status, 'Application status updated successfully');
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/masters/application-statuses/:id - Delete status (soft delete)
router.delete('/:id',
  authenticate,
  requirePermission('masters.application_statuses.delete'),
  async (req, res, next) => {
    try {
      const deleted = await applicationStatusService.deleteApplicationStatus(req.params.id, req.user.admin_id);
      if (!deleted) {
        throw ApiError.notFound('Application status not found');
      }
      return ApiResponse.deleted(res, 'Application status deleted successfully');
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
