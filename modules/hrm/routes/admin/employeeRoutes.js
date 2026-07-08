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
const { sendXlsxFromRows, sendPdfFromHtml, buildSimpleReportHtml, sanitizeFileName } = require('../../../../utils/reportExport');

const formatDateOnly = (value) => {
  if (!value) return '-';
  if (typeof value === 'string') return value.split('T')[0];
  return new Date(value).toISOString().split('T')[0];
};

// Validation functions
const validateAadhar = (aadhar) => {
  if (!aadhar) return true; // Optional field
  // Remove spaces and check if exactly 12 digits
  const cleanAadhar = aadhar.replace(/\s/g, '');
  return /^[0-9]{12}$/.test(cleanAadhar);
};

const validateMobile = (mobile) => {
  if (!mobile) return true; // Optional field
  // Check if exactly 10 digits and starts with 6-9
  return /^[6-9][0-9]{9}$/.test(mobile);
};

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
      scheme_id: req.query.scheme_id ? parseInt(req.query.scheme_id) : undefined,
      scheme_type_id: req.query.scheme_type_id ? parseInt(req.query.scheme_type_id) : undefined,
      post_id: req.query.post_id ? parseInt(req.query.post_id) : undefined,
      onboarding_status: req.query.onboarding_status,
      onboarding_type: req.query.onboarding_type,
      is_active: req.query.is_active !== undefined ? req.query.is_active === 'true' : undefined,
      contract_status: req.query.contract_status,
      search: req.query.search,
      only_hub: req.query.only_hub === 'true',
      only_osc: req.query.only_osc === 'true'
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
 * @route GET /api/hrm/admin/employees/export
 * @desc Export employees to Excel or PDF (backend generation)
 * @access Admin only
 */
router.get('/export', requireHRMAdminPermission(['hrm.employees.view', 'hrm.*']), async (req, res, next) => {
  try {
    const { format = 'excel' } = req.query;

    const filters = {
      district_id: req.query.district_id ? parseInt(req.query.district_id) : undefined,
      scheme_id: req.query.scheme_id ? parseInt(req.query.scheme_id) : undefined,
      scheme_type_id: req.query.scheme_type_id ? parseInt(req.query.scheme_type_id) : undefined,
      post_id: req.query.post_id ? parseInt(req.query.post_id) : undefined,
      onboarding_status: req.query.onboarding_status,
      onboarding_type: req.query.onboarding_type,
      is_active: req.query.is_active !== undefined ? req.query.is_active === 'true' : undefined,
      contract_status: req.query.contract_status,
      search: req.query.search,
      only_hub: req.query.only_hub === 'true',
      only_osc: req.query.only_osc === 'true'
    };

    // Get all employees without pagination for export
    const result = await employeeService.getEmployeeList(filters, req.hrmScope, {
      page: 1,
      limit: null,
      sortBy: 'created_at',
      sortOrder: 'DESC'
    });

    // Format data for export
    const exportData = result.employees.map(emp => {
      const status = emp.employment_status === 'INACTIVE' ? 'Inactive' :
                     emp.employment_status === 'ACTIVE' ? 'Active' :
                     emp.contract_end_date && new Date(emp.contract_end_date) < new Date() ? 'Expired' : 'Active';

      return {
        employee_code: emp.employee_code,
        full_name: emp.applicant?.personal?.full_name || '-',
        email: emp.applicant?.email || '-',
        mobile_no: emp.applicant?.mobile_no || '-',
        post_name: emp.post?.post_name || '-',
        district_name: emp.district?.district_name || '-',
        location_name: emp.scheme?.scheme_name || '-',
        location_type: emp.scheme?.schemeType?.scheme_code || '-',
        contract_start_date: formatDateOnly(emp.contract_start_date),
        contract_end_date: formatDateOnly(emp.contract_end_date),
        status: status,
        onboarding_status: emp.onboarding_status,
        employment_status: emp.employment_status
      };
    });

    const columns = [
      { header: 'Employee Code', key: 'employee_code', width: 15 },
      { header: 'Full Name', key: 'full_name', width: 20 },
      { header: 'Email', key: 'email', width: 20 },
      { header: 'Mobile', key: 'mobile_no', width: 12 },
      { header: 'Post', key: 'post_name', width: 15 },
      { header: 'District', key: 'district_name', width: 15 },
      { header: 'Location', key: 'location_name', width: 15 },
      { header: 'Contract Start', key: 'contract_start_date', width: 12 },
      { header: 'Contract End', key: 'contract_end_date', width: 12 }
    ];

    const filename = sanitizeFileName('employee-records');

    if (format === 'excel') {
      await sendXlsxFromRows(res, filename, columns, exportData);
    } else if (format === 'pdf') {
      const html = buildSimpleReportHtml('Employee Records', columns, exportData);
      await sendPdfFromHtml(res, filename, html);
    } else {
      throw new ApiError(400, 'Invalid format. Use "excel" or "pdf"');
    }
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
      scheme_id: req.query.scheme_id ? parseInt(req.query.scheme_id) : undefined,
      scheme_type_id: req.query.scheme_type_id ? parseInt(req.query.scheme_type_id) : undefined
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
    
    // Update attendance summary with correct values
    try {
      const attendanceSummaryService = require('../../services/attendanceSummaryService');
      const updatedAttendanceSummary = await attendanceSummaryService.getAttendanceSummary(parseInt(employeeId));
      
      // Replace attendance summary in response
      if (employee.attendance_summary) {
        employee.attendance_summary = updatedAttendanceSummary;
      }
    } catch (attendanceError) {
      logger.error('Attendance summary error:', attendanceError);
      // Keep original attendance summary if service fails
    }
    
    // Add IDs to employment info for dropdown mapping
    if (employee && employee.employment_info) {
      // Get the original employee data to extract all IDs
      const EmployeeMaster = require('../../../../models').EmployeeMaster;
      const originalEmployee = await EmployeeMaster.findOne({
        where: { employee_id: parseInt(employeeId) },
        attributes: ['post_id', 'district_id', 'scheme_id']
      });
      
      if (originalEmployee) {
        employee.employment_info.post_id = originalEmployee.post_id;
        employee.employment_info.district_id = originalEmployee.district_id;
        employee.employment_info.scheme_id = originalEmployee.scheme_id;
      }
    }
    
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

    // Only include applicant association if personal_info is being updated
    const employee = await EmployeeMaster.findOne({
      where: {
        employee_id: parseInt(employeeId),
        is_deleted: false
      },
      include: req.body.personal_info ? [{
        model: db.ApplicantMaster,
        as: 'applicant'
      }] : []
    });

    if (!employee) {
      throw new ApiError(404, 'Employee not found');
    }

    // Allowed fields for update
    const allowedFields = [
      'post_id', 'district_id', 'scheme_id',
      'contract_start_date', 'contract_end_date', 'employee_pay',
      'is_active', 'employment_status', 'reporting_officer_id'
    ];

    const updateData = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updateData[field] = req.body[field];
      }
    }
    
    // Auto-sync employment_status with is_active only if employment_status not explicitly provided
    if (updateData.is_active !== undefined && !updateData.employment_status) {
      updateData.employment_status = updateData.is_active ? 'ACTIVE' : 'INACTIVE';
    }

    // Handle personal_info updates
    if (req.body.personal_info) {
      const db = require('../../../../models');
      const { ApplicantMaster, ApplicantPersonal } = db;
      const { Op } = db.Sequelize;
      const personalInfo = req.body.personal_info;
      
      // Validate Aadhar number format (only if provided)
      if (personalInfo.aadhar_no && personalInfo.aadhar_no.trim() !== '' && !validateAadhar(personalInfo.aadhar_no)) {
        throw new ApiError(400, 'Invalid Aadhar number format. Must be 12 digits (spaces allowed)');
      }
      
      // Validate mobile number format (only if provided)
      if (personalInfo.mobile_no && personalInfo.mobile_no.trim() !== '' && !validateMobile(personalInfo.mobile_no)) {
        throw new ApiError(400, 'Invalid mobile number format. Must be 10 digits starting with 6-9');
      }
      
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
        
        // Calculate age if DOB is provided
        if (personalInfo.dob) {
          const dob = new Date(personalInfo.dob);
          const today = new Date();
          let age = today.getFullYear() - dob.getFullYear();
          const monthDiff = today.getMonth() - dob.getMonth();
          if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
            age--;
          }
          personalUpdateData.age = age;
        }
        
        // Update ms_applicant_master table
        if (Object.keys(masterUpdateData).length > 0) {
          // Check for mobile number uniqueness if mobile_no is being updated and changing
          if (masterUpdateData.mobile_no !== undefined) {
            // Skip update if mobile_no is empty string or not changing
            if (masterUpdateData.mobile_no === '' || masterUpdateData.mobile_no === employee.applicant?.mobile_no) {
              delete masterUpdateData.mobile_no;
            } else {
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
          }

          // Check for email uniqueness if email is being updated and changing
          if (masterUpdateData.email) {
            if (masterUpdateData.email !== employee.applicant?.email) {
              const existingEmail = await ApplicantMaster.findOne({
                where: {
                  email: masterUpdateData.email,
                  applicant_id: { [Op.ne]: employee.applicant_id }
                }
              });

              if (existingEmail) {
                throw new ApiError(409, 'Email already exists');
              }
            } else {
              // Remove email from updateData since it's not changing
              delete masterUpdateData.email;
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
      throw new ApiError(400, 'No data provided for update');
    }

    await EmployeeMaster.update(updateData, {
      where: { employee_id: parseInt(employeeId) }
    });

    updateData.updated_at = new Date();
    await employee.update(updateData);

    return ApiResponse.success(res, employee, 'Employee updated successfully');
  } catch (error) {
    next(error);
  }
});

module.exports = router;
