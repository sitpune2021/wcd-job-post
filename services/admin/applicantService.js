// ============================================================================
// ADMIN APPLICANT SERVICE
// ============================================================================
// Purpose: Admin operations for viewing applicant data
// Tables: ms_applicant_master, ms_applicant_personal, ms_applicant_address, etc.
// ============================================================================

const { sequelize } = require('../../config/db');
const { ApplicantMaster } = require('../../models');
const logger = require('../../config/logger');
const profileService = require('../applicant/profileService');
const { batchGetDashboards } = require('./applicantDashboardBatcher');
const { ApiError } = require('../../middleware/errorHandler');
const { getRelativePath } = require('../../utils/fileUpload');

const toPublicUploadPath = (filePath) => {
  if (!filePath) return null;
  const rel = getRelativePath(filePath).replace(/\\/g, '/');
  return '/' + rel.replace(/^\/+/, '');
};

/**
 * Get all applicants with pagination, search, and filters
 * @param {Object} query - Query params (page, limit, search, include_inactive)
 * @returns {Promise<Object>} Paginated list of applicants
 */
const getApplicants = async (query = {}) => {
  const startTime = Date.now();
  const requestId = `REQ-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  try {
    logger.info(`[${requestId}] getApplicants START`, { query });
    
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.max(parseInt(query.limit, 10) || 20, 1);
    const offset = (page - 1) * limit;
    const search = query.search ? query.search.trim() : '';
    const includeInactive = query.include_inactive === 'true';
    
    logger.info(`[${requestId}] Params: page=${page}, limit=${limit}, search="${search}"`);

    let whereClause = `WHERE am.is_deleted = false`;
    const replacements = { limit, offset };

    if (!includeInactive) {
      whereClause += ` AND am.is_verified = true`;
    }

    if (search) {
      whereClause += ` AND (
        ap.full_name ILIKE :search 
        OR am.email ILIKE :search 
        OR am.mobile_no ILIKE :search
        OR am.applicant_no ILIKE :search
      )`;
      replacements.search = `%${search}%`;
    }

    // Count query
    const countQuery = `
      SELECT COUNT(DISTINCT am.applicant_id) as total
      FROM ms_applicant_master am
      LEFT JOIN ms_applicant_personal ap ON am.applicant_id = ap.applicant_id
      ${whereClause}
    `;

    const countStart = Date.now();
    const [countResult] = await sequelize.query(countQuery, { replacements });
    const countTime = Date.now() - countStart;
    const total = parseInt(countResult[0]?.total || 0, 10);
    
    logger.info(`[${requestId}] COUNT query completed: ${countTime}ms, total=${total}`);

    // Data query
    const dataQuery = `
      SELECT 
        am.applicant_id,
        am.applicant_no,
        am.email,
        am.mobile_no,
        am.is_verified,
        am.ocr_disabled,
        am.created_at,
        ap.full_name,
        ap.gender,
        ap.dob,
        (SELECT COUNT(*) FROM ms_applications WHERE applicant_id = am.applicant_id AND is_deleted = false) as application_count
      FROM ms_applicant_master am
      LEFT JOIN ms_applicant_personal ap ON am.applicant_id = ap.applicant_id
      ${whereClause}
      ORDER BY am.applicant_id DESC
      LIMIT :limit OFFSET :offset
    `;

    const dataStart = Date.now();
    const [applicants] = await sequelize.query(dataQuery, { replacements });
    const dataTime = Date.now() - dataStart;
    
    logger.info(`[${requestId}] DATA query completed: ${dataTime}ms, rows=${applicants.length}`);

    // Batch fetch dashboard data (eliminates N+1 queries)
    const dashboardStart = Date.now();
    const applicantIds = applicants.map(a => a.applicant_id);
    logger.info(`[${requestId}] BATCHING ${applicants.length} dashboard calls into 2-3 queries`);
    
    let dashboardMap = {};
    try {
      dashboardMap = await batchGetDashboards(applicantIds);
    } catch (err) {
      logger.error(`[${requestId}] Batch dashboard fetch failed: ${err.message}`);
    }
    
    const applicantsWithCompletion = applicants.map(applicant => {
      const dashboard = dashboardMap[applicant.applicant_id];
      return {
        ...applicant,
        profile_completion: dashboard?.profile_completion || 0
      };
    });
    
    const dashboardTotalTime = Date.now() - dashboardStart;
    logger.info(`[${requestId}] BATCHED ${applicants.length} dashboards in ${dashboardTotalTime}ms (avg: ${Math.round(dashboardTotalTime / applicants.length)}ms per applicant)`);

    const totalTime = Date.now() - startTime;
    logger.info(`[${requestId}] getApplicants COMPLETE: ${totalTime}ms total (count: ${countTime}ms, data: ${dataTime}ms, dashboards: ${dashboardTotalTime}ms)`);
    logger.info(`[${requestId}] PERFORMANCE IMPROVEMENT: Query=${countTime + dataTime}ms (${Math.round((countTime + dataTime) / totalTime * 100)}%), Dashboards=${dashboardTotalTime}ms (${Math.round(dashboardTotalTime / totalTime * 100)}%)`);
    
    return {
      data: {
        applicants: applicantsWithCompletion
      },
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1
      }
    };
  } catch (error) {
    const totalTime = Date.now() - startTime;
    logger.error(`[${requestId}] Error fetching applicants after ${totalTime}ms:`, error);
    throw error;
  }
};

/**
 * Bulk toggle OCR for applicants
 * @param {Array<number>} applicantIds - list of applicant IDs
 * @param {boolean} ocrDisabled - desired flag value
 */
const updateApplicantOCR = async (applicantIds = [], ocrDisabled = false) => {
  if (!Array.isArray(applicantIds) || applicantIds.length === 0) {
    throw new Error('No applicants provided');
  }

  const ids = applicantIds.map((id) => parseInt(id, 10)).filter((id) => Number.isInteger(id));
  if (ids.length === 0) {
    throw new Error('Invalid applicant IDs');
  }

  try {
    const [result] = await sequelize.query(
      `UPDATE ms_applicant_master
       SET ocr_disabled = :ocrDisabled, updated_at = NOW()
       WHERE applicant_id IN (:ids) AND is_deleted = false
       RETURNING applicant_id, ocr_disabled`,
      {
        replacements: { ids, ocrDisabled },
      }
    );

    return { updated: result.length, applicants: result };
  } catch (err) {
    logger.error('updateApplicantOCR failed', {
      ids,
      ocrDisabled,
      message: err.message,
      detail: err.original?.detail,
      code: err.original?.code
    });
    throw err;
  }
};

/**
 * Get applicant by ID with full profile details
 * @param {number} applicantId - Applicant ID
 * @returns {Promise<Object|null>} Full applicant profile or null
 */
const getApplicantById = async (applicantId) => {
  try {
    const start = Date.now();
    // Basic info
    const [basicResult] = await sequelize.query(`
      SELECT 
        am.applicant_id,
        am.applicant_no,
        am.email,
        am.mobile_no,
        am.created_at
      FROM ms_applicant_master am
      WHERE am.applicant_id = :applicantId AND am.is_deleted = false
    `, { replacements: { applicantId } });

    if (basicResult.length === 0) {
      return null;
    }

    const applicant = basicResult[0];

    const [
      [personalResult],
      [addressResult],
      [educationResult],
      [experienceResult],
      [skillsResult],
      [documentsResult],
      [applicationsResult]
    ] = await Promise.all([
      sequelize.query(`
        SELECT 
          ap.full_name,
          ap.gender,
          ap.dob,
          ap.marital_status,
          ap.aadhar_no,
          ap.domicile_maharashtra,
          ap.photo_path,
          ap.signature_path,
          ap.aadhaar_path,
          ap.resume_path,
          ap.domicile_path,
          ap.category_id,
          cm.category_name
        FROM ms_applicant_personal ap
        LEFT JOIN ms_category_master cm ON ap.category_id = cm.category_id AND cm.is_deleted = false
        WHERE ap.applicant_id = :applicantId
      `, { replacements: { applicantId } }),
      sequelize.query(`
        SELECT 
          aa.address_line, aa.address_line2, aa.pincode,
          aa.permanent_address_same, aa.permanent_address_line,
          aa.permanent_address_line2, aa.permanent_pincode,
          d.district_name,
          t.taluka_name,
          pd.district_name AS permanent_district_name,
          pt.taluka_name AS permanent_taluka_name
        FROM ms_applicant_address aa
        LEFT JOIN ms_district_master d ON aa.district_id = d.district_id
        LEFT JOIN ms_taluka_master t ON aa.taluka_id = t.taluka_id
        LEFT JOIN ms_district_master pd ON aa.permanent_district_id = pd.district_id
        LEFT JOIN ms_taluka_master pt ON aa.permanent_taluka_id = pt.taluka_id
        WHERE aa.applicant_id = :applicantId AND aa.is_deleted = false
      `, { replacements: { applicantId } }),
      sequelize.query(`
        SELECT 
          ae.education_id,
          el.level_name,
          ae.degree_name,
          ae.university_board,
          ae.passing_year,
          ae.percentage,
          ae.certificate_path
        FROM ms_applicant_education ae
        LEFT JOIN ms_education_levels el ON ae.education_level_id = el.level_id
        WHERE ae.applicant_id = :applicantId AND ae.is_deleted = false
        ORDER BY ae.passing_year DESC
      `, { replacements: { applicantId } }),
      sequelize.query(`
        SELECT 
          ax.experience_id,
          ax.organization_name,
          ax.designation,
          ax.start_date,
          ax.end_date,
          ax.is_current,
          ax.total_months,
          ax.certificate_path
        FROM ms_applicant_experience ax
        WHERE ax.applicant_id = :applicantId AND ax.is_deleted = false
        ORDER BY ax.start_date DESC
      `, { replacements: { applicantId } }),
      sequelize.query(`
        SELECT
          s.applicant_skill_id,
          s.applicant_id,
          s.skill_id,
          s.notes,
          s.certificate_path,
          sm.skill_name,
          sm.skill_name_mr,
          sm.description,
          sm.description_mr
        FROM ms_applicant_skills s
        LEFT JOIN ms_skill_master sm ON s.skill_id = sm.skill_id
        WHERE s.applicant_id = :applicantId AND s.is_deleted = false
        ORDER BY s.applicant_skill_id DESC
      `, { replacements: { applicantId } }),
      sequelize.query(`
        SELECT 
          ad.document_id,
          dt.doc_code,
          dt.doc_type_name,
          ad.file_path
        FROM ms_applicant_documents ad
        LEFT JOIN ms_document_types dt ON ad.doc_type_id = dt.doc_type_id
        WHERE ad.applicant_id = :applicantId AND ad.is_deleted = false
        ORDER BY ad.created_at DESC
      `, { replacements: { applicantId } }),
      sequelize.query(`
        SELECT 
          a.application_id,
          a.application_no,
          a.status,
          a.submitted_at,
          pm.post_name,
          pm.post_code
        FROM ms_applications a
        LEFT JOIN ms_post_master pm ON a.post_id = pm.post_id
        WHERE a.applicant_id = :applicantId AND a.is_deleted = false
        ORDER BY a.created_at DESC
      `, { replacements: { applicantId } })
    ]);

    applicant.personal = personalResult[0] || null;
    if (applicant.personal) {
      applicant.personal.photo_path = toPublicUploadPath(applicant.personal.photo_path);
      applicant.personal.signature_path = toPublicUploadPath(applicant.personal.signature_path);
      applicant.personal.aadhaar_path = toPublicUploadPath(applicant.personal.aadhaar_path);
      applicant.personal.resume_path = toPublicUploadPath(applicant.personal.resume_path);
      applicant.personal.domicile_path = toPublicUploadPath(applicant.personal.domicile_path);
      applicant.personal.category = applicant.personal.category_name || null;
    }

    applicant.addresses = addressResult;

    applicant.education = (educationResult || []).map((e) => ({
      ...e,
      certificate_path: toPublicUploadPath(e.certificate_path)
    }));

    applicant.experience = (experienceResult || []).map((e) => ({
      ...e,
      certificate_path: toPublicUploadPath(e.certificate_path)
    }));

    applicant.skills = (skillsResult || []).map((row) => ({
      applicant_skill_id: row.applicant_skill_id,
      applicant_id: row.applicant_id,
      skill_id: row.skill_id,
      notes: row.notes || null,
      certificate_path: toPublicUploadPath(row.certificate_path),
      skill: {
        skill_id: row.skill_id,
        skill_name: row.skill_name || null,
        skill_name_mr: row.skill_name_mr || null,
        description: row.description || null,
        description_mr: row.description_mr || null
      }
    }));

    applicant.documents = (documentsResult || []).map((d) => ({
      document_id: d.document_id,
      doc_code: d.doc_code || null,
      doc_type_name: d.doc_type_name || null,
      file_path: toPublicUploadPath(d.file_path)
    }));

    applicant.applications = applicationsResult;

    // const duration = Date.now() - start;
    // logger.info(`getApplicantById ${applicantId} took ${duration}ms`);

    return applicant;
  } catch (error) {
    logger.error('Error fetching applicant by ID:', error);
    throw error;
  }
};

module.exports = {
  getApplicants,
  getApplicantById,
  updateApplicantOCR
};
