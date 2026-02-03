// ============================================================================
// DISTRICT ROUTES
// ============================================================================
// Purpose: CRUD operations for district master data
// Base path: /api/masters/districts
// ============================================================================

const express = require('express');
const router = express.Router();
const { authenticate, requirePermission } = require('../../middleware/auth');
const { districtService } = require('../../services/masters');
const ApiResponse = require('../../utils/ApiResponse');
const { ApiError } = require('../../middleware/errorHandler');

// ==================== PUBLIC ROUTES ====================
// These routes are accessible without authentication (for dropdowns)

// GET /api/masters/districts - Get all districts
router.get('/', async (req, res, next) => {
  try {
    const result = await districtService.getDistricts(req.query);
    return ApiResponse.success(res, result, 'Districts retrieved successfully');
  } catch (error) {
    next(error);
  }
});

// GET /api/masters/districts/:id - Get district by ID
router.get('/:id', async (req, res, next) => {
  try {
    const district = await districtService.getDistrictById(req.params.id, req.query.lang);
    if (!district) {
      throw ApiError.notFound('District not found');
    }
    return ApiResponse.success(res, district, 'District retrieved successfully');
  } catch (error) {
    next(error);
  }
});

// ==================== PROTECTED ROUTES ====================
// These routes require authentication and specific permissions

// POST /api/masters/districts - Create new district
router.post('/', 
  authenticate, 
  requirePermission('masters.districts.create'),
  async (req, res, next) => {
    try {
      const district = await districtService.createDistrict(req.body, req.user.admin_id);
      return ApiResponse.created(res, district, 'District created successfully');
    } catch (error) {
      next(error);
    }
  }
);

// PUT /api/masters/districts/:id - Update district
router.put('/:id', 
  authenticate, 
  requirePermission('masters.districts.edit'),
  async (req, res, next) => {
    try {
      const district = await districtService.updateDistrict(req.params.id, req.body, req.user.admin_id);
      if (!district) {
        throw ApiError.notFound('District not found');
      }
      return ApiResponse.success(res, district, 'District updated successfully');
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /api/masters/districts/:id - Delete district (soft delete)
router.delete('/:id', 
  authenticate, 
  requirePermission('masters.districts.delete'),
  async (req, res, next) => {
    try {
      const deleted = await districtService.deleteDistrict(req.params.id, req.user.admin_id);
      if (!deleted) {
        throw ApiError.notFound('District not found');
      }
      return ApiResponse.deleted(res, 'District deleted successfully');
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
