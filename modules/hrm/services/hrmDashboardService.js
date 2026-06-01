const db = require('../../../models');
const { Op } = db.Sequelize;
const logger = require('../../../config/logger');
const { Attendance, LeaveApplication, LeaveType, MonthlyReport, PerformanceReview, FieldVisit, EmployeeMaster, Holiday } = require('../models');
const { getEmployeeFromUser, getEmployeeIdsUnderAdmin } = require('../utils/hrmHelpers');
const { getWorkingDaysInMonth } = require('../utils/workingDayHelpers');
const ApplicantPersonal = db.ApplicantPersonal;

/**
 * Admin HRM Dashboard
 * Shows: total employees, present today, on leave, contract expiring,
 *        pending reports, leave approvals, evaluations due, field visits,
 *        district-wise attendance, monthly report status
 */
const getAdminDashboard = async (adminUser) => {
  try {
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
        district_attendance: [], report_status: { submitted: 0, approved: 0, rejected: 0, pending: 0 },
        leave_usage_report: [], contract_expiry_alerts: []
      };
    }

    const empFilter = { employee_id: { [Op.in]: employeeIds } };
    const totalEmployees = employeeIds.length;

    // ---- Simple count queries (no JOINs, no GROUP BY) ----
    let presentToday = 0, onLeaveToday = 0, contractExpiring = 0;
    let pendingReports = 0, leaveApprovals = 0, evaluationsDue = 0, fieldVisitsThisMonth = 0;
    
    try {
      presentToday = await Attendance.count({
        where: { ...empFilter, attendance_date: today, status: 'PRESENT', is_deleted: false }
      });
    } catch (e) { logger.error('Attendance query failed:', e.message); }
    
    try {
      onLeaveToday = await LeaveApplication.count({
        where: { ...empFilter, status: 'APPROVED', from_date: { [Op.lte]: today }, to_date: { [Op.gte]: today }, is_deleted: false }
      });
    } catch (e) { logger.error('LeaveApplication count failed:', e.message); }
    
    try {
      contractExpiring = await EmployeeMaster.count({
        where: { ...empFilter, contract_end_date: { [Op.between]: [today, thirtyDaysFromNow] }, is_deleted: false }
      });
    } catch (e) { logger.error('Contract expiring count failed:', e.message); }
    
    try {
      pendingReports = await MonthlyReport.count({
        where: { ...empFilter, status: 'SUBMITTED', is_deleted: false }
      });
    } catch (e) { logger.error('Pending reports count failed:', e.message); }
    
    try {
      leaveApprovals = await LeaveApplication.count({
        where: { ...empFilter, status: 'PENDING', is_deleted: false }
      });
    } catch (e) { logger.error('Leave approvals count failed:', e.message); }
    
    try {
      evaluationsDue = await PerformanceReview.count({
        where: { ...empFilter, status: 'SELF_SUBMITTED', is_deleted: false }
      });
    } catch (e) { logger.error('Evaluations count failed:', e.message); }

    const monthStart = new Date(currentYear, currentMonth - 1, 1).toISOString().split('T')[0];
    const monthEnd = new Date(currentYear, currentMonth, 0).toISOString().split('T')[0];
    try {
      fieldVisitsThisMonth = await FieldVisit.count({
        where: { ...empFilter, visit_date: { [Op.between]: [monthStart, monthEnd] }, is_deleted: false }
      });
    } catch (e) { logger.error('Field visits count failed:', e.message); }

    // ---- District attendance (plain queries, JS aggregation) ----
    let districtAttendance = [];
    try {
      const allEmployeesInDistrict = await EmployeeMaster.findAll({
        where: { ...empFilter, is_deleted: false },
        attributes: ['employee_id', 'district_id'],
        raw: true
      });

      const presentEmployeeIds = await Attendance.findAll({
        where: { ...empFilter, attendance_date: today, status: 'PRESENT', is_deleted: false },
        attributes: ['employee_id'],
        raw: true
      }).then(rows => new Set(rows.map(r => r.employee_id)));

      const districtNames = await db.DistrictMaster.findAll({
        attributes: ['district_id', 'district_name'],
        raw: true
      });
      const districtNameMap = {};
      districtNames.forEach(d => { districtNameMap[d.district_id] = d.district_name; });

      const districtMap = {};
      allEmployeesInDistrict.forEach(emp => {
        const did = emp.district_id;
        if (!districtMap[did]) {
          districtMap[did] = { district_id: did, district_name: districtNameMap[did] || 'Unknown', total_employees: 0, present_today: 0, attendance_percentage: 0 };
        }
        districtMap[did].total_employees++;
        if (presentEmployeeIds.has(emp.employee_id)) districtMap[did].present_today++;
      });
      Object.values(districtMap).forEach(d => {
        d.attendance_percentage = d.total_employees > 0 ? Math.round((d.present_today / d.total_employees) * 100) : 0;
      });
      districtAttendance = Object.values(districtMap).sort((a, b) => b.present_today - a.present_today);
    } catch (e) { logger.error('District attendance failed:', e.message); }

    // ---- Report status (plain query, JS aggregation) ----
    const reportStatus = { submitted: 0, approved: 0, rejected: 0, pending: 0 };
    try {
      const reportRows = await MonthlyReport.findAll({
        where: { ...empFilter, report_month: currentMonth, report_year: currentYear, is_deleted: false },
        attributes: ['status'],
        raw: true
      });
      reportRows.forEach(r => {
        const key = r.status ? r.status.toLowerCase() : '';
        if (reportStatus[key] !== undefined) reportStatus[key]++;
      });
      reportStatus.pending = Math.max(0, totalEmployees - reportStatus.submitted - reportStatus.approved - reportStatus.rejected);
    } catch (e) { logger.error('Report status failed:', e.message); }

    // ---- Leave usage (plain query, JS aggregation) ----
    let leaveUsageReport = [];
    try {
      const leaveRows = await LeaveApplication.findAll({
        where: { ...empFilter, status: 'APPROVED', is_deleted: false },
        attributes: ['leave_type_id', 'total_days', 'from_date', 'to_date'],
        raw: true
      });
      const leaveUsageMap = {};
      leaveRows.forEach(r => {
        if (r.from_date >= monthStart && r.to_date <= monthEnd) {
          leaveUsageMap[r.leave_type_id] = (leaveUsageMap[r.leave_type_id] || 0) + (parseFloat(r.total_days) || 0);
        }
      });
      const leaveTypeIds = Object.keys(leaveUsageMap).map(Number);
      const leaveTypes = leaveTypeIds.length > 0 ? await LeaveType.findAll({
        where: { leave_type_id: { [Op.in]: leaveTypeIds } },
        attributes: ['leave_type_id', 'leave_name', 'leave_code'],
        raw: true
      }) : [];
      const leaveTypeMap = {};
      leaveTypes.forEach(lt => { leaveTypeMap[lt.leave_type_id] = lt; });
      leaveUsageReport = Object.entries(leaveUsageMap).map(([typeId, days]) => ({
        leave_code: leaveTypeMap[typeId]?.leave_code || `TYPE_${typeId}`,
        leave_name: leaveTypeMap[typeId]?.leave_name || `Leave Type ${typeId}`,
        days_used: days,
        percentage_of_staff: totalEmployees > 0 ? Math.round((days / totalEmployees) * 100) : 0
      }));
    } catch (e) { logger.error('Leave usage failed:', e.message); }

    // ---- Contract expiry alerts (disabled due to database error) ----
    const contractExpiryAlerts = [];

    return {
      total_employees: totalEmployees,
      present_today: presentToday,
      on_leave_today: onLeaveToday,
      contract_expiring: contractExpiring,
      contract_expiry_alerts: contractExpiryAlerts,
      pending_reports: pendingReports,
      leave_approvals: leaveApprovals,
      evaluations_due: evaluationsDue,
      field_visits_this_month: fieldVisitsThisMonth,
      district_attendance: districtAttendance,
      report_status: reportStatus,
      leave_usage_report: leaveUsageReport
    };
  } catch (error) {
    logger.error('getAdminDashboard error:', error);
    throw error;
  }
};

/**
 * Employee (Applicant) HRM Dashboard
 * Shows: attendance rate, leave balance, salary status, documents,
 *        quick actions summary
 */
const getEmployeeDashboard = async (user) => {
  let employeeId = null;
  try {
    logger.info('getEmployeeDashboard: Starting dashboard fetch', { 
      user_id: user.id || user.employee_id || user.applicant_id,
      user_type: typeof user,
      user_keys: Object.keys(user)
    });

    const employee = await getEmployeeFromUser(user, EmployeeMaster);
    if (!employee) {
      logger.warn('getEmployeeDashboard: Employee not found for user', { 
        user_id: user.id || user.employee_id || user.applicant_id 
      });
      // Return safe default response instead of throwing error
      return {
        success: true,
        message: 'No employee record found',
        data: {
          employee_id: null,
          full_name: user.username || 'User',
          employee_code: null,
          employment_status: 'NOT_ONBOARDED',
          is_active: false,
          attendance_summary: {
            present_days: 0,
            absent_days: 0,
            half_days: 0,
            leave_days: 0,
            holidays: 0,
            total_days: 0
          },
          leave_balance: [],
          upcoming_holidays: [],
          recent_activities: []
        }
      };
    }

    employeeId = employee.employee_id;
    const today = new Date().toISOString().split('T')[0];
    const currentMonth = new Date().getMonth() + 1;
    const currentYear = new Date().getFullYear();

    // Get personal information for full name
    let personalInfo = null;
    if (employee.applicant_id) {
      try {
        personalInfo = await ApplicantPersonal.findOne({
          where: { applicant_id: employee.applicant_id, is_deleted: false },
          attributes: ['full_name'],
          raw: true
        });
      } catch (e) {
        logger.error('Personal info fetch failed:', e.message);
      }
    }

    // Get attendance rate for current month
    const workingDaysResult = await getWorkingDaysInMonth(currentMonth, currentYear);
    const workingDays = workingDaysResult.workingDays;
    const attendanceRecords = await Attendance.findAll({
      where: {
        employee_id: employeeId,
        attendance_date: {
          [Op.gte]: new Date(currentYear, currentMonth - 1, 1).toISOString().split('T')[0],
          [Op.lte]: new Date(currentYear, currentMonth, 0).toISOString().split('T')[0]
        },
        is_deleted: false
      },
      attributes: ['status'],
      raw: true
    });

    const presentDays = attendanceRecords.filter(r => r.status === 'PRESENT').length;
    const attendanceRate = workingDays > 0 ? Math.round((presentDays / workingDays) * 100) : 0;

    // Get leave balance
    const leaveBalance = await LeaveApplication.findAll({
      where: {
        employee_id: employeeId,
        status: 'APPROVED',
        is_deleted: false
      },
      attributes: ['leave_type_id', 'total_days'],
      raw: true
    });

    // Get documents status
    const documentsStatus = {
      aadhaar: employee.aadhaar_verified || false,
      pan: employee.pan_verified || false,
      bank: employee.bank_account_verified || false
    };

    return {
      employee_info: {
        employee_id: employee.employee_id,
        employee_code: employee.employee_code,
        full_name: personalInfo?.full_name || `${employee.first_name || ''} ${employee.last_name || ''}`.trim() || employee.employee_code,
        designation: employee.designation || 'N/A',
        district: employee.district_name || 'N/A'
      },
      attendance_summary: {
        rate: attendanceRate,
        present: presentDays,
        total_days: workingDays
      },
      leave_balance: leaveBalance.reduce((acc, leave) => {
        acc[leave.leave_type_id] = (acc[leave.leave_type_id] || 0) + parseFloat(leave.total_days);
        return acc;
      }, {}),
      salary: {
        status: 'not_available',
        last_paid: null
      },
      documents: documentsStatus,
      quick_actions: {
        can_apply_leave: true,
        can_view_payslip: false,
        can_download_documents: true
      },
      pending_actions: {
        pending_leaves: 0,
        pending_reports: 0,
        evaluations_due: 0
      },
      activity_summary: {
        field_visits_this_month: 0
      },
      today_status: {
        attendance_status: presentDays > 0 ? 'PRESENT' : 'NOT_MARKED'
      }
    };
  } catch (error) {
    logger.error('getEmployeeDashboard: Error fetching dashboard data', {
      employee_id: employeeId,
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
};

module.exports = {
  getAdminDashboard,
  getEmployeeDashboard
};
