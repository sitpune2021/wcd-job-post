/**
 * Working Day Helpers
 * Validates working days for attendance and leave operations
 * Handles holidays, weekends, and business rules
 */

const { ApiError } = require('../../../middleware/errorHandler');
const { isWeekend, validateAndNormalizeDate } = require('./dateTimeHelpers');
const { safeHolidayCheck, safeLeaveCheck } = require('./safeQueryHelpers');
const logger = require('../../../config/logger');

/**
 * Check if a date is a working day
 * @param {string} dateString - Date in YYYY-MM-DD format
 * @param {number} employeeId - Employee ID (for leave checking)
 * @returns {Promise<Object>} Working day validation result
 */
const isWorkingDay = async (dateString, employeeId = null) => {
  try {
    const normalizedDate = validateAndNormalizeDate(dateString);
    
    // Check if it's Sunday
    if (isWeekend(normalizedDate)) {
      return {
        isWorkingDay: false,
        reason: 'WEEKEND',
        message: 'Sunday is not a working day',
        date: normalizedDate
      };
    }
    
    // Check if it's a holiday
    const holiday = await safeHolidayCheck(normalizedDate);
    if (holiday) {
      return {
        isWorkingDay: false,
        reason: 'HOLIDAY',
        message: `Holiday: ${holiday.holiday_name}`,
        holiday,
        date: normalizedDate
      };
    }
    
    // Check if employee is on approved leave (if employee ID provided)
    if (employeeId) {
      const leave = await safeLeaveCheck(employeeId, normalizedDate);
      if (leave) {
        return {
          isWorkingDay: false,
          reason: 'ON_LEAVE',
          message: `On approved leave: ${leave.leaveType?.leave_name || 'Leave'}`,
          leave,
          date: normalizedDate
        };
      }
    }
    
    return {
      isWorkingDay: true,
      reason: 'WORKING_DAY',
      message: 'Working day',
      date: normalizedDate
    };
    
  } catch (error) {
    logger.error('Working day validation failed:', error);
    throw new ApiError(500, 'Unable to validate working day');
  }
};

/**
 * Validate that a date range contains only working days
 * @param {string} startDate - Start date
 * @param {string} endDate - End date
 * @param {number} employeeId - Employee ID (for leave checking)
 * @returns {Promise<Object>} Validation result
 */
const validateWorkingDayRange = async (startDate, endDate, employeeId = null) => {
  try {
    const { validateDateRange } = require('./dateTimeHelpers');
    const { startDate: start, endDate: end, days } = validateDateRange(startDate, endDate);
    
    const nonWorkingDays = [];
    let workingDays = 0;
    
    for (let date = new Date(start); date <= new Date(end); date.setDate(date.getDate() + 1)) {
      const dateString = date.toISOString().split('T')[0];
      const dayValidation = await isWorkingDay(dateString, employeeId);
      
      if (!dayValidation.isWorkingDay) {
        nonWorkingDays.push({
          date: dateString,
          reason: dayValidation.reason,
          message: dayValidation.message
        });
      } else {
        workingDays++;
      }
    }
    
    return {
      isValid: nonWorkingDays.length === 0,
      startDate: start,
      endDate: end,
      totalDays: days,
      workingDays,
      nonWorkingDays,
      message: nonWorkingDays.length === 0 
        ? 'All dates are working days'
        : `Found ${nonWorkingDays.length} non-working day(s) in the range`
    };
    
  } catch (error) {
    logger.error('Working day range validation failed:', error);
    throw new ApiError(500, 'Unable to validate date range');
  }
};

/**
 * Validate attendance marking eligibility
 * @param {string} dateString - Date to mark attendance
 * @param {number} employeeId - Employee ID
 * @returns {Promise<Object>} Validation result
 */
const validateAttendanceMarking = async (dateString, employeeId) => {
  try {
    const dayValidation = await isWorkingDay(dateString, employeeId);
    
    if (!dayValidation.isWorkingDay) {
      throw new ApiError(400, `Cannot mark attendance: ${dayValidation.message}`);
    }
    
    // Check if it's a future date
    const { isFutureDate } = require('./dateTimeHelpers');
    if (isFutureDate(dateString)) {
      throw new ApiError(400, 'Cannot mark attendance for future dates');
    }
    
    return {
      canMark: true,
      date: dayValidation.date,
      message: 'Attendance can be marked'
    };
    
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    logger.error('Attendance marking validation failed:', error);
    throw new ApiError(500, 'Unable to validate attendance marking');
  }
};

/**
 * Validate leave application eligibility
 * @param {string} startDate - Leave start date
 * @param {string} endDate - Leave end date
 * @param {number} employeeId - Employee ID
 * @returns {Promise<Object>} Validation result
 */
const validateLeaveApplication = async (startDate, endDate, employeeId) => {
  try {
    const rangeValidation = await validateWorkingDayRange(startDate, endDate, employeeId);
    
    // For leave applications, we can apply on days that include non-working days
    // but we need to calculate actual working days
    return {
      canApply: true,
      startDate: rangeValidation.startDate,
      endDate: rangeValidation.endDate,
      totalDays: rangeValidation.totalDays,
      workingDays: rangeValidation.workingDays,
      nonWorkingDays: rangeValidation.nonWorkingDays,
      message: `Leave application valid for ${rangeValidation.workingDays} working day(s) out of ${rangeValidation.totalDays} day(s)`
    };
    
  } catch (error) {
    logger.error('Leave application validation failed:', error);
    throw new ApiError(500, 'Unable to validate leave application');
  }
};

/**
 * Get working days in a month
 * @param {number} month - Month (1-12)
 * @param {number} year - Year
 * @param {number} employeeId - Employee ID (for leave checking)
 * @returns {Promise<Object>} Working days summary
 */
const getWorkingDaysInMonth = async (month, year, employeeId = null) => {
  try {
    const { validateYear } = require('./dateTimeHelpers');
    const validatedYear = validateYear(year);
    
    if (month < 1 || month > 12) {
      throw new ApiError(400, 'Invalid month. Must be between 1 and 12.');
    }
    
    const startDate = new Date(validatedYear, month - 1, 1);
    const endDate = new Date(validatedYear, month, 0);
    const totalDays = endDate.getDate();
    
    let workingDays = 0;
    let nonWorkingDays = [];
    
    for (let day = 1; day <= totalDays; day++) {
      const date = new Date(validatedYear, month - 1, day);
      const dateString = date.toISOString().split('T')[0];
      
      const dayValidation = await isWorkingDay(dateString, employeeId);
      
      if (!dayValidation.isWorkingDay) {
        nonWorkingDays.push({
          date: dateString,
          reason: dayValidation.reason,
          message: dayValidation.message
        });
      } else {
        workingDays++;
      }
    }
    
    return {
      month,
      year: validatedYear,
      totalDays,
      workingDays,
      nonWorkingDays,
      workingDaysPercentage: ((workingDays / totalDays) * 100).toFixed(1)
    };
    
  } catch (error) {
    logger.error('Get working days in month failed:', error);
    throw new ApiError(500, 'Unable to get working days for month');
  }
};

/**
 * Check if attendance can be marked today
 * @param {number} employeeId - Employee ID
 * @returns {Promise<Object>} Today's validation result
 */
const canMarkAttendanceToday = async (employeeId) => {
  try {
    const { getCurrentDate } = require('./dateTimeHelpers');
    const today = getCurrentDate();
    
    return await validateAttendanceMarking(today, employeeId);
    
  } catch (error) {
    logger.error('Check attendance marking for today failed:', error);
    throw new ApiError(500, 'Unable to check attendance eligibility for today');
  }
};

/**
 * Get calendar status for a date range
 * @param {string} startDate - Start date
 * @param {string} endDate - End date
 * @param {number} employeeId - Employee ID
 * @returns {Promise<Array>} Calendar with day statuses
 */
const getCalendarStatus = async (startDate, endDate, employeeId = null) => {
  try {
    const { validateDateRange } = require('./dateTimeHelpers');
    const { startDate: start, endDate: end } = validateDateRange(startDate, endDate);
    
    const calendar = [];
    
    for (let date = new Date(start); date <= new Date(end); date.setDate(date.getDate() + 1)) {
      const dateString = date.toISOString().split('T')[0];
      const dayValidation = await isWorkingDay(dateString, employeeId);
      
      calendar.push({
        date: dateString,
        dayOfWeek: date.getDay(),
        isWorkingDay: dayValidation.isWorkingDay,
        status: dayValidation.reason,
        message: dayValidation.message,
        holiday: dayValidation.holiday || null,
        leave: dayValidation.leave || null
      });
    }
    
    return calendar;
    
  } catch (error) {
    logger.error('Get calendar status failed:', error);
    throw new ApiError(500, 'Unable to get calendar status');
  }
};

/**
 * Validate business day operations
 * @param {string} operation - Operation type ('attendance' or 'leave')
 * @param {string} dateString - Date string
 * @param {number} employeeId - Employee ID
 * @returns {Promise<Object>} Validation result
 */
const validateBusinessDayOperation = async (operation, dateString, employeeId = null) => {
  try {
    switch (operation.toLowerCase()) {
      case 'attendance':
        return await validateAttendanceMarking(dateString, employeeId);
      
      case 'leave':
        // For leave, we need a range, so just validate the single date
        const dayValidation = await isWorkingDay(dateString, employeeId);
        return {
          canApply: true,
          date: dayValidation.date,
          isWorkingDay: dayValidation.isWorkingDay,
          message: dayValidation.message
        };
      
      default:
        throw new ApiError(400, 'Invalid operation type. Must be "attendance" or "leave".');
    }
    
  } catch (error) {
    logger.error('Business day operation validation failed:', error);
    throw error;
  }
};

module.exports = {
  isWorkingDay,
  validateWorkingDayRange,
  validateAttendanceMarking,
  validateLeaveApplication,
  getWorkingDaysInMonth,
  canMarkAttendanceToday,
  getCalendarStatus,
  validateBusinessDayOperation
};
