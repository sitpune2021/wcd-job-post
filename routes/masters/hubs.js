const express = require('express');
const router = express.Router();
const hubService = require('../../services/masters/hubService');
const { authenticate, requirePermission } = require('../../middleware/auth');
const ApiResponse = require('../../utils/ApiResponse');
const { ApiError } = require('../../middleware/errorHandler');

// Get all hubs (with optional pagination and filters)
router.get('/', async (req, res, next) => {
  try {
    const hubs = await hubService.getHubs(req.query);
    return ApiResponse.success(res, hubs, 'Hubs retrieved successfully');
  } catch (error) {
    next(error);
  }
});

// Get hub by ID
router.get('/:id', async (req, res, next) => {
  try {
    const hub = await hubService.getHubById(req.params.id, req.query.lang);
    if (!hub) throw ApiError.notFound('Hub not found');
    return ApiResponse.success(res, hub, 'Hub retrieved successfully');
  } catch (error) {
    next(error);
  }
});

// Create new hub
router.post('/', authenticate, requirePermission(['masters.hubs.create']), async (req, res, next) => {
  try {
    const hub = await hubService.createHub(req.body, req.user.admin_id);
    return ApiResponse.created(res, hub, 'Hub created successfully');
  } catch (error) {
    next(error);
  }
});

// Update hub
router.put('/:id', authenticate, requirePermission(['masters.hubs.edit']), async (req, res, next) => {
  try {
    const hub = await hubService.updateHub(req.params.id, req.body, req.user.admin_id);
    return ApiResponse.success(res, hub, 'Hub updated successfully');
  } catch (error) {
    next(error);
  }
});

// Delete hub (soft delete)
router.delete('/:id', authenticate, requirePermission(['masters.hubs.delete']), async (req, res, next) => {
  try {
    await hubService.deleteHub(req.params.id, req.user.admin_id);
    return ApiResponse.success(res, null, 'Hub deleted successfully');
  } catch (error) {
    next(error);
  }
});

module.exports = router;
