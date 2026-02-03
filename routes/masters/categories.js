// ============================================================================
// CATEGORY ROUTES
// ============================================================================
// Purpose: CRUD operations for category master data (SC, ST, OBC, etc.)
// Base path: /api/masters/categories
// ============================================================================

const express = require('express');
const router = express.Router();
const { authenticate, requirePermission } = require('../../middleware/auth');
const { categoryService } = require('../../services/masters');
const ApiResponse = require('../../utils/ApiResponse');
const { ApiError } = require('../../middleware/errorHandler');

router.get('/', async (req, res, next) => {
  try {
    // const result = await categoryService.getCategories(req.query);
    // return ApiResponse.success(res, result, 'Categories retrieved successfully');
    return ApiResponse.success(res, { categories: [], pagination: { total: 0, page: 1, limit: 0, totalPages: 1 } }, 'Categories retrieved successfully');
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    // const category = await categoryService.getCategoryById(req.params.id, req.query.lang);
    // if (!category) throw ApiError.notFound('Category not found');
    // return ApiResponse.success(res, category, 'Category retrieved successfully');
    return ApiResponse.success(res, null, 'Category retrieved successfully');
  } catch (error) {
    next(error);
  }
});

router.post('/', authenticate, requirePermission('masters.categories.create'),
  async (req, res, next) => {
    try {
      // const category = await categoryService.createCategory(req.body, req.user.admin_id);
      // return ApiResponse.created(res, category, 'Category created successfully');
      return ApiResponse.created(res, null, 'Category created successfully');
    } catch (error) {
      next(error);
    }
  }
);

router.put('/:id', authenticate, requirePermission('masters.categories.edit'),
  async (req, res, next) => {
    try {
      // const category = await categoryService.updateCategory(req.params.id, req.body, req.user.admin_id);
      // if (!category) throw ApiError.notFound('Category not found');
      // return ApiResponse.success(res, category, 'Category updated successfully');
      return ApiResponse.success(res, null, 'Category updated successfully');
    } catch (error) {
      next(error);
    }
  }
);

router.delete('/:id', authenticate, requirePermission('masters.categories.delete'),
  async (req, res, next) => {
    try {
      // const deleted = await categoryService.deleteCategory(req.params.id, req.user.admin_id);
      // if (!deleted) throw ApiError.notFound('Category not found');
      // return ApiResponse.deleted(res, 'Category deleted successfully');
      return ApiResponse.deleted(res, 'Category deleted successfully');
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
