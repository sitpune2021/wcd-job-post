/**
 * HRM Employee Management Routes (Admin)
 * Employee CRUD operations, statistics, and management
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../../../../middleware/auth');
const { hrmFeatureFlag, hrmHierarchy } = require('../../middleware');
const { requireHRMAdminPermission } = require('../../middleware/permissionGuard');
const { applyHRMHierarchyFilter } = hrmHierarchy;
const employeeService = require('../../services/employeeService');
const ApiResponse = require('../../../../utils/ApiResponse');
const logger = require('../../../../config/logger');

// Apply authentication and hierarchy filter
router.use(authenticate);
router.use(applyHRMHierarchyFilter);

/**
 * @route GET /api/hrm/admin/employees
 * @desc Get employee list with filters and pagination
 * @access Admin only
 */
router.get('/', requireHRMAdminPermission(['hrm.employees.view', 'hrm.*']), async (req, res, next) => {
  try {
    const filters = {
      district_id: req.query.district_id ? parseInt(req.query.district_id) : undefined,
      component_id: req.query.component_id ? parseInt(req.query.component_id) : undefined,
      hub_id: req.query.hub_id ? parseInt(req.query.hub_id) : undefined,
      post_id: req.query.post_id ? parseInt(req.query.post_id) : undefined,
      onboarding_status: req.query.onboarding_status,
      onboarding_type: req.query.onboarding_type,
      is_active: req.query.is_active !== undefined ? req.query.is_active === 'true' : undefined,
      contract_status: req.query.contract_status,
      search: req.query.search
    };

    const pagination = {
      page: parseInt(req.query.page) || 1,
      limit: parseInt(req.query.limit) || 50,
      sortBy: req.query.sortBy || 'created_at',
      sortOrder: req.query.sortOrder || 'DESC'
    };

    const result = await employeeService.getEmployeeList(filters, req.hrmScope, pagination);
    
    // Return consistent pagination structure
    return ApiResponse.success(res, {
      data: result.employees,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total: result.pagination.total,
        totalPages: result.pagination.totalPages,
        hasNext: pagination.page < result.pagination.totalPages,
        hasPrev: pagination.page > 1
      }
    }, 'Employee list retrieved successfully');
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/hrm/admin/employees/statistics
 * @desc Get employee statistics for dashboard
 * @access Admin only
 */
router.get('/statistics', requireHRMAdminPermission(['hrm.employees.view', 'hrm.*']), async (req, res, next) => {
  try {
    const filters = {
      district_id: req.query.district_id ? parseInt(req.query.district_id) : undefined,
      component_id: req.query.component_id ? parseInt(req.query.component_id) : undefined,
      hub_id: req.query.hub_id ? parseInt(req.query.hub_id) : undefined
    };

    // Apply HRM scope filters
    if (req.hrmScope && req.hrmScope.filters) {
      Object.assign(filters, req.hrmScope.filters);
    }

    const stats = await employeeService.getEmployeeStatistics(filters);
    
    return ApiResponse.success(res, stats, 'Employee statistics retrieved successfully');
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/hrm/admin/employees/:employeeId
 * @desc Get employee details by ID
 * @access Admin only
 */
router.get('/:employeeId', requireHRMAdminPermission(['hrm.employees.view', 'hrm.*']), async (req, res, next) => {
  try {
    const { employeeId } = req.params;
    
    if (!employeeId || isNaN(parseInt(employeeId))) {
      throw ApiError.badRequest('Valid employee ID is required');
    }

    // Use a simpler approach to avoid SQL errors
    const db = require('../../../../models');
    const { EmployeeMaster } = db;
    
    const employee = await EmployeeMaster.findOne({
      where: { 
        employee_id: parseInt(employeeId), 
        is_deleted: false 
      }
    });
    
    if (!employee) {
      throw ApiError.notFound('Employee not found');
    }
    
    
    // Get applicant profile for additional details
    if (employee.applicant_id) {
      try {
        const profileService = require('../../../services/applicant/profileService');
        const applicantProfile = await profileService.getProfile(employee.applicant_id);
        
        // Combine data
        const combinedEmployee = {
          employee_id: employee.employee_id,
          employee_code: employee.employee_code,
          applicant_id: employee.applicant_id,
          employment_status: employee.employment_status,
          onboarding_status: employee.onboarding_status,
          contract_start_date: employee.contract_start_date,
          contract_end_date: employee.contract_end_date,
          created_at: employee.created_at,
          full_name: applicantProfile.personal?.full_name || null,
          email: applicantProfile.email,
          mobile_no: applicantProfile.mobile_no,
          dob: applicantProfile.personal?.dob || null,
          gender: applicantProfile.personal?.gender || null,
          aadhar_no: applicantProfile.personal?.aadhar_no || null,
          profile_image: applicantProfile.profile_img
        };
        
        return ApiResponse.success(res, combinedEmployee, 'Employee details retrieved successfully');
      } catch (profileError) {
        // If profile fails, return basic employee data
        return ApiResponse.success(res, employee, 'Employee details retrieved successfully');
      }
    }
    
    return ApiResponse.success(res, employee, 'Employee details retrieved successfully');
  } catch (error) {
    next(error);
  }
});

module.exports = router;
