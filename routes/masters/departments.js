// ============================================================================
// DEPARTMENT ROUTES
// ============================================================================
// Purpose: CRUD operations for department master data
// Base path: /api/masters/departments
// ============================================================================

const express = require('express');
const router = express.Router();
const { authenticate, requirePermission } = require('../../middleware/auth');
const { departmentService } = require('../../services/masters');
const ApiResponse = require('../../utils/ApiResponse');
const { ApiError } = require('../../middleware/errorHandler');

router.get('/', async (req, res, next) => {
  try {
    const result = await departmentService.getDepartments(req.query);
    return ApiResponse.success(res, result, 'Departments retrieved successfully');
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const department = await departmentService.getDepartmentById(req.params.id, req.query.lang);
    if (!department) throw ApiError.notFound('Department not found');
    return ApiResponse.success(res, department, 'Department retrieved successfully');
  } catch (error) {
    next(error);
  }
});

router.post('/', authenticate, requirePermission('masters.departments.create'),
  async (req, res, next) => {
    try {
      const department = await departmentService.createDepartment(req.body, req.user.admin_id);
      return ApiResponse.created(res, department, 'Department created successfully');
    } catch (error) {
      next(error);
    }
  }
);

router.put('/:id', authenticate, requirePermission('masters.departments.edit'),
  async (req, res, next) => {
    try {
      const department = await departmentService.updateDepartment(req.params.id, req.body, req.user.admin_id);
      if (!department) throw ApiError.notFound('Department not found');
      return ApiResponse.success(res, department, 'Department updated successfully');
    } catch (error) {
      next(error);
    }
  }
);

router.delete('/:id', authenticate, requirePermission('masters.departments.delete'),
  async (req, res, next) => {
    try {
      const deleted = await departmentService.deleteDepartment(req.params.id, req.user.admin_id);
      if (!deleted) throw ApiError.notFound('Department not found');
      return ApiResponse.deleted(res, 'Department deleted successfully');
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
