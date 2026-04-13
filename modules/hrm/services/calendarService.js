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
const EmployeeMaster = db.EmployeeMaster;
const { getEmployeeFromUser } = require('../utils/hrmHelpers');

// Enhanced utilities for precise date/time handling
const { getCurrentDate, validateYear, isWeekend } = require('../utils/dateTimeHelpers');
const { safeQuery } = require('../utils/safeQueryHelpers');

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

  // Fetch all relevant data for the month
  const [attendanceRecords, holidays, approvedLeaves] = await Promise.all([
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
        year: currentYear,
        holiday_date: {
          [Op.between]: [
            startDate.toISOString().split('T')[0],
            endDate.toISOString().split('T')[0]
          ]
        },
        is_active: true,
        is_deleted: false
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
    })
  ]);

  // Create lookup maps for quick access
  const attendanceMap = new Map();
  attendanceRecords.forEach(record => {
    attendanceMap.set(record.attendance_date, record);
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

  // Build calendar days
  const days = [];
  let workingDays = 0;
  let presentDays = 0;
  let absentDays = 0;
  let leaveDaysCount = 0;
  let holidayCount = 0;
  let sundayCount = 0;

  // Get today's date at midnight for accurate comparison
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let day = 1; day <= totalDays; day++) {
    const currentDate = new Date(currentYear, currentMonth - 1, day);
    const dateStr = currentDate.toISOString().split('T')[0];
    const dayOfWeek = currentDate.getDay();
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    let dayStatus = 'NOT_MARKED';
    let isWorkingDay = true;
    let details = null;

    // Priority order: Holiday > Sunday > Leave > Attendance
    
    // Check if it's a holiday
    if (holidayMap.has(dateStr)) {
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
    // Check if it's Sunday
    else if (dayOfWeek === 0) {
      dayStatus = 'SUNDAY';
      isWorkingDay = false;
      sundayCount++;
    }
    // Check if on approved leave
    else if (leaveDates.has(dateStr)) {
      dayStatus = 'ON_LEAVE';
      isWorkingDay = false;
      leaveDaysCount++;
      details = leaveDetailsMap.get(dateStr);
    }
    // Check attendance record
    else if (attendanceMap.has(dateStr)) {
      const attendance = attendanceMap.get(dateStr);
      dayStatus = attendance.status;
      
      if (attendance.status === 'PRESENT') {
        presentDays++;
      } else if (attendance.status === 'ABSENT') {
        absentDays++;
      } else if (attendance.status === 'HALF_DAY') {
        presentDays += 0.5;
      }
      
      details = {
        check_in_time: attendance.check_in_time,
        half_day_type: attendance.half_day_type,
        device_type: attendance.device_type,
        remarks: attendance.remarks
      };
    }
    // No record for a working day in the past (excludes today)
    else if (currentDate < today && isWorkingDay) {
      dayStatus = 'ABSENT';
      absentDays++;
    }

    // Count working days (exclude Sundays and holidays)
    if (isWorkingDay) {
      workingDays++;
    }

    days.push({
      date: dateStr,
      day: day,
      day_of_week: dayOfWeek,
      day_name: dayNames[dayOfWeek],
      status: dayStatus,
      is_working_day: isWorkingDay,
      is_past: currentDate < today,
      is_today: dateStr === new Date().toISOString().split('T')[0],
      details: details
    });
  }

  // Calculate attendance percentage
  const attendancePercentage = workingDays > 0 
    ? Math.round((presentDays / workingDays) * 100) 
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
      present_days: presentDays,
      absent_days: absentDays,
      leave_days: leaveDaysCount,
      holidays: holidayCount,
      sundays: sundayCount,
      attendance_percentage: attendancePercentage
    }
  };
};

/**
 * Get holidays for a specific year/month (Admin view)
 * Enhanced with proper year validation
 */
const getHolidaysByYear = async (year, month) => {
  // Validate year using enhanced utility
  const validatedYear = year ? validateYear(year) : new Date().getFullYear();
  
  const whereClause = {
    year: validatedYear,
    is_deleted: false
  };

  // Add month filter if provided
  if (month) {
    whereClause[db.Sequelize.Op.and] = db.Sequelize.where(
      db.Sequelize.fn('EXTRACT', db.Sequelize.literal('MONTH FROM holiday_date')),
      month
    );
  }

  const holidays = await Holiday.findAll({
    where: whereClause,
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
      const { date, name, type, description } = holiday;

      if (!date || !name) {
        results.errors.push({ date, error: 'Date and name are required', fullHoliday: holiday });
        continue;
      }

      // Check if holiday already exists for this date and year (including deleted ones)
      const anyHoliday = await Holiday.findOne({
        where: {
          holiday_date: date,
          year: validatedYear
        }
      });

      if (anyHoliday) {
        if (anyHoliday.is_deleted) {
          // Reactivate the deleted holiday instead of creating new one
          await anyHoliday.update({
            holiday_name: name,
            holiday_type: type || 'NATIONAL',
            description: description || null,
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
