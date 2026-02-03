// ============================================================================
// TALUKA ROUTES
// ============================================================================
// Purpose: CRUD operations for taluka master data
// Base path: /api/masters/talukas
// ============================================================================

const express = require('express');
const router = express.Router();
const { authenticate, requirePermission } = require('../../middleware/auth');
const { talukaService } = require('../../services/masters');
const ApiResponse = require('../../utils/ApiResponse');
const { ApiError } = require('../../middleware/errorHandler');

// GET /api/masters/talukas - Get all talukas (optionally filtered by district)
router.get('/', async (req, res, next) => {
  try {
    const result = await talukaService.getTalukas(req.query);
    return ApiResponse.success(res, result, 'Talukas retrieved successfully');
  } catch (error) {
    next(error);
  }
});

// GET /api/masters/talukas/:id - Get taluka by ID
router.get('/:id', async (req, res, next) => {
  try {
    const taluka = await talukaService.getTalukaById(req.params.id, req.query.lang);
    if (!taluka) throw ApiError.notFound('Taluka not found');
    return ApiResponse.success(res, taluka, 'Taluka retrieved successfully');
  } catch (error) {
    next(error);
  }
});

// POST /api/masters/talukas - Create new taluka
router.post('/', authenticate, requirePermission('masters.talukas.create'),
  async (req, res, next) => {
    try {
      const taluka = await talukaService.createTaluka(req.body, req.user.admin_id);
      return ApiResponse.created(res, taluka, 'Taluka created successfully');
    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/masters/talukas/:id - Update taluka
router.put('/:id', authenticate, requirePermission('masters.talukas.edit'),
  async (req, res, next) => {
    try {
      const taluka = await talukaService.updateTaluka(req.params.id, req.body, req.user.admin_id);
      if (!taluka) throw ApiError.notFound('Taluka not found');
      return ApiResponse.success(res, taluka, 'Taluka updated successfully');
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/masters/talukas/:id - Delete taluka
router.delete('/:id', authenticate, requirePermission('masters.talukas.delete'),
  async (req, res, next) => {
    try {
      const deleted = await talukaService.deleteTaluka(req.params.id, req.user.admin_id);
      if (!deleted) throw ApiError.notFound('Taluka not found');
      return ApiResponse.deleted(res, 'Taluka deleted successfully');
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
