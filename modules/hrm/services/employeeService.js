const db = require('../../../models');
const { EmployeeOnboardingLog } = require('../models');
const EmployeeMaster = db.EmployeeMaster;
const { buildEmployeeWhereClause } = require('../middleware/hrmHierarchy');
const bcrypt = require('bcryptjs');
const { getBcryptRounds } = require('../../../config/security');
const logger = require('../../../config/logger');
const { Op } = require('sequelize');
const fs = require('fs');
const path = require('path');

/**
 * Employee Service
 * Handles employee listing, filtering, and management
 */

/**
 * Get employee list with filters and pagination
 */
async function getEmployeeList(filters = {}, hrmScope = null, pagination = {}) {
  try {
    const {
      page = 1,
      limit = 10,
      sortBy = 'created_at',
      sortOrder = 'DESC'
    } = pagination;

    const offset = (page - 1) * limit;

    // Base where clause
    let where = {
      is_deleted: false
    };

    // Temporarily disable HRM hierarchy scope for debugging
    // if (hrmScope) {
    //   where = buildEmployeeWhereClause(where, hrmScope);
    // }

    // Apply additional filters
    if (filters.district_id) {
      where.district_id = filters.district_id;
    }

    if (filters.component_id) {
      where.component_id = filters.component_id;
    }

    if (filters.hub_id) {
      where.hub_id = filters.hub_id;
    }

    if (filters.post_id) {
      where.post_id = filters.post_id;
    }

    if (filters.onboarding_status) {
      where.onboarding_status = filters.onboarding_status;
    }

    if (filters.onboarding_type) {
      where.onboarding_type = filters.onboarding_type;
    }

    if (filters.is_active !== undefined) {
      where.is_active = filters.is_active;
    }

    // Search by employee code or name
    if (filters.search) {
      where[Op.or] = [
        { employee_code: { [Op.iLike]: `%${filters.search}%` } },
        { '$applicant.personal.full_name$': { [Op.iLike]: `%${filters.search}%` } },
        { '$applicant.email$': { [Op.iLike]: `%${filters.search}%` } }
      ];
    }

    // Contract status filter
    if (filters.contract_status) {
      const today = new Date().toISOString().split('T')[0];
      
      if (filters.contract_status === 'active') {
        where.contract_start_date = { [Op.lte]: today };
        where[Op.or] = [
          { contract_end_date: null },
          { contract_end_date: { [Op.gte]: today } }
        ];
      } else if (filters.contract_status === 'expired') {
        where.contract_end_date = { [Op.lt]: today };
      } else if (filters.contract_status === 'upcoming') {
        where.contract_start_date = { [Op.gt]: today };
      }
    }

    const { count, rows } = await EmployeeMaster.findAndCountAll({
      where,
      include: [
        {
          model: db.ApplicantMaster,
          as: 'applicant',
          required: false,
          include: [
            {
              model: db.ApplicantPersonal,
              as: 'personal',
              required: false,
              attributes: ['full_name', 'dob', 'gender']
            }
          ],
          attributes: ['applicant_id', 'email', 'mobile_no']
        },
        {
          model: db.PostMaster,
          as: 'post',
          required: false,
          attributes: ['post_id', 'post_name', 'post_code']
        },
        {
          model: db.DistrictMaster,
          as: 'district',
          required: false,
          attributes: ['district_id', 'district_name']
        },
        {
          model: db.Component,
          as: 'component',
          required: false,
          attributes: ['component_id', 'component_name']
        },
        {
          model: db.Hub,
          as: 'hub',
          required: false,
          attributes: ['hub_id', 'hub_name']
        }
      ],
      limit,
      offset,
      order: [[sortBy, sortOrder]],
      distinct: true
    });

    return {
      employees: rows,
      pagination: {
        total: count,
        page,
        limit,
        totalPages: Math.ceil(count / limit)
      }
    };
  } catch (error) {
    logger.error('Error fetching employee list', { error: error.message, filters });
    throw error;
  }
}

/**
 * Get single employee details with complete information
 */
async function getEmployeeById(employeeId, hrmScope = null) {
  try {
    let where = {
      employee_id: employeeId,
      is_deleted: false
    };

    if (hrmScope) {
      where = buildEmployeeWhereClause(where, hrmScope);
    }

    // Get complete employee information using raw SQL for better performance
    const [employees] = await db.sequelize.query(
      `SELECT 
        e.employee_id,
        e.employee_code,
        e.applicant_id,
        e.post_id,
        e.district_id,
        e.component_id,
        e.hub_id,
        e.contract_start_date,
        e.contract_end_date,
        e.employment_status,
        e.onboarding_status,
        e.onboarding_type,
        e.reporting_officer_id,
        e.employee_pay,
        e.is_active,
        e.created_at as joining_date,
        e.updated_at,
        am.email,
        am.mobile_no,
        am.is_employee as is_applicant_employee,
        ap.full_name,
        ap.dob,
        ap.gender,
        ap.aadhar_no,
        pm.post_name,
        dm.district_name,
        cm.component_name,
        hm.hub_name,
        ro.employee_code as reporting_officer_code,
        rap.full_name as reporting_officer_name,
        adu.admin_id as onboarding_email_sent_by,
        adu.username as onboarding_email_sent_by_username
      FROM ms_employee_master e
      LEFT JOIN ms_applicant_master am ON e.applicant_id = am.applicant_id
      LEFT JOIN ms_applicant_personal ap ON e.applicant_id = ap.applicant_id
      LEFT JOIN ms_post_master pm ON e.post_id = pm.post_id
      LEFT JOIN ms_district_master dm ON e.district_id = dm.district_id
      LEFT JOIN ms_components cm ON e.component_id = cm.component_id
      LEFT JOIN ms_hub_master hm ON e.hub_id = hm.hub_id
      LEFT JOIN ms_employee_master ro ON e.reporting_officer_id = ro.employee_id
      LEFT JOIN ms_applicant_personal rap ON ro.applicant_id = rap.applicant_id
      LEFT JOIN ms_admin_users adu ON e.onboarding_email_sent_by = adu.admin_id
      WHERE e.employee_id = :employeeId 
        AND e.is_deleted = false`,
      { 
        replacements: { employeeId },
        type: db.sequelize.QueryTypes.SELECT
      }
    );

    if (employees.length === 0) {
      throw new ApiError(404, 'Employee not found');
    }

    const employee = employees[0];

    // Get leave balance summary for current year
    const [leaveBalances] = await db.sequelize.query(
      `SELECT 
        lt.leave_code,
        lt.leave_name,
        COALESCE(lb.total_allocated, 0) as total_allocated,
        COALESCE(lb.used, 0) as used,
        COALESCE(lb.remaining, 0) as remaining,
        COALESCE(lb.carry_forward, 0) as carry_forward
      FROM ms_hrm_leave_types lt
      LEFT JOIN ms_hrm_leave_balance lb ON lt.leave_type_id = lb.leave_type_id 
        AND lb.employee_id = :employeeId 
        AND lb.year = EXTRACT(YEAR FROM CURRENT_DATE)
        AND lb.is_deleted = false
      WHERE lt.is_active = true 
        AND lt.is_deleted = false
      ORDER BY lt.leave_code`,
      { 
        replacements: { employeeId },
        type: db.sequelize.QueryTypes.SELECT
      }
    );

    // Get attendance summary for current month
    const [attendanceSummary] = await db.sequelize.query(
      `SELECT 
        COUNT(CASE WHEN status = 'PRESENT' THEN 1 END) as present_days,
        COUNT(CASE WHEN status = 'ABSENT' THEN 1 END) as absent_days,
        COUNT(CASE WHEN status = 'HALF_DAY' THEN 1 END) as half_days,
        COUNT(CASE WHEN status = 'ON_LEAVE' THEN 1 END) as leave_days,
        COUNT(CASE WHEN status = 'HOLIDAY' OR status = 'SUNDAY' THEN 1 END) as holidays,
        COUNT(*) as total_days
      FROM ms_hrm_attendance
      WHERE employee_id = :employeeId
        AND attendance_date >= DATE_TRUNC('month', CURRENT_DATE)
        AND attendance_date < DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month'`,
      { 
        replacements: { employeeId },
        type: db.sequelize.QueryTypes.SELECT
      }
    );

    // Get recent leave applications
    const [recentLeaves] = await db.sequelize.query(
      `SELECT 
        la.leave_id,
        la.from_date,
        la.to_date,
        la.total_days,
        la.status,
        la.reason,
        lt.leave_name,
        la.created_at
      FROM ms_hrm_leave_applications la
      INNER JOIN ms_hrm_leave_types lt ON la.leave_type_id = lt.leave_type_id
      WHERE la.employee_id = :employeeId
        AND la.is_deleted = false
      ORDER BY la.created_at DESC
      LIMIT 5`,
      { 
        replacements: { employeeId },
        type: db.sequelize.QueryTypes.SELECT
      }
    );

    // Get onboarding log
    const [onboardingLog] = await db.sequelize.query(
      `SELECT 
        log_id,
        action,
        details,
        performed_at,
        performed_by,
        adu.username as performed_by_username
      FROM ms_employee_onboarding_log ol
      LEFT JOIN ms_admin_users adu ON ol.performed_by = adu.admin_id
      WHERE ol.employee_id = :employeeId
      ORDER BY ol.performed_at DESC
      LIMIT 10`,
      { 
        replacements: { employeeId },
        type: db.sequelize.QueryTypes.SELECT
      }
    );

    return {
      employee_id: employee.employee_id,
      employee_code: employee.employee_code,
      applicant_id: employee.applicant_id,
      personal_info: {
        full_name: employee.full_name,
        email: employee.email,
        mobile_no: employee.mobile_no,
        dob: employee.dob,
        gender: employee.gender,
        aadhar_no: employee.aadhar_no,
        address: employee.address,
        pincode: employee.pincode,
        state: employee.state,
        district: employee.applicant_district,
        father_name: employee.father_name,
        mother_name: employee.mother_name,
        marital_status: employee.marital_status,
        blood_group: employee.blood_group,
        disability: employee.disability
      },
      employment_info: {
        post_name: employee.post_name,
        district_name: employee.district_name,
        component_name: employee.component_name,
        hub_name: employee.hub_name,
        employee_pay: employee.employee_pay,
        contract_start_date: employee.contract_start_date,
        contract_end_date: employee.contract_end_date,
        joining_date: employee.joining_date,
        employment_status: employee.employment_status,
        onboarding_status: employee.onboarding_status,
        onboarding_type: employee.onboarding_type,
        is_active: employee.is_active
      },
      reporting_info: {
        reporting_officer_id: employee.reporting_officer_id,
        reporting_officer_code: employee.reporting_officer_code,
        reporting_officer_name: employee.reporting_officer_name
      },
      onboarding_info: {
        onboarding_email_sent_by: employee.onboarding_email_sent_by,
        onboarding_email_sent_by_username: employee.onboarding_email_sent_by_username
      },
      leave_balance: leaveBalances,
      attendance_summary: attendanceSummary[0] || {
        present_days: 0,
        absent_days: 0,
        half_days: 0,
        leave_days: 0,
        holidays: 0,
        total_days: 0
      },
      recent_leaves: recentLeaves,
      onboarding_log: onboardingLog
    };
  } catch (error) {
    logger.error('Error getting employee details:', error);
    throw error;
  }
}

/**
 * Get employee statistics for dashboard
 */
async function getEmployeeStatistics(hrmScope = null) {
  try {
    let where = { is_deleted: false };

    if (hrmScope) {
      where = buildEmployeeWhereClause(where, hrmScope);
    }

    const today = new Date().toISOString().split('T')[0];

    const [
      totalEmployees,
      activeEmployees,
      pendingOnboarding,
      expiredContracts,
      contractsExpiringIn30Days
    ] = await Promise.all([
      EmployeeMaster.count({ where }),
      EmployeeMaster.count({ where: { ...where, is_active: true } }),
      EmployeeMaster.count({ 
        where: { 
          ...where, 
          onboarding_status: { [Op.in]: ['PENDING', 'EMAIL_SENT', 'ONBOARDING_INCOMPLETE'] }
        } 
      }),
      EmployeeMaster.count({
        where: {
          ...where,
          contract_end_date: { [Op.lt]: today }
        }
      }),
      EmployeeMaster.count({
        where: {
          ...where,
          contract_end_date: {
            [Op.gte]: today,
            [Op.lte]: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
          }
        }
      })
    ]);

    // Get breakdown by onboarding type
    const onboardingTypeBreakdown = await EmployeeMaster.findAll({
      where,
      attributes: [
        'onboarding_type',
        [db.sequelize.fn('COUNT', db.sequelize.col('employee_id')), 'count']
      ],
      group: ['onboarding_type'],
      raw: true
    });

    // Get breakdown by district
    const districtBreakdown = await EmployeeMaster.findAll({
      where,
      attributes: [
        'district_id',
        [db.sequelize.fn('COUNT', db.sequelize.col('employee_id')), 'count']
      ],
      include: [
        {
          model: db.DistrictMaster,
          as: 'district',
          attributes: ['district_name']
        }
      ],
      group: ['district_id', 'district.district_id', 'district.district_name'],
      raw: true,
      nest: true
    });

    return {
      totalEmployees,
      activeEmployees,
      inactiveEmployees: totalEmployees - activeEmployees,
      pendingOnboarding,
      expiredContracts,
      contractsExpiringIn30Days,
      onboardingTypeBreakdown,
      districtBreakdown
    };
  } catch (error) {
    logger.error('Error fetching employee statistics', { error: error.message });
    throw error;
  }
}

/**
 * Update employee status
 */
async function updateEmployeeStatus(employeeId, status, adminId, hrmScope = null) {
  const transaction = await db.sequelize.transaction();

  try {
    let where = {
      employee_id: employeeId,
      is_deleted: false
    };

    if (hrmScope) {
      where = buildEmployeeWhereClause(where, hrmScope);
    }

    const employee = await EmployeeMaster.findOne({ where, transaction });

    if (!employee) {
      throw new Error('Employee not found or access denied');
    }

    await EmployeeMaster.update(
      {
        is_active: status,
        updated_by: adminId
      },
      {
        where: { employee_id: employeeId },
        transaction
      }
    );

    await EmployeeOnboardingLog.create({
      employee_id: employeeId,
      action: status ? 'ACTIVATED' : 'DEACTIVATED',
      details: { previous_status: employee.is_active },
      performed_by: adminId,
      performed_at: new Date()
    }, { transaction });

    await transaction.commit();

    logger.info('Employee status updated', { employee_id: employeeId, status });

    return { success: true, message: 'Employee status updated successfully' };
  } catch (error) {
    await transaction.rollback();
    logger.error('Error updating employee status', { employee_id: employeeId, error: error.message });
    throw error;
  }
}

/**
 * Reject selected applicant onboarding
 */
async function rejectApplicantOnboarding(applicationId, reason, adminId, ipAddress) {
  const transaction = await db.sequelize.transaction();

  try {
    const application = await db.Application.findOne({
      where: {
        application_id: applicationId,
        status: 'SELECTED',
        is_deleted: false
      },
      transaction
    });

    if (!application) {
      throw new Error('Application not found or not in SELECTED status');
    }

    // Check if employee already exists
    const existingEmployee = await EmployeeMaster.findOne({
      where: { application_id: applicationId, is_deleted: false },
      transaction
    });

    if (existingEmployee) {
      throw new Error('Employee record already exists, cannot reject');
    }

    // Update application status to REJECTED
    await db.Application.update(
      {
        status: 'REJECTED',
        updated_by: adminId
      },
      {
        where: { application_id: applicationId },
        transaction
      }
    );

    await transaction.commit();

    logger.info('Applicant onboarding rejected', {
      application_id: applicationId,
      reason,
      rejected_by: adminId
    });

    return {
      success: true,
      message: 'Applicant onboarding rejected successfully'
    };
  } catch (error) {
    await transaction.rollback();
    logger.error('Error rejecting applicant onboarding', {
      application_id: applicationId,
      error: error.message
    });
    throw error;
  }
}

/**
 * Get employee by applicant ID
 */
async function getEmployeeByApplicantId(applicantId) {
  try {
    logger.info('Looking up employee by applicant ID', { applicantId });
    
    // Use simple query first to avoid include issues
    const employee = await EmployeeMaster.findOne({
      where: { applicant_id: applicantId, is_deleted: false }
    });

    if (!employee) {
      logger.warn('No employee found for applicant ID', { applicantId });
      return null;
    }

    logger.info('Employee found', { 
      applicantId, 
      employeeId: employee.employee_id,
      employeeCode: employee.employee_code 
    });

    return employee;
  } catch (error) {
    logger.error('Error getting employee by applicant ID:', { applicantId, error: error.message });
    throw error;
  }
}

/**
 * Update employee profile
 */
async function updateEmployeeProfile(applicantId, updateData) {
  try {
    const employee = await EmployeeMaster.findOne({
      where: { applicant_id: applicantId, is_deleted: false }
    });

    if (!employee) {
      throw new Error('Employee not found');
    }

    // Update applicant personal details if provided
    if (updateData.full_name || updateData.mobile_no) {
      await db.ApplicantPersonal.update(
        {
          ...(updateData.full_name && { full_name: updateData.full_name }),
          ...(updateData.mobile_no && { mobile_no: updateData.mobile_no }),
          updated_at: new Date()
        },
        { where: { applicant_id: applicantId } }
      );
    }

    // Update employee record if provided
    const allowedFields = ['mobile_no', 'address', 'emergency_contact'];
    const employeeUpdateData = {};
    
    allowedFields.forEach(field => {
      if (updateData[field] !== undefined) {
        employeeUpdateData[field] = updateData[field];
      }
    });

    if (Object.keys(employeeUpdateData).length > 0) {
      employeeUpdateData.updated_at = new Date();
      await EmployeeMaster.update(employeeUpdateData, {
        where: { employee_id: employee.employee_id }
      });
    }

    // Return updated employee record
    return await getEmployeeByApplicantId(applicantId);
  } catch (error) {
    logger.error('Error updating employee profile:', error);
    throw error;
  }
}

/**
 * Change employee password
 */
async function changeEmployeePassword(applicantId, currentPassword, newPassword) {
  try {
    logger.info('Password change attempt', { applicantId, newPasswordLength: newPassword.length });
    
    const employee = await EmployeeMaster.findOne({
      where: { applicant_id: applicantId, is_deleted: false },
      include: [
        {
          model: db.ApplicantMaster,
          as: 'applicant',
          attributes: ['password_hash']
        }
      ]
    });

    if (!employee) {
      throw new Error('Employee not found');
    }

    logger.info('Employee found for password change', {
      employeeId: employee.employee_id,
      password_change_required: employee.password_change_required,
      has_temp_password: !!employee.temp_password_hash
    });

    // Verify current password - check against temp password if required, otherwise applicant password
    let isPasswordValid = false;
    let passwordType = '';
    
    if (employee.password_change_required && employee.temp_password_hash) {
      // Employee needs to change temp password
      isPasswordValid = await bcrypt.compare(currentPassword, employee.temp_password_hash);
      passwordType = 'temp_password';
      logger.info('Verifying against temp password', { isValid: isPasswordValid });
    } else {
      // Check against applicant's regular password
      isPasswordValid = await bcrypt.compare(currentPassword, employee.applicant.password_hash);
      passwordType = 'applicant_password';
      logger.info('Verifying against applicant password', { isValid: isPasswordValid });
    }
    
    if (!isPasswordValid) {
      logger.error('Password verification failed', { passwordType, applicantId });
      throw new Error('Current password is incorrect');
    }

    // Hash new password
    const passwordHash = await bcrypt.hash(newPassword, getBcryptRounds());
    logger.info('New password hashed successfully');

    // Update applicant password
    const applicantUpdateResult = await db.ApplicantMaster.update(
      { 
        password_hash: passwordHash,
        updated_at: new Date()
      },
      { where: { applicant_id: applicantId } }
    );

    logger.info('Applicant password updated', { 
      applicantId, 
      affectedRows: applicantUpdateResult[0] 
    });

    // Update employee password_change_required flag
    const employeeUpdateResult = await EmployeeMaster.update(
      { 
        password_change_required: false, // Set to false since password has been changed
        temp_password_hash: null, // Clear temp password hash
        updated_at: new Date()
      },
      { where: { employee_id: employee.employee_id } }
    );

    logger.info('Employee record updated', { 
      employeeId: employee.employee_id,
      affectedRows: employeeUpdateResult[0],
      password_change_required: false,
      temp_password_cleared: true
    });

    logger.info(`Password changed successfully for employee: ${employee.employee_id}`);

    return { success: true, message: 'Password changed successfully' };
  } catch (error) {
    logger.error('Error changing employee password:', { 
      error: error.message, 
      applicantId, 
      stack: error.stack 
    });
    throw error;
  }
}

/**
 * Upload allotment letter
 */
async function uploadAllotmentLetter(applicantId, file) {
  try {
    const employee = await EmployeeMaster.findOne({
      where: { applicant_id: applicantId, is_deleted: false }
    });

    if (!employee) {
      throw new Error('Employee not found');
    }

    // Create employee directory if it doesn't exist
    const employeeDir = path.join('uploads/hrm/employees', employee.employee_code);
    if (!fs.existsSync(employeeDir)) {
      fs.mkdirSync(employeeDir, { recursive: true });
    }

    // Move file from temp to employee directory
    const tempPath = file.path;
    const finalPath = path.join(employeeDir, 'allotment_letter.pdf');
    
    fs.renameSync(tempPath, finalPath);

    // Get relative path for database storage
    const relativePath = path.relative('uploads', finalPath);
    
    // Update employee record
    await EmployeeMaster.update(
      { 
        allotment_letter_uploaded: true,
        allotment_letter_path: relativePath,
        updated_at: new Date()
      },
      { where: { employee_id: employee.employee_id } }
    );

    logger.info(`Allotment letter uploaded for employee: ${employee.employee_id}`);

    return {
      success: true,
      message: 'Allotment letter uploaded successfully',
      file_path: relativePath
    };
  } catch (error) {
    logger.error('Error uploading allotment letter:', error);
    throw error;
  }
}

/**
 * Get employee profile with full details for web interface
 */
async function getEmployeeProfile(employeeId) {
  try {
    // Get complete employee information using raw SQL
    const [employees] = await db.sequelize.query(
      `SELECT 
        e.employee_id,
        e.employee_code,
        e.applicant_id,
        e.post_id,
        e.district_id,
        e.component_id,
        e.hub_id,
        e.contract_start_date,
        e.contract_end_date,
        e.employment_status,
        e.onboarding_status,
        e.onboarding_type,
        e.reporting_officer_id,
        e.employee_pay,
        e.is_active,
        e.created_at as joining_date,
        e.updated_at,
        am.email,
        am.mobile_no,
        am.is_employee as is_applicant_employee,
        ap.full_name,
        ap.dob,
        ap.gender,
        ap.aadhar_no,
        pm.post_name,
        dm.district_name,
        cm.component_name,
        hm.hub_name,
        ro.employee_code as reporting_officer_code,
        rap.full_name as reporting_officer_name,
        adu.admin_id as onboarding_email_sent_by,
        adu.username as onboarding_email_sent_by_username
      FROM ms_employee_master e
      LEFT JOIN ms_applicant_master am ON e.applicant_id = am.applicant_id
      LEFT JOIN ms_applicant_personal ap ON e.applicant_id = ap.applicant_id
      LEFT JOIN ms_post_master pm ON e.post_id = pm.post_id
      LEFT JOIN ms_district_master dm ON e.district_id = dm.district_id
      LEFT JOIN ms_components cm ON e.component_id = cm.component_id
      LEFT JOIN ms_hub_master hm ON e.hub_id = hm.hub_id
      LEFT JOIN ms_employee_master ro ON e.reporting_officer_id = ro.employee_id
      LEFT JOIN ms_applicant_personal rap ON ro.applicant_id = rap.applicant_id
      LEFT JOIN ms_admin_users adu ON e.onboarding_email_sent_by = adu.admin_id
      WHERE e.employee_id = :employeeId 
        AND e.is_deleted = false`,
      { 
        replacements: { employeeId },
        type: db.sequelize.QueryTypes.SELECT
      }
    );

    if (employees.length === 0) {
      throw new ApiError(404, 'Employee not found');
    }

    const employee = employees[0];

    // Get leave balance summary for current year
    const [leaveBalances] = await db.sequelize.query(
      `SELECT 
        lt.leave_code,
        lt.leave_name,
        COALESCE(lb.total_allocated, 0) as total_allocated,
        COALESCE(lb.used, 0) as used,
        COALESCE(lb.remaining, 0) as remaining,
        COALESCE(lb.carry_forward, 0) as carry_forward
      FROM ms_hrm_leave_types lt
      LEFT JOIN ms_hrm_leave_balance lb ON lt.leave_type_id = lb.leave_type_id 
        AND lb.employee_id = :employeeId 
        AND lb.year = EXTRACT(YEAR FROM CURRENT_DATE)
        AND lb.is_deleted = false
      WHERE lt.is_active = true 
        AND lt.is_deleted = false
      ORDER BY lt.leave_code`,
      { 
        replacements: { employeeId },
        type: db.sequelize.QueryTypes.SELECT
      }
    );

    // Get attendance summary for current month
    const [attendanceSummary] = await db.sequelize.query(
      `SELECT 
        COUNT(CASE WHEN status = 'PRESENT' THEN 1 END) as present_days,
        COUNT(CASE WHEN status = 'ABSENT' THEN 1 END) as absent_days,
        COUNT(CASE WHEN status = 'HALF_DAY' THEN 1 END) as half_days,
        COUNT(CASE WHEN status = 'ON_LEAVE' THEN 1 END) as leave_days,
        COUNT(CASE WHEN status = 'HOLIDAY' OR status = 'SUNDAY' THEN 1 END) as holidays,
        COUNT(*) as total_days
      FROM ms_hrm_attendance
      WHERE employee_id = :employeeId
        AND attendance_date >= DATE_TRUNC('month', CURRENT_DATE)
        AND attendance_date < DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month'`,
      { 
        replacements: { employeeId },
        type: db.sequelize.QueryTypes.SELECT
      }
    );

    // Get recent leave applications
    const [recentLeaves] = await db.sequelize.query(
      `SELECT 
        la.leave_id,
        la.from_date,
        la.to_date,
        la.total_days,
        la.status,
        la.reason,
        lt.leave_name,
        la.created_at
      FROM ms_hrm_leave_applications la
      INNER JOIN ms_hrm_leave_types lt ON la.leave_type_id = lt.leave_type_id
      WHERE la.employee_id = :employeeId
        AND la.is_deleted = false
      ORDER BY la.created_at DESC
      LIMIT 5`,
      { 
        replacements: { employeeId },
        type: db.sequelize.QueryTypes.SELECT
      }
    );

    // Get onboarding log
    const [onboardingLog] = await db.sequelize.query(
      `SELECT 
        log_id,
        action,
        details,
        performed_at,
        performed_by,
        adu.username as performed_by_username
      FROM ms_employee_onboarding_log ol
      LEFT JOIN ms_admin_users adu ON ol.performed_by = adu.admin_id
      WHERE ol.employee_id = :employeeId
      ORDER BY ol.performed_at DESC
      LIMIT 10`,
      { 
        replacements: { employeeId },
        type: db.sequelize.QueryTypes.SELECT
      }
    );

    return {
      employee_id: employee.employee_id,
      employee_code: employee.employee_code,
      applicant_id: employee.applicant_id,
      personal_info: {
        full_name: employee.full_name,
        email: employee.email,
        mobile_no: employee.mobile_no,
        dob: employee.dob,
        gender: employee.gender,
        aadhar_no: employee.aadhar_no,
        address: employee.address,
        pincode: employee.pincode,
        state: employee.state,
        district: employee.applicant_district,
        father_name: employee.father_name,
        mother_name: employee.mother_name,
        marital_status: employee.marital_status,
        blood_group: employee.blood_group,
        disability: employee.disability
      },
      employment_info: {
        post_name: employee.post_name,
        district_name: employee.district_name,
        component_name: employee.component_name,
        hub_name: employee.hub_name,
        employee_pay: employee.employee_pay,
        contract_start_date: employee.contract_start_date,
        contract_end_date: employee.contract_end_date,
        joining_date: employee.joining_date,
        employment_status: employee.employment_status,
        onboarding_status: employee.onboarding_status,
        onboarding_type: employee.onboarding_type,
        is_active: employee.is_active
      },
      reporting_info: {
        reporting_officer_id: employee.reporting_officer_id,
        reporting_officer_code: employee.reporting_officer_code,
        reporting_officer_name: employee.reporting_officer_name
      },
      onboarding_info: {
        onboarding_email_sent_by: employee.onboarding_email_sent_by,
        onboarding_email_sent_by_username: employee.onboarding_email_sent_by_username
      },
      leave_balance: leaveBalances,
      attendance_summary: attendanceSummary[0] || {
        present_days: 0,
        absent_days: 0,
        half_days: 0,
        leave_days: 0,
        holidays: 0,
        total_days: 0
      },
      recent_leaves: recentLeaves,
      onboarding_log: onboardingLog
    };
  } catch (error) {
    logger.error('Error getting employee profile:', error);
    throw error;
  }
}

/**
 * Get complete employee and applicant profile for HRM app/applicant routes
 */
async function getCompleteEmployeeProfile(applicantId) {
  try {
    // Get employee record with joins to get names
    const employee = await EmployeeMaster.findOne({
      where: { applicant_id: applicantId, is_deleted: false },
      include: [
        {
          model: db.PostMaster,
          as: 'post',
          attributes: ['post_id', 'post_name', 'post_code'],
          where: { is_deleted: false },
          required: false
        },
        {
          model: db.DistrictMaster,
          as: 'district',
          attributes: ['district_id', 'district_name'],
          where: { is_deleted: false },
          required: false
        },
        {
          model: db.Component,
          as: 'component',
          attributes: ['component_id', 'component_name'],
          where: { is_deleted: false },
          required: false
        },
        {
          model: db.Hub,
          as: 'hub',
          attributes: ['hub_id', 'hub_name'],
          where: { is_deleted: false },
          required: false
        },
        {
          model: db.AdminUser,
          as: 'reportingOfficer',
          attributes: ['admin_id', 'username'],
          where: { is_deleted: false },
          required: false
        }
      ]
    });

    if (!employee) {
      return null;
    }

    // Get applicant profile using the existing service
    const profileService = require('../../../services/applicant/profileService');
    const applicantProfile = await profileService.getProfile(applicantId);

    // Combine employee and applicant data
    return {
      employee_id: employee.employee_id,
      employee_code: employee.employee_code,
      full_name: applicantProfile.personal?.full_name || null,
      email: applicantProfile.email,
      mobile_no: applicantProfile.mobile_no,
      dob: applicantProfile.personal?.dob || null,
      gender: applicantProfile.personal?.gender || null,
      aadhar_no: applicantProfile.personal?.aadhar_no || null,
      profile_image: applicantProfile.profile_img,
      address: applicantProfile.address,
      employment_status: employee.employment_status,
      onboarding_status: employee.onboarding_status,
      onboarding_type: employee.onboarding_type,
      contract_start_date: employee.contract_start_date,
      contract_end_date: employee.contract_end_date,
      joining_date: employee.created_at,
      employee_pay: employee.employee_pay,
      // Post details (handle null joins gracefully)
      post_id: employee.post_id,
      post_name: employee.post?.post_name || null,
      post_code: employee.post?.post_code || null,
      // District details (handle null joins gracefully)
      district_id: employee.district_id,
      district_name: employee.district?.district_name || null,
      // Component details (handle null joins gracefully)
      component_id: employee.component_id,
      component_name: employee.component?.component_name || null,
      // Hub details (handle null joins gracefully)
      hub_id: employee.hub_id,
      hub_name: employee.hub?.hub_name || null,
      // Reporting officer details (handle nested null joins gracefully)
      reporting_officer_id: employee.reporting_officer_id,
      reporting_officer_username: employee.reportingOfficer?.username || null,
      // Allotment letter (fix path format - ensure consistent HRM format)
      allotment_letter_uploaded: !!employee.allotment_letter_path,
      allotment_letter_path: employee.allotment_letter_path || null
    };
  } catch (error) {
    logger.error('Error getting complete employee profile:', error);
    throw error;
  }
}

module.exports = {
  getEmployeeList,
  getEmployeeById,
  getEmployeeProfile,
  getEmployeeStatistics,
  updateEmployeeStatus,
  rejectApplicantOnboarding,
  getEmployeeByApplicantId,
  updateEmployeeProfile,
  changeEmployeePassword,
  uploadAllotmentLetter,
  getCompleteEmployeeProfile
};
