/**
 * Safe Query Helpers
 * Robust database query helpers with proper error handling for attendance and leave operations
 */

const { Op } = require('sequelize');
const logger = require('../../../config/logger');
const { ApiError } = require('../../../middleware/errorHandler');

/**
 * Safe query wrapper with fallback and error handling
 * @param {Function} queryFn - Query function to execute
 * @param {any} fallbackValue - Fallback value if query fails
 * @param {string} context - Context for logging
 * @returns {Promise<any>} Query result or fallback
 */
const safeQuery = async (queryFn, fallbackValue = null, context = 'Database operation') => {
  try {
    const result = await queryFn();
    return result;
  } catch (error) {
    logger.warn(`${context} failed, using fallback:`, {
      error: error.message,
      context,
      fallback: !!fallbackValue
    });
    
    // Don't throw error for non-critical queries
    if (fallbackValue !== null) {
      return fallbackValue;
    }
    
    // For critical queries, throw a user-friendly error
    if (error.name === 'SequelizeConnectionError') {
      throw new ApiError(503, 'Database connection error. Please try again later.');
    }
    
    if (error.name === 'SequelizeDatabaseError') {
      // Check if it's a column error
      if (error.message.includes('column') || error.message.includes('field')) {
        logger.error('Database column error:', error.message);
        throw new ApiError(500, 'Data validation error. Please contact support.');
      }
      
      // Other database errors
      throw new ApiError(500, 'Database operation failed. Please try again later.');
    }
    
    throw error;
  }
};

/**
 * Safe holiday check
 * @param {string} date - Date to check
 * @returns {Promise<Object|null>} Holiday object or null
 */
const safeHolidayCheck = async (date) => {
  const { Holiday } = require('../models');
  
  return safeQuery(async () => {
    return await Holiday.findOne({
      where: { 
        holiday_date: date,
        is_active: true
      }
    });
  }, null, 'Holiday check');
};

/**
 * Safe leave application check
 * @param {number} employeeId - Employee ID
 * @param {string} date - Date to check
 * @returns {Promise<Object|null>} Leave application or null
 */
const safeLeaveCheck = async (employeeId, date) => {
  const { LeaveApplication, LeaveType } = require('../models');
  
  return safeQuery(async () => {
    return await LeaveApplication.findOne({
      where: {
        employee_id: employeeId,
        status: 'APPROVED',
        from_date: { [Op.lte]: date },
        to_date: { [Op.gte]: date }
      },
      include: [{
        model: LeaveType,
        as: 'leaveType',
        attributes: ['leave_name'],
        required: false
      }]
    });
  }, null, 'Leave check');
};

/**
 * Safe attendance record check
 * @param {number} employeeId - Employee ID
 * @param {string} date - Date to check
 * @returns {Promise<Object|null>} Attendance record or null
 */
const safeAttendanceCheck = async (employeeId, date) => {
  const { Attendance } = require('../models');
  
  return safeQuery(async () => {
    return await Attendance.findOne({
      where: { 
        employee_id: employeeId, 
        attendance_date: date 
      }
    });
  }, null, 'Attendance check');
};

/**
 * Safe leave balance check
 * @param {number} employeeId - Employee ID
 * @param {number} leaveTypeId - Leave type ID
 * @param {number} year - Year
 * @returns {Promise<Object|null>} Leave balance or null
 */
const safeLeaveBalanceCheck = async (employeeId, leaveTypeId, year) => {
  const { LeaveBalance, LeaveType } = require('../models');
  
  return safeQuery(async () => {
    return await LeaveBalance.findOne({
      where: { 
        employee_id: employeeId, 
        leave_type_id: leaveTypeId, 
        year 
      },
      include: [{
        model: LeaveType,
        as: 'leaveType',
        attributes: ['leave_code', 'leave_name'],
        required: false
      }]
    });
  }, null, 'Leave balance check');
};

/**
 * Safe employee data fetch with location information
 * @param {number} employeeId - Employee ID
 * @returns {Promise<Object>} Employee data with safe fallbacks
 */
const safeEmployeeWithLocation = async (employeeId) => {
  const { EmployeeMaster } = require('../models');
  const db = require('../../../models');
  
  return safeQuery(async () => {
    let employee = await EmployeeMaster.findOne({
      where: { employee_id: employeeId },
      attributes: ['employee_id', 'employee_code', 'component_id', 'hub_id', 'district_id']
    });
    
    if (!employee) {
      throw new ApiError(404, 'Employee not found');
    }
    
    const employeeData = employee.toJSON();
    
    // Try to fetch component separately
    if (employeeData.component_id) {
      try {
        employeeData.component = await db.Component.findOne({
          where: { component_id: employeeData.component_id },
          attributes: ['component_id', 'component_name', 'latitude', 'longitude', 'geofence_radius_meters']
        });
      } catch (error) {
        logger.warn('Component fetch failed:', error.message);
        employeeData.component = null;
      }
    }
    
    // Try to fetch hub separately
    if (employeeData.hub_id) {
      try {
        employeeData.hub = await db.Hub.findOne({
          where: { hub_id: employeeData.hub_id },
          attributes: ['hub_id', 'hub_name', 'latitude', 'longitude', 'geofence_radius_meters']
        });
      } catch (error) {
        logger.warn('Hub fetch failed:', error.message);
        employeeData.hub = null;
      }
    }
    
    // Try to fetch district separately
    if (employeeData.district_id) {
      try {
        employeeData.district = await db.DistrictMaster.findOne({
          where: { district_id: employeeData.district_id },
          attributes: ['district_id', 'district_name']
        });
      } catch (error) {
        logger.warn('District fetch failed:', error.message);
        employeeData.district = null;
      }
    }
    
    return employeeData;
  }, null, 'Employee with location fetch');
};

/**
 * Safe leave type fetch
 * @param {number} leaveTypeId - Leave type ID
 * @returns {Promise<Object|null>} Leave type or null
 */
const safeLeaveTypeFetch = async (leaveTypeId) => {
  const { LeaveType } = require('../models');
  
  return safeQuery(async () => {
    return await LeaveType.findOne({
      where: { 
        leave_type_id: leaveTypeId,
        is_active: true
      },
      attributes: ['leave_type_id', 'leave_code', 'leave_name', 'default_days_per_year']
    });
  }, null, 'Leave type fetch');
};

/**
 * Safe multiple leave balances fetch
 * @param {number} employeeId - Employee ID
 * @param {number} year - Year
 * @returns {Promise<Array>} Array of leave balances
 */
const safeLeaveBalancesFetch = async (employeeId, year) => {
  const { LeaveBalance, LeaveType } = require('../models');
  
  return safeQuery(async () => {
    return await LeaveBalance.findAll({
      where: { 
        employee_id: employeeId, 
        year 
      },
      include: [{
        model: LeaveType,
        as: 'leaveType',
        attributes: ['leave_code', 'leave_name'],
        required: false
      }]
    });
  }, [], 'Leave balances fetch');
};

/**
 * Safe attendance history fetch
 * @param {number} employeeId - Employee ID
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Attendance records with pagination
 */
const safeAttendanceHistoryFetch = async (employeeId, options = {}) => {
  const { Attendance } = require('../models');
  const { getPagination } = require('../utils/hrmHelpers');
  
  return safeQuery(async () => {
    const { page, limit, from_date, to_date } = options;
    const { offset } = getPagination({ page, limit });
    
    const where = { employee_id };
    
    if (from_date && to_date) {
      where.attendance_date = { [Op.between]: [from_date, to_date] };
    } else if (from_date) {
      where.attendance_date = { [Op.gte]: from_date };
    } else if (to_date) {
      where.attendance_date = { [Op.lte]: to_date };
    }
    
    const { count, rows } = await Attendance.findAndCountAll({
      where,
      order: [['attendance_date', 'DESC']],
      limit,
      offset
    });
    
    return { count, rows };
  }, { count: 0, rows: [] }, 'Attendance history fetch');
};

/**
 * Safe leave applications fetch
 * @param {number} employeeId - Employee ID
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Leave applications with pagination
 */
const safeLeaveApplicationsFetch = async (employeeId, options = {}) => {
  const { LeaveApplication, LeaveType } = require('../models');
  const { getPagination } = require('../utils/hrmHelpers');
  
  return safeQuery(async () => {
    const { page, limit, status, year } = options;
    const { offset } = getPagination({ page, limit });
    
    const where = { employee_id };
    
    if (status) {
      where.status = status;
    }
    
    if (year) {
      where.from_date = { [Op.gte]: `${year}-01-01` };
      where.to_date = { [Op.lte]: `${year}-12-31` };
    }
    
    const { count, rows } = await LeaveApplication.findAndCountAll({
      where,
      include: [{
        model: LeaveType,
        as: 'leaveType',
        attributes: ['leave_code', 'leave_name'],
        required: false
      }],
      order: [['created_at', 'DESC']],
      limit,
      offset
    });
    
    return { count, rows };
  }, { count: 0, rows: [] }, 'Leave applications fetch');
};

/**
 * Validate leave overlap
 * @param {number} employeeId - Employee ID
 * @param {string} fromDate - From date
 * @param {string} toDate - To date
 * @param {number} excludeLeaveId - Leave ID to exclude (for updates)
 * @returns {Promise<Object>} Overlap validation result
 */
const safeLeaveOverlapCheck = async (employeeId, fromDate, toDate, excludeLeaveId = null) => {
  const { LeaveApplication } = require('../models');
  
  return safeQuery(async () => {
    const where = {
      employee_id: employeeId,
      status: { [Op.in]: ['PENDING', 'APPROVED'] },
      [Op.or]: [
        {
          from_date: { [Op.lte]: fromDate },
          to_date: { [Op.gte]: fromDate }
        },
        {
          from_date: { [Op.lte]: toDate },
          to_date: { [Op.gte]: toDate }
        },
        {
          from_date: { [Op.gte]: fromDate },
          to_date: { [Op.lte]: toDate }
        }
      ]
    };
    
    if (excludeLeaveId) {
      where.leave_id = { [Op.ne]: excludeLeaveId };
    }
    
    const overlappingLeaves = await LeaveApplication.findAll({
      where,
      attributes: ['leave_id', 'from_date', 'to_date', 'status']
    });
    
    return {
      hasOverlap: overlappingLeaves.length > 0,
      overlappingLeaves
    };
  }, { hasOverlap: false, overlappingLeaves: [] }, 'Leave overlap check');
};

/**
 * Create leave balance if not exists
 * @param {number} employeeId - Employee ID
 * @param {number} leaveTypeId - Leave type ID
 * @param {number} year - Year
 * @returns {Promise<Object>} Created or existing balance
 */
const safeCreateLeaveBalance = async (employeeId, leaveTypeId, year) => {
  const { LeaveBalance, LeaveType } = require('../models');
  
  return safeQuery(async () => {
    // First check if balance exists
    const existing = await LeaveBalance.findOne({
      where: { employee_id: employeeId, leave_type_id: leaveTypeId, year }
    });
    
    if (existing) {
      return existing;
    }
    
    // Get leave type for default days
    const leaveType = await LeaveType.findOne({
      where: { leave_type_id: leaveTypeId, is_active: true },
      attributes: ['default_days_per_year']
    });
    
    if (!leaveType) {
      throw new ApiError(400, 'Invalid leave type');
    }
    
    // Create new balance
    const balance = await LeaveBalance.create({
      employee_id: employeeId,
      leave_type_id: leaveTypeId,
      year,
      total_allocated: leaveType.default_days_per_year,
      used: 0,
      remaining: leaveType.default_days_per_year,
      created_by: employeeId
    });
    
    logger.info(`Leave balance created for employee ${employeeId}`, {
      leaveTypeId,
      year,
      allocated: leaveType.default_days_per_year
    });
    
    return balance;
  }, null, 'Leave balance creation');
};

/**
 * Update leave balance safely
 * @param {number} employeeId - Employee ID
 * @param {number} leaveTypeId - Leave type ID
 * @param {number} year - Year
 * @param {number} daysChange - Days to add/subtract
 * @returns {Promise<Object>} Updated balance
 */
const safeUpdateLeaveBalance = async (employeeId, leaveTypeId, year, daysChange) => {
  const { LeaveBalance } = require('../models');
  
  return safeQuery(async () => {
    const balance = await LeaveBalance.findOne({
      where: { employee_id: employeeId, leave_type_id: leaveTypeId, year }
    });
    
    if (!balance) {
      throw new ApiError(400, 'Leave balance not found');
    }
    
    const newUsed = Math.max(0, balance.used + daysChange);
    const newRemaining = balance.total_allocated - newUsed;
    
    await balance.update({
      used: newUsed,
      remaining: newRemaining
    });
    
    logger.info(`Leave balance updated for employee ${employeeId}`, {
      leaveTypeId,
      year,
      daysChange,
      newUsed,
      newRemaining
    });
    
    return balance;
  }, null, 'Leave balance update');
};

module.exports = {
  safeQuery,
  safeHolidayCheck,
  safeLeaveCheck,
  safeAttendanceCheck,
  safeLeaveBalanceCheck,
  safeEmployeeWithLocation,
  safeLeaveTypeFetch,
  safeLeaveBalancesFetch,
  safeAttendanceHistoryFetch,
  safeLeaveApplicationsFetch,
  safeLeaveOverlapCheck,
  safeCreateLeaveBalance,
  safeUpdateLeaveBalance
};
