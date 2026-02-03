// ============================================================================
// COMPONENT ROUTES
// ============================================================================
// Purpose: CRUD operations for component master data
// Base path: /api/masters/components
// ============================================================================

const express = require('express');
const router = express.Router();
const { authenticate, requirePermission } = require('../../middleware/auth');
const { componentService } = require('../../services/masters');
const ApiResponse = require('../../utils/ApiResponse');
const { ApiError } = require('../../middleware/errorHandler');

router.get('/', async (req, res, next) => {
  try {
    const result = await componentService.getComponents(req.query);
    return ApiResponse.success(res, result, 'Components retrieved successfully');
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const component = await componentService.getComponentById(req.params.id, req.query.lang);
    if (!component) throw ApiError.notFound('Component not found');
    return ApiResponse.success(res, component, 'Component retrieved successfully');
  } catch (error) {
    next(error);
  }
});

router.post('/', authenticate, requirePermission('masters.components.create'),
  async (req, res, next) => {
    try {
      const component = await componentService.createComponent(req.body, req.user.admin_id);
      return ApiResponse.created(res, component, 'Component created successfully');
    } catch (error) {
      next(error);
    }
  }
);

router.put('/:id', authenticate, requirePermission('masters.components.edit'),
  async (req, res, next) => {
    try {
      const component = await componentService.updateComponent(req.params.id, req.body, req.user.admin_id);
      if (!component) throw ApiError.notFound('Component not found');
      return ApiResponse.success(res, component, 'Component updated successfully');
    } catch (error) {
      next(error);
    }
  }
);

router.delete('/:id', authenticate, requirePermission('masters.components.delete'),
  async (req, res, next) => {
    try {
      const deleted = await componentService.deleteComponent(req.params.id, req.user.admin_id);
      if (!deleted) throw ApiError.notFound('Component not found');
      return ApiResponse.deleted(res, 'Component deleted successfully');
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
