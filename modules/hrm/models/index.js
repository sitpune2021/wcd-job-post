const EmployeeMaster = require('./EmployeeMaster');
const EmployeeOnboardingLog = require('./EmployeeOnboardingLog');
const Attendance = require('./Attendance');
const LeaveType = require('./LeaveType');
const LeaveBalance = require('./LeaveBalance');
const LeaveApplication = require('./LeaveApplication');
const MonthlyReport = require('./MonthlyReport');
const FieldVisit = require('./FieldVisit');
const PerformanceReview = require('./PerformanceReview');
const Holiday = require('./Holiday');
const PayrollCycle = require('./PayrollCycle');
const Payslip = require('./Payslip');

// Define associations
const setupAssociations = (db) => {
  // ==================== EmployeeMaster (Phase 1) ====================
  EmployeeMaster.belongsTo(db.ApplicantMaster, {
    foreignKey: 'applicant_id',
    as: 'applicant'
  });

  EmployeeMaster.belongsTo(db.Application, {
    foreignKey: 'application_id',
    as: 'application'
  });

  EmployeeMaster.belongsTo(db.PostMaster, {
    foreignKey: 'post_id',
    as: 'post'
  });

  EmployeeMaster.belongsTo(db.DistrictMaster, {
    foreignKey: 'district_id',
    as: 'district'
  });

  EmployeeMaster.belongsTo(db.Component, {
    foreignKey: 'component_id',
    as: 'component'
  });

  EmployeeMaster.belongsTo(db.Hub, {
    foreignKey: 'hub_id',
    as: 'hub'
  });

  EmployeeMaster.belongsTo(db.AdminUser, {
    foreignKey: 'onboarding_email_sent_by',
    as: 'emailSentByAdmin'
  });

  EmployeeMaster.belongsTo(db.AdminUser, {
    foreignKey: 'reporting_officer_id',
    as: 'reportingOfficer'
  });

  // EmployeeOnboardingLog
  EmployeeOnboardingLog.belongsTo(EmployeeMaster, {
    foreignKey: 'employee_id',
    as: 'employee'
  });

  EmployeeOnboardingLog.belongsTo(db.AdminUser, {
    foreignKey: 'performed_by',
    as: 'performedByAdmin'
  });

  EmployeeMaster.hasMany(EmployeeOnboardingLog, {
    foreignKey: 'employee_id',
    as: 'onboardingLogs'
  });

  db.ApplicantMaster.hasOne(EmployeeMaster, {
    foreignKey: 'applicant_id',
    as: 'employeeProfile'
  });

  db.Application.hasOne(EmployeeMaster, {
    foreignKey: 'application_id',
    as: 'employeeProfile'
  });

  // ==================== Attendance (Phase 2) ====================
  Attendance.belongsTo(EmployeeMaster, {
    foreignKey: 'employee_id',
    as: 'employee'
  });

  EmployeeMaster.hasMany(Attendance, {
    foreignKey: 'employee_id',
    as: 'attendanceRecords'
  });

  // ==================== Leave (Phase 2) ====================
  LeaveBalance.belongsTo(EmployeeMaster, {
    foreignKey: 'employee_id',
    as: 'employee'
  });

  LeaveBalance.belongsTo(LeaveType, {
    foreignKey: 'leave_type_id',
    as: 'leaveType'
  });

  EmployeeMaster.hasMany(LeaveBalance, {
    foreignKey: 'employee_id',
    as: 'leaveBalances'
  });

  LeaveApplication.belongsTo(EmployeeMaster, {
    foreignKey: 'employee_id',
    as: 'employee'
  });

  LeaveApplication.belongsTo(LeaveType, {
    foreignKey: 'leave_type_id',
    as: 'leaveType'
  });

  LeaveApplication.belongsTo(db.AdminUser, {
    foreignKey: 'approved_by',
    as: 'approver'
  });

  EmployeeMaster.hasMany(LeaveApplication, {
    foreignKey: 'employee_id',
    as: 'leaveApplications'
  });

  // ==================== Monthly Reports (Phase 2) ====================
  MonthlyReport.belongsTo(EmployeeMaster, {
    foreignKey: 'employee_id',
    as: 'employee'
  });

  MonthlyReport.belongsTo(db.AdminUser, {
    foreignKey: 'appraiser_id',
    as: 'appraiser'
  });

  EmployeeMaster.hasMany(MonthlyReport, {
    foreignKey: 'employee_id',
    as: 'monthlyReports'
  });

  // ==================== Field Visits (Phase 2) ====================
  FieldVisit.belongsTo(EmployeeMaster, {
    foreignKey: 'employee_id',
    as: 'employee'
  });

  FieldVisit.belongsTo(db.AdminUser, {
    foreignKey: 'reviewed_by',
    as: 'reviewer'
  });

  EmployeeMaster.hasMany(FieldVisit, {
    foreignKey: 'employee_id',
    as: 'fieldVisits'
  });

  // ==================== Performance Reviews (Phase 2) ====================
  PerformanceReview.belongsTo(EmployeeMaster, {
    foreignKey: 'employee_id',
    as: 'employee'
  });

  PerformanceReview.belongsTo(db.AdminUser, {
    foreignKey: 'appraiser_id',
    as: 'appraiser'
  });

  EmployeeMaster.hasMany(PerformanceReview, {
    foreignKey: 'employee_id',
    as: 'performanceReviews'
  });

  // ==================== Payroll (Simplified) ====================
  PayrollCycle.belongsTo(db.AdminUser, {
    foreignKey: 'generated_by',
    as: 'generator'
  });

  PayrollCycle.hasMany(Payslip, {
    foreignKey: 'cycle_id',
    as: 'payslips'
  });

  Payslip.belongsTo(PayrollCycle, {
    foreignKey: 'cycle_id',
    as: 'cycle'
  });

  Payslip.belongsTo(EmployeeMaster, {
    foreignKey: 'employee_id',
    as: 'employee'
  });

  EmployeeMaster.hasMany(Payslip, {
    foreignKey: 'employee_id',
    as: 'payslips'
  });
};

module.exports = {
  EmployeeMaster,
  EmployeeOnboardingLog,
  Attendance,
  LeaveType,
  LeaveBalance,
  LeaveApplication,
  MonthlyReport,
  FieldVisit,
  PerformanceReview,
  Holiday,
  PayrollCycle,
  Payslip,
  setupAssociations
};
