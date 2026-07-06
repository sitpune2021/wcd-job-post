/**
 * Leave Service
 * Handles leave applications, approvals, balances, and summaries
 * Enhanced with proper date/time handling, year-wise management, and safe queries
 */
const { Op, literal } = require('sequelize');
const sequelize = require('../../../config/db');
const logger = require('../../../config/logger');
const { ApiError } = require('../../../middleware/errorHandler');
const db = require('../../../models');
const { LeaveApplication, LeaveType, LeaveBalance, Attendance } = require('../models');
const EmployeeMaster = db.EmployeeMaster;
const DistrictMaster = require('../../../models/DistrictMaster');
const PostMaster = require('../../../models/PostMaster');
const ApplicantMaster = require('../../../models/ApplicantMaster');
const ApplicantPersonal = require('../../../models/ApplicantPersonal');
const { getEmployeeFromUser, buildHierarchyFilter, getEmployeeIdsUnderAdmin, calculateLeaveDays, getPagination, paginatedResponse } = require('../utils/hrmHelpers');
const { buildQueryOptions, buildResponse } = require('../utils/hrmFilterBuilder');

// Enhanced utilities for precise date/time handling and safe queries
const { getCurrentDate, getCurrentYear, validateYear, validateDateRange, isPastDate } = require('../utils/dateTimeHelpers');
const { safeQuery, safeLeaveOverlapCheck, safeUpdateLeaveBalance } = require('../utils/safeQueryHelpers');

/**
 * Ensure leave balances exist for an employee for the current year
 * Uses simple default days per year from leave type configuration
 */
const ensureLeaveBalances = async (employeeId, year) => {
  try {
    // Ensure year is a valid integer
    const yearInt = parseInt(year) || new Date().getFullYear();
    
    // Create unified balance record (11 days total across all leave types)
    const existing = await LeaveBalance.findOne({
      where: { employee_id: employeeId, leave_type_id: 1, year: yearInt }
    });
    
    if (!existing) {
      const defaultDays = parseInt(process.env.DEFAULT_LEAVE_DAYS) || 11;
      await LeaveBalance.create({
        employee_id: employeeId,
        leave_type_id: 1, // Use Casual Leave as default (leave_type_id 1 exists)
        year: yearInt,
        total_allocated: defaultDays,
        used: 0,
        remaining: defaultDays,
        created_by: employeeId
      });
      
      logger.info(`Unified leave balance created for employee ${employeeId}`, {
        year: yearInt,
        allocated: defaultDays
      });
    }
  } catch (error) {
    // If validation fails (e.g., leave_type_id cannot be null), log and continue
    logger.warn(`Failed to ensure leave balance for employee ${employeeId}:`, error.message);
    // Don't throw error - allow API to continue with no balance data
  }
};

/**
 * Get leave balances for the logged-in employee
 */
const getMyLeaveBalances = async (user) => {
  const employee = await getEmployeeFromUser(user, EmployeeMaster);
  if (!employee) throw new ApiError(404, 'Employee record not found.');

  const year = new Date().getFullYear();
  await ensureLeaveBalances(employee.employee_id, year);

  // Get unified balance record
  const unifiedBalance = await LeaveBalance.findOne({
    where: { employee_id: employee.employee_id, leave_type_id: 1, year, is_deleted: false }
  });

  // Get all leave types for display
  const leaveTypes = await LeaveType.findAll({
    where: { is_active: true, is_deleted: false },
    attributes: ['leave_type_id', 'leave_code', 'leave_name'],
    order: [['leave_code', 'ASC']]
  });

  // Create balance entries for each leave type using unified balance
  const balances = leaveTypes.map(lt => ({
    leave_balance_id: unifiedBalance?.balance_id || null,
    employee_id: employee.employee_id,
    leave_type_id: lt.leave_type_id,
    year: year,
    total_allocated: unifiedBalance?.total_allocated || 11,
    used: unifiedBalance?.used || 0,
    remaining: unifiedBalance?.remaining || 11,
    leaveType: lt
  }));

  return { year, balances };
};

/**
 * Apply for leave
 * Enhanced with proper date validation and safe overlap checking
 */
const applyLeave = async (user, data) => {
  const employee = await getEmployeeFromUser(user, EmployeeMaster);
  if (!employee) throw new ApiError(404, 'Employee record not found.');
  if (employee.employment_status !== 'ACTIVE') throw new ApiError(403, 'Only active employees can apply for leave.');

  // Validate leave type
  const leaveType = await LeaveType.findOne({
    where: { leave_type_id: data.leave_type_id, is_active: true, is_deleted: false }
  });
  if (!leaveType) throw new ApiError(400, 'Invalid leave type.');

  // Validate date range - cannot apply for past dates
  if (isPastDate(data.from_date)) {
    throw new ApiError(400, 'Cannot apply for leave on past dates.');
  }

  // Check if applying leave on a holiday
  const { safeHolidayCheck } = require('../utils/safeQueryHelpers');
  const start = new Date(data.from_date);
  const end = new Date(data.to_date);
  
  // Check each date in the range for holidays
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split('T')[0];
    const holiday = await safeHolidayCheck(dateStr);
    
    if (holiday) {
      throw new ApiError(400, `Cannot apply leave on ${d.toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} as it is a holiday: ${holiday.holiday_name}. Leave cannot be granted for holidays.`);
    }
  }

  // Calculate days (already excludes Sundays)
  const totalDays = await calculateLeaveDays(data.from_date, data.to_date, data.is_half_day);
  if (totalDays <= 0) {
    throw new ApiError(400, 'Invalid date range. Cannot apply leave only on non-working days.');
  }

  // Check balance using proper year extraction (for informational purposes only)
  const year = new Date(data.from_date).getFullYear();
  await ensureLeaveBalances(employee.employee_id, year);

  const balance = await LeaveBalance.findOne({
    where: { employee_id: employee.employee_id, leave_type_id: data.leave_type_id, year }
  });

  // Only check balance for paid leaves during application
  // Unpaid leaves can be applied regardless of balance
  // Balance will be checked during approval for paid leaves

  // Check for overlapping leaves using safe query
  const overlapCheck = await safeLeaveOverlapCheck(employee.employee_id, data.from_date, data.to_date);
  if (overlapCheck.hasOverlap) {
    const overlapDates = overlapCheck.overlappingLeaves.map(l => `${l.from_date} to ${l.to_date}`).join(', ');
    throw new ApiError(400, `You already have a leave application for overlapping dates: ${overlapDates}`);
  }

  const leave = await LeaveApplication.create({
    employee_id: employee.employee_id,
    leave_type_id: data.leave_type_id,
    from_date: data.from_date,
    to_date: data.to_date,
    total_days: totalDays,
    is_half_day: data.is_half_day || false,
    half_day_type: data.is_half_day ? data.half_day_type : null,
    reason: data.reason,
    supporting_document_path: data.supporting_document || null,
    status: 'PENDING',
    created_by: user.applicant_id || user.id
  });

  logger.info(`Leave applied: employee=${employee.employee_code}, type=${leaveType.leave_code}, days=${totalDays}, from=${data.from_date}, to=${data.to_date}`);

  // Add balance information to response
  const response = leave.toJSON();
  response.balance_info = {
    available: balance?.remaining || 0,
    requested: totalDays,
    will_be_paid: balance && balance.remaining >= totalDays,
    note: balance && balance.remaining < totalDays 
      ? `Insufficient balance. This leave will be marked as UNPAID if approved. Available: ${balance.remaining}, Requested: ${totalDays}`
      : balance && balance.remaining >= totalDays
      ? `Sufficient balance. This leave will be marked as PAID if approved. Available: ${balance.remaining}, Requested: ${totalDays}`
      : `No balance record found. This leave will be marked as UNPAID if approved.`
  };

  return response;
};

/**
 * Get my leaves (for the logged-in employee) with summary
 */
const getMyLeaves = async (user, query) => {
  const employee = await getEmployeeFromUser(user, EmployeeMaster);
  if (!employee) throw new ApiError(404, 'Employee record not found.');

  const { page, limit, offset } = getPagination(query);
  const where = { employee_id: employee.employee_id, is_deleted: false };

  // Apply filters - only status and year, no month filtering for cleaner approach
  if (query.status) where.status = query.status;
  
  if (query.year) {
    // Filter by year only
    where.from_date = { [Op.gte]: `${query.year}-01-01` };
    where.to_date = { [Op.lte]: `${query.year}-12-31` };
  } else {
    // Default to current year
    const currentYear = new Date().getFullYear();
    where.from_date = { [Op.gte]: `${currentYear}-01-01` };
    where.to_date = { [Op.lte]: `${currentYear}-12-31` };
  }

  // Get leave applications with pagination (separate operations to avoid aggregation error)
  const [count, rows] = await Promise.all([
    LeaveApplication.count({ where }),
    LeaveApplication.findAll({
      where,
      attributes: [
        'leave_id', 'employee_id', 'leave_type_id', 'from_date', 'to_date', 
        'total_days', 'is_half_day', 'half_day_type', 'reason', 
        'supporting_document_path', 'status', 'approved_by', 'approved_at', 
        'rejection_reason', 'is_paid', 'is_deleted', 'created_at', 'updated_at'
      ],
      include: [{ model: LeaveType, as: 'leaveType', attributes: ['leave_code', 'leave_name'], required: false }],
      order: [['created_at', 'DESC']],
      limit,
      offset
    })
  ]);

  // Get comprehensive summary (year-round, not filtered by month)
  const yearQuery = { ...query };
  delete yearQuery.month; // Remove month filter to show full year data
  const summary = await getLeaveSummary(employee.employee_id, yearQuery);

  // Return original response structure with added summary
  const originalResponse = paginatedResponse(rows, count, page, limit);
  originalResponse.summary = summary;
  
  return originalResponse;
};

/**
 * Get comprehensive leave summary
 */
const getLeaveSummary = async (employeeId, query) => {
  // Build summary where clause (same filters as main query but without pagination)
  const summaryWhere = { employee_id: employeeId, is_deleted: false };
  
  if (query.status) summaryWhere.status = query.status;
  
  if (query.year) {
    summaryWhere.from_date = { [Op.gte]: `${query.year}-01-01` };
    summaryWhere.to_date = { [Op.lte]: `${query.year}-12-31` };
  } else {
    // Default to current year
    const currentYear = new Date().getFullYear();
    summaryWhere.from_date = { [Op.gte]: `${currentYear}-01-01` };
    summaryWhere.to_date = { [Op.lte]: `${currentYear}-12-31` };
  }

  // Get leave applications for statistics (simplified approach)
  const leaveApplications = await LeaveApplication.findAll({
    where: summaryWhere,
    attributes: [
      'leave_id', 'employee_id', 'leave_type_id', 'from_date', 'to_date', 
      'total_days', 'is_half_day', 'half_day_type', 'reason', 
      'supporting_document_path', 'status', 'approved_by', 'approved_at', 
      'rejection_reason', 'is_paid', 'is_deleted', 'created_at', 'updated_at'
    ],
    include: [{ model: LeaveType, as: 'leaveType', attributes: ['leave_code', 'leave_name'], required: false }],
    order: [['created_at', 'DESC']]
  });

  // Calculate statistics manually
  const statsMap = new Map();
  leaveApplications.forEach(app => {
    const key = app.leave_type_id;
    if (!statsMap.has(key)) {
      statsMap.set(key, {
        leave_type_id: key,
        leave_type_name: app.leaveType?.leave_name || 'Unknown',
        total_applications: 0,
        total_days_used: 0,
        approved_days: 0,
        pending_days: 0,
        rejected_days: 0,
        cancelled_days: 0
      });
    }
    
    const stats = statsMap.get(key);
    stats.total_applications += 1;
    stats.total_days_used += app.total_days || 0;
    
    if (app.status === 'APPROVED') {
      stats.approved_days += app.total_days || 0;
    } else if (app.status === 'PENDING') {
      stats.pending_days += app.total_days || 0;
    } else if (app.status === 'REJECTED') {
      stats.rejected_days += app.total_days || 0;
    } else if (app.status === 'CANCELLED') {
      stats.cancelled_days += app.total_days || 0;
    }
  });

  const leaveStats = Array.from(statsMap.values());

  // Get current year unified balance
  const currentYear = new Date().getFullYear();
  const year = parseInt(query.year) || currentYear;
  
  await ensureLeaveBalances(employeeId, year);
  const unifiedBalance = await LeaveBalance.findOne({
    where: { employee_id: employeeId, year, leave_type_id: 1, is_deleted: false },
    include: [{ model: LeaveType, as: 'leaveType', attributes: ['leave_code', 'leave_name'], required: false }]
  });

  // Calculate simple counts directly from leave applications
  const approvedApplications = leaveApplications.filter(app => app.status === 'APPROVED').length;
  const rejectedApplications = leaveApplications.filter(app => app.status === 'REJECTED').length;
  const pendingApplications = leaveApplications.filter(app => app.status === 'PENDING').length;
  const totalApplications = leaveApplications.length;

  // Calculate total allowed, used, and remaining days (use defaults if no balance exists)
  const defaultDays = parseInt(process.env.DEFAULT_LEAVE_DAYS) || 11;
  const totalAllowedDays = unifiedBalance ? parseFloat(unifiedBalance.total_allocated || defaultDays) : defaultDays;
  const totalUsedDays = unifiedBalance ? parseFloat(unifiedBalance.used || 0) : 0;
  const totalRemainingDays = unifiedBalance ? parseFloat(unifiedBalance.remaining || (totalAllowedDays - totalUsedDays)) : (totalAllowedDays - totalUsedDays);

  // Build simplified summary object
  const summary = {
    leave_summary: {
      total_allowed_days: totalAllowedDays,
      total_used_days: totalUsedDays,
      total_remaining_days: totalRemainingDays
    },
    application_counts: {
      total_applied: totalApplications,
      approved: approvedApplications,
      rejected: rejectedApplications,
      pending: pendingApplications
    },
    days_summary: {
      approved_days: leaveStats.reduce((sum, stat) => sum + parseFloat(stat.approved_days || 0), 0),
      pending_days: leaveStats.reduce((sum, stat) => sum + parseFloat(stat.pending_days || 0), 0)
    }
  };

  return summary;
};

/**
 * Cancel a pending leave application
 */
const cancelLeave = async (user, leaveId) => {
  const employee = await getEmployeeFromUser(user, EmployeeMaster);
  if (!employee) throw new ApiError(404, 'Employee record not found.');

  const leave = await LeaveApplication.findOne({
    where: { leave_id: leaveId, employee_id: employee.employee_id, is_deleted: false }
  });
  if (!leave) throw new ApiError(404, 'Leave application not found.');
  if (leave.status !== 'PENDING') throw new ApiError(400, 'Only pending leaves can be cancelled.');

  leave.status = 'CANCELLED';
  leave.updated_by = user.applicant_id || user.id;
  leave.updated_at = new Date();
  await leave.save();

  logger.info(`Leave cancelled: leave_id=${leaveId}, employee=${employee.employee_code}`);
  return leave;
};

/**
 * Get leave approvals (admin - pending leaves from employees under jurisdiction)
 */
const getLeaveApprovals = async (adminUser, query) => {
  const employeeIds = await getEmployeeIdsUnderAdmin(adminUser, EmployeeMaster);

  if (employeeIds.length === 0) {
    return buildResponse({ rows: [], count: 0 }, query, {
      message: 'No employees found under your jurisdiction'
    });
  }

  // Build standardized query options with search and pagination
  const queryOptions = buildQueryOptions(query, {
    baseWhere: {
      employee_id: { [Op.in]: employeeIds },
      status: query.status || 'PENDING' // Default to pending
    },
    searchFields: [
      '$employee.employee_code$',
      '$employee.applicant.personal.full_name$',
      '$employee.district.district_name$',
      '$leaveType.leave_name$',
      'reason',
      'rejection_reason'
    ],
    filterableFields: {
      leave_type_id: {
        transform: (value) => parseInt(value),
        validate: (value) => !isNaN(value) && value > 0
      },
      is_half_day: {
        transform: (value) => value === 'true',
        validate: (value) => typeof value === 'boolean'
      },
      approved_by: {
        transform: (value) => parseInt(value),
        validate: (value) => !isNaN(value) && value > 0
      }
    },
    sortableFields: ['created_at', 'from_date', 'to_date', 'status', 'total_days'],
    defaultSort: [['created_at', 'DESC']],
    dateField: 'from_date',
    include: [
      { 
        model: LeaveType, 
        as: 'leaveType', 
        attributes: ['leave_code', 'leave_name'], 
        required: false 
      },
      {
        model: EmployeeMaster, 
        as: 'employee',
        attributes: ['employee_id', 'employee_code', 'district_id', 'applicant_id'],
        include: [
          {
            model: db.DistrictMaster,
            as: 'district',
            attributes: ['district_name'],
            required: false
          },
          {
            model: db.ApplicantMaster,
            as: 'applicant',
            attributes: ['applicant_id'],
            include: [
              {
                model: db.ApplicantPersonal,
                as: 'personal',
                attributes: ['full_name'],
                required: false
              }
            ],
            required: false
          }
        ],
        required: false
      }
    ]
  });

  const { count, rows } = await LeaveApplication.findAndCountAll(queryOptions);

  // Process rows to handle null employee names and include leave balance
  const processedRows = await Promise.all(rows.map(async (leave) => {
    const leaveData = leave.toJSON ? leave.toJSON() : leave;
    
    // Safely extract employee name with fallbacks
    let employeeName = null;
    if (leaveData.employee) {
      if (leaveData.employee.applicant && leaveData.employee.applicant.personal) {
        employeeName = leaveData.employee.applicant.personal.full_name;
      }
      // Fallback to employee code if name is null/empty
      if (!employeeName) {
        employeeName = leaveData.employee.employee_code;
      }
    }
    
    // Fetch unified leave balance for this employee
    let leaveBalance = null;
    try {
      const year = new Date(leaveData.from_date).getFullYear();
      
      // Ensure leave balance exists for this employee
      await ensureLeaveBalances(leaveData.employee_id, year);
      
      const balance = await LeaveBalance.findOne({
        where: { 
          employee_id: leaveData.employee_id, 
          leave_type_id: 1, // Use Casual Leave balance
          year 
        }
      });
      
      if (balance) {
        leaveBalance = {
          total_allocated: balance.total_allocated,
          used: balance.used,
          remaining: balance.remaining,
          can_be_paid: balance.remaining >= parseFloat(leaveData.total_days || 0)
        };
      } else {
        // Fallback default balance if no record exists
        const defaultDays = parseInt(process.env.DEFAULT_LEAVE_DAYS) || 11;
        leaveBalance = {
          total_allocated: defaultDays,
          used: 0,
          remaining: defaultDays,
          can_be_paid: defaultDays >= parseFloat(leaveData.total_days || 0)
        };
      }
    } catch (err) {
      logger.warn('Failed to fetch leave balance for approval:', err.message);
    }
    
    // Return flattened data with employee name and balance info
    return {
      ...leaveData,
      employee_name: employeeName || 'Unknown',
      leave_balance: leaveBalance
    };
  }));

  // Build standardized response
  return buildResponse({ rows: processedRows, count }, query, {
    message: 'Leave approvals retrieved successfully'
  });
};

/**
 * Approve or reject a leave application (admin action)
 */
const actionLeave = async (adminUser, leaveId, data) => {
  const leave = await LeaveApplication.findOne({
    where: { leave_id: leaveId, is_deleted: false },
    include: [{ model: EmployeeMaster, as: 'employee', attributes: ['employee_id', 'employee_code', 'district_id', 'scheme_id'], required: false }]
  });
  if (!leave) throw new ApiError(404, 'Leave application not found.');
  if (leave.status !== 'PENDING') throw new ApiError(400, 'Only pending leaves can be acted upon.');

  // Check admin has jurisdiction over this employee
  const employeeIds = await getEmployeeIdsUnderAdmin(adminUser, EmployeeMaster);
  if (!employeeIds.includes(leave.employee_id)) {
    throw new ApiError(403, 'You do not have permission to manage this employee.');
  }

  const t = await sequelize.transaction();
  try {
    leave.status = data.status;
    leave.approved_by = adminUser.admin_id;
    leave.approved_at = new Date();
    if (data.status === 'REJECTED') {
      leave.rejection_reason = data.rejection_reason || null;
    }
    leave.updated_by = adminUser.admin_id;
    leave.updated_at = new Date();

    // If approved, determine paid/unpaid status
    if (data.status === 'APPROVED') {
      const year = new Date(leave.from_date).getFullYear();
      
      // Get unified leave balance to enforce paid/unpaid rules
      const balance = await LeaveBalance.findOne({
        where: { employee_id: leave.employee_id, leave_type_id: 1, year },
        transaction: t
      });

      let isPaid = data.is_paid;

      // If balance is 0 or insufficient, force unpaid regardless of admin choice
      if (!balance || balance.remaining <= 0) {
        isPaid = false;
        logger.info(`Leave forced to UNPAID: employee=${leave.employee_id}, balance exhausted (remaining=${balance?.remaining || 0})`);
      } else if (balance.remaining < leave.total_days && isPaid) {
        // Not enough balance for full paid leave - force unpaid
        isPaid = false;
        logger.info(`Leave forced to UNPAID: employee=${leave.employee_id}, insufficient balance (remaining=${balance.remaining}, requested=${leave.total_days})`);
      }

      leave.is_paid = isPaid;

      // Only decrement balance if leave is PAID
      if (isPaid) {
        await LeaveBalance.update(
          {
            used: literal(`used + ${leave.total_days}`),
            remaining: literal(`remaining - ${leave.total_days}`),
            updated_at: new Date()
          },
          {
            where: { employee_id: leave.employee_id, year },
            transaction: t
          }
        );
        logger.info(`Leave balance decremented: employee=${leave.employee_id}, days=${leave.total_days}, type=PAID`);
      } else {
        logger.info(`Leave balance NOT decremented: employee=${leave.employee_id}, days=${leave.total_days}, type=UNPAID`);
      }

      // Mark attendance as ON_LEAVE for leave dates
      const start = new Date(leave.from_date);
      const end = new Date(leave.to_date);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        if (d.getDay() === 0) continue; // Skip Sundays
        const dateStr = d.toISOString().split('T')[0];
        
        const leaveRemark = isPaid 
          ? `Paid Leave: ${leave.reason}` 
          : `Unpaid Leave: ${leave.reason}`;
        
        // Update existing attendance record or create new one
        const [attendance, created] = await Attendance.findOrCreate({
          where: { employee_id: leave.employee_id, attendance_date: dateStr },
          defaults: {
            employee_id: leave.employee_id,
            attendance_date: dateStr,
            status: leave.is_half_day ? 'HALF_DAY' : 'ON_LEAVE',
            half_day_type: leave.is_half_day ? leave.half_day_type : null,
            remarks: leaveRemark,
            created_by: adminUser.admin_id
          },
          transaction: t
        });
        
        // If record already existed, update it to reflect leave status
        if (!created) {
          await attendance.update({
            status: leave.is_half_day ? 'HALF_DAY' : 'ON_LEAVE',
            half_day_type: leave.is_half_day ? leave.half_day_type : null,
            remarks: `${leaveRemark} (Updated from ${attendance.status})`,
            updated_by: adminUser.admin_id,
            updated_at: new Date()
          }, { transaction: t });
        }
      }
    }

    await leave.save({ transaction: t });
    await t.commit();
    logger.info(`Leave ${data.status}: leave_id=${leaveId}, is_paid=${leave.is_paid}, by admin=${adminUser.admin_id}`);
    return leave;
  } catch (error) {
    await t.rollback();
    throw error;
  }
};

/**
 * Get leave summary (admin view - per-employee breakdown)
 */
const getAdminLeaveSummary = async (adminUser, query) => {
  const employeeIds = await getEmployeeIdsUnderAdmin(adminUser, EmployeeMaster);

  if (employeeIds.length === 0) {
    return buildResponse({ rows: [], count: 0 }, query, {
      message: 'No employees found under your jurisdiction'
    });
  }

  const now = new Date();
  const month = parseInt(query.month) || (now.getMonth() + 1);
  const year = parseInt(query.year) || now.getFullYear();

  // Get leave types
  const leaveTypes = await LeaveType.findAll({
    where: { is_active: true },
    attributes: ['leave_type_id', 'leave_code', 'leave_name']
  });

  // Get employees with robust error handling
  let employees = [];
  let count = 0;
  
  try {
    // Try complex query first
    const employeeQueryOptions = buildQueryOptions(query, {
      baseWhere: {
        employee_id: { [Op.in]: employeeIds }
      },
      searchFields: [
        'employee_code',
        '$applicant.email$',
        '$applicant.personal.full_name$'
      ],
      filterableFields: {
        district_id: {
          transform: (value) => parseInt(value),
          validate: (value) => !isNaN(value) && value > 0
        },
        scheme_type_id: {
          transform: (value) => parseInt(value),
          validate: (value) => !isNaN(value) && value > 0
        },
        scheme_id: {
          transform: (value) => parseInt(value),
          validate: (value) => !isNaN(value) && value > 0
        },
        post_id: {
          transform: (value) => parseInt(value),
          validate: (value) => !isNaN(value) && value > 0
        }
      },
      sortableFields: ['employee_code', 'employment_status'],
      defaultSort: [['employee_id', 'DESC']],
      include: [
        {
          model: DistrictMaster,
          as: 'district',
          attributes: ['district_name'],
          required: false
        },
        {
          model: PostMaster,
          as: 'post',
          attributes: ['post_name'],
          required: false
        },
        {
          model: ApplicantMaster,
          as: 'applicant',
          attributes: ['applicant_id', 'mobile_no'],
          include: [
            {
              model: ApplicantPersonal,
              as: 'personal',
              attributes: ['full_name'],
              required: false
            }
          ],
          required: false
        }
      ]
    });

    const result = await EmployeeMaster.findAndCountAll(employeeQueryOptions);
    employees = result.rows;
    count = result.count;
  } catch (complexError) {
    logger.warn('Complex employee query failed, trying simpler approach:', complexError.message);
    
    try {
      // Fallback: try with just district
      const simpleQueryOptions = buildQueryOptions(query, {
        baseWhere: {
          employee_id: { [Op.in]: employeeIds }
        },
        searchFields: ['employee_code', '$applicant.email$', '$applicant.personal.full_name$'],
        filterableFields: {
          district_id: {
            transform: (value) => parseInt(value),
            validate: (value) => !isNaN(value) && value > 0
          }
        },
        sortableFields: ['employee_code', 'employment_status'],
        defaultSort: [['employee_id', 'DESC']],
        include: [
          {
            model: DistrictMaster,
            as: 'district',
            attributes: ['district_name'],
            required: false
          },
          {
            model: ApplicantMaster,
            as: 'applicant',
            attributes: ['applicant_id', 'mobile_no'],
            include: [
              {
                model: ApplicantPersonal,
                as: 'personal',
                attributes: ['full_name'],
                required: false
              }
            ],
            required: false
          }
        ]
      });

      const result = await EmployeeMaster.findAndCountAll(simpleQueryOptions);
      employees = result.rows;
      count = result.count;
    } catch (simpleError) {
      logger.warn('Simple employee query failed, using basic query:', simpleError.message);
      
      // Final fallback: basic query
      const basicQueryOptions = buildQueryOptions(query, {
        baseWhere: {
          employee_id: { [Op.in]: employeeIds }
        },
        searchFields: ['employee_code'],
        sortableFields: ['employee_code', 'employment_status'],
        defaultSort: [['employee_code', 'ASC']]
      });

      const result = await EmployeeMaster.findAndCountAll(basicQueryOptions);
      employees = result.rows;
      count = result.count;
    }
  }

  // Get leave balances for all employees in this year
  const leaveBalances = await LeaveBalance.findAll({
    where: {
      employee_id: { [Op.in]: employees.map(emp => emp.employee_id) },
      year: year
    },
    include: [
      {
        model: LeaveType,
        as: 'leaveType',
        attributes: ['leave_code', 'leave_name'],
        required: false
      }
    ]
  });

  // Get leave applications for the specified month/year (for usage calculation)
  const startDate = new Date(year, month - 1, 1).toISOString().split('T')[0];
  const endDate = new Date(year, month, 0).toISOString().split('T')[0];

  const leaveApplications = await LeaveApplication.findAll({
    where: {
      employee_id: { [Op.in]: employees.map(emp => emp.employee_id) },
      [Op.or]: [
        {
          from_date: { [Op.gte]: startDate },
          to_date: { [Op.lte]: endDate }
        },
        {
          from_date: { [Op.lte]: endDate },
          to_date: { [Op.gte]: startDate }
        }
      ]
    },
    include: [
      {
        model: LeaveType,
        as: 'leaveType',
        attributes: ['leave_code', 'leave_name'],
        required: false
      }
    ]
  });

  // Get all applications for status counts (year-round)
  const allApplications = await LeaveApplication.findAll({
    where: {
      employee_id: { [Op.in]: employees.map(emp => emp.employee_id) },
      [Op.and]: [
        {
          from_date: { [Op.gte]: new Date(year, 0, 1).toISOString().split('T')[0] },
          to_date: { [Op.lte]: new Date(year, 11, 31).toISOString().split('T')[0] }
        }
      ]
    },
    include: [
      {
        model: LeaveType,
        as: 'leaveType',
        attributes: ['leave_code', 'leave_name'],
        required: false
      }
    ]
  });

  // Process employee data with leave information
  const processedEmployees = await Promise.all(employees.map(async (emp) => {
    const employeeBalances = leaveBalances.filter(lb => lb.employee_id === emp.employee_id);
    const employeeApplications = leaveApplications.filter(la => la.employee_id === emp.employee_id);
    const employeeAllApplications = allApplications.filter(la => la.employee_id === emp.employee_id);

    // Calculate leave usage by type
    const leaveUsage = {};
    let totalUsedDays = 0;

    leaveTypes.forEach(type => {
      const applications = employeeApplications.filter(app => app.leave_type_id === type.leave_type_id);
      const usedDays = applications.reduce((sum, app) => sum + parseFloat(app.total_days || 0), 0);
      leaveUsage[type.leave_code] = usedDays;
      totalUsedDays += usedDays;
    });

    // Simplified leave balance: 11 days total across all types
    let totalAllocated = 11; // Default from environment variable
    let totalUsed = 0;
    let totalRemaining = 11;
    
    // Get the first balance record (they all have the same allocation now)
    const firstBalance = employeeBalances[0];
    if (firstBalance) {
      totalAllocated = parseFloat(firstBalance.total_allocated || 11);
      totalUsed = parseFloat(firstBalance.used || 0);
      totalRemaining = parseFloat(firstBalance.remaining || totalAllocated);
    }
    
    // Build unified leave balances (use database balance consistently)
    const leaveBalancesByType = {};
    leaveTypes.forEach(type => {
      leaveBalancesByType[type.leave_code] = {
        allocated: totalAllocated,
        used: totalUsed, // Use the unified database value
        balance: totalRemaining // Use the unified database value
      };
    });

    // Safely extract employee information with proper fallbacks
    let fullName = emp.applicant?.personal?.full_name || emp.employee_code;
    let mobileNumber = emp.applicant?.mobile_no || null;
    let districtName = emp.district?.district_name || 'N/A';
    let postName = emp.post?.post_name || 'N/A';

    // Debug: Log what we're getting
    if (!emp.applicant?.personal?.full_name) {
      logger.warn('Employee missing personal data:', {
        employee_id: emp.employee_id,
        applicant_id: emp.applicant_id,
        hasApplicant: !!emp.applicant,
        hasPersonal: !!emp.applicant?.personal
      });
    }

    // Additional fallback: try to fetch missing data individually
    if (!emp.applicant?.personal?.full_name && emp.applicant_id) {
      try {
        const applicant = await db.ApplicantMaster.findOne({
          where: { applicant_id: emp.applicant_id },
          attributes: ['mobile_no'],
          include: [
            {
              model: db.ApplicantPersonal,
              as: 'personal',
              attributes: ['full_name'],
              required: false
            }
          ]
        });
        if (applicant?.personal?.full_name) {
          fullName = applicant.personal.full_name;
          mobileNumber = applicant.mobile_no;
        }
      } catch (error) {
        logger.warn('Failed to fetch applicant personal data:', error.message);
      }
    }

    if (!emp.district?.district_name && emp.district_id) {
      try {
        const district = await db.DistrictMaster.findOne({
          where: { district_id: emp.district_id },
          attributes: ['district_name']
        });
        if (district?.district_name) {
          districtName = district.district_name;
        }
      } catch (error) {
        logger.warn('Failed to fetch district data:', error.message);
      }
    }

    if (!emp.post?.post_name && emp.post_id) {
      try {
        const post = await db.PostMaster.findOne({
          where: { post_id: emp.post_id },
          attributes: ['post_name']
        });
        if (post?.post_name) {
          postName = post.post_name;
        }
      } catch (error) {
        logger.warn('Failed to fetch post data:', error.message);
      }
    }

    return {
      employee_id: emp.employee_id,
      employee_code: emp.employee_code,
      full_name: fullName,
      mobile_number: mobileNumber,
      district_name: districtName,
      post_name: postName,
      employment_status: emp.employment_status,
      leave_usage: leaveUsage,
      leave_balances: leaveBalancesByType,
      total_used_days: totalUsed,
      applications_count: employeeAllApplications.length,
      pending_count: employeeAllApplications.filter(app => app.status === 'PENDING').length,
      approved_count: employeeAllApplications.filter(app => app.status === 'APPROVED').length,
      rejected_count: employeeAllApplications.filter(app => app.status === 'REJECTED').length
    };
  }));

  // Build summary statistics
  const summary = {
    total_employees: employees.length,
    total_leave_applications: leaveApplications.length,
    pending_applications: leaveApplications.filter(app => app.status === 'PENDING').length,
    approved_applications: leaveApplications.filter(app => app.status === 'APPROVED').length,
    rejected_applications: leaveApplications.filter(app => app.status === 'REJECTED').length,
    cancelled_applications: leaveApplications.filter(app => app.status === 'CANCELLED').length,
    leave_types_summary: leaveTypes.map(type => {
      const typeApplications = leaveApplications.filter(app => app.leave_type_id === type.leave_type_id);
      return {
        leave_type_id: type.leave_type_id,
        leave_code: type.leave_code,
        leave_name: type.leave_name,
        applications_count: typeApplications.length,
        total_days_used: typeApplications.reduce((sum, app) => sum + parseFloat(app.total_days || 0), 0)
      };
    })
  };

  // Build standardized response
  return buildResponse({ rows: processedEmployees, count }, query, {
    message: 'Leave summary retrieved successfully',
    summary: {
      ...summary,
      leave_types: leaveTypes.map(type => ({
        leave_type_id: type.leave_type_id,
        leave_code: type.leave_code,
        leave_name: type.leave_name
      }))
    }
  });
};

/**
 * Get all leave types
 */
const getLeaveTypes = async () => {
  return LeaveType.findAll({
    where: { is_active: true, is_deleted: false },
    order: [['leave_type_id', 'ASC']]
  });
};

module.exports = {
  getMyLeaveBalances,
  applyLeave,
  getMyLeaves,
  cancelLeave,
  getLeaveApprovals,
  actionLeave,
  getAdminLeaveSummary,
  getLeaveTypes
};
