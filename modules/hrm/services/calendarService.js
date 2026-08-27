/**
 * Calendar Service
 * Industry-standard government HRM calendar management
 * Provides unified view of attendance, holidays, leaves, and Sundays
 * Enhanced with proper year-wise management and safe queries
 */
const { Op } = require('sequelize');
const logger = require('../../../config/logger');
const { ApiError } = require('../../../middleware/errorHandler');
const db = require('../../../models');
const { Attendance, Holiday, LeaveApplication, LeaveType } = require('../models');
const WeeklyOffClaim = db.HrmWeeklyOffClaim;
const EmployeeMaster = db.EmployeeMaster;
const { getEmployeeFromUser } = require('../utils/hrmHelpers');
const { getWorkingDaysInMonth } = require('../utils/workingDayHelpers');

// Enhanced utilities for precise date/time handling
const { getCurrentDate, validateYear, isWeekend } = require('../utils/dateTimeHelpers');
const { safeQuery } = require('../utils/safeQueryHelpers');

const normalizeIds = (values) => Array.from(new Set(
  (Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0)
));

const buildScopedSchemeWhere = (adminUser, extraWhere = {}) => {
  const filters = adminUser?.hrm_scope_filters || adminUser?.dataValues?.hrm_scope_filters || {};
  const where = { is_deleted: false, ...extraWhere };

  if (filters.block_all) {
    where.scheme_id = { [Op.in]: [] };
    return where;
  }
  if (Array.isArray(filters.scheme_ids) && filters.scheme_ids.length > 0) {
    where.scheme_id = { [Op.in]: filters.scheme_ids };
  }
  if (Array.isArray(filters.district_ids) && filters.district_ids.length > 0) {
    where.district_id = { [Op.in]: filters.district_ids };
  } else if (filters.district_id) {
    where.district_id = filters.district_id;
  }
  if (Array.isArray(filters.scheme_type_ids) && filters.scheme_type_ids.length > 0) {
    where.scheme_type_id = { [Op.in]: filters.scheme_type_ids };
  } else if (filters.scheme_type_id) {
    where.scheme_type_id = filters.scheme_type_id;
  }

  return where;
};

const assertHolidayScopeAllowed = async (adminUser, holiday) => {
  if (!adminUser) return;

  const filters = adminUser.hrm_scope_filters || adminUser.dataValues?.hrm_scope_filters || {};
  if (filters.block_all) {
    throw new ApiError(403, 'Holiday scope is outside your CHRMS access scope');
  }

  const restrictedSchemeIds = normalizeIds([
    ...(Array.isArray(filters.scheme_ids) ? filters.scheme_ids : []),
    filters.scheme_id
  ]);
  const restrictedSchemeTypeIds = normalizeIds([
    ...(Array.isArray(filters.scheme_type_ids) ? filters.scheme_type_ids : []),
    filters.scheme_type_id
  ]);
  const restrictedDistrictIds = normalizeIds([
    ...(Array.isArray(filters.district_ids) ? filters.district_ids : []),
    filters.district_id
  ]);

  if (restrictedSchemeIds.length > 0) {
    if (!holiday.scheme_id || !restrictedSchemeIds.includes(Number(holiday.scheme_id))) {
      throw new ApiError(403, 'Holiday scope is outside your assigned scheme access');
    }
  }
  if (restrictedSchemeTypeIds.length > 0 && !restrictedSchemeTypeIds.includes(Number(holiday.scheme_type_id))) {
    throw new ApiError(403, 'Holiday scope is outside your assigned scheme type access');
  }
  if (restrictedDistrictIds.length > 0 && !holiday.district_id) {
    throw new ApiError(403, 'District is required for your holiday calendar access scope');
  }
  if (restrictedDistrictIds.length > 0 && !restrictedDistrictIds.includes(Number(holiday.district_id))) {
    throw new ApiError(403, 'Holiday scope is outside your assigned district access');
  }

  if (holiday.scheme_id) {
    const schemeWhere = buildScopedSchemeWhere(adminUser, { is_active: true, scheme_id: holiday.scheme_id });
    const exists = await db.Scheme.count({ where: schemeWhere });
    if (!exists) {
      throw new ApiError(403, 'Holiday scope is outside your CHRMS access scope');
    }
  }
};

/**
 * Get comprehensive calendar for an employee
 * Shows all days with their status: PRESENT, ABSENT, SUNDAY, HOLIDAY, ON_LEAVE
 * Enhanced with proper date handling and accurate status calculation
 */
const getEmployeeCalendar = async (user, query) => {
  const employee = await getEmployeeFromUser(user, EmployeeMaster);
  if (!employee) {
    throw new ApiError(404, 'Employee record not found.');
  }

  const { month, year } = query;
  
  // Use standardized date utilities for year validation
  const currentYear = year ? validateYear(year) : new Date().getFullYear();
  const currentMonth = month ? parseInt(month) : new Date().getMonth() + 1;

  // Validate month
  if (currentMonth < 1 || currentMonth > 12) {
    throw new ApiError(400, 'Invalid month. Must be between 1 and 12.');
  }

  // Calculate date range
  const startDate = new Date(currentYear, currentMonth - 1, 1);
  const endDate = new Date(currentYear, currentMonth, 0);
  const totalDays = endDate.getDate();
  const employeeScheme = employee.scheme_id
    ? await db.Scheme.findOne({
      where: { scheme_id: employee.scheme_id, is_deleted: false },
      attributes: ['scheme_id', 'district_id', 'scheme_type_id'],
      raw: true
    })
    : null;
  const holidayScope = {
    [Op.or]: [
      { scheme_id: null, scheme_type_id: null, district_id: null }
    ]
  };
  if (employeeScheme?.scheme_id) holidayScope[Op.or].push({ scheme_id: employeeScheme.scheme_id });
  if (employeeScheme?.scheme_type_id) holidayScope[Op.or].push({ scheme_type_id: employeeScheme.scheme_type_id, scheme_id: null });
  if (employeeScheme?.district_id) holidayScope[Op.or].push({ district_id: employeeScheme.district_id, scheme_id: null });

  // Fetch all relevant data for the month
  const [attendanceRecords, holidays, approvedLeaves, weeklyOffs] = await Promise.all([
    // Get attendance records
    Attendance.findAll({
      where: {
        employee_id: employee.employee_id,
        attendance_date: {
          [Op.between]: [
            startDate.toISOString().split('T')[0],
            endDate.toISOString().split('T')[0]
          ]
        },
        is_deleted: false
      },
      order: [['attendance_date', 'ASC']]
    }),

    // Get holidays for this year
    Holiday.findAll({
      where: {
        holiday_date: {
          [Op.between]: [
            startDate.toISOString().split('T')[0],
            endDate.toISOString().split('T')[0]
          ]
        },
        is_active: true,
        is_deleted: false,
        ...holidayScope
      }
    }),

    // Get approved leaves
    LeaveApplication.findAll({
      where: {
        employee_id: employee.employee_id,
        status: 'APPROVED',
        [Op.or]: [
          {
            from_date: {
              [Op.between]: [
                startDate.toISOString().split('T')[0],
                endDate.toISOString().split('T')[0]
              ]
            }
          },
          {
            to_date: {
              [Op.between]: [
                startDate.toISOString().split('T')[0],
                endDate.toISOString().split('T')[0]
              ]
            }
          },
          {
            [Op.and]: [
              { from_date: { [Op.lte]: startDate.toISOString().split('T')[0] } },
              { to_date: { [Op.gte]: endDate.toISOString().split('T')[0] } }
            ]
          }
        ],
        is_deleted: false
      },
      include: [
        {
          model: LeaveType,
          as: 'leaveType',
          attributes: ['leave_name', 'leave_code']
        }
      ]
    }),
    // Get approved weekly offs
    WeeklyOffClaim.findAll({
      where: {
        employee_id: employee.employee_id,
        claim_status: 'APPROVED',
        claimed_off_date: {
          [Op.between]: [
            startDate.toISOString().split('T')[0],
            endDate.toISOString().split('T')[0]
          ]
        }
      }
    })
  ]);

  // Create lookup maps for quick access
  const attendanceMap = new Map();
  let presentCount = 0;
  let halfDayCount = 0;
  let onLeaveCount = 0;
  let holidayStatusCount = 0;

  attendanceRecords.forEach(record => {
    attendanceMap.set(record.attendance_date, record);
    switch (record.status) {
      case 'PRESENT':
        presentCount += 1;
        break;
      case 'HALF_DAY':
        halfDayCount += 1;
        break;
      case 'ON_LEAVE':
        onLeaveCount += 1;
        break;
      case 'HOLIDAY':
        holidayStatusCount += 1;
        break;
      default:
        break;
    }
  });

  const holidayMap = new Map();
  holidays.forEach(holiday => {
    holidayMap.set(holiday.holiday_date, holiday);
  });

  // Create leave date set
  const leaveDates = new Set();
  const leaveDetailsMap = new Map();
  approvedLeaves.forEach(leave => {
    const fromDate = new Date(leave.from_date);
    const toDate = new Date(leave.to_date);
    
    for (let d = new Date(fromDate); d <= toDate; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0];
      // Only add if within current month
      if (d >= startDate && d <= endDate) {
        leaveDates.add(dateStr);
        leaveDetailsMap.set(dateStr, {
          leave_id: leave.leave_id,
          leave_type: leave.leaveType?.leave_name || 'Leave',
          is_half_day: leave.is_half_day,
          half_day_type: leave.half_day_type
        });
      }
    }
  });

  // Create weekly off date set
  const weeklyOffDates = new Set();
  const weeklyOffDetailsMap = new Map();
  weeklyOffs.forEach(weeklyOff => {
    const dateStr = weeklyOff.claimed_off_date;
    weeklyOffDates.add(dateStr);
    weeklyOffDetailsMap.set(dateStr, {
      claim_id: weeklyOff.claim_id,
      claim_status: weeklyOff.claim_status,
      approved_at: weeklyOff.approved_at,
      approved_by: weeklyOff.approved_by
    });
  });

  // Get working days using the same method as admin attendance summary
  const workingDaysResult = await getWorkingDaysInMonth(currentMonth, currentYear);
  const workingDays = workingDaysResult.workingDays;

  // Build calendar days
  const days = [];
  let holidayCount = 0;
  let sundayCount = 0;
  let weeklyOffCount = 0;

  // Use IST date for today to avoid UTC offset causing wrong day in is_past comparison
  const today = new Date(getCurrentDate());

  for (let day = 1; day <= totalDays; day++) {
    const currentDate = new Date(currentYear, currentMonth - 1, day);
    const dateStr = currentDate.toISOString().split('T')[0];
    const dayOfWeek = currentDate.getDay();
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    let dayStatus = 'NOT_MARKED';
    let isWorkingDay = true;
    let details = null;

    // Status precedence matters:
    // 1. Approved weekly off / leave are explicit HRM records and should be shown as-is.
    // 2. Marked attendance should override generic Sunday/holiday labels.
    // 3. Because ABSENT rows are no longer persisted, past unmarked working days
    //    are inferred as ABSENT below.
    
    // Check if on approved weekly off
    if (weeklyOffDates.has(dateStr)) {
      dayStatus = 'WEEKLY_OFF';
      isWorkingDay = false;
      weeklyOffCount++;
      details = weeklyOffDetailsMap.get(dateStr);
    }
    // Check if on approved leave
    else if (leaveDates.has(dateStr)) {
      dayStatus = 'ON_LEAVE';
      isWorkingDay = false;
      details = leaveDetailsMap.get(dateStr);
    }
    // Check attendance record (only if no weekly off or leave)
    else if (attendanceMap.has(dateStr)) {
      const attendance = attendanceMap.get(dateStr);
      dayStatus = attendance.status;
      
      details = {
        check_in_time: attendance.check_in_time,
        half_day_type: attendance.half_day_type,
        device_type: attendance.device_type,
        remarks: attendance.remarks
      };
      
      // Mark special day context if attendance exists
      if (holidayMap.has(dateStr)) {
        const holiday = holidayMap.get(dateStr);
        details.holiday_name = holiday.holiday_name;
        details.holiday_type = holiday.holiday_type;
        details.is_holiday_with_attendance = true;
        holidayCount++;
      } else if (dayOfWeek === 0) {
        details.is_sunday_with_attendance = true;
        sundayCount++;
      }
    }
    // Check if it's a holiday (only if no attendance)
    else if (holidayMap.has(dateStr)) {
      const holiday = holidayMap.get(dateStr);
      dayStatus = 'HOLIDAY';
      isWorkingDay = false;
      holidayCount++;
      details = {
        holiday_name: holiday.holiday_name,
        holiday_type: holiday.holiday_type,
        description: holiday.description
      };
    }
    // Check if it's Sunday (only if no attendance)
    else if (dayOfWeek === 0) {
      dayStatus = 'SUNDAY';
      isWorkingDay = false;
      sundayCount++;
    }
    // No record for a working day in the past (excludes today) - only within contract period
    else if (currentDate < today && isWorkingDay) {
      // Check if date is within contract period
      const isWithinContract = (!employee.contract_start_date || dateStr >= employee.contract_start_date) &&
                               (!employee.contract_end_date || dateStr <= employee.contract_end_date);
      
      if (isWithinContract) {
        dayStatus = 'ABSENT';
      } else {
        // Outside contract period - don't count as absent
        dayStatus = 'NOT_MARKED';
        isWorkingDay = false; // Don't count as working day for attendance calculation
      }
    }

    
    days.push({
      date: dateStr,
      day: day,
      day_of_week: dayOfWeek,
      day_name: dayNames[dayOfWeek],
      status: dayStatus,
      is_working_day: isWorkingDay,
      is_past: currentDate < today,
      is_today: dateStr === getCurrentDate(),
      details: details
    });
  }

  const halfDayDays = halfDayCount * 0.5;
  // Count actual absent records from attendance data
  let absentCount = 0;
  attendanceRecords.forEach(record => {
    if (record.status === 'ABSENT') {
      absentCount += 1;
    }
  });
  
  const absentDays = absentCount;
  const attendancePercentage = workingDays > 0 
    ? Math.round(((presentCount + halfDayDays) / workingDays) * 100) 
    : 0;

  return {
    employee: {
      employee_id: employee.employee_id,
      employee_code: employee.employee_code,
      full_name: employee.applicant?.full_name || 'N/A'
    },
    calendar: {
      month: currentMonth,
      year: currentYear,
      total_days: totalDays,
      working_days: workingDays,
      days: days
    },
    summary: {
      present_days: presentCount,
      absent_days: absentDays,
      leave_days: onLeaveCount,
      half_days: halfDayCount,
      half_day_days: halfDayDays,
      holidays: holidayCount,
      sundays: sundayCount,
      weekly_off_days: weeklyOffCount,
      attendance_percentage: attendancePercentage
    }
  };
};

/**
 * Get holidays for a specific year/month (Admin view)
 * Enhanced with proper year validation
 */
const getHolidaysByYear = async (year, month, filters = {}, adminUser = null) => {
  // Validate year using enhanced utility
  const validatedYear = year ? validateYear(year) : new Date().getFullYear();
  
  const whereClause = {
    is_active: true,
    is_deleted: false
  };

  // Filter by year
  if (validatedYear) {
    whereClause.year = validatedYear;
  }

  // Add month filter if provided using date range
  if (month) {
    const startDate = new Date(validatedYear, month - 1, 1);
    const endDate = new Date(validatedYear, month, 0);
    whereClause.holiday_date = {
      [Op.between]: [
        startDate.toISOString().split('T')[0],
        endDate.toISOString().split('T')[0]
      ]
    };
  }

  if (filters.district_id) {
    whereClause.district_id = filters.district_id;
  }
  if (filters.scheme_type_id) {
    whereClause.scheme_type_id = filters.scheme_type_id;
  }
  if (filters.scheme_id) {
    whereClause.scheme_id = filters.scheme_id;
  }

  if (adminUser) {
    const scopedSchemes = await db.Scheme.findAll({
      where: buildScopedSchemeWhere(adminUser, { is_active: true }),
      attributes: ['scheme_id', 'district_id', 'scheme_type_id'],
      raw: true
    });
    const visibleSchemeIds = normalizeIds(scopedSchemes.map((scheme) => scheme.scheme_id));
    const visibleDistrictIds = normalizeIds(scopedSchemes.map((scheme) => scheme.district_id));
    const visibleSchemeTypeIds = normalizeIds(scopedSchemes.map((scheme) => scheme.scheme_type_id));

    if (visibleSchemeIds.length === 0) {
      whereClause.holiday_id = { [Op.in]: [] };
    } else {
      whereClause[Op.and] = [
        ...(whereClause[Op.and] || []),
        {
          [Op.or]: [
            { scheme_id: null, scheme_type_id: null, district_id: null },
            { scheme_id: { [Op.in]: visibleSchemeIds } },
            { scheme_type_id: { [Op.in]: visibleSchemeTypeIds } },
            { district_id: { [Op.in]: visibleDistrictIds } }
          ]
        }
      ];
    }
  }

  const holidays = await Holiday.findAll({
    where: whereClause,
    include: [
      { model: db.DistrictMaster, as: 'district', attributes: ['district_name'], required: false },
      { model: db.SchemeType, as: 'schemeType', attributes: ['scheme_code', 'scheme_name'], required: false },
      { model: db.Scheme, as: 'scheme', attributes: ['scheme_code', 'scheme_name'], required: false }
    ],
    order: [['holiday_date', 'ASC']]
  });

  return holidays;
};

/**
 * Add/Update holidays for a year (Admin only)
 * Enhanced with proper year validation for any year management
 */
const manageHolidays = async (adminUser, data) => {
  const { year, holidays } = data;

  if (!year || !holidays || !Array.isArray(holidays)) {
    throw new ApiError(400, 'Year and holidays array are required');
  }

  // Validate year using enhanced utility (allows any year between 2020-2030)
  const validatedYear = validateYear(year);

  const results = {
    created: 0,
    updated: 0,
    errors: []
  };

  for (const holiday of holidays) {
    try {
      const { date, name, type, description, district_id, scheme_type_id, scheme_id } = holiday;

      if (!date || !name || !scheme_type_id) {
        results.errors.push({ date, error: 'Date, name, and scheme type are required', fullHoliday: holiday });
        continue;
      }

      await assertHolidayScopeAllowed(adminUser, {
        district_id: district_id || null,
        scheme_type_id,
        scheme_id: scheme_id || null
      });

      // Scope is part of identity: each scheme type/scheme can have its own calendar.
      const anyHoliday = await Holiday.findOne({
        where: {
          holiday_date: date,
          year: validatedYear,
          district_id: district_id || null,
          scheme_type_id,
          scheme_id: scheme_id || null
        }
      });

      if (anyHoliday) {
        if (anyHoliday.is_deleted) {
          // Reactivate the deleted holiday instead of creating new one
          await anyHoliday.update({
            holiday_name: name,
            holiday_type: type || 'NATIONAL',
            description: description || null,
            district_id: district_id || null,
            scheme_type_id,
            scheme_id: scheme_id || null,
            is_active: true,
            is_deleted: false,
            updated_by: adminUser.admin_id
          });
          results.updated++; // Count as update since we're reactivating
        } else {
          // Update existing active holiday
          await anyHoliday.update({
            holiday_name: name,
            holiday_type: type || anyHoliday.holiday_type,
            description: description || anyHoliday.description,
            district_id: district_id || null,
            scheme_type_id,
            scheme_id: scheme_id || null,
            updated_by: adminUser.admin_id
          });
          results.updated++;
        }
      } else {
        // Create completely new holiday
        await Holiday.create({
          holiday_date: date,
          holiday_name: name,
          year: validatedYear,
          holiday_type: type || 'NATIONAL',
          description: description || null,
          district_id: district_id || null,
          scheme_type_id,
          scheme_id: scheme_id || null,
          is_active: true,
          is_deleted: false,
          created_by: adminUser.admin_id
        });
        results.created++;
      }
    } catch (error) {
      results.errors.push({ 
        date: holiday?.date || 'unknown', 
        error: error.message,
        fullHoliday: holiday,
        errorType: error.constructor.name
      });
    }
  }

  logger.info(`Holidays managed for year ${validatedYear}`, {
    adminId: adminUser.admin_id,
    created: results.created,
    updated: results.updated,
    errors: results.errors.length,
    errorDetails: results.errors.length > 0 ? results.errors : null
  });

  if (results.errors.length > 0 && results.created === 0 && results.updated === 0) {
    throw new ApiError(400, results.errors[0].error || 'Holiday could not be saved');
  }

  return results;
};

/**
 * Delete a holiday with year validation
 * Enhanced with proper year validation
 */
const deleteHoliday = async (adminUser, holidayId, year) => {
  // Validate year using enhanced utility
  const validatedYear = validateYear(year);
  
  const holiday = await Holiday.findByPk(holidayId);
  
  if (!holiday) {
    throw new ApiError(404, 'Holiday not found');
  }

  // Validate year matches
  if (holiday.year !== validatedYear) {
    throw new ApiError(400, 'Holiday year mismatch');
  }

  await assertHolidayScopeAllowed(adminUser, holiday);

  await holiday.update({
    is_deleted: true,
    updated_by: adminUser.admin_id
  });

  logger.info(`Holiday deleted`, {
    adminId: adminUser.admin_id,
    holidayId: holidayId,
    holidayName: holiday.holiday_name,
    year: year
  });

  return { message: 'Holiday deleted successfully' };
};

module.exports = {
  getEmployeeCalendar,
  getHolidaysByYear,
  manageHolidays,
  deleteHoliday
};
