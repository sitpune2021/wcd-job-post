/**
 * Field Visit Service
 * Handles geo-tagged field visit logging and review
 */
const { Op } = require('sequelize');
const logger = require('../../../config/logger');
const { ApiError } = require('../../../middleware/errorHandler');
const db = require('../../../models');
const { FieldVisit } = require('../models');
const EmployeeMaster = db.EmployeeMaster;
const { getEmployeeFromUser, getEmployeeIdsUnderAdmin, getPagination, paginatedResponse } = require('../utils/hrmHelpers');

/**
 * Log a field visit (employee)
 */
const logVisit = async (user, data) => {
  const employee = await getEmployeeFromUser(user, EmployeeMaster);
  if (!employee) throw new ApiError(404, 'Employee record not found.');
  if (employee.employment_status !== 'ACTIVE') throw new ApiError(403, 'Only active employees can log visits.');

  const visit = await FieldVisit.create({
    employee_id: employee.employee_id,
    visit_date: data.visit_date,
    location: data.location,
    purpose: data.purpose,
    observations: data.observations || null,
    beneficiaries_count: data.beneficiaries_count || 0,
    latitude: data.latitude || null,
    longitude: data.longitude || null,
    geo_address: data.geo_address || null,
    photo_paths: data.photo_paths || [],
    status: 'SUBMITTED',
    created_by: user.applicant_id || user.id
  });

  logger.info(`Field visit logged: employee=${employee.employee_code}, date=${data.visit_date}`);
  return visit;
};

/**
 * Get my field visits (employee view)
 */
const getMyVisits = async (user, query) => {
  const employee = await getEmployeeFromUser(user, EmployeeMaster);
  if (!employee) throw new ApiError(404, 'Employee record not found.');

  const { page, limit, offset } = getPagination(query);
  const where = { employee_id: employee.employee_id, is_deleted: false };

  if (query.status) where.status = query.status;
  if (query.month && query.year) {
    const start = new Date(query.year, query.month - 1, 1);
    const end = new Date(query.year, query.month, 0);
    where.visit_date = { [Op.between]: [start.toISOString().split('T')[0], end.toISOString().split('T')[0]] };
  }

  const { count, rows } = await FieldVisit.findAndCountAll({
    where,
    order: [['visit_date', 'DESC']],
    limit,
    offset
  });

  return paginatedResponse(rows, count, page, limit);
};

/**
 * Get visit by ID (employee can view own, admin can view under jurisdiction)
 */
const getVisitById = async (visitId, user, isAdmin = false) => {
  const visit = await FieldVisit.findOne({
    where: { visit_id: visitId, is_deleted: false },
    include: [{
      model: EmployeeMaster, as: 'employee',
      attributes: ['employee_id', 'employee_code', 'district_id', 'component_id'],
      include: [
        { association: 'applicant', attributes: ['full_name'] },
        { association: 'district', attributes: ['district_name'] },
        { association: 'component', attributes: ['component_name'] }
      ]
    }]
  });
  if (!visit) throw new ApiError(404, 'Field visit not found.');

  if (!isAdmin) {
    const employee = await getEmployeeFromUser(user, EmployeeMaster);
    if (!employee || visit.employee_id !== employee.employee_id) {
      throw new ApiError(403, 'Access denied.');
    }
  }

  return visit;
};

/**
 * Get visits for review (admin view)
 */
const getVisitsForReview = async (adminUser, query) => {
  const { page, limit, offset } = getPagination(query);
  const employeeIds = await getEmployeeIdsUnderAdmin(adminUser, EmployeeMaster);

  if (employeeIds.length === 0) return paginatedResponse([], 0, page, limit);

  const where = {
    employee_id: { [Op.in]: employeeIds },
    is_deleted: false
  };

  if (query.status) where.status = query.status;
  if (query.month && query.year) {
    const start = new Date(query.year, query.month - 1, 1);
    const end = new Date(query.year, query.month, 0);
    where.visit_date = { [Op.between]: [start.toISOString().split('T')[0], end.toISOString().split('T')[0]] };
  }

  const { count, rows } = await FieldVisit.findAndCountAll({
    where,
    include: [{
      model: EmployeeMaster, as: 'employee',
      attributes: ['employee_id', 'employee_code', 'district_id'],
      include: [
        { association: 'applicant', attributes: ['full_name'] },
        { association: 'district', attributes: ['district_name'] }
      ]
    }],
    order: [['visit_date', 'DESC']],
    limit,
    offset
  });

  return paginatedResponse(rows, count, page, limit);
};

/**
 * Review a field visit (admin action)
 */
const reviewVisit = async (adminUser, visitId, data) => {
  const visit = await FieldVisit.findOne({
    where: { visit_id: visitId, is_deleted: false },
    include: [{ model: EmployeeMaster, as: 'employee', attributes: ['employee_id', 'district_id', 'component_id', 'hub_id'] }]
  });
  if (!visit) throw new ApiError(404, 'Field visit not found.');
  if (!['SUBMITTED', 'REVIEWED'].includes(visit.status)) {
    throw new ApiError(400, 'This visit cannot be reviewed in its current state.');
  }

  const employeeIds = await getEmployeeIdsUnderAdmin(adminUser, EmployeeMaster);
  if (!employeeIds.includes(visit.employee_id)) {
    throw new ApiError(403, 'You do not have permission to review this visit.');
  }

  visit.status = data.status;
  visit.reviewed_by = adminUser.admin_id;
  visit.reviewed_at = new Date();
  visit.reviewer_remarks = data.reviewer_remarks || null;
  visit.updated_by = adminUser.admin_id;
  visit.updated_at = new Date();
  await visit.save();

  logger.info(`Field visit ${data.status}: visit_id=${visitId}, by admin=${adminUser.admin_id}`);
  return visit;
};

/**
 * Upload photos for a field visit
 */
const uploadVisitPhotos = async (user, visitId, photoPaths) => {
  const employee = await getEmployeeFromUser(user, EmployeeMaster);
  if (!employee) throw new ApiError(404, 'Employee record not found.');

  const visit = await FieldVisit.findOne({
    where: { visit_id: visitId, employee_id: employee.employee_id, is_deleted: false }
  });
  if (!visit) throw new ApiError(404, 'Field visit not found.');

  const existing = visit.photo_paths || [];
  visit.photo_paths = [...existing, ...photoPaths];
  visit.updated_at = new Date();
  await visit.save();

  return visit;
};

module.exports = {
  logVisit,
  getMyVisits,
  getVisitById,
  getVisitsForReview,
  reviewVisit,
  uploadVisitPhotos
};
