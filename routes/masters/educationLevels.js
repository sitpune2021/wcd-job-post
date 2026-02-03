// ============================================================================
// EDUCATION LEVEL ROUTES
// ============================================================================
// Purpose: CRUD operations for education level master data
// Base path: /api/masters/education-levels
// ============================================================================

const express = require('express');
const router = express.Router();
const { authenticate, requirePermission } = require('../../middleware/auth');
const { educationLevelService } = require('../../services/masters');
const ApiResponse = require('../../utils/ApiResponse');
const { ApiError } = require('../../middleware/errorHandler');

router.get('/', async (req, res, next) => {
  try {
    const result = await educationLevelService.getEducationLevels(req.query);
    return ApiResponse.success(res, result, 'Education levels retrieved successfully');
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const level = await educationLevelService.getEducationLevelById(req.params.id, req.query.lang);
    if (!level) throw ApiError.notFound('Education level not found');
    return ApiResponse.success(res, level, 'Education level retrieved successfully');
  } catch (error) {
    next(error);
  }
});

router.post('/', authenticate, requirePermission('masters.education_levels.create'),
  async (req, res, next) => {
    try {
      const level = await educationLevelService.createEducationLevel(req.body, req.user.admin_id);
      return ApiResponse.created(res, level, 'Education level created successfully');
    } catch (error) {
      next(error);
    }
  }
);

router.put('/:id', authenticate, requirePermission('masters.education_levels.edit'),
  async (req, res, next) => {
    try {
      const level = await educationLevelService.updateEducationLevel(req.params.id, req.body, req.user.admin_id);
      if (!level) throw ApiError.notFound('Education level not found');
      return ApiResponse.success(res, level, 'Education level updated successfully');
    } catch (error) {
      next(error);
    }
  }
);

router.delete('/:id', authenticate, requirePermission('masters.education_levels.delete'),
  async (req, res, next) => {
    try {
      const deleted = await educationLevelService.deleteEducationLevel(req.params.id, req.user.admin_id);
      if (!deleted) throw ApiError.notFound('Education level not found');
      return ApiResponse.deleted(res, 'Education level deleted successfully');
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
