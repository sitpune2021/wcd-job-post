/**
 * HRM Employee Management Routes (Admin)
 * Employee CRUD operations, statistics, and management
 */

const express = require('express');
const router = express.Router();
const db = require('../../../../models');
const ApiResponse = require('../../../../utils/ApiResponse');
const { ApiError } = require('../../../../middleware/errorHandler');
const employeeService = require('../../services/employeeService');
const { requireHRMAdminPermission } = require('../../middleware/permissionGuard');
const logger = require('../../../../config/logger');
const { authenticate } = require('../../../../middleware/auth');
const { hrmFeatureFlag, hrmHierarchy } = require('../../middleware');
const { applyHRMHierarchyFilter } = hrmHierarchy;

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
      throw new ApiError(400, 'Valid employee ID is required');
    }

    // Use the employeeService which returns complete data with joined names
    const employee = await employeeService.getEmployeeById(parseInt(employeeId), req.hrmScope);
    
    return ApiResponse.success(res, employee, 'Employee details retrieved successfully');
  } catch (error) {
    next(error);
  }
});

/**
 * @route PUT /api/hrm/admin/employees/:employeeId
 * @desc Update employee details
 * @access Admin only
 */
router.put('/:employeeId', requireHRMAdminPermission(['hrm.employees.edit', 'hrm.*']), async (req, res, next) => {
  try {
    const { employeeId } = req.params;
    
    if (!employeeId || isNaN(parseInt(employeeId))) {
      throw new ApiError(400, 'Valid employee ID is required');
    }

    const db = require('../../../../models');
    const { EmployeeMaster } = db;
    
    const employee = await EmployeeMaster.findOne({
      where: { 
        employee_id: parseInt(employeeId), 
        is_deleted: false 
      }
    });
    
    if (!employee) {
      throw new ApiError(404, 'Employee not found');
    }

    // Allowed fields for update
    const allowedFields = [
      'post_id', 'district_id', 'component_id', 'hub_id',
      'contract_start_date', 'contract_end_date', 'employee_pay',
      'employment_status', 'is_active', 'reporting_officer_id'
    ];

    const updateData = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updateData[field] = req.body[field];
      }
    }

    // Handle personal_info updates
    if (req.body.personal_info) {
      const db = require('../../../../models');
      const { ApplicantMaster, ApplicantPersonal } = db;
      const { Op } = db.Sequelize;
      const personalInfo = req.body.personal_info;
      
      // Update applicant info
      if (employee.applicant_id) {
        const masterUpdateData = {};
        const personalUpdateData = {};
        
        // Fields that go to ms_applicant_master
        const masterFields = ['email', 'mobile_no'];
        for (const field of masterFields) {
          if (personalInfo[field] !== undefined) {
            masterUpdateData[field] = personalInfo[field];
          }
        }
        
        // Fields that go to ms_applicant_personal
        const personalFields = ['full_name', 'dob', 'gender', 'aadhar_no'];
        for (const field of personalFields) {
          if (personalInfo[field] !== undefined) {
            personalUpdateData[field] = personalInfo[field];
          }
        }
        
        // Update ms_applicant_master table
        if (Object.keys(masterUpdateData).length > 0) {
          // Check for mobile number uniqueness if mobile_no is being updated
          if (masterUpdateData.mobile_no) {
            const existingMobile = await ApplicantMaster.findOne({
              where: { 
                mobile_no: masterUpdateData.mobile_no,
                applicant_id: { [Op.ne]: employee.applicant_id }
              }
            });
            
            if (existingMobile) {
              throw new ApiError(409, 'Mobile number already exists');
            }
          }
          
          // Check for email uniqueness if email is being updated
          if (masterUpdateData.email) {
            const existingEmail = await ApplicantMaster.findOne({
              where: { 
                email: masterUpdateData.email,
                applicant_id: { [Op.ne]: employee.applicant_id }
              }
            });
            
            if (existingEmail) {
              throw new ApiError(409, 'Email already exists');
            }
          }
          
          await ApplicantMaster.update(masterUpdateData, {
            where: { applicant_id: employee.applicant_id }
          });
        }
        
        // Update ms_applicant_personal table
        if (Object.keys(personalUpdateData).length > 0) {
          await ApplicantPersonal.update(personalUpdateData, {
            where: { applicant_id: employee.applicant_id }
          });
        }
      }
    }

    if (Object.keys(updateData).length === 0 && !req.body.personal_info) {
      throw new ApiError(400, 'No valid fields to update');
    }

    if (Object.keys(updateData).length > 0) {
      updateData.updated_at = new Date();
      await employee.update(updateData);
    }

    logger.info(`Employee ${employeeId} updated by admin ${req.user.admin_id}`, { updateData });

    return ApiResponse.success(res, employee, 'Employee updated successfully');
  } catch (error) {
    next(error);
  }
});

module.exports = router;
