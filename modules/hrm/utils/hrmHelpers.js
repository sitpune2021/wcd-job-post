/**
 * HRM Shared Helper Functions
 * Reusable utilities across all HRM modules
 */
const { Op } = require('sequelize');
const logger = require('../../../config/logger');

/**
 * Get employee_id from authenticated user (applicant login)
 * Looks up employee record by applicant_id from JWT token
 */
const getEmployeeFromUser = async (user, EmployeeMaster) => {
  if (!user) {
    return null;
  }
  
  // Handle Sequelize instance wrapping
  const applicantId = user.applicant_id || user.dataValues?.applicant_id;
  
  if (!applicantId) {
    return null;
  }
  
  const employee = await EmployeeMaster.findOne({
    where: {
      applicant_id: applicantId,
      is_deleted: false,
      is_active: true
    },
    attributes: ['employee_id', 'employee_code', 'post_id', 'district_id', 'component_id', 'hub_id', 'onboarding_status', 'employment_status', 'reporting_officer_id']
  });
  
  return employee;
};

/**
 * Build hierarchy filter for admin user
 * Returns WHERE clause for employee queries based on admin's jurisdiction
 */
const buildHierarchyFilter = (adminUser) => {
  const where = {};

  // Super Admin and State Admin see everything
  const role = adminUser.role?.role_code || adminUser.role;
  if (['SUPER_ADMIN', 'STATE_ADMIN', 'TECH_ADMIN'].includes(role)) {
    return where;
  }

  // If admin has no district/OSC/hub assignment, show all employees
  if (!adminUser.district_id && !adminUser.component_id && !adminUser.hub_id) {
    return where; // No filters = show all
  }

  // District-level filtering (applies to District, OSC, and Hub admins)
  if (adminUser.district_id) {
    where.district_id = adminUser.district_id;
  }

  // Component (OSC) level filtering - for OSC admins
  if (adminUser.component_id && !adminUser.hub_id) {
    where.component_id = adminUser.component_id;
  }

  // Hub level filtering - for Hub admins (similar to OSC admins)
  if (adminUser.hub_id && !adminUser.component_id) {
    where.hub_id = adminUser.hub_id;
  }

  // Note: Admin should not have both component_id and hub_id
  // They manage either an OSC OR a Hub, not both

  return where;
};

/**
 * Get employee IDs under an admin's jurisdiction
 * Used for filtering attendance, leave, reports etc.
 */
const getEmployeeIdsUnderAdmin = async (adminUser, EmployeeMaster) => {
  const hierarchyFilter = buildHierarchyFilter(adminUser);
  const employees = await EmployeeMaster.findAll({
    where: {
      ...hierarchyFilter,
      is_deleted: false,
      is_active: true
    },
    attributes: ['employee_id']
  });
  return employees.map(e => e.employee_id);
};

/**
 * Calculate working days in a month (excluding Sundays and holidays)
 */
const getWorkingDaysInMonth = async (year, month, Holiday) => {
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0);
  let workingDays = 0;

  // Get holidays for the month
  const holidays = await Holiday.findAll({
    where: {
      holiday_date: { [Op.between]: [startDate, endDate] },
      is_active: true,
      is_deleted: false
    },
    attributes: ['holiday_date']
  });
  const holidayDates = new Set(holidays.map(h => h.holiday_date));

  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const dayOfWeek = d.getDay();
    const dateStr = d.toISOString().split('T')[0];
    if (dayOfWeek !== 0 && !holidayDates.has(dateStr)) {
      workingDays++;
    }
  }

  return workingDays;
};

/**
 * Calculate working days in a custom date range (excluding Sundays and holidays)
 */
const getWorkingDaysInRange = async (startDate, endDate, Holiday) => {
  let workingDays = 0;

  // Get holidays for the date range
  const holidays = await Holiday.findAll({
    where: {
      holiday_date: { [Op.between]: [startDate, endDate] },
      is_active: true,
      is_deleted: false
    },
    attributes: ['holiday_date']
  });
  const holidayDates = new Set(holidays.map(h => h.holiday_date));

  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const dayOfWeek = d.getDay();
    const dateStr = d.toISOString().split('T')[0];
    if (dayOfWeek !== 0 && !holidayDates.has(dateStr)) {
      workingDays++;
    }
  }

  return workingDays;
};

/**
 * Check if a specific date is a working day (not Sunday or holiday)
 */
const isWorkingDay = async (date) => {
  const { Holiday } = require('../models');
  const { safeHolidayCheck } = require('./safeQueryHelpers');
  
  const dateObj = new Date(date);
  const dateStr = dateObj.toISOString().split('T')[0];
  
  // Check if it's Sunday
  if (dateObj.getDay() === 0) {
    return false;
  }
  
  // Check if it's a holiday
  const holiday = await safeHolidayCheck(dateStr);
  if (holiday) {
    return false;
  }
  
  return true;
};

/**
 * Calculate business days between two dates (for leave calculation)
 * Excludes Sundays and holidays
 */
const calculateLeaveDays = async (fromDate, toDate, isHalfDay = false) => {
  if (isHalfDay) return 0.5;

  const start = new Date(fromDate);
  const end = new Date(toDate);
  let days = 0;
  const { Holiday } = require('../models');
  const { safeHolidayCheck } = require('./safeQueryHelpers');

  // Get all holidays in the date range for efficient checking
  const holidays = await Holiday.findAll({
    where: {
      holiday_date: { [Op.between]: [start.toISOString().split('T')[0], end.toISOString().split('T')[0]] },
      is_active: true,
      is_deleted: false
    },
    attributes: ['holiday_date']
  });
  const holidayDates = new Set(holidays.map(h => h.holiday_date));

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split('T')[0];
    if (d.getDay() !== 0 && !holidayDates.has(dateStr)) { // Exclude Sundays and holidays
      days++;
    }
  }

  return days;
};

/**
 * Get month name from number
 */
const getMonthName = (month) => {
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  return months[month - 1] || '';
};

/**
 * Format period string (e.g., "January - March 2026")
 */
const formatPeriod = (startDate, endDate) => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  return `${getMonthName(start.getMonth() + 1)} - ${getMonthName(end.getMonth() + 1)} ${end.getFullYear()}`;
};

/**
 * Standard pagination helper
 */
const getPagination = (query) => {
  const page = Math.max(1, parseInt(query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit) || 10));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
};

/**
 * Build pagination response
 */
const paginatedResponse = (rows, count, page, limit) => ({
  data: rows,
  pagination: {
    total: count,
    page,
    limit,
    totalPages: Math.ceil(count / limit)
  }
});

module.exports = {
  getEmployeeFromUser,
  buildHierarchyFilter,
  getEmployeeIdsUnderAdmin,
  getWorkingDaysInMonth,
  getWorkingDaysInRange,
  isWorkingDay,
  calculateLeaveDays,
  getMonthName,
  formatPeriod,
  getPagination,
  paginatedResponse
};
