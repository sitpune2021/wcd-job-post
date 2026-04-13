/**
 * Date/Time Helpers
 * Standardized date/time handling with timezone management and year-wise operations
 */

const logger = require('../../../config/logger');
const { ApiError } = require('../../../middleware/errorHandler');

/**
 * Get current date in server timezone (UTC+5:30 for India)
 * @returns {string} Date in YYYY-MM-DD format
 */
const getCurrentDate = () => {
  const now = new Date();
  // Convert to IST (UTC+5:30)
  const istOffset = 5.5 * 60 * 60 * 1000; // 5.5 hours in milliseconds
  const istTime = new Date(now.getTime() + istOffset + now.getTimezoneOffset() * 60 * 1000);
  
  return istTime.toISOString().split('T')[0];
};

/**
 * Get current time in server timezone
 * @returns {string} Time in HH:MM:SS format
 */
const getCurrentTime = () => {
  const now = new Date();
  // Convert to IST
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istTime = new Date(now.getTime() + istOffset + now.getTimezoneOffset() * 60 * 1000);
  
  return istTime.toTimeString().split(' ')[0];
};

/**
 * Validate and normalize date string
 * @param {string} dateString - Date string to validate
 * @returns {string} Normalized date in YYYY-MM-DD format
 */
const validateAndNormalizeDate = (dateString) => {
  if (!dateString) {
    throw new ApiError(400, 'Date is required');
  }

  let date;
  
  // Handle various date formats
  if (dateString instanceof Date) {
    date = dateString;
  } else if (typeof dateString === 'string') {
    // Try parsing different formats
    const formats = [
      /^\d{4}-\d{2}-\d{2}$/,           // YYYY-MM-DD
      /^\d{2}\/\d{2}\/\d{4}$/,           // DD/MM/YYYY
      /^\d{2}-\d{2}-\d{4}$/,             // DD-MM-YYYY
    ];

    for (const format of formats) {
      if (format.test(dateString)) {
        // Convert to standard format
        if (dateString.includes('/')) {
          const [day, month, year] = dateString.split('/');
          date = new Date(`${year}-${month}-${day}`);
        } else if (dateString.includes('-') && dateString.length === 10) {
          if (dateString.split('-')[0].length === 4) {
            // Already YYYY-MM-DD
            date = new Date(dateString);
          } else {
            // DD-MM-YYYY format
            const [day, month, year] = dateString.split('-');
            date = new Date(`${year}-${month}-${day}`);
          }
        }
        break;
      }
    }
    
    if (!date) {
      date = new Date(dateString); // Last resort
    }
  } else {
    throw new ApiError(400, 'Invalid date format');
  }

  if (isNaN(date.getTime())) {
    throw new ApiError(400, 'Invalid date');
  }

  // Validate date range
  const minDate = new Date('2020-01-01');
  const maxDate = new Date('2030-12-31');
  
  if (date < minDate || date > maxDate) {
    throw new ApiError(400, 'Date must be between 2020 and 2030');
  }

  return date.toISOString().split('T')[0];
};

/**
 * Validate and normalize time string
 * @param {string} timeString - Time string to validate
 * @returns {string} Normalized time in HH:MM:SS format
 */
const validateAndNormalizeTime = (timeString) => {
  if (!timeString) {
    throw new ApiError(400, 'Time is required');
  }

  let time;
  
  if (timeString instanceof Date) {
    time = timeString;
  } else if (typeof timeString === 'string') {
    // Handle various time formats
    const formats = [
      /^\d{2}:\d{2}:\d{2}$/,           // HH:MM:SS
      /^\d{2}:\d{2}$/,                 // HH:MM
      /^\d{1,2}:\d{2}:\d{2}\s*(AM|PM)$/i,  // H:MM:SS AM/PM
      /^\d{1,2}:\d{2}\s*(AM|PM)$/i        // H:MM AM/PM
    ];

    for (const format of formats) {
      if (format.test(timeString)) {
        if (timeString.toLowerCase().includes('am') || timeString.toLowerCase().includes('pm')) {
          // 12-hour format
          const [timePart, period] = timeString.toLowerCase().split(/\s+/);
          const [hours, minutes, seconds = '00'] = timePart.split(':');
          let hour24 = parseInt(hours);
          
          if (period === 'pm' && hour24 !== 12) {
            hour24 += 12;
          } else if (period === 'am' && hour24 === 12) {
            hour24 = 0;
          }
          
          time = new Date();
          time.setHours(hour24, parseInt(minutes), parseInt(seconds), 0);
        } else {
          // 24-hour format
          const [hours, minutes, seconds = '00'] = timeString.split(':');
          time = new Date();
          time.setHours(parseInt(hours), parseInt(minutes), parseInt(seconds), 0);
        }
        break;
      }
    }
    
    if (!time) {
      time = new Date(`1970-01-01T${timeString}`); // Last resort
    }
  } else {
    throw new ApiError(400, 'Invalid time format');
  }

  if (isNaN(time.getTime())) {
    throw new ApiError(400, 'Invalid time');
  }

  return time.toTimeString().split(' ')[0];
};

/**
 * Get current financial year (April to March)
 * @returns {number} Financial year
 */
const getCurrentFinancialYear = () => {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istTime = new Date(now.getTime() + istOffset + now.getTimezoneOffset() * 60 * 1000);
  
  const year = istTime.getFullYear();
  const month = istTime.getMonth() + 1; // 1-12
  
  // Financial year starts from April (month 4)
  return month >= 4 ? year : year - 1;
};

/**
 * Get current calendar year
 * @returns {number} Calendar year
 */
const getCurrentYear = () => {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istTime = new Date(now.getTime() + istOffset + now.getTimezoneOffset() * 60 * 1000);
  
  return istTime.getFullYear();
};

/**
 * Validate year parameter
 * @param {number|string} year - Year to validate
 * @returns {number} Validated year
 */
const validateYear = (year) => {
  const yearNum = parseInt(year);
  
  if (isNaN(yearNum)) {
    throw new ApiError(400, 'Invalid year format');
  }
  
  if (yearNum < 2000 || yearNum > 2100) {
    throw new ApiError(400, 'Year must be between 2000 and 2100');
  }
  
  return yearNum;
};

/**
 * Check if date is weekend (Sunday)
 * @param {string} dateString - Date in YYYY-MM-DD format
 * @returns {boolean} True if weekend
 */
const isWeekend = (dateString) => {
  const date = new Date(dateString);
  return date.getDay() === 0; // Sunday = 0
};

/**
 * Check if date is today
 * @param {string} dateString - Date in YYYY-MM-DD format
 * @returns {boolean} True if today
 */
const isToday = (dateString) => {
  const today = getCurrentDate();
  return dateString === today;
};

/**
 * Check if date is in the past
 * @param {string} dateString - Date in YYYY-MM-DD format
 * @returns {boolean} True if past date
 */
const isPastDate = (dateString) => {
  const date = new Date(dateString);
  const today = new Date(getCurrentDate());
  
  date.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  
  return date < today;
};

/**
 * Check if date is in the future
 * @param {string} dateString - Date in YYYY-MM-DD format
 * @returns {boolean} True if future date
 */
const isFutureDate = (dateString) => {
  const date = new Date(dateString);
  const today = new Date(getCurrentDate());
  
  date.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  
  return date > today;
};

/**
 * Calculate days between two dates
 * @param {string} startDate - Start date in YYYY-MM-DD format
 * @param {string} endDate - End date in YYYY-MM-DD format
 * @returns {number} Number of days
 */
const calculateDaysBetween = (startDate, endDate) => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  const diffTime = Math.abs(end - start);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
  
  return diffDays;
};

/**
 * Validate date range
 * @param {string} startDate - Start date
 * @param {string} endDate - End date
 * @param {Object} options - Validation options
 * @returns {Object} Validated dates
 */
const validateDateRange = (startDate, endDate, options = {}) => {
  const {
    allowPast = true,
    allowFuture = false,
    maxDays = 365,
    allowSameDay = true
  } = options;

  const normalizedStart = validateAndNormalizeDate(startDate);
  const normalizedEnd = validateAndNormalizeDate(endDate);

  if (normalizedStart > normalizedEnd) {
    throw new ApiError(400, 'Start date must be before or equal to end date');
  }

  if (!allowSameDay && normalizedStart === normalizedEnd) {
    throw new ApiError(400, 'Start and end dates cannot be the same');
  }

  if (!allowPast && isPastDate(normalizedStart)) {
    throw new ApiError(400, 'Start date cannot be in the past');
  }

  if (!allowFuture && isFutureDate(normalizedEnd)) {
    throw new ApiError(400, 'End date cannot be in the future');
  }

  const daysDiff = calculateDaysBetween(normalizedStart, normalizedEnd);
  if (daysDiff > maxDays) {
    throw new ApiError(400, `Date range cannot exceed ${maxDays} days`);
  }

  return {
    startDate: normalizedStart,
    endDate: normalizedEnd,
    days: daysDiff
  };
};

/**
 * Get working days in date range (excluding Sundays)
 * @param {string} startDate - Start date
 * @param {string} endDate - End date
 * @returns {number} Working days
 */
const getWorkingDaysInRange = (startDate, endDate) => {
  const { startDate: start, endDate: end, days } = validateDateRange(startDate, endDate);
  let workingDays = 0;
  
  for (let date = new Date(start); date <= new Date(end); date.setDate(date.getDate() + 1)) {
    if (!isWeekend(date.toISOString().split('T')[0])) {
      workingDays++;
    }
  }
  
  return workingDays;
};

/**
 * Format date for display
 * @param {string} dateString - Date in YYYY-MM-DD format
 * @param {string} format - Format type ('short', 'long', 'display')
 * @returns {string} Formatted date
 */
const formatDate = (dateString, format = 'display') => {
  const date = new Date(dateString);
  
  switch (format) {
    case 'short':
      return date.toLocaleDateString('en-IN', { 
        day: '2-digit', 
        month: 'short', 
        year: 'numeric' 
      });
    case 'long':
      return date.toLocaleDateString('en-IN', { 
        weekday: 'long',
        day: '2-digit', 
        month: 'long', 
        year: 'numeric' 
      });
    case 'display':
    default:
      return date.toLocaleDateString('en-IN', { 
        day: '2-digit', 
        month: '2-digit', 
        year: 'numeric' 
      });
  }
};

/**
 * Get month and year from date
 * @param {string} dateString - Date in YYYY-MM-DD format
 * @returns {Object} Month and year
 */
const getMonthYear = (dateString) => {
  const date = new Date(dateString);
  return {
    month: date.getMonth() + 1, // 1-12
    year: date.getFullYear(),
    monthName: date.toLocaleDateString('en-IN', { month: 'long' })
  };
};

module.exports = {
  getCurrentDate,
  getCurrentTime,
  validateAndNormalizeDate,
  validateAndNormalizeTime,
  getCurrentFinancialYear,
  getCurrentYear,
  validateYear,
  isWeekend,
  isToday,
  isPastDate,
  isFutureDate,
  calculateDaysBetween,
  validateDateRange,
  getWorkingDaysInRange,
  formatDate,
  getMonthYear
};
