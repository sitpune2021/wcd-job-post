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

/**
 * Get scheme-wise attendance data with filtering
 * Provides breakdown by district and scheme type (OSC/HUB/OTHER)
 */
const getSchemeWiseAttendance = async (adminUser, filters = {}) => {
  try {
    const employeeIds = await getEmployeeIdsUnderAdmin(adminUser, EmployeeMaster);
    const { district_id, scheme_type, date } = filters;
    const targetDate = date || new Date().toISOString().split('T')[0];

    if (employeeIds.length === 0) {
      return {
        summary: { total_employees: 0, present_today: 0, attendance_percentage: 0 },
        districts: [],
        schemes: [],
        filters_applied: { district_id, scheme_type, date: targetDate }
      };
    }

    const empFilter = { employee_id: { [Op.in]: employeeIds }, is_deleted: false };
    
    // Add district filter if specified
    if (district_id) {
      empFilter.district_id = district_id;
    }

    // Get all employees with their scheme information
    const employees = await EmployeeMaster.findAll({
      where: empFilter,
      attributes: ['employee_id', 'district_id', 'scheme_id'],
      raw: true
    });

    // Get scheme information separately
    const schemeIds = [...new Set(employees.map(e => e.scheme_id).filter(Boolean))];
    const schemes = schemeIds.length > 0 ? await db.Scheme.findAll({
      where: { scheme_id: { [Op.in]: schemeIds } },
      attributes: ['scheme_id', 'scheme_name', 'scheme_type_id'],
      include: [{
        model: db.SchemeType,
        as: 'schemeType',
        attributes: ['scheme_code'],
        required: false
      }],
      raw: false
    }) : [];
    const schemeMap = {};
    schemes.forEach(s => { 
      schemeMap[s.scheme_id] = {
        scheme_id: s.scheme_id,
        scheme_name: s.scheme_name,
        scheme_type: s.schemeType ? s.schemeType.scheme_code : 'OTHER'
      };
    });

    // Get present employees for the target date
    const presentEmployees = await Attendance.findAll({
      where: {
        employee_id: { [Op.in]: employeeIds },
        attendance_date: targetDate,
        status: 'PRESENT',
        is_deleted: false
      },
      attributes: ['employee_id'],
      raw: true
    }).then(rows => new Set(rows.map(r => r.employee_id)));

    // Get district names
    const districtIds = [...new Set(employees.map(e => e.district_id).filter(Boolean))];
    const districts = districtIds.length > 0 ? await db.DistrictMaster.findAll({
      where: { district_id: { [Op.in]: districtIds } },
      attributes: ['district_id', 'district_name'],
      raw: true
    }) : [];
    const districtMap = {};
    districts.forEach(d => { districtMap[d.district_id] = d.district_name; });

    // Process data by district and scheme
    const districtData = {};
    const schemeData = {
      OSC: { total: 0, present: 0, percentage: 0 },
      HUB: { total: 0, present: 0, percentage: 0 },
      OTHER: { total: 0, present: 0, percentage: 0 }
    };

    let totalEmployees = 0;
    let totalPresent = 0;

    employees.forEach(employee => {
      const districtId = employee.district_id;
      const scheme = schemeMap[employee.scheme_id];
      const schemeType = scheme?.scheme_type || 'OTHER';
      const isPresent = presentEmployees.has(employee.employee_id);

      // Initialize district if not exists
      if (!districtData[districtId]) {
        districtData[districtId] = {
          district_id: districtId,
          district_name: districtMap[districtId] || 'Unknown',
          total_employees: 0,
          present_today: 0,
          attendance_percentage: 0,
          schemes: {
            OSC: { total: 0, present: 0, percentage: 0 },
            HUB: { total: 0, present: 0, percentage: 0 },
            OTHER: { total: 0, present: 0, percentage: 0 }
          }
        };
      }

      // Update district data
      districtData[districtId].total_employees++;
      districtData[districtId].present_today += isPresent ? 1 : 0;
      
      // Ensure schemes object exists for the schemeType
      if (!districtData[districtId].schemes[schemeType]) {
        districtData[districtId].schemes[schemeType] = { total: 0, present: 0, percentage: 0 };
      }
      districtData[districtId].schemes[schemeType].total++;
      districtData[districtId].schemes[schemeType].present += isPresent ? 1 : 0;

      // Update scheme data
      if (!scheme_type || scheme_type === schemeType) {
        // Ensure scheme data exists for the schemeType
        if (!schemeData[schemeType]) {
          schemeData[schemeType] = { total: 0, present: 0, percentage: 0 };
        }
        schemeData[schemeType].total++;
        schemeData[schemeType].present += isPresent ? 1 : 0;
      }

      // Update totals
      if (!scheme_type || scheme_type === schemeType) {
        totalEmployees++;
        totalPresent += isPresent ? 1 : 0;
      }
    });

    // Calculate percentages
    Object.keys(districtData).forEach(districtId => {
      const district = districtData[districtId];
      district.attendance_percentage = district.total_employees > 0 
        ? Math.round((district.present_today / district.total_employees) * 100) 
        : 0;

      Object.keys(district.schemes).forEach(scheme => {
        const schemeData = district.schemes[scheme];
        schemeData.percentage = schemeData.total > 0 
          ? Math.round((schemeData.present / schemeData.total) * 100) 
          : 0;
      });
    });

    Object.keys(schemeData).forEach(scheme => {
      schemeData[scheme].percentage = schemeData[scheme].total > 0 
        ? Math.round((schemeData[scheme].present / schemeData[scheme].total) * 100) 
        : 0;
    });

    const attendancePercentage = totalEmployees > 0 
      ? Math.round((totalPresent / totalEmployees) * 100) 
      : 0;

    return {
      summary: {
        total_employees: totalEmployees,
        present_today: totalPresent,
        attendance_percentage: attendancePercentage
      },
      districts: Object.values(districtData).sort((a, b) => b.present_today - a.present_today),
      schemes: Object.entries(schemeData).map(([type, data]) => ({
        scheme_type: type,
        ...data
      })).filter(s => s.total > 0),
      filters_applied: { district_id, scheme_type, date: targetDate }
    };
  } catch (error) {
    logger.error('getSchemeWiseAttendance error:', error);
    throw error;
  }
};

/**
 * Generate PDF for scheme-wise attendance report
 */
const generateSchemeWiseAttendancePDF = async (adminUser, filters = {}) => {
  try {
    const data = await getSchemeWiseAttendance(adminUser, filters);
    
    // Generate HTML for PDF using existing pattern
    const html = generateSchemeWiseAttendanceHTML(data, filters);
    
    // Use existing html-pdf-node approach
    const htmlToPdf = require('html-pdf-node');
    const pdfBuffer = await htmlToPdf.generatePdf(
      { content: html },
      {
        format: 'A4',
        printBackground: true,
        margin: { top: '14mm', right: '12mm', bottom: '14mm', left: '12mm' },
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
      }
    );
    
    // Validate PDF buffer
    if (!pdfBuffer || Buffer.byteLength(pdfBuffer) < 100) {
      throw new Error('PDF generation failed: Empty or invalid PDF buffer');
    }
    
    return pdfBuffer;
  } catch (error) {
    logger.error('generateSchemeWiseAttendancePDF error:', error);
    throw error;
  }
};

const generateSchemeWiseAttendanceHTML = (data, filters) => {
  const currentDate = filters.date || new Date().toISOString().split('T')[0];
  
  let html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Scheme-wise Attendance Report</title>
      <style>
        body { 
          font-family: Arial, sans-serif; 
          margin: 15px; 
          color: #333;
          font-size: 11px;
        }
        .header { 
          text-align: center; 
          margin-bottom: 20px; 
          border-bottom: 1px solid #333;
          padding-bottom: 15px;
        }
        .title { 
          font-size: 16px; 
          font-weight: bold; 
          margin-bottom: 8px;
        }
        .date-info { 
          font-size: 10px; 
          color: #666;
          margin-bottom: 3px;
        }
        .section { 
          margin-bottom: 20px; 
        }
        .section-title { 
          font-size: 13px; 
          font-weight: bold; 
          margin-bottom: 10px;
          border-bottom: 1px solid #ccc;
          padding-bottom: 3px;
        }
        table { 
          width: 100%; 
          border-collapse: collapse; 
          margin-bottom: 15px;
          font-size: 10px;
        }
        th, td { 
          border: 1px solid #ddd; 
          padding: 6px; 
          text-align: left; 
          vertical-align: top;
        }
        th { 
          background-color: #f5f5f5; 
          font-weight: bold;
          font-size: 9px;
        }
        .text-center { text-align: center; }
        .text-right { text-align: right; }
        .no-data { 
          text-align: center; 
          color: #999; 
          font-style: italic;
          padding: 15px;
          font-size: 10px;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="title">Scheme-wise Attendance Report</div>
        <div class="date-info">Date: ${currentDate}</div>
        ${filters.district_id ? `<div class="date-info">District ID: ${filters.district_id}</div>` : ''}
        ${filters.scheme_type ? `<div class="date-info">Scheme Type: ${filters.scheme_type}</div>` : ''}
        ${filters.scheme_id ? `<div class="date-info">Scheme ID: ${filters.scheme_id}</div>` : ''}
        <div class="date-info">Generated on: ${new Date().toLocaleString()}</div>
      </div>
  `;
  
  // Summary section
  if (data.summary) {
    html += `
      <div class="section">
        <div class="section-title">Summary</div>
        <table>
          <tr>
            <td><strong>Total Employees</strong></td>
            <td class="text-right">${data.summary.total_employees || 0}</td>
          </tr>
          <tr>
            <td><strong>Present Today</strong></td>
            <td class="text-right">${data.summary.present_today || 0}</td>
          </tr>
          <tr>
            <td><strong>Attendance Percentage</strong></td>
            <td class="text-right">${data.summary.attendance_percentage || 0}%</td>
          </tr>
        </table>
      </div>
    `;
  }
  
  // Scheme breakdown section
  html += `
    <div class="section">
      <div class="section-title">Attendance by Scheme</div>
  `;
  
  if (data.schemes && data.schemes.length > 0) {
    // Show all available scheme types dynamically, excluding 'Other'
    const availableSchemes = data.schemes.filter(scheme => 
      scheme.scheme_type && 
      scheme.scheme_type !== 'OTHER' && 
      scheme.total > 0
    );
    
    if (availableSchemes.length > 0) {
      html += `
        <table>
          <thead>
            <tr>
              <th>Scheme Type</th>
              <th class="text-center">Present</th>
              <th class="text-center">Total</th>
              <th class="text-center">Percentage</th>
            </tr>
          </thead>
          <tbody>
      `;
      
      availableSchemes.forEach(scheme => {
        html += `
          <tr>
            <td>${scheme.scheme_type}</td>
            <td class="text-center">${scheme.present || 0}</td>
            <td class="text-center">${scheme.total || 0}</td>
            <td class="text-center">${scheme.percentage || 0}%</td>
          </tr>
        `;
      });
      
      html += `
          </tbody>
        </table>
      `;
    } else {
      html += `<div class="no-data">No scheme data available</div>`;
    }
  } else {
    html += `<div class="no-data">No scheme data available</div>`;
  }
  
  html += `</div>`;
  
  // District-wise section with scheme breakdown
  html += `
    <div class="section">
      <div class="section-title">District Attendance Details</div>
  `;
  
  if (data.districts && data.districts.length > 0) {
    // Get all unique scheme types from data, excluding 'Other'
    const allSchemeTypes = [...new Set(data.districts.flatMap(d => 
      Object.keys(d.schemes || {}).filter(schemeType => schemeType !== 'OTHER')
    ))];
    
    // Build dynamic table headers
    let headerRow = '<th>District Name</th><th class="text-center">Total</th><th class="text-center">Present</th><th class="text-center">%</th>';
    allSchemeTypes.forEach(schemeType => {
      headerRow += `<th class="text-center">${schemeType}</th>`;
    });
    
    html += `
      <table>
        <thead>
          <tr>
            ${headerRow}
          </tr>
        </thead>
        <tbody>
    `;
    
    data.districts.forEach(district => {
      let row = `<td><strong>${district.district_name || 'N/A'}</strong></td>`;
      row += `<td class="text-center">${district.total_employees || 0}</td>`;
      row += `<td class="text-center">${district.present_today || 0}</td>`;
      row += `<td class="text-center">${district.attendance_percentage || 0}%</td>`;
      
      // Add scheme data dynamically
      allSchemeTypes.forEach(schemeType => {
        const schemeData = district.schemes?.[schemeType] || { total: 0, present: 0, percentage: 0 };
        row += `<td class="text-center">${schemeData.present}/${schemeData.total} (${schemeData.percentage}%)</td>`;
      });
      
      html += `<tr>${row}</tr>`;
    });
    
    html += `
        </tbody>
      </table>
    `;
  } else {
    html += `<div class="no-data">No district data available</div>`;
  }
  
  html += `
      </div>
    </body>
    </html>
  `;
  
  return html;
};

/**
 * Get districts for filtering based on admin's access level
 */
const getDistrictsForFiltering = async (adminUser) => {
  try {
    const employeeIds = await getEmployeeIdsUnderAdmin(adminUser, EmployeeMaster);
    
    if (employeeIds.length === 0) {
      return [];
    }

    // Get unique districts from employees
    const employees = await EmployeeMaster.findAll({
      where: { employee_id: { [Op.in]: employeeIds }, is_deleted: false },
      attributes: ['district_id'],
      raw: true
    });

    const districtIds = [...new Set(employees.map(e => e.district_id).filter(Boolean))];
    
    if (districtIds.length === 0) {
      return [];
    }

    const districts = await db.DistrictMaster.findAll({
      where: { district_id: { [Op.in]: districtIds }, is_active: true },
      attributes: ['district_id', 'district_name'],
      order: [['district_name', 'ASC']],
      raw: true
    });

    return districts.map(d => ({
      district_id: d.district_id,
      district_name: d.district_name
    }));
  } catch (error) {
    logger.error('getDistrictsForFiltering error:', error);
    throw error;
  }
};

/**
 * Get schemes for filtering based on admin's access level and optional district filter
 */
const getSchemesForFiltering = async (adminUser, filters = {}) => {
  try {
    const { district_id } = filters;
    const employeeIds = await getEmployeeIdsUnderAdmin(adminUser, EmployeeMaster);
    
    if (employeeIds.length === 0) {
      return [];
    }

    const empFilter = { employee_id: { [Op.in]: employeeIds }, is_deleted: false };
    
    // Add district filter if specified
    if (district_id) {
      empFilter.district_id = district_id;
    }

    // Get unique schemes from employees
    const employees = await EmployeeMaster.findAll({
      where: empFilter,
      attributes: ['scheme_id'],
      raw: true
    });

    const schemeIds = [...new Set(employees.map(e => e.scheme_id).filter(Boolean))];
    
    if (schemeIds.length === 0) {
      return [];
    }

    const schemes = await db.Scheme.findAll({
      where: { scheme_id: { [Op.in]: schemeIds }, is_active: true },
      attributes: ['scheme_id', 'scheme_name', 'scheme_type_id'],
      include: [{
        model: db.SchemeType,
        as: 'schemeType',
        attributes: ['scheme_code'],
        required: false
      }],
      order: [['scheme_name', 'ASC']],
      raw: false
    });

    return schemes.map(s => ({
      scheme_id: s.scheme_id,
      scheme_name: s.scheme_name,
      scheme_type: s.schemeType ? s.schemeType.scheme_code : 'OTHER'
    }));
  } catch (error) {
    logger.error('getSchemesForFiltering error:', error);
    throw error;
  }
};

module.exports = {
  getAdminDashboard,
  getEmployeeDashboard,
  getSchemeWiseAttendance,
  generateSchemeWiseAttendancePDF,
  getDistrictsForFiltering,
  getSchemesForFiltering
};
