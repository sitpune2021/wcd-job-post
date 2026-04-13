/**
 * HRM Dashboard Service
 * Provides dashboard stats for both admin and applicant/employee views
 */
const { Op, fn, col, literal } = require('sequelize');
const logger = require('../../../config/logger');
const { ApiError } = require('../../../middleware/errorHandler');
const db = require('../../../models');
const { Attendance, LeaveApplication, LeaveBalance, LeaveType, MonthlyReport, FieldVisit, PerformanceReview, Holiday } = require('../models');
const EmployeeMaster = db.EmployeeMaster;
const { getEmployeeFromUser, getEmployeeIdsUnderAdmin, getWorkingDaysInMonth } = require('../utils/hrmHelpers');

/**
 * Admin HRM Dashboard
 * Shows: total employees, present today, on leave, contract expiring,
 *        pending reports, leave approvals, evaluations due, field visits,
 *        district-wise attendance, monthly report status
 */
const getAdminDashboard = async (adminUser) => {
  const employeeIds = await getEmployeeIdsUnderAdmin(adminUser, EmployeeMaster);
  const today = new Date().toISOString().split('T')[0];
  const now = new Date();
  const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  if (employeeIds.length === 0) {
    return {
      total_employees: 0, present_today: 0, on_leave_today: 0,
      contract_expiring: 0, pending_reports: 0, leave_approvals: 0,
      evaluations_due: 0, field_visits_this_month: 0,
      district_attendance: [], report_status: {}
    };
  }

  const empFilter = { employee_id: { [Op.in]: employeeIds } };

  // Total active employees
  const totalEmployees = employeeIds.length;

  // Present today
  const presentToday = await Attendance.count({
    where: { ...empFilter, attendance_date: today, status: 'PRESENT', is_deleted: false }
  });

  // On leave today
  const onLeaveToday = await LeaveApplication.count({
    where: {
      ...empFilter,
      status: 'APPROVED',
      from_date: { [Op.lte]: today },
      to_date: { [Op.gte]: today },
      is_deleted: false
    }
  });

  // Contracts expiring in 30 days
  const contractExpiring = await EmployeeMaster.count({
    where: {
      employee_id: { [Op.in]: employeeIds },
      contract_end_date: { [Op.between]: [today, thirtyDaysFromNow] },
      is_deleted: false
    }
  });

  // Pending monthly reports
  const pendingReports = await MonthlyReport.count({
    where: { ...empFilter, status: 'SUBMITTED', is_deleted: false }
  });

  // Pending leave approvals
  const leaveApprovals = await LeaveApplication.count({
    where: { ...empFilter, status: 'PENDING', is_deleted: false }
  });

  // Evaluations due (self-submitted, awaiting review)
  const evaluationsDue = await PerformanceReview.count({
    where: { ...empFilter, status: 'SELF_SUBMITTED', is_deleted: false }
  });

  // Field visits this month
  const monthStart = new Date(currentYear, currentMonth - 1, 1).toISOString().split('T')[0];
  const monthEnd = new Date(currentYear, currentMonth, 0).toISOString().split('T')[0];
  const fieldVisitsThisMonth = await FieldVisit.count({
    where: {
      ...empFilter,
      visit_date: { [Op.between]: [monthStart, monthEnd] },
      is_deleted: false
    }
  });

  // District-wise attendance for today
  const districtAttendance = await Attendance.findAll({
    where: { ...empFilter, attendance_date: today, status: 'PRESENT', is_deleted: false },
    include: [{
      model: EmployeeMaster, as: 'employee',
      attributes: ['district_id'],
      include: [{ association: 'district', attributes: ['district_name'] }]
    }],
    attributes: [[fn('COUNT', col('HrmAttendance.attendance_id')), 'count']],
    group: ['employee.district_id', 'employee->district.district_id', 'employee->district.district_name'],
    raw: false
  });

  // Monthly report status
  const reportStatuses = await MonthlyReport.findAll({
    where: {
      ...empFilter,
      report_month: currentMonth,
      report_year: currentYear,
      is_deleted: false
    },
    attributes: ['status', [fn('COUNT', col('report_id')), 'count']],
    group: ['status']
  });

  const reportStatus = { submitted: 0, approved: 0, rejected: 0, pending: 0 };
  reportStatuses.forEach(rs => {
    const key = rs.status.toLowerCase();
    if (reportStatus[key] !== undefined) reportStatus[key] = parseInt(rs.dataValues.count);
  });
  reportStatus.pending = totalEmployees - (reportStatus.submitted + reportStatus.approved + reportStatus.rejected);

  return {
    total_employees: totalEmployees,
    present_today: presentToday,
    on_leave_today: onLeaveToday,
    contract_expiring: contractExpiring,
    pending_reports: pendingReports,
    leave_approvals: leaveApprovals,
    evaluations_due: evaluationsDue,
    field_visits_this_month: fieldVisitsThisMonth,
    district_attendance: districtAttendance,
    report_status: reportStatus
  };
};

/**
 * Employee (Applicant) HRM Dashboard
 * Shows: attendance rate, leave balance, salary status, documents,
 *        quick actions summary
 */
const getEmployeeDashboard = async (user) => {
  logger.info('getEmployeeDashboard: Starting dashboard fetch', { 
    user_id: user.id || user.employee_id || user.applicant_id,
    user_type: typeof user,
    user_keys: Object.keys(user)
  });

  const employee = await getEmployeeFromUser(user, EmployeeMaster);
  if (!employee) {
    logger.error('getEmployeeDashboard: Employee not found for user', { user });
    throw new ApiError(404, 'Employee record not found.');
  }

  logger.info('getEmployeeDashboard: Employee found', { 
    employee_id: employee.employee_id,
    employee_code: employee.employee_code,
    applicant_id: employee.applicant_id
  });

  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();
  const empId = employee.employee_id;

  // Today's attendance status
  const today = now.toISOString().split('T')[0];
  logger.info('getEmployeeDashboard: Fetching today attendance', { empId, today });
  
  let todayAttendance;
  try {
    todayAttendance = await Attendance.findOne({
      where: { 
        employee_id: empId, 
        attendance_date: today,
        is_deleted: false
      }
    });
    logger.info('getEmployeeDashboard: Today attendance fetched', { status: todayAttendance?.status });
  } catch (error) {
    logger.error('getEmployeeDashboard: Error fetching today attendance', { error: error.message, stack: error.stack });
    throw error;
  }

  // Leave balance summary
  logger.info('getEmployeeDashboard: Fetching leave balances', { empId, currentYear });
  
  let leaveBalances;
  try {
    leaveBalances = await LeaveBalance.findAll({
      where: { 
        employee_id: empId, 
        year: currentYear,
        is_deleted: false
      },
      include: [{
        model: LeaveType,
        as: 'leaveType',
        where: { is_active: true, is_deleted: false },
        required: true
      }]
    });
    logger.info('getEmployeeDashboard: Leave balances fetched', { count: leaveBalances.length });
  } catch (error) {
    logger.error('getEmployeeDashboard: Error fetching leave balances', { error: error.message, stack: error.stack });
    throw error;
  }

  // Pending leave applications
  logger.info('getEmployeeDashboard: Counting pending leaves', { empId });
  
  let pendingLeaves;
  try {
    pendingLeaves = await LeaveApplication.count({
      where: { employee_id: empId, status: 'PENDING', is_deleted: false }
    });
    logger.info('getEmployeeDashboard: Pending leaves counted', { count: pendingLeaves });
  } catch (error) {
    logger.error('getEmployeeDashboard: Error counting pending leaves', { error: error.message, stack: error.stack });
    throw error;
  }

  // Pending monthly reports
  logger.info('getEmployeeDashboard: Counting pending reports', { empId, currentMonth, currentYear });
  
  let pendingReports;
  try {
    pendingReports = await MonthlyReport.count({
      where: { 
        employee_id: empId, 
        status: 'PENDING', 
        is_deleted: false,
        report_month: currentMonth,
        report_year: currentYear
      }
    });
    logger.info('getEmployeeDashboard: Pending reports counted', { count: pendingReports });
  } catch (error) {
    logger.error('getEmployeeDashboard: Error counting pending reports', { error: error.message, stack: error.stack });
    pendingReports = 0; // Set default if table doesn't exist
  }

  // Field visits this month
  logger.info('getEmployeeDashboard: Counting field visits', { empId, currentMonth, currentYear });
  
  let fieldVisitsThisMonth;
  try {
    fieldVisitsThisMonth = await FieldVisit.count({
      where: { 
        employee_id: empId, 
        is_deleted: false,
        visit_date: {
          [Op.gte]: new Date(currentYear, currentMonth - 1, 1),
          [Op.lt]: new Date(currentYear, currentMonth, 1)
        }
      }
    });
    logger.info('getEmployeeDashboard: Field visits counted', { count: fieldVisitsThisMonth });
  } catch (error) {
    logger.error('getEmployeeDashboard: Error counting field visits', { error: error.message, stack: error.stack });
    fieldVisitsThisMonth = 0; // Set default if table doesn't exist
  }

  // Performance evaluations pending
  logger.info('getEmployeeDashboard: Counting evaluations due', { empId });
  
  let evaluationsDue;
  try {
    evaluationsDue = await PerformanceReview.count({
      where: { 
        employee_id: empId, 
        status: 'PENDING', 
        is_deleted: false 
      }
    });
    logger.info('getEmployeeDashboard: Evaluations counted', { count: evaluationsDue });
  } catch (error) {
    logger.error('getEmployeeDashboard: Error counting evaluations', { error: error.message, stack: error.stack });
    evaluationsDue = 0; // Set default if table doesn't exist
  }

  // Monthly attendance summary (simplified)
  logger.info('getEmployeeDashboard: Fetching attendance summary', { empId, currentMonth, currentYear });
  
  let attendanceSummary;
  try {
    attendanceSummary = await Attendance.findAll({
      where: { 
        employee_id: empId,
        is_deleted: false,
        attendance_date: {
          [Op.gte]: new Date(currentYear, currentMonth - 1, 1),
          [Op.lt]: new Date(currentYear, currentMonth, 1)
        }
      },
      attributes: ['status'],
      raw: true
    });
    logger.info('getEmployeeDashboard: Attendance summary fetched', { count: attendanceSummary.length });
  } catch (error) {
    logger.error('getEmployeeDashboard: Error fetching attendance summary', { error: error.message, stack: error.stack });
    throw error;
  }

  // Calculate attendance stats
  const stats = attendanceSummary.reduce((acc, record) => {
    acc[record.status.toLowerCase()] = (acc[record.status.toLowerCase()] || 0) + 1;
    acc.total_days++;
    return acc;
  }, { present_days: 0, absent_days: 0, half_days: 0, leave_days: 0, holidays: 0, total_days: 0 });

  logger.info('getEmployeeDashboard: Preparing dashboard response', { 
    today_status: todayAttendance?.status,
    leave_balance_count: leaveBalances.length,
    pending_leaves: pendingLeaves,
    pending_reports: pendingReports,
    field_visits: fieldVisitsThisMonth,
    evaluations_due: evaluationsDue,
    total_days: stats.total_days
  });

  return {
    today_status: {
      attendance_status: todayAttendance?.status || 'NOT_MARKED',
      check_in_time: todayAttendance?.check_in_time || null
    },
    leave_balance: leaveBalances.map(lb => ({
      leave_code: lb.leaveType.leave_code,
      leave_name: lb.leaveType.leave_name,
      remaining: lb.remaining || 0,
      used: lb.used || 0
    })),
    attendance_summary: stats,
    pending_actions: {
      pending_leaves: pendingLeaves,
      pending_reports: pendingReports,
      evaluations_due: evaluationsDue
    },
    activity_summary: {
      field_visits_this_month: fieldVisitsThisMonth
    },
    employee_info: {
      employee_id: employee.employee_id,
      employee_code: employee.employee_code,
      employment_status: employee.employment_status,
      onboarding_status: employee.onboarding_status
    }
  };
};

/**
 * Get calendar events for employee (leaves, visits, reports, holidays, evaluations)
 */
const getCalendarEvents = async (user, query) => {
  const employee = await getEmployeeFromUser(user, EmployeeMaster);
  if (!employee) throw new ApiError(404, 'Employee record not found.');

  const month = parseInt(query.month) || (new Date().getMonth() + 1);
  const year = parseInt(query.year) || new Date().getFullYear();
  const monthStart = new Date(year, month - 1, 1).toISOString().split('T')[0];
  const monthEnd = new Date(year, month, 0).toISOString().split('T')[0];
  const dateRange = { [Op.between]: [monthStart, monthEnd] };
  const empId = employee.employee_id;

  // Leaves
  const leaves = await LeaveApplication.findAll({
    where: {
      employee_id: empId,
      status: { [Op.in]: ['APPROVED', 'PENDING'] },
      from_date: { [Op.lte]: monthEnd },
      to_date: { [Op.gte]: monthStart },
      is_deleted: false
    },
    include: [{ model: LeaveType, as: 'leaveType', attributes: ['leave_code', 'leave_name'] }]
  });

  // Field visits
  const visits = await FieldVisit.findAll({
    where: { employee_id: empId, visit_date: dateRange, is_deleted: false },
    attributes: ['visit_id', 'visit_date', 'location', 'status']
  });

  // Monthly report
  const report = await MonthlyReport.findOne({
    where: { employee_id: empId, report_month: month, report_year: year, is_deleted: false },
    attributes: ['report_id', 'status', 'submitted_at']
  });

  // Holidays
  const holidays = await Holiday.findAll({
    where: { holiday_date: dateRange, is_active: true, is_deleted: false }
  });

  // Performance reviews with periods overlapping this month
  const evaluations = await PerformanceReview.findAll({
    where: {
      employee_id: empId,
      period_end: { [Op.gte]: monthStart },
      period_start: { [Op.lte]: monthEnd },
      is_deleted: false
    },
    attributes: ['review_id', 'review_period', 'status', 'period_start', 'period_end']
  });

  // Build events array
  const events = [];

  leaves.forEach(l => {
    events.push({
      type: 'LEAVE',
      title: `${l.leaveType?.leave_name || 'Leave'} (${l.status})`,
      start_date: l.from_date,
      end_date: l.to_date,
      status: l.status,
      id: l.leave_id
    });
  });

  visits.forEach(v => {
    events.push({
      type: 'VISIT',
      title: `Field Visit: ${v.location}`,
      start_date: v.visit_date,
      end_date: v.visit_date,
      status: v.status,
      id: v.visit_id
    });
  });

  if (report) {
    events.push({
      type: 'REPORT',
      title: `Monthly Report (${report.status})`,
      start_date: report.submitted_at ? report.submitted_at.toISOString().split('T')[0] : null,
      status: report.status,
      id: report.report_id
    });
  }

  holidays.forEach(h => {
    events.push({
      type: 'HOLIDAY',
      title: h.holiday_name,
      start_date: h.holiday_date,
      end_date: h.holiday_date,
      status: 'ACTIVE'
    });
  });

  evaluations.forEach(e => {
    events.push({
      type: 'EVALUATION',
      title: `Evaluation: ${e.review_period}`,
      start_date: e.period_start,
      end_date: e.period_end,
      status: e.status,
      id: e.review_id
    });
  });

  return {
    month,
    year,
    events
  };
};

module.exports = {
  getAdminDashboard,
  getEmployeeDashboard,
  getCalendarEvents
};
