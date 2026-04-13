const db = require('../../../models');
const { EmployeeOnboardingLog } = require('../models');
const EmployeeMaster = db.EmployeeMaster;
const { generateEmployeeCode } = require('../utils/employeeCodeGenerator');
const { sendOnboardingEmail } = require('./hrmEmailService');
const bcrypt = require('bcryptjs');
const { getBcryptRounds } = require('../../../config/security');
const logger = require('../../../config/logger');
const { Op } = require('sequelize');
const { ApiError } = require('../../../middleware/errorHandler');

/**
 * Parse date from DD/MM/YYYY format to YYYY-MM-DD
 */
function parseDate(dateStr) {
  if (!dateStr) return null;
  
  // Handle DD/MM/YYYY format
  if (typeof dateStr === 'string' && dateStr.includes('/')) {
    const parts = dateStr.split('/');
    if (parts.length === 3) {
      const [day, month, year] = parts;
      const date = new Date(`${year}-${month}-${day}`);
      return isNaN(date) ? null : date.toISOString().split('T')[0];
    }
  }
  
  return dateStr;
}

/**
 * Employee Onboarding Service
 * Handles both Flow A (CRM Selected) and Flow B (Existing Employee Import)
 */

/**
 * Onboard selected applicant (Flow A)
 * Creates employee record linked to existing application
 */
async function onboardSelectedApplicant(applicantId, contractData, adminId, ipAddress) {
  const transaction = await db.sequelize.transaction();
  let applicationId = null;

  try {
    // First find the application for this applicant
    const application = await db.Application.findOne({
      where: {
        applicant_id: applicantId,
        is_deleted: false
        // status: 'SELECTED' // Temporarily removed for debugging
      },
      include: [
        {
          model: db.ApplicantMaster,
          as: 'applicant',
          include: [
            {
              model: db.ApplicantPersonal,
              as: 'personal'
            }
          ]
        },
        {
          model: db.PostMaster,
          as: 'post',
          required: false // Use LEFT JOIN
        },
        {
          model: db.DistrictMaster,
          as: 'district',
          required: false // Use LEFT JOIN
        }
      ],
      transaction
    });

    if (!application) {
      throw new ApiError(404, 'Application not found or not in SELECTED status');
    }

    applicationId = application.application_id; // Store for error logging

    if (!application.post) {
      throw new ApiError(400, 'Application must have an associated post');
    }

    // Check if employee already exists for this application
    const existingEmployee = await EmployeeMaster.findOne({
      where: { application_id: application.application_id, is_deleted: false },
      transaction
    });

    if (existingEmployee) {
      throw new ApiError(409, 'Employee record already exists for this application. This applicant has already been onboarded.');
    }

    // Determine component_id or hub_id from post
    const componentId = application.post?.component_id;
    const hubId = application.post?.hub_id;

    if (!componentId && !hubId) {
      throw new Error('Post must have either component_id or hub_id');
    }

    // Create employee record
    const employeeCode = await generateEmployeeCode();
    const employee = await EmployeeMaster.create({
      employee_code: employeeCode,
      applicant_id: application.applicant_id,
      application_id: application.application_id,
      post_id: application.post_id,
      district_id: application.district_id,
      component_id: componentId,
      hub_id: hubId,
      contract_start_date: parseDate(contractData.contract_start_date),
      contract_end_date: parseDate(contractData.contract_end_date) || null,
      onboarding_type: 'CRM_SELECTED',
      onboarding_status: 'ACTIVE',
      onboarding_completed_at: new Date(),
      is_active: true,
      created_by: adminId
    }, { transaction });

    // Update applicant master to mark as employee
    await db.ApplicantMaster.update(
      {
        is_employee: true,
        employee_id: employee.employee_id,
        updated_by: adminId
      },
      {
        where: { applicant_id: application.applicant_id },
        transaction
      }
    );

    // Log the onboarding action
    await EmployeeOnboardingLog.create({
      employee_id: employee.employee_id,
      action: 'CREATED_FROM_APPLICATION',
      details: {
        application_id: application.application_id,
        contract_start_date: contractData.contract_start_date,
        contract_end_date: contractData.contract_end_date,
        onboarded_by: 'ADMIN_CONFIRMATION'
      },
      performed_by: adminId,
      performed_at: new Date(),
      ip_address: ipAddress
    }, { transaction });

    await transaction.commit();

    logger.info('Successfully onboarded selected applicant', {
      employee_id: employee.employee_id,
      employee_code: employee.employee_code,
      application_id: application.application_id,
      applicant_id: application.applicant_id
    });

    // Fetch complete employee record with associations
    const completeEmployee = await EmployeeMaster.findByPk(employee.employee_id, {
      include: [
        {
          model: db.ApplicantMaster,
          as: 'applicant',
          include: [{ model: db.ApplicantPersonal, as: 'personal' }]
        },
        { model: db.PostMaster, as: 'post' },
        { model: db.DistrictMaster, as: 'district' },
        { model: db.Component, as: 'component' },
        { model: db.Hub, as: 'hub' }
      ]
    });

    return {
      success: true,
      employee: completeEmployee,
      employee_code: employeeCode,
      message: `Applicant successfully onboarded as employee with code ${employeeCode}`
    };
  } catch (error) {
    // Only rollback if transaction is still active
    if (transaction && !transaction.finished) {
      await transaction.rollback();
    }
    logger.error('Error onboarding selected applicant', {
      application_id: applicationId,
      applicant_id: applicantId,
      error: error.message
    });
    throw error;
  }
}

/**
 * Flow B: Create employee record for existing employee (manual/bulk import)
 * Creates both ApplicantMaster and EmployeeMaster records
 */
async function onboardExistingEmployee(employeeData, adminId, ipAddress) {
  const transaction = await db.sequelize.transaction();

  try {
    const {
      email,
      full_name,
      post_id,
      district_id,
      component_id,
      hub_id,
      contract_start_date,
      contract_end_date,
      employee_pay
    } = employeeData;

    // Validate required fields
    if (!email || !full_name || !post_id || !district_id) {
      throw ApiError.badRequest('Missing required fields: email, full_name, post_id, district_id');
    }

    if (!component_id && !hub_id) {
      throw ApiError.badRequest('Either component_id or hub_id must be provided');
    }

    // Check if email already exists in applicant table
    const existingApplicant = await db.ApplicantMaster.findOne({
      where: { email, is_deleted: false },
      transaction
    });

    if (existingApplicant) {
      throw ApiError.badRequest(`Email ${email} already exists in applicant records. Cannot Onboard.`);
    }

    // Use provided password or generate temporary password: User@123
    const password = employeeData.password || 'User@123';
    const passwordHash = await bcrypt.hash(password, getBcryptRounds());

    // Create new applicant record since none exists
    const applicant = await db.ApplicantMaster.create({
      email,
      password_hash: passwordHash,
      is_verified: true,
      is_employee: true,
      created_by: adminId,
      updated_by: adminId
    }, { transaction });

    applicantId = applicant.applicant_id;

    // Create applicant personal record with provided values
    await db.ApplicantPersonal.create({
      applicant_id: applicantId,
      full_name,
      dob: parseDate(employeeData.dob) || '1990-01-01', // Parse date or use default
      gender: employeeData.gender || 'Other', // Use provided gender or default
      domicile_maharashtra: true, // Default to true (not required from user)
      created_by: adminId
    }, { transaction });

    // Generate employee code
    const employee_code = await generateEmployeeCode();

    // Create employee record (only for new applicants)
    const employee = await EmployeeMaster.create({
      applicant_id: applicantId,
      application_id: null,
      employee_code, // Use generated employee code
      post_id,
      district_id,
      component_id: component_id || null,
      hub_id: hub_id || null,
      contract_start_date: parseDate(contract_start_date),
      contract_end_date: parseDate(contract_end_date) || null,
      employee_pay: employee_pay || null,
      onboarding_type: 'EXISTING_IMPORT',
      onboarding_status: 'PENDING',
      temp_password_hash: passwordHash,
      password_change_required: true,
      is_active: false,
      created_by: adminId
    }, { transaction });

    // Update applicant master to mark as employee
    await db.ApplicantMaster.update(
      {
        is_employee: true,
        employee_id: employee.employee_id,
        updated_by: adminId
      },
      {
        where: { applicant_id: applicantId },
        transaction
      }
    );

    // Log the onboarding action
    await EmployeeOnboardingLog.create({
      employee_id: employee.employee_id,
      action: 'CREATED_EXISTING_IMPORT',
      details: {
        email,
        full_name,
        import_type: 'MANUAL',
        temp_password_set: true
      },
      performed_by: adminId,
      performed_at: new Date(),
      ip_address: ipAddress
    }, { transaction });

    logger.info('Successfully created existing employee record', {
      employee_id: employee.employee_id,
      employee_code: employee.employee_code,
      email,
      applicant_id: applicantId
    });

    // Fetch complete employee record
    const completeEmployee = await EmployeeMaster.findByPk(employee.employee_id, {
      include: [
        {
          model: db.ApplicantMaster,
          as: 'applicant',
          include: [{ model: db.ApplicantPersonal, as: 'personal' }]
        },
        { model: db.PostMaster, as: 'post' },
        { model: db.DistrictMaster, as: 'district' },
        { model: db.Component, as: 'component' },
        { model: db.Hub, as: 'hub' }
      ]
    });

    await transaction.commit();

    return {
      success: true,
      employee: completeEmployee,
      tempPassword: password,
      message: 'Employee record created. Email can now be sent with credentials.'
    };
  } catch (error) {
    // Only rollback if transaction is still active
    if (transaction && !transaction.finished) {
      await transaction.rollback();
    }
    logger.error('Error onboarding existing employee', {
      email: employeeData.email,
      error: error.message
    });
    throw error;
  }
}

/**
 * Send onboarding email to existing employee (Flow B)
 */
async function sendEmployeeOnboardingEmail(employeeId, adminId, ipAddress, forceResend = false, customMessage = null) {
  try {
    const employee = await EmployeeMaster.findOne({
      where: {
        employee_id: employeeId,
        onboarding_type: 'EXISTING_IMPORT',
        is_deleted: false
      },
      include: [
        {
          model: db.ApplicantMaster,
          as: 'applicant',
          required: false,
          include: [
            { model: db.ApplicantPersonal, as: 'personal', required: false }
          ]
        },
        { 
          model: db.PostMaster, 
          as: 'post',
          attributes: ['post_id', 'post_name', 'post_code'],
          required: false
        },
        { 
          model: db.DistrictMaster, 
          as: 'district',
          attributes: ['district_id', 'district_name'],
          required: false
        },
        { 
          model: db.Component, 
          as: 'component',
          attributes: ['component_id', 'component_name'],
          required: false
        },
        { 
          model: db.Hub, 
          as: 'hub',
          attributes: ['hub_id', 'hub_name'],
          required: false
        }
      ]
    });

    if (!employee || !employee.applicant) {
      throw new Error('Employee not found or not eligible for email');
    }

    // Always send email - no check for already sent
    // This allows resending emails anytime

    // Update email sent status and change PENDING to ACTIVE
    await EmployeeMaster.update({
      onboarding_email_sent_at: new Date(),
      onboarding_email_sent_by: adminId,
      onboarding_status: 'ACTIVE',
      employment_status: 'ACTIVE',
      is_active: true
    }, {
      where: { employee_id: employeeId }
    });

    // Prepare email data
    const emailData = {
      email: employee.applicant.email,
      fullName: employee.applicant.personal?.full_name || 'Employee',
      tempPassword: 'User@123',
      employeeCode: employee.employee_code,
      postName: employee.post?.post_name || 'N/A',
      postCode: employee.post?.post_code || 'N/A',
      districtName: employee.district?.district_name || 'N/A',
      componentName: employee.component?.component_name || employee.hub?.hub_name || 'N/A',
      contractStartDate: employee.contract_start_date,
      loginUrl: process.env.APPLICANT_FRONTEND_URL + '/login',
      customMessage: customMessage || 'Welcome to the team!'
    };

    // Send email
    await sendOnboardingEmail(emailData);

    return {
      success: true,
      message: 'Onboarding email sent successfully',
      employee: {
        employee_id: employee.employee_id,
        employee_code: employee.employee_code,
        email: employee.applicant.email,
        already_sent: false
      }
    };
  } catch (error) {
    logger.error('Error sending onboarding email', {
      employee_id: employeeId,
      error: error.message
    });
    throw error;
  }
}

/**
 * Bulk import existing employees from Excel data
 */
async function bulkImportExistingEmployees(employeesData, adminId, ipAddress) {
  const results = {
    success: [],
    failed: []
  };

  for (const employeeData of employeesData) {
    try {
      const result = await onboardExistingEmployee(employeeData, adminId, ipAddress);
      
      if (result.action === 'updated') {
        results.success.push({
          email: employeeData.email,
          employee_code: result.employee.employee_code,
          employee_id: result.employee.employee_id,
          action: 'updated'
        });
      } else {
        results.success.push({
          email: employeeData.email,
          employee_code: result.employee.employee_code,
          employee_id: result.employee.employee_id,
          action: 'created'
        });
      }
    } catch (error) {
      results.failed.push({
        email: employeeData.email,
        error: error.message
      });
    }
  }

  logger.info('Bulk import completed', {
    total: employeesData.length,
    success: results.success.length,
    failed: results.failed.length
  });

  return results;
}

/**
 * Get list of selected applicants pending onboarding (for "Onboard from Applications" tab)
 */
async function getPendingSelectedApplicants(filters = {}) {
  const where = {
    status: 'SELECTED',
    is_deleted: false
  };

  // Apply filters
  if (filters.district_id) {
    where.district_id = filters.district_id;
  }

  if (filters.component_id || filters.hub_id) {
    where['$post.component_id$'] = filters.component_id || null;
    where['$post.hub_id$'] = filters.hub_id || null;
  }

  const page = filters.page || 1;
  const limit = filters.limit || 50;
  const offset = (page - 1) * limit;

  // Get total count first
  const totalApplications = await db.Application.count({
    where,
    include: [
      {
        model: db.PostMaster,
        as: 'post',
        attributes: { exclude: ['amount'] },
        include: [
          { model: db.Component, as: 'component' },
          { model: db.Hub, as: 'hub' }
        ]
      }
    ]
  });

  // Get paginated applications
  const applications = await db.Application.findAll({
    where,
    include: [
      {
        model: db.ApplicantMaster,
        as: 'applicant',
        include: [
          {
            model: db.ApplicantPersonal,
            as: 'personal'
          }
        ]
      },
      {
        model: db.PostMaster,
        as: 'post',
        attributes: { exclude: ['amount'] },
        include: [
          { model: db.Component, as: 'component' },
          { model: db.Hub, as: 'hub' }
        ]
      },
      {
        model: db.DistrictMaster,
        as: 'district'
      }
    ],
    order: [['created_at', 'DESC']],
    limit,
    offset
  });

  // Filter out those who already have employee records
  const applicationsWithoutEmployee = [];

  for (const app of applications) {
    const hasEmployee = await EmployeeMaster.findOne({
      where: {
        application_id: app.application_id,
        is_deleted: false
      }
    });

    if (!hasEmployee) {
      applicationsWithoutEmployee.push(app);
    }
  }

  return {
    applications: applicationsWithoutEmployee,
    total: totalApplications
  };
}

/**
 * Get list of onboarded applicants with filtering
 * Supports both Excel imports and modal form entries
 */
async function getOnboardedApplicants(filters = {}) {
  try {
    const {
      onboarding_type,
      email_sent,
      district_id,
      component_id,
      hub_id,
      page = 1,
      limit = 50
    } = filters;

    // Build where clause for EmployeeMaster
    const whereClause = {
      is_deleted: false
    };

    // Apply location filters
    if (district_id) whereClause.district_id = district_id;
    if (component_id) whereClause.component_id = component_id;
    if (hub_id) whereClause.hub_id = hub_id;

    // Apply onboarding_type filter if specified
    if (onboarding_type) {
      whereClause.onboarding_type = onboarding_type === 'excel_import' ? 'EXISTING_IMPORT' : onboarding_type;
    }

    const offset = (page - 1) * limit;

    // Get count without includes to avoid issues
    const count = await EmployeeMaster.count({
      where: whereClause
    });

    // Get rows with includes
    const rows = await EmployeeMaster.findAll({
      where: whereClause,
      include: [
        {
          model: EmployeeOnboardingLog,
          as: 'onboardingLogs',
          required: false, // Use LEFT JOIN to include employees without logs
        },
        {
          model: db.ApplicantMaster,
          as: 'applicant',
          attributes: ['applicant_id', 'email', 'mobile_no'],
          required: false, // Use LEFT JOIN for applicant
          include: [
            {
              model: db.ApplicantPersonal,
              as: 'personal',
              attributes: ['full_name', 'dob', 'gender'],
              required: false // Use LEFT JOIN for personal
            }
          ]
        },
        {
          model: db.PostMaster,
          as: 'post',
          attributes: ['post_id', 'post_name', 'post_code'],
          required: false // Use LEFT JOIN for post
        },
        {
          model: db.DistrictMaster,
          as: 'district',
          attributes: ['district_id', 'district_name'],
          required: false // Use LEFT JOIN for district
        },
        {
          model: db.Component,
          as: 'component',
          attributes: ['component_id', 'component_name'],
          required: false // Use LEFT JOIN for component
        },
        {
          model: db.Hub,
          as: 'hub',
          attributes: ['hub_id', 'hub_name'],
          required: false // Use LEFT JOIN for hub
        }
      ],
      limit,
      offset,
      order: [['created_at', 'DESC']]
    });

    // Format the response
    const applications = rows.map(employee => {
      // Determine onboarding type from logs or employee record
      const logs = employee.onboardingLogs || [];
      const createdLog = logs.find(log => log.action === 'CREATED');
      const emailLog = logs.find(log => log.action === 'EMAIL_SENT');
      const confirmedLog = logs.find(log => log.action === 'CONFIRMED');
      
      // Use onboarding_type from employee record if available, otherwise determine from logs
      let determinedType = employee.onboarding_type === 'EXISTING_IMPORT' ? 'excel_import' : 
                          employee.onboarding_type === 'CRM_SELECTED' ? 'flow_a' : 
                          employee.onboarding_type === 'FORM_ADDED' ? 'flow_b' : 'unknown';
      
      // Fallback to logs if onboarding_type is not set
      if (determinedType === 'unknown') {
        if (confirmedLog) {
          determinedType = 'flow_a'; // CRM selected
        } else if (emailLog) {
          determinedType = 'flow_b'; // Sent email
        } else if (createdLog) {
          determinedType = 'excel_import'; // Excel imported
        }
      }

      return {
        employee_id: employee.employee_id,
        employee_code: employee.employee_code,
        onboarding_type: determinedType,
        email_sent: !!emailLog,
        email_sent_at: emailLog ? emailLog.performed_at : null,
        completed_at: confirmedLog ? confirmedLog.performed_at : (createdLog ? createdLog.performed_at : null),
        status: employee.is_active ? 'active' : 'pending',
        created_at: employee.created_at,
        employee: {
          employee_id: employee.employee_id,
          employee_code: employee.employee_code,
          contract_start_date: employee.contract_start_date,
          contract_end_date: employee.contract_end_date,
          is_active: employee.is_active,
          applicant: employee.applicant,
          post: employee.post,
          district: employee.district,
          component: employee.component,
          hub: employee.hub
        }
      };
    });

    // Additional filtering if needed (for email_sent filter)
    let filteredApplications = applications;
    if (email_sent !== undefined) {
      filteredApplications = applications.filter(app => app.email_sent === email_sent);
    }

    return {
      applications: filteredApplications,
      total: filteredApplications.length
    };
  } catch (error) {
    logger.error('Error getting onboarded applicants:', error);
    throw error;
  }
}

/**
 * Send onboarding emails to multiple employees
 */
async function sendOnboardingEmails(employeeIds, customMessage, adminId, ipAddress, hrmScope = null, forceResend = false) {
  const results = {
    success: [],
    failed: []
  };

  for (const id of employeeIds) {
    try {
      if (!id) {
        results.failed.push({
          employee_id: id,
          error: 'Invalid ID provided'
        });
        continue;
      }

      // Find employee by applicant_id or employee_id
      let employee = await EmployeeMaster.findOne({
        where: { applicant_id: id, is_deleted: false }
      });
      
      if (!employee) {
        employee = await EmployeeMaster.findOne({
          where: { employee_id: id, is_deleted: false }
        });
      }
      
      if (!employee) {
        throw new Error('Employee not found');
      }

      const result = await sendEmployeeOnboardingEmail(employee.employee_id, adminId, ipAddress, forceResend, customMessage);
      results.success.push({
        employee_id: employee.employee_id,
        employee_code: result.employee.employee_code,
        email: result.employee.email,
        already_sent: false
      });
    } catch (error) {
      results.failed.push({
        employee_id: id,
        error: error.message
      });
    }
  }

  return results;
}

module.exports = {
  onboardSelectedApplicant,
  onboardExistingEmployee,
  sendEmployeeOnboardingEmail,
  sendOnboardingEmails,
  bulkImportExistingEmployees,
  getPendingSelectedApplicants,
  getOnboardedApplicants
};
