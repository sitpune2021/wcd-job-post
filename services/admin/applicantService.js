// ============================================================================
// ADMIN APPLICANT SERVICE
// ============================================================================
// Purpose: Admin operations for viewing applicant data
// Tables: ms_applicant_master, ms_applicant_personal, ms_applicant_address, etc.
// ============================================================================

const { sequelize } = require('../../config/db');
const logger = require('../../config/logger');
const { getRelativePath } = require('../../utils/fileUpload');
const profileService = require('../applicant/profileService');

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
  try {
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.max(parseInt(query.limit, 10) || 20, 1);
    const offset = (page - 1) * limit;
    const search = query.search ? query.search.trim() : '';
    const includeInactive = query.include_inactive === 'true';

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

    const [countResult] = await sequelize.query(countQuery, { replacements });
    const total = parseInt(countResult[0]?.total || 0, 10);

    // Data query
    const dataQuery = `
      SELECT 
        am.applicant_id,
        am.applicant_no,
        am.email,
        am.mobile_no,
        am.is_verified,
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

    const [applicants] = await sequelize.query(dataQuery, { replacements });

    // Reuse existing applicant dashboard/profile logic to compute completion
    const applicantsWithCompletion = await Promise.all(
      applicants.map(async (applicant) => {
        try {
          const dashboard = await profileService.getDashboard(applicant.applicant_id);
          const percentage = dashboard?.completionStatus?.percentage;
          const legacy = dashboard?.profileCompletion;
          const profileCompletion = Number.isFinite(percentage)
            ? percentage
            : (Number.isFinite(legacy) ? legacy : 0);

          return {
            ...applicant,
            profile_completion: profileCompletion
          };
        } catch (err) {
          logger.warn(`Unable to compute profile completion for applicant ${applicant.applicant_id}: ${err.message}`);
          return {
            ...applicant,
            profile_completion: null
          };
        }
      })
    );

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
    logger.error('Error fetching applicants:', error);
    throw error;
  }
};

/**
 * Get applicant by ID with full profile details
 * @param {number} applicantId - Applicant ID
 * @returns {Promise<Object|null>} Full applicant profile or null
 */
const getApplicantById = async (applicantId) => {
  try {
    // Basic info
    const [basicResult] = await sequelize.query(`
      SELECT 
        am.applicant_id,
        am.applicant_no,
        am.email,
        am.mobile_no,
        am.is_verified,
        am.created_at,
        am.updated_at
      FROM ms_applicant_master am
      WHERE am.applicant_id = :applicantId AND am.is_deleted = false
    `, { replacements: { applicantId } });

    if (basicResult.length === 0) {
      return null;
    }

    const applicant = basicResult[0];

    // Personal details
    const [personalResult] = await sequelize.query(`
      SELECT 
        ap.full_name, ap.father_name, ap.mother_name, ap.gender, ap.dob,
        ap.marital_status, ap.aadhar_no,
        -- PAN temporarily disabled
        -- ap.pan_no,
        ap.domicile_maharashtra,
        ap.photo_path, ap.signature_path, ap.aadhaar_path,
        -- ap.pan_path,
        ap.resume_path, ap.domicile_path,
        ap.category_id,
        cm.category_name,
        ap.created_at, ap.updated_at
      FROM ms_applicant_personal ap
      LEFT JOIN ms_category_master cm ON ap.category_id = cm.category_id AND cm.is_deleted = false
      WHERE ap.applicant_id = :applicantId
    `, { replacements: { applicantId } });

    applicant.personal = personalResult[0] || null;
    if (applicant.personal) {
      applicant.personal.photo_path = toPublicUploadPath(applicant.personal.photo_path);
      applicant.personal.signature_path = toPublicUploadPath(applicant.personal.signature_path);
      applicant.personal.aadhaar_path = toPublicUploadPath(applicant.personal.aadhaar_path);
      // PAN temporarily disabled
      // applicant.personal.pan_path = toPublicUploadPath(applicant.personal.pan_path);
      applicant.personal.resume_path = toPublicUploadPath(applicant.personal.resume_path);
      applicant.personal.domicile_path = toPublicUploadPath(applicant.personal.domicile_path);
      applicant.personal.category = applicant.personal.category_name || null;
    }

    // Address details
    const [addressResult] = await sequelize.query(`
      SELECT 
        aa.address_id, aa.address_line, aa.address_line2, aa.pincode,
        aa.permanent_address_same, aa.permanent_address_line,
        aa.permanent_address_line2, aa.permanent_pincode,
        d.district_name, t.taluka_name,
        pd.district_name AS permanent_district_name, pt.taluka_name AS permanent_taluka_name
      FROM ms_applicant_address aa
      LEFT JOIN ms_district_master d ON aa.district_id = d.district_id
      LEFT JOIN ms_taluka_master t ON aa.taluka_id = t.taluka_id
      LEFT JOIN ms_district_master pd ON aa.permanent_district_id = pd.district_id
      LEFT JOIN ms_taluka_master pt ON aa.permanent_taluka_id = pt.taluka_id
      WHERE aa.applicant_id = :applicantId AND aa.is_deleted = false
    `, { replacements: { applicantId } });

    applicant.addresses = addressResult;

    // Education details
    const [educationResult] = await sequelize.query(`
      SELECT 
        ae.education_id, ae.qualification_level, ae.degree_name,
        ae.specialization, ae.university_board, ae.stream_subject,
        ae.passing_year, ae.percentage, ae.certificate_path,
        el.level_name, el.level_code
      FROM ms_applicant_education ae
      LEFT JOIN ms_education_levels el ON ae.education_level_id = el.level_id
      WHERE ae.applicant_id = :applicantId AND ae.is_deleted = false
      ORDER BY ae.passing_year DESC
    `, { replacements: { applicantId } });

    applicant.education = (educationResult || []).map((e) => ({
      ...e,
      certificate_path: toPublicUploadPath(e.certificate_path)
    }));

    // Experience details
    const [experienceResult] = await sequelize.query(`
      SELECT 
        ax.experience_id, ax.organization_name, ax.designation,
        ax.start_date, ax.end_date, ax.is_current,
        ax.work_domain, ax.total_months, ax.employer_type,
        ax.is_relevant_for_eligibility,
        ed.domain_name,
        ax.certificate_path,
        ax.offer_letter_path,
        ax.salary_slip_path
      FROM ms_applicant_experience ax
      LEFT JOIN ms_experience_domains ed ON ax.domain_id = ed.id
      WHERE ax.applicant_id = :applicantId AND ax.is_deleted = false
      ORDER BY ax.start_date DESC
    `, { replacements: { applicantId } });

    applicant.experience = (experienceResult || []).map((e) => ({
      ...e,
      certificate_path: toPublicUploadPath(e.certificate_path),
      offer_letter_path: toPublicUploadPath(e.offer_letter_path),
      salary_slip_path: toPublicUploadPath(e.salary_slip_path)
    }));

    // Skills
    const [skillsResult] = await sequelize.query(`
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
    `, { replacements: { applicantId } });

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

    // Documents
    const [documentsResult] = await sequelize.query(`
      SELECT 
        ad.document_id, ad.file_path, ad.original_name AS file_name, ad.file_size,
        ad.is_verified, ad.created_at AS uploaded_at,
        dt.doc_type_name, dt.doc_code
      FROM ms_applicant_documents ad
      LEFT JOIN ms_document_types dt ON ad.doc_type_id = dt.doc_type_id
      WHERE ad.applicant_id = :applicantId AND ad.is_deleted = false
      ORDER BY ad.created_at DESC
    `, { replacements: { applicantId } });

    applicant.documents = (documentsResult || []).map((d) => ({
      ...d,
      file_path: toPublicUploadPath(d.file_path)
    }));

    // Applications
    const [applicationsResult] = await sequelize.query(`
      SELECT 
        a.application_id, a.application_no, a.status, a.submitted_at,
        a.created_at, a.updated_at,
        pm.post_name, pm.post_code
      FROM ms_applications a
      LEFT JOIN ms_post_master pm ON a.post_id = pm.post_id
      WHERE a.applicant_id = :applicantId AND a.is_deleted = false
      ORDER BY a.created_at DESC
    `, { replacements: { applicantId } });

    applicant.applications = applicationsResult;

    return applicant;
  } catch (error) {
    logger.error('Error fetching applicant by ID:', error);
    throw error;
  }
};

module.exports = {
  getApplicants,
  getApplicantById
};
