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
  // Ensure year is a valid integer
  const yearInt = parseInt(year) || new Date().getFullYear();
  
  const leaveTypes = await LeaveType.findAll({
    where: { is_active: true, is_deleted: false }
  });

  for (const lt of leaveTypes) {
    const existing = await LeaveBalance.findOne({
      where: { employee_id: employeeId, leave_type_id: lt.leave_type_id, year: yearInt }
    });
    
    if (!existing) {
      await LeaveBalance.create({
        employee_id: employeeId,
        leave_type_id: lt.leave_type_id,
        year: yearInt,
        total_allocated: lt.default_days_per_year,
        used: 0,
        remaining: lt.default_days_per_year,
        created_by: employeeId
      });
      
      logger.info(`Leave balance created for employee ${employeeId}`, {
        leaveType: lt.leave_code,
        year: yearInt,
        allocated: lt.default_days_per_year
      });
    }
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

  const balances = await LeaveBalance.findAll({
    where: { employee_id: employee.employee_id, year, is_deleted: false },
    include: [{ model: LeaveType, as: 'leaveType', attributes: ['leave_code', 'leave_name'], required: false }],
    order: [['leave_type_id', 'ASC']]
  });

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

  // Check balance using proper year extraction
  const year = new Date(data.from_date).getFullYear();
  await ensureLeaveBalances(employee.employee_id, year);

  const balance = await LeaveBalance.findOne({
    where: { employee_id: employee.employee_id, leave_type_id: data.leave_type_id, year }
  });

  if (!balance || balance.remaining < totalDays) {
    throw new ApiError(400, `Insufficient ${leaveType.leave_name} balance. Available: ${balance?.remaining || 0}, Requested: ${totalDays}`);
  }

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
  return leave;
};

/**
 * Get my leaves (for the logged-in employee) with summary
 */
const getMyLeaves = async (user, query) => {
  const employee = await getEmployeeFromUser(user, EmployeeMaster);
  if (!employee) throw new ApiError(404, 'Employee record not found.');

  const { page, limit, offset } = getPagination(query);
  const where = { employee_id: employee.employee_id, is_deleted: false };

  // Apply filters
  if (query.status) where.status = query.status;
  
  if (query.year && query.month) {
    // Filter by specific year and month
    const monthStr = query.month.toString().padStart(2, '0');
    const startDate = `${query.year}-${monthStr}-01`;
    // Get last day of month properly
    const lastDay = new Date(query.year, query.month, 0).getDate();
    const endDate = `${query.year}-${monthStr}-${lastDay.toString().padStart(2, '0')}`;
    where.from_date = { [Op.between]: [startDate, endDate] };
  } else if (query.year) {
    // Filter by year only
    where.from_date = { [Op.gte]: `${query.year}-01-01` };
    where.to_date = { [Op.lte]: `${query.year}-12-31` };
  } else if (query.month) {
    // Filter by month across all years - use date range approach for better compatibility
    const currentYear = new Date().getFullYear();
    const monthStr = query.month.toString().padStart(2, '0');
    const startDate = `${currentYear}-${monthStr}-01`;
    // Get last day of month properly
    const lastDay = new Date(currentYear, query.month, 0).getDate();
    const endDate = `${currentYear}-${monthStr}-${lastDay.toString().padStart(2, '0')}`;
    where.from_date = { [Op.between]: [startDate, endDate] };
  }

  // Get leave applications with pagination (separate operations to avoid aggregation error)
  const [count, rows] = await Promise.all([
    LeaveApplication.count({ where }),
    LeaveApplication.findAll({
      where,
      include: [{ model: LeaveType, as: 'leaveType', attributes: ['leave_code', 'leave_name'], required: false }],
      order: [['created_at', 'DESC']],
      limit,
      offset
    })
  ]);

  // Get comprehensive summary
  const summary = await getLeaveSummary(employee.employee_id, query);

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
  
  if (query.year && query.month) {
    const monthStr = query.month.toString().padStart(2, '0');
    const startDate = `${query.year}-${monthStr}-01`;
    // Get last day of month properly
    const lastDay = new Date(query.year, query.month, 0).getDate();
    const endDate = `${query.year}-${monthStr}-${lastDay.toString().padStart(2, '0')}`;
    summaryWhere.from_date = { [Op.between]: [startDate, endDate] };
  } else if (query.year) {
    summaryWhere.from_date = { [Op.gte]: `${query.year}-01-01` };
    summaryWhere.to_date = { [Op.lte]: `${query.year}-12-31` };
  } else if (query.month) {
    // Filter by month across all years - use date range approach for better compatibility
    const currentYear = new Date().getFullYear();
    const monthStr = query.month.toString().padStart(2, '0');
    const startDate = `${currentYear}-${monthStr}-01`;
    // Get last day of month properly
    const lastDay = new Date(currentYear, query.month, 0).getDate();
    const endDate = `${currentYear}-${monthStr}-${lastDay.toString().padStart(2, '0')}`;
    summaryWhere.from_date = { [Op.between]: [startDate, endDate] };
  }

  // Get leave applications for statistics (simplified approach)
  const leaveApplications = await LeaveApplication.findAll({
    where: summaryWhere,
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

  // Get current year balances
  const currentYear = new Date().getFullYear();
  const year = parseInt(query.year) || currentYear;
  
  await ensureLeaveBalances(employeeId, year);
  const balances = await LeaveBalance.findAll({
    where: { employee_id: employeeId, year, is_deleted: false },
    include: [{ model: LeaveType, as: 'leaveType', attributes: ['leave_code', 'leave_name'], required: false }],
    order: [['leave_type_id', 'ASC']]
  });

  // Calculate simple counts directly from leave applications
  const approvedApplications = leaveApplications.filter(app => app.status === 'APPROVED').length;
  const rejectedApplications = leaveApplications.filter(app => app.status === 'REJECTED').length;
  const pendingApplications = leaveApplications.filter(app => app.status === 'PENDING').length;
  const totalApplications = leaveApplications.length;

  // Calculate total allowed, used, and remaining days
  const totalAllowedDays = balances.reduce((sum, b) => sum + parseFloat(b.allocated || 0), 0);
  const totalUsedDays = leaveStats.reduce((sum, stat) => sum + parseFloat(stat.total_days_used || 0), 0);
  const totalRemainingDays = totalAllowedDays - totalUsedDays;

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
      'employee.employee_code',
      'employee.applicant.personal.full_name',
      'district.district_name',
      'leaveType.leave_name',
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

  // Process rows to handle null employee names safely
  const processedRows = rows.map(leave => {
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
    
    // Return flattened data with employee name directly
    return {
      ...leaveData,
      employee_name: employeeName || 'Unknown'
    };
  });

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
    include: [{ model: EmployeeMaster, as: 'employee', attributes: ['employee_id', 'employee_code', 'district_id', 'component_id', 'hub_id'], required: false }]
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
    await leave.save({ transaction: t });

    // If approved, update leave balance and mark attendance as ON_LEAVE
    if (data.status === 'APPROVED') {
      const year = new Date(leave.from_date).getFullYear();
      await LeaveBalance.update(
        {
          used: literal(`used + ${leave.total_days}`),
          remaining: literal(`remaining - ${leave.total_days}`),
          updated_at: new Date()
        },
        {
          where: { employee_id: leave.employee_id, leave_type_id: leave.leave_type_id, year },
          transaction: t
        }
      );

      // Mark attendance as ON_LEAVE for leave dates
      const start = new Date(leave.from_date);
      const end = new Date(leave.to_date);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        if (d.getDay() === 0) continue; // Skip Sundays
        const dateStr = d.toISOString().split('T')[0];
        await Attendance.findOrCreate({
          where: { employee_id: leave.employee_id, attendance_date: dateStr },
          defaults: {
            employee_id: leave.employee_id,
            attendance_date: dateStr,
            status: leave.is_half_day ? 'HALF_DAY' : 'ON_LEAVE',
            half_day_type: leave.is_half_day ? leave.half_day_type : null,
            remarks: `Leave: ${leave.reason}`,
            created_by: adminUser.admin_id
          },
          transaction: t
        });
      }
    }

    await t.commit();
    logger.info(`Leave ${data.status}: leave_id=${leaveId}, by admin=${adminUser.admin_id}`);
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
        'applicant.personal.full_name',
        'district.district_name',
        'post.post_name'
      ],
      filterableFields: {
        district_id: {
          transform: (value) => parseInt(value),
          validate: (value) => !isNaN(value) && value > 0
        },
        post_id: {
          transform: (value) => parseInt(value),
          validate: (value) => !isNaN(value) && value > 0
        }
      },
      sortableFields: ['employee_code', 'employment_status'],
      defaultSort: [['employee_code', 'ASC']],
      include: [
        {
          model: db.DistrictMaster,
          as: 'district',
          attributes: ['district_name'],
          required: false
        },
        {
          model: db.PostMaster,
          as: 'post',
          attributes: ['post_name'],
          required: false
        },
        {
          model: db.ApplicantMaster,
          as: 'applicant',
          attributes: ['applicant_id', 'mobile_no'],
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
      ]
    });

    const result = await EmployeeMaster.findAndCountAll(employeeQueryOptions);
    employees = result.rows;
    count = result.count;
  } catch (complexError) {
    console.warn('Complex employee query failed, trying simpler approach:', complexError.message);
    
    try {
      // Fallback: try with just district
      const simpleQueryOptions = buildQueryOptions(query, {
        baseWhere: {
          employee_id: { [Op.in]: employeeIds }
        },
        searchFields: ['employee_code', 'district.district_name'],
        filterableFields: {
          district_id: {
            transform: (value) => parseInt(value),
            validate: (value) => !isNaN(value) && value > 0
          }
        },
        sortableFields: ['employee_code', 'employment_status'],
        defaultSort: [['employee_code', 'ASC']],
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
            attributes: ['applicant_id', 'mobile_no'],
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
        ]
      });

      const result = await EmployeeMaster.findAndCountAll(simpleQueryOptions);
      employees = result.rows;
      count = result.count;
    } catch (simpleError) {
      console.warn('Simple employee query failed, using basic query:', simpleError.message);
      
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

  // Get leave applications for the specified month/year
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

  // Process employee data with leave information
  const processedEmployees = await Promise.all(employees.map(async (emp) => {
    const employeeBalances = leaveBalances.filter(lb => lb.employee_id === emp.employee_id);
    const employeeApplications = leaveApplications.filter(la => la.employee_id === emp.employee_id);

    // Calculate leave usage by type
    const leaveUsage = {};
    let totalUsedDays = 0;

    leaveTypes.forEach(type => {
      const applications = employeeApplications.filter(app => app.leave_type_id === type.leave_type_id);
      const usedDays = applications.reduce((sum, app) => sum + parseFloat(app.total_days || 0), 0);
      leaveUsage[type.leave_code] = usedDays;
      totalUsedDays += usedDays;
    });

    // Build leave balances by type
    const leaveBalancesByType = {};
    leaveTypes.forEach(type => {
      const balance = employeeBalances.find(lb => lb.leave_type_id === type.leave_type_id);
      if (balance) {
        leaveBalancesByType[balance.leaveType.leave_code] = {
          allocated: parseFloat(balance.total_allocated || 0),
          used: parseFloat(balance.used || 0),
          balance: parseFloat(balance.remaining || 0)
        };
      }
    });

    // Safely extract employee information with proper fallbacks
    let fullName = emp.applicant?.personal?.full_name || emp.employee_code;
    let mobileNumber = emp.applicant?.mobile_no || null;
    let districtName = emp.district?.district_name || 'N/A';
    let postName = emp.post?.post_name || 'N/A';

    // Debug: Log what we're getting
    if (!emp.applicant?.personal?.full_name) {
      console.warn('Employee missing personal data:', {
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
        console.warn('Failed to fetch applicant personal data:', error.message);
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
        console.warn('Failed to fetch district data:', error.message);
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
        console.warn('Failed to fetch post data:', error.message);
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
      total_used_days: totalUsedDays,
      applications_count: employeeApplications.length,
      pending_count: employeeApplications.filter(app => app.status === 'PENDING').length,
      approved_count: employeeApplications.filter(app => app.status === 'APPROVED').length,
      rejected_count: employeeApplications.filter(app => app.status === 'REJECTED').length
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
      month,
      year,
      leave_types: leaveTypes
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
