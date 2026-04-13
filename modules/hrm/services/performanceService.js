/**
 * Performance Review Service
 * Handles self-evaluations, appraiser reviews, and summaries
 */
const { Op, fn, col, literal } = require('sequelize');
const logger = require('../../../config/logger');
const { ApiError } = require('../../../middleware/errorHandler');
const db = require('../../../models');
const { PerformanceReview } = require('../models');
const EmployeeMaster = db.EmployeeMaster;
const { getEmployeeFromUser, getEmployeeIdsUnderAdmin, getPagination, paginatedResponse } = require('../utils/hrmHelpers');

/**
 * Submit self-evaluation (employee)
 */
const submitSelfEvaluation = async (user, data) => {
  const employee = await getEmployeeFromUser(user, EmployeeMaster);
  if (!employee) throw new ApiError(404, 'Employee record not found.');
  if (employee.employment_status !== 'ACTIVE') throw new ApiError(403, 'Only active employees can submit evaluations.');

  // Check for existing review in the same period
  const existing = await PerformanceReview.findOne({
    where: {
      employee_id: employee.employee_id,
      period_start: data.period_start,
      period_end: data.period_end,
      is_deleted: false
    }
  });

  if (existing) {
    if (['REVIEWED', 'COMPLETED'].includes(existing.status)) {
      throw new ApiError(400, 'This evaluation period has already been reviewed.');
    }
    // Update existing
    existing.self_rating = data.self_rating;
    existing.key_achievements = data.key_achievements;
    existing.challenges_faced = data.challenges_faced || null;
    existing.improvement_plan = data.improvement_plan || null;
    existing.review_period = data.review_period;
    existing.status = 'SELF_SUBMITTED';
    existing.self_submitted_at = new Date();
    existing.updated_by = user.applicant_id || user.id;
    existing.updated_at = new Date();
    await existing.save();

    logger.info(`Performance self-eval updated: employee=${employee.employee_code}, period=${data.review_period}`);
    return existing;
  }

  const review = await PerformanceReview.create({
    employee_id: employee.employee_id,
    review_period: data.review_period,
    period_start: data.period_start,
    period_end: data.period_end,
    self_rating: data.self_rating,
    key_achievements: data.key_achievements,
    challenges_faced: data.challenges_faced || null,
    improvement_plan: data.improvement_plan || null,
    status: 'SELF_SUBMITTED',
    self_submitted_at: new Date(),
    created_by: user.applicant_id || user.id
  });

  logger.info(`Performance self-eval submitted: employee=${employee.employee_code}, period=${data.review_period}`);
  return review;
};

/**
 * Get my performance history (employee view)
 */
const getMyPerformance = async (user, query) => {
  const employee = await getEmployeeFromUser(user, EmployeeMaster);
  if (!employee) throw new ApiError(404, 'Employee record not found.');

  const { page, limit, offset } = getPagination(query);
  const where = { employee_id: employee.employee_id, is_deleted: false };

  if (query.status) where.status = query.status;

  const { count, rows } = await PerformanceReview.findAndCountAll({
    where,
    order: [['period_start', 'DESC']],
    limit,
    offset
  });

  return paginatedResponse(rows, count, page, limit);
};

/**
 * Get single performance review detail
 */
const getReviewById = async (reviewId, user, isAdmin = false) => {
  const review = await PerformanceReview.findOne({
    where: { review_id: reviewId, is_deleted: false },
    include: [{
      model: EmployeeMaster, as: 'employee',
      attributes: ['employee_id', 'employee_code', 'district_id', 'component_id']
    }]
  });
  if (!review) throw new ApiError(404, 'Performance review not found.');

  if (!isAdmin) {
    const employee = await getEmployeeFromUser(user, EmployeeMaster);
    if (!employee || review.employee_id !== employee.employee_id) {
      throw new ApiError(403, 'Access denied.');
    }
  }

  return review;
};

/**
 * Get staff reviews for appraiser (admin view)
 */
const getStaffReviews = async (adminUser, query) => {
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
    where.status = { [Op.in]: ['SELF_SUBMITTED', 'REVIEWED', 'COMPLETED'] };
  }

  if (query.period) where.review_period = { [Op.iLike]: `%${query.period}%` };

  const { count, rows } = await PerformanceReview.findAndCountAll({
    where,
    include: [{
      model: EmployeeMaster, as: 'employee',
      attributes: ['employee_id', 'employee_code', 'district_id']
    }],
    order: [['self_submitted_at', 'DESC']],
    limit,
    offset
  });

  return paginatedResponse(rows, count, page, limit);
};

/**
 * Submit appraiser review (admin action)
 */
const submitAppraiserReview = async (adminUser, reviewId, data) => {
  const review = await PerformanceReview.findOne({
    where: { review_id: reviewId, is_deleted: false },
    include: [{ model: EmployeeMaster, as: 'employee', attributes: ['employee_id', 'district_id', 'component_id', 'hub_id'] }]
  });
  if (!review) throw new ApiError(404, 'Performance review not found.');
  if (review.status !== 'SELF_SUBMITTED') {
    throw new ApiError(400, 'Only self-submitted reviews can be appraised.');
  }

  const employeeIds = await getEmployeeIdsUnderAdmin(adminUser, EmployeeMaster);
  if (!employeeIds.includes(review.employee_id)) {
    throw new ApiError(403, 'You do not have permission to review this employee.');
  }

  review.appraiser_id = adminUser.admin_id;
  review.appraiser_rating = data.appraiser_rating;
  review.appraiser_remarks = data.appraiser_remarks;
  review.grade = data.grade;
  review.score = data.score;
  review.status = 'REVIEWED';
  review.reviewed_at = new Date();
  review.updated_by = adminUser.admin_id;
  review.updated_at = new Date();
  await review.save();

  logger.info(`Performance reviewed: review_id=${reviewId}, grade=${data.grade}, by admin=${adminUser.admin_id}`);
  return review;
};

/**
 * Get performance summary (admin view)
 */
const getPerformanceSummary = async (adminUser, query) => {
  const employeeIds = await getEmployeeIdsUnderAdmin(adminUser, EmployeeMaster);
  if (employeeIds.length === 0) return { summary: {} };

  const period = query.period || '';
  const where = {
    employee_id: { [Op.in]: employeeIds },
    is_deleted: false,
    status: { [Op.in]: ['REVIEWED', 'COMPLETED'] }
  };

  if (period) where.review_period = { [Op.iLike]: `%${period}%` };

  const reviews = await PerformanceReview.findAll({
    where,
    include: [{
      model: EmployeeMaster, as: 'employee',
      attributes: ['employee_id', 'employee_code', 'district_id']
    }],
    order: [['appraiser_rating', 'DESC']]
  });

  const totalEvaluated = reviews.length;
  const avgRating = totalEvaluated > 0
    ? (reviews.reduce((sum, r) => sum + (parseFloat(r.appraiser_rating) || 0), 0) / totalEvaluated).toFixed(1)
    : 0;

  const gradeCount = { A: 0, 'B+': 0, B: 0, C: 0, D: 0, F: 0 };
  reviews.forEach(r => { if (r.grade && gradeCount[r.grade] !== undefined) gradeCount[r.grade]++; });

  const pendingReview = await PerformanceReview.count({
    where: {
      employee_id: { [Op.in]: employeeIds },
      status: 'SELF_SUBMITTED',
      is_deleted: false
    }
  });

  return {
    total_evaluated: totalEvaluated,
    avg_rating: parseFloat(avgRating),
    grade_a: gradeCount['A'],
    pending_review: pendingReview,
    grade_distribution: gradeCount,
    employees: reviews.map(r => ({
      employee_id: r.employee_id,
      employee_code: r.employee?.employee_code,
      name: r.employee?.applicant?.full_name || '',
      district: r.employee?.district?.district_name || '',
      period: r.review_period,
      avg_rating: r.appraiser_rating,
      grade: r.grade,
      status: r.status
    }))
  };
};

module.exports = {
  submitSelfEvaluation,
  getMyPerformance,
  getReviewById,
  getStaffReviews,
  submitAppraiserReview,
  getPerformanceSummary
};
