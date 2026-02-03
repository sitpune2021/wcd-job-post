const { sequelize } = require('../config/db');
const logger = require('../config/logger');
const { generateApplicationNo } = require('../utils/idGenerator');

/**
 * Application Service
 * Handles job application flow
 */

// Create application (draft)
const createApplication = async (applicantId, postId) => {
  try {
    // Check if already applied
    const [existing] = await sequelize.query(
      `SELECT application_id FROM ms_applications 
       WHERE applicant_id = ? AND post_id = ? AND is_deleted = false`,
      { replacements: [applicantId, postId] }
    );

    if (existing.length > 0) {
      throw new Error('Already applied to this post');
    }

    // Generate application number
    const applicationNo = await generateApplicationNo();

    const [result] = await sequelize.query(
      `INSERT INTO ms_applications (
        applicant_id, post_id, application_no, status, 
        is_locked, created_by, created_at, updated_at
      )
      VALUES (?, ?, ?, 'DRAFT', false, ?, NOW(), NOW())
      RETURNING *`,
      {
        replacements: [applicantId, postId, applicationNo, applicantId]
      }
    );

    logger.info(`Application created: ${result[0].application_id} by applicant ${applicantId}`);
    return result[0];
  } catch (error) {
    logger.error('Error creating application:', error);
    throw error;
  }
};

// Get applicant's applications
const getMyApplications = async (applicantId) => {
  try {
    const [applications] = await sequelize.query(
      `SELECT 
        a.application_id,
        a.application_no,
        a.post_id,
        p.post_name,
        p.post_name_mr,
        a.status,
        ast.status_name,
        ast.status_name_mr,
        a.submitted_at,
        a.is_locked,
        a.created_at,
        a.updated_at
      FROM ms_applications a
      JOIN ms_post_master p ON a.post_id = p.post_id
      LEFT JOIN ms_application_statuses ast ON a.status = ast.status_code
      WHERE a.applicant_id = ? AND a.is_deleted = false
      ORDER BY a.created_at DESC`,
      { replacements: [applicantId] }
    );

    return applications;
  } catch (error) {
    logger.error('Error fetching applications:', error);
    throw error;
  }
};

// Get application by ID
const getApplicationById = async (applicationId, applicantId = null) => {
  try {
    let query = `
      SELECT 
        a.*,
        p.post_name,
        p.post_name_mr,
        p.description,
        p.min_qualification,
        p.min_experience_months,
        ast.status_name,
        ast.status_name_mr,
        ap.full_name,
        am.email,
        am.mobile_no
      FROM ms_applications a
      JOIN ms_post_master p ON a.post_id = p.post_id
      LEFT JOIN ms_application_statuses ast ON a.status = ast.status_code
      LEFT JOIN ms_applicant_master am ON a.applicant_id = am.applicant_id
      LEFT JOIN ms_applicant_personal ap ON a.applicant_id = ap.applicant_id AND ap.is_deleted = false
      WHERE a.application_id = :applicationId AND a.is_deleted = false
    `;

    const replacements = { applicationId };

    if (applicantId) {
      query += ` AND a.applicant_id = :applicantId`;
      replacements.applicantId = applicantId;
    }

    const [applications] = await sequelize.query(query, { replacements });

    return applications.length > 0 ? applications[0] : null;
  } catch (error) {
    logger.error('Error fetching application:', error);
    throw error;
  }
};

// Submit application
const submitApplication = async (applicationId, applicantId) => {
  try {
    const [result] = await sequelize.query(
      `UPDATE ms_applications 
       SET status = 'SUBMITTED', 
           submitted_at = NOW(),
           is_locked = true,
           updated_by = :applicantId,
           updated_at = NOW()
       WHERE application_id = :applicationId 
         AND applicant_id = :applicantId 
         AND status = 'DRAFT'
         AND is_deleted = false
       RETURNING *`,
      {
        replacements: { applicationId, applicantId }
      }
    );

    if (result.length === 0) {
      throw new Error('Application not found or already submitted');
    }

    logger.info(`Application submitted: ${applicationId} by applicant ${applicantId}`);
    return result[0];
  } catch (error) {
    logger.error('Error submitting application:', error);
    throw error;
  }
};

// Withdraw application
const withdrawApplication = async (applicationId, applicantId) => {
  try {
    const [result] = await sequelize.query(
      `UPDATE ms_applications 
       SET status = 'WITHDRAWN',
           is_locked = true,
           updated_by = :applicantId,
           updated_at = NOW()
       WHERE application_id = :applicationId 
         AND applicant_id = :applicantId 
         AND status IN ('SUBMITTED', 'UNDER_REVIEW')
         AND is_deleted = false
       RETURNING *`,
      {
        replacements: { applicationId, applicantId }
      }
    );

    if (result.length === 0) {
      throw new Error('Application not found or cannot be withdrawn');
    }

    logger.info(`Application withdrawn: ${applicationId} by applicant ${applicantId}`);
    return result[0];
  } catch (error) {
    logger.error('Error withdrawing application:', error);
    throw error;
  }
};

// Admin: Get all applications with filters
const getAllApplications = async (filters = {}) => {
  try {
    let query = `
      SELECT 
        a.application_id,
        a.application_no,
        a.applicant_id,
        ap.full_name as applicant_name,
        am.email,
        am.mobile_no,
        a.post_id,
        p.post_name,
        p.post_name_mr,
        a.status,
        ast.status_name,
        ast.status_name_mr,
        a.submitted_at,
        a.is_locked,
        a.created_at,
        a.updated_at
      FROM ms_applications a
      JOIN ms_applicant_master am ON a.applicant_id = am.applicant_id
      LEFT JOIN ms_applicant_personal ap ON a.applicant_id = ap.applicant_id AND ap.is_deleted = false
      JOIN ms_post_master p ON a.post_id = p.post_id
      LEFT JOIN ms_application_statuses ast ON a.status = ast.status_code
      WHERE a.is_deleted = false
    `;

    const replacements = {};

    if (filters.status) {
      query += ` AND a.status = :status`;
      replacements.status = filters.status;
    }

    if (filters.post_id) {
      query += ` AND a.post_id = :post_id`;
      replacements.post_id = filters.post_id;
    }

    if (filters.search) {
      query += ` AND (ap.full_name ILIKE :search OR am.email ILIKE :search OR a.application_no ILIKE :search)`;
      replacements.search = `%${filters.search}%`;
    }

    if (filters.from_date) {
      query += ` AND a.submitted_at >= :from_date`;
      replacements.from_date = filters.from_date;
    }

    if (filters.to_date) {
      query += ` AND a.submitted_at <= :to_date`;
      replacements.to_date = filters.to_date;
    }

    query += ` ORDER BY a.submitted_at DESC`;

    const [applications] = await sequelize.query(query, { replacements });
    return applications;
  } catch (error) {
    logger.error('Error fetching all applications:', error);
    throw error;
  }
};

// Admin: Update application status
const updateApplicationStatus = async (applicationId, status, updatedBy, remarks = null) => {
  try {
    const [result] = await sequelize.query(
      `UPDATE ms_applications 
       SET status = :status,
           updated_by = :updatedBy,
           updated_at = NOW()
       WHERE application_id = :applicationId AND is_deleted = false
       RETURNING *`,
      {
        replacements: {
          applicationId,
          status,
          updatedBy
        }
      }
    );

    if (result.length === 0) {
      return null;
    }

    logger.info(`Application status updated: ${applicationId} to ${status} by ${updatedBy}`);
    return result[0];
  } catch (error) {
    logger.error('Error updating application status:', error);
    throw error;
  }
};

// Admin: Bulk status update
const bulkUpdateStatus = async (applicationIds, status, updatedBy, remarks = null) => {
  try {
    const placeholders = applicationIds.map((_, i) => `$${i + 1}`).join(',');
    
    const [result] = await sequelize.query(
      `UPDATE ms_applications 
       SET status = $${applicationIds.length + 1},
           admin_remarks = COALESCE($${applicationIds.length + 2}, admin_remarks),
           updated_by = $${applicationIds.length + 3},
           updated_at = NOW()
       WHERE application_id IN (${placeholders}) AND is_deleted = false
       RETURNING application_id`,
      {
        bind: [...applicationIds, status, remarks, updatedBy]
      }
    );

    logger.info(`Bulk status update: ${result.length} applications updated to ${status} by ${updatedBy}`);
    return result.length;
  } catch (error) {
    logger.error('Error in bulk status update:', error);
    throw error;
  }
};

// Get application statistics
const getApplicationStats = async (filters = {}) => {
  try {
    let query = `
      SELECT 
        COUNT(*) as total_applications,
        COUNT(CASE WHEN status = 'SUBMITTED' THEN 1 END) as submitted,
        COUNT(CASE WHEN status = 'UNDER_REVIEW' THEN 1 END) as under_review,
        COUNT(CASE WHEN status = 'SHORTLISTED' THEN 1 END) as shortlisted,
        COUNT(CASE WHEN status = 'APPROVED' THEN 1 END) as approved,
        COUNT(CASE WHEN status = 'REJECTED' THEN 1 END) as rejected,
        COUNT(CASE WHEN status = 'WITHDRAWN' THEN 1 END) as withdrawn
      FROM ms_applications
      WHERE is_deleted = false
    `;

    const replacements = {};

    if (filters.post_id) {
      query += ` AND post_id = :post_id`;
      replacements.post_id = filters.post_id;
    }

    const [stats] = await sequelize.query(query, { replacements });
    return stats[0];
  } catch (error) {
    logger.error('Error fetching application stats:', error);
    throw error;
  }
};

module.exports = {
  createApplication,
  getMyApplications,
  getApplicationById,
  submitApplication,
  withdrawApplication,
  getAllApplications,
  updateApplicationStatus,
  bulkUpdateStatus,
  getApplicationStats
};
