// ============================================================================
// SCHEME ROUTES
// ============================================================================
// Purpose: CRUD operations for scheme master data
// Base path: /api/masters/schemes
// ============================================================================

const express = require('express');
const router = express.Router();
const { authenticate, requirePermission } = require('../../middleware/auth');
const { schemeService } = require('../../services/masters');
const ApiResponse = require('../../utils/ApiResponse');
const { ApiError } = require('../../middleware/errorHandler');
const { validateBody, validateBodyAndParams } = require('../../middleware/validate');
const schemeSchemas = require('../../validators/masters/schemeSchemas');

router.get('/', async (req, res, next) => {
  try {
    const result = await schemeService.getAllSchemes(req.query);
    return ApiResponse.success(res, result, 'Schemes retrieved successfully');
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const scheme = await schemeService.getSchemeById(req.params.id, req.query.lang);
    if (!scheme) throw ApiError.notFound('Scheme not found');
    return ApiResponse.success(res, scheme, 'Scheme retrieved successfully');
  } catch (error) {
    next(error);
  }
});

router.post('/', authenticate, requirePermission('masters.schemes.create'), validateBody(schemeSchemas.createScheme),
  async (req, res, next) => {
    try {
      const scheme = await schemeService.createScheme(req.body, req.user.admin_id);
      return ApiResponse.created(res, scheme, 'Scheme created successfully');
    } catch (error) {
      next(error);
    }
  }
);

router.put('/:id', authenticate, requirePermission('masters.schemes.edit'), validateBodyAndParams(schemeSchemas.updateScheme, schemeSchemas.schemeIdParam),
  async (req, res, next) => {
    try {
      const scheme = await schemeService.updateScheme(req.params.id, req.body, req.user.admin_id);
      if (!scheme) throw ApiError.notFound('Scheme not found');
      return ApiResponse.success(res, scheme, 'Scheme updated successfully');
    } catch (error) {
      next(error);
    }
  }
);

router.delete('/:id', authenticate, requirePermission('masters.schemes.delete'),
  async (req, res, next) => {
    try {
      const deleted = await schemeService.deleteScheme(req.params.id, req.user.admin_id);
      if (!deleted) throw ApiError.notFound('Scheme not found');
      return ApiResponse.deleted(res, 'Scheme deleted successfully');
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
