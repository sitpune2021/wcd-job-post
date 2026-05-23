// ============================================================================
// SCHEME TYPE ROUTES
// ============================================================================
// Purpose: CRUD operations for scheme type master data
// Base path: /api/masters/scheme-types
// ============================================================================

const express = require('express');
const router = express.Router();
const { authenticate, requirePermission } = require('../../middleware/auth');
const schemeTypeService = require('../../services/masters/schemeTypeService');
const ApiResponse = require('../../utils/ApiResponse');
const { ApiError } = require('../../middleware/errorHandler');
const { validateBody, validateBodyAndParams } = require('../../middleware/validate');
const schemeTypeSchemas = require('../../validators/masters/schemeTypeSchemas');

// Get all scheme types (with optional pagination and filters)
router.get('/', async (req, res, next) => {
  try {
    const result = await schemeTypeService.getSchemeTypes(req.query);
    return ApiResponse.success(res, result, 'Scheme types retrieved successfully');
  } catch (error) {
    next(error);
  }
});

// Get scheme type by ID
router.get('/:id', async (req, res, next) => {
  try {
    const schemeType = await schemeTypeService.getSchemeTypeById(req.params.id);
    if (!schemeType) throw ApiError.notFound('Scheme type not found');
    return ApiResponse.success(res, schemeType, 'Scheme type retrieved successfully');
  } catch (error) {
    next(error);
  }
});

// Create new scheme type
router.post('/', authenticate, requirePermission('masters.scheme-types.create'),
  validateBody(schemeTypeSchemas.createSchemeType),
  async (req, res, next) => {
    try {
      const schemeType = await schemeTypeService.createSchemeType(req.body, req.user.admin_id);
      return ApiResponse.created(res, schemeType, 'Scheme type created successfully');
    } catch (error) {
      next(error);
    }
  }
);

// Update scheme type
router.put('/:id', authenticate, requirePermission('masters.scheme-types.edit'),
  validateBodyAndParams(schemeTypeSchemas.updateSchemeType, schemeTypeSchemas.schemeTypeIdParam),
  async (req, res, next) => {
    try {
      const schemeType = await schemeTypeService.updateSchemeType(req.params.id, req.body, req.user.admin_id);
      if (!schemeType) throw ApiError.notFound('Scheme type not found');
      return ApiResponse.success(res, schemeType, 'Scheme type updated successfully');
    } catch (error) {
      next(error);
    }
  }
);

// Delete scheme type (soft delete)
router.delete('/:id', authenticate, requirePermission('masters.scheme-types.delete'),
  async (req, res, next) => {
    try {
      const deleted = await schemeTypeService.deleteSchemeType(req.params.id, req.user.admin_id);
      if (!deleted) throw ApiError.notFound('Scheme type not found');
      return ApiResponse.success(res, null, 'Scheme type deleted successfully');
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
