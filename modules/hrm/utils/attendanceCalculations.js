/**
 * Centralized HRM Attendance Calculations Module
 * Consolidates all attendance-related calculations to reduce code duplication
 * and ensure consistency across the application
 */

const { Op, fn, col, literal } = require('sequelize');
const { getWorkingDaysInYear } = require('./hrmHelpers');
const { getWorkingDaysInMonth } = require('./workingDayHelpers');

/**
 * Calculate attendance counts from records
 * @param {Array} attendanceRecords - Array of attendance records
 * @returns {Object} Counts of present, absent, leave, half-day, holiday
 */
const countAttendanceRecords = (attendanceRecords = []) => {
  const counts = {
    present: 0,
    absent: 0,
    on_leave: 0,
    half_day: 0,
    holiday: 0
  };

  attendanceRecords.forEach(record => {
    switch (record.status) {
      case 'PRESENT':
        counts.present += 1;
        break;
      case 'ABSENT':
        counts.absent += 1;
        break;
      case 'ON_LEAVE':
        counts.on_leave += 1;
        break;
      case 'HALF_DAY':
        counts.half_day += 1;
        break;
      case 'HOLIDAY':
        counts.holiday += 1;
        break;
      default:
        break;
    }
  });

  return counts;
};

/**
 * Calculate attendance percentage
 * @param {number} present - Number of present days
 * @param {number} halfDays - Number of half days
 * @param {number} workingDays - Total working days
 * @returns {number} Attendance percentage (0-100)
 */
const calculateAttendancePercentage = (present, halfDays, workingDays) => {
  if (workingDays <= 0) return 0;
  const halfDayDays = halfDays * 0.5;
  return Math.round(((present + halfDayDays) / workingDays) * 100);
};

/**
 * Calculate paid days for salary
 * @param {number} present - Number of present days
 * @param {number} halfDays - Number of half days
 * @param {number} onLeave - Number of leave days
 * @returns {number} Total paid days
 */
const calculatePaidDays = (present, halfDays, onLeave) => {
  const halfDayDays = halfDays * 0.5;
  return present + halfDayDays + onLeave;
};

/**
 * Build attendance summary for a single employee
 * @param {Object} employee - Employee object with attendance counts
 * @param {number} workingDays - Total working days in period
 * @returns {Object} Attendance summary
 */
const buildEmployeeAttendanceSummary = (employee, workingDays) => {
  const present = parseInt(employee.present_count) || 0;
  const absent = parseInt(employee.absent_count) || 0;
  const onLeave = parseInt(employee.leave_count) || 0;
  const halfDayCount = parseInt(employee.half_day_count) || 0;
  const halfDayDays = halfDayCount * 0.5;
  const holiday = parseInt(employee.holiday_count) || 0;

  const attendancePercentage = calculateAttendancePercentage(present, halfDayCount, workingDays);

  return {
    employee_id: employee.employee_id,
    employee_code: employee.employee_code || '',
    name: employee.applicant?.personal?.full_name || '',
    district: employee.district?.district_name || '',
    district_id: employee.district_id,
    osc: employee.component?.component_name || '',
    post: employee.post?.post_name || '',
    working_days: workingDays,
    present,
    absent,
    on_leave: onLeave,
    half_day: halfDayCount,
    half_day_days: halfDayDays,
    holiday,
    attendance_percentage: attendancePercentage
  };
};

/**
 * Build aggregated summary for multiple employees
 * @param {Array} employeeSummaries - Array of employee summaries
 * @param {number} workingDays - Total working days in period
 * @returns {Object} Aggregated summary
 */
const buildAggregatedSummary = (employeeSummaries, workingDays) => {
  const total_present = employeeSummaries.reduce((sum, e) => sum + e.present, 0);
  const total_absent = employeeSummaries.reduce((sum, e) => sum + e.absent, 0);
  const total_on_leave = employeeSummaries.reduce((sum, e) => sum + e.on_leave, 0);
  const total_half_day = employeeSummaries.reduce((sum, e) => sum + (e.half_day || 0), 0);
  const total_half_day_days = employeeSummaries.reduce((sum, e) => sum + (e.half_day_days || 0), 0);
  const total_holiday = employeeSummaries.reduce((sum, e) => sum + (e.holiday || 0), 0);

  const total_employees = employeeSummaries.length;
  const total_working = total_employees * workingDays;

  // Overall attendance percentage
  const totalAttendancePercentage = total_employees > 0
    ? Math.round(((total_present + total_half_day_days) / (total_present + total_absent + total_on_leave + total_half_day_days)) * 100)
    : 0;

  return {
    total_employees,
    total_present,
    total_absent,
    total_on_leave,
    total_half_day,
    total_half_day_days,
    total_holiday,
    total_working,
    attendance_percentage: totalAttendancePercentage
  };
};

/**
 * Get database query attributes for attendance counts
 * Used in findAll queries to count attendance by status
 * @returns {Array} Sequelize attributes array
 */
const getAttendanceCountAttributes = () => [
  'employee_id',
  [fn('COUNT', literal("CASE WHEN status = 'PRESENT' THEN 1 END")), 'present_count'],
  [fn('COUNT', literal("CASE WHEN status = 'ABSENT' THEN 1 END")), 'absent_count'],
  [fn('COUNT', literal("CASE WHEN status = 'ON_LEAVE' THEN 1 END")), 'leave_count'],
  [fn('COUNT', literal("CASE WHEN status = 'HALF_DAY' THEN 1 END")), 'half_day_count'],
  [fn('COUNT', literal("CASE WHEN status = 'HOLIDAY' THEN 1 END")), 'holiday_count']
];

module.exports = {
  countAttendanceRecords,
  calculateAttendancePercentage,
  calculatePaidDays,
  buildEmployeeAttendanceSummary,
  buildAggregatedSummary,
  getAttendanceCountAttributes
};
