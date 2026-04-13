/**
 * Monthly Report Service
 * Handles report submission, review, and summaries
 */
const { Op, fn, col, literal } = require('sequelize');
const logger = require('../../../config/logger');
const { ApiError } = require('../../../middleware/errorHandler');
const db = require('../../../models');
const { MonthlyReport } = require('../models');
const EmployeeMaster = db.EmployeeMaster;
const { getEmployeeFromUser, getEmployeeIdsUnderAdmin, getPagination, paginatedResponse, getMonthName } = require('../utils/hrmHelpers');

/**
 * Submit or update a monthly report (employee)
 */
const submitReport = async (user, data) => {
  const employee = await getEmployeeFromUser(user, EmployeeMaster);
  if (!employee) throw new ApiError(404, 'Employee record not found.');
  if (employee.employment_status !== 'ACTIVE') throw new ApiError(403, 'Only active employees can submit reports.');

  // Check if report already exists for this month
  const existing = await MonthlyReport.findOne({
    where: {
      employee_id: employee.employee_id,
      report_month: data.report_month,
      report_year: data.report_year,
      is_deleted: false
    }
  });

  if (existing) {
    if (existing.status === 'APPROVED') {
      throw new ApiError(400, 'Report for this month has already been approved.');
    }
    // Update existing draft/rejected report
    existing.work_category = data.work_category || existing.work_category;
    existing.nature_of_work = data.nature_of_work;
    existing.beneficiaries_reached = data.beneficiaries_reached || 0;
    existing.field_visits_conducted = data.field_visits_conducted || 0;
    existing.key_achievements = data.key_achievements || null;
    existing.challenges_faced = data.challenges_faced || null;
    existing.improvement_plan = data.improvement_plan || null;
    existing.status = 'SUBMITTED';
    existing.submitted_at = new Date();
    existing.updated_by = user.applicant_id || user.id;
    existing.updated_at = new Date();
    await existing.save();

    logger.info(`Monthly report updated: employee=${employee.employee_code}, month=${data.report_month}/${data.report_year}`);
    return existing;
  }

  // Create new report
  const report = await MonthlyReport.create({
    employee_id: employee.employee_id,
    report_month: data.report_month,
    report_year: data.report_year,
    work_category: data.work_category || null,
    nature_of_work: data.nature_of_work,
    beneficiaries_reached: data.beneficiaries_reached || 0,
    field_visits_conducted: data.field_visits_conducted || 0,
    key_achievements: data.key_achievements || null,
    challenges_faced: data.challenges_faced || null,
    improvement_plan: data.improvement_plan || null,
    status: 'SUBMITTED',
    submitted_at: new Date(),
    created_by: user.applicant_id || user.id
  });

  logger.info(`Monthly report submitted: employee=${employee.employee_code}, month=${data.report_month}/${data.report_year}`);
  return report;
};

/**
 * Get my reports (employee view)
 */
const getMyReports = async (user, query) => {
  const employee = await getEmployeeFromUser(user, EmployeeMaster);
  if (!employee) throw new ApiError(404, 'Employee record not found.');

  const { page, limit, offset } = getPagination(query);
  const where = { employee_id: employee.employee_id, is_deleted: false };

  if (query.status) where.status = query.status;
  if (query.year) where.report_year = parseInt(query.year);

  const { count, rows } = await MonthlyReport.findAndCountAll({
    where,
    order: [['report_year', 'DESC'], ['report_month', 'DESC']],
    limit,
    offset
  });

  return paginatedResponse(rows, count, page, limit);
};

/**
 * Get report stats for employee dashboard
 */
const getMyReportStats = async (user) => {
  const employee = await getEmployeeFromUser(user, EmployeeMaster);
  if (!employee) throw new ApiError(404, 'Employee record not found.');

  const year = new Date().getFullYear();
  const reports = await MonthlyReport.findAll({
    where: { employee_id: employee.employee_id, report_year: year, is_deleted: false },
    attributes: ['status']
  });

  return {
    submitted: reports.filter(r => r.status === 'SUBMITTED').length,
    approved: reports.filter(r => r.status === 'APPROVED').length,
    rejected: reports.filter(r => r.status === 'REJECTED').length,
    pending: reports.filter(r => r.status === 'SUBMITTED').length
  };
};

/**
 * Get reports for review (admin view)
 */
const getReportsForReview = async (adminUser, query) => {
  const { page, limit, offset } = getPagination(query);
  const employeeIds = await getEmployeeIdsUnderAdmin(adminUser, EmployeeMaster);

  if (employeeIds.length === 0) return paginatedResponse([], 0, page, limit);

  const where = {
    employee_id: { [Op.in]: employeeIds },
    is_deleted: false
  };

  if (query.status) {
    where.status = query.status;
  } else {
    where.status = { [Op.in]: ['SUBMITTED', 'APPROVED', 'REJECTED'] };
  }
  if (query.month) where.report_month = parseInt(query.month);
  if (query.year) where.report_year = parseInt(query.year);

  const { count, rows } = await MonthlyReport.findAndCountAll({
    where,
    include: [{
      model: EmployeeMaster, as: 'employee',
      attributes: ['employee_id', 'employee_code', 'district_id'],
      include: [{
        model: db.ApplicantMaster,
        as: 'applicant',
        attributes: ['applicant_id', 'mobile_no'],
        include: [{
          model: db.ApplicantPersonal,
          as: 'personal',
          attributes: ['full_name'],
          required: false
        }],
        required: false
      }]
    }],
    order: [['submitted_at', 'DESC']],
    limit,
    offset
  });

  // Transform rows to include employee details directly
  const transformedRows = rows.map(report => {
    const employee = report.employee;
    const reportData = report.toJSON();
    
    // Add employee data directly to the report object
    return {
      ...reportData,
      employee_id: employee.employee_id,
      employee_code: employee.employee_code,
      district_id: employee.district_id,
      full_name: employee.applicant?.personal?.full_name || employee.employee_code,
      mobile_number: employee.applicant?.mobile_no || null
    };
  });

  return paginatedResponse(transformedRows, count, page, limit);
};

/**
 * Review a monthly report (admin action)
 */
const reviewReport = async (adminUser, reportId, data) => {
  const report = await MonthlyReport.findOne({
    where: { report_id: reportId, is_deleted: false },
    include: [{ model: EmployeeMaster, as: 'employee', attributes: ['employee_id', 'district_id', 'component_id', 'hub_id'] }]
  });
  if (!report) throw new ApiError(404, 'Report not found.');
  if (report.status !== 'SUBMITTED') throw new ApiError(400, 'Only submitted reports can be reviewed.');

  // Check jurisdiction
  const employeeIds = await getEmployeeIdsUnderAdmin(adminUser, EmployeeMaster);
  if (!employeeIds.includes(report.employee_id)) {
    throw new ApiError(403, 'You do not have permission to review this report.');
  }

  report.status = data.status;
  report.appraiser_id = adminUser.admin_id;
  report.appraiser_remarks = data.appraiser_remarks || null;
  report.reviewed_at = new Date();
  report.updated_by = adminUser.admin_id;
  report.updated_at = new Date();
  await report.save();

  logger.info(`Report ${data.status}: report_id=${reportId}, by admin=${adminUser.admin_id}`);
  return report;
};

/**
 * Get report summary (admin view)
 */
const getReportSummary = async (adminUser, query) => {
  const employeeIds = await getEmployeeIdsUnderAdmin(adminUser, EmployeeMaster);
  if (employeeIds.length === 0) return { summary: {} };

  const now = new Date();
  const month = parseInt(query.month) || (now.getMonth() + 1);
  const year = parseInt(query.year) || now.getFullYear();

  const reports = await MonthlyReport.findAll({
    where: {
      employee_id: { [Op.in]: employeeIds },
      report_month: month,
      report_year: year,
      is_deleted: false
    },
    attributes: ['status']
  });

  return {
    month,
    year,
    total_employees: employeeIds.length,
    submitted: reports.filter(r => r.status === 'SUBMITTED').length,
    approved: reports.filter(r => r.status === 'APPROVED').length,
    rejected: reports.filter(r => r.status === 'REJECTED').length,
    pending: employeeIds.length - reports.length
  };
};

/**
 * Upload document for a report
 */
const uploadReportDocument = async (user, reportId, filePath) => {
  const employee = await getEmployeeFromUser(user, EmployeeMaster);
  if (!employee) throw new ApiError(404, 'Employee record not found.');

  const report = await MonthlyReport.findOne({
    where: { report_id: reportId, employee_id: employee.employee_id, is_deleted: false }
  });
  if (!report) throw new ApiError(404, 'Report not found.');
  if (report.status === 'APPROVED') throw new ApiError(400, 'Cannot modify an approved report.');

  report.document_path = filePath;
  report.updated_at = new Date();
  await report.save();

  return report;
};

module.exports = {
  submitReport,
  getMyReports,
  getMyReportStats,
  getReportsForReview,
  reviewReport,
  getReportSummary,
  uploadReportDocument
};
