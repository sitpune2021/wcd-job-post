// ============================================================================
// APPLICANT EXPERIENCE SERVICE
// ============================================================================
// Purpose: Work experience record management for applicants
// Table: ms_applicant_experience
// ============================================================================

const db = require('../../models');
const { ApplicantExperience, ExperienceDomain, Application } = db;
const logger = require('../../config/logger');
const { ApiError } = require('../../middleware/errorHandler');
const { getRelativePath } = require('../../utils/fileUpload');

const toPublicUploadPath = (filePath) => {
  if (!filePath) return null;
  const rel = getRelativePath(filePath).replace(/\\/g, '/');
  return '/' + rel.replace(/^\/+/, '');
};

const assertProfileEditable = async (applicantId) => {
  const count = await Application.count({
    where: {
      applicant_id: applicantId,
      is_deleted: false
    }
  });
  if ((count || 0) > 0) {
    throw new ApiError(403, 'Profile is locked after applying. You can only upload required documents.');
  }
};

// ==================== EXPERIENCE CRUD OPERATIONS ====================

/**
 * Add experience record
 * @param {number} applicantId - Applicant ID
 * @param {Object} data - Experience data
 * @returns {Promise<Object>} - Created experience record
 */
const normalizeBoolean = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    return ['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase());
  }
  return false;
};

const sanitizeDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().split('T')[0];
};

const addExperience = async (applicantId, data, filesData = {}) => {
  const normalizedCurrent = normalizeBoolean(data?.is_current);
  const {
    organization_name,
    designation,
    domain_id,
    work_domain,
    employer_type,
    is_relevant_for_eligibility = true,
    description
  } = data;
  const start_date = sanitizeDate(data?.start_date);
  const end_date_raw = sanitizeDate(data?.end_date);
  const end_date = normalizedCurrent ? null : end_date_raw;

  if (!start_date) {
    throw new ApiError(400, 'Start date is required and must be a valid date');
  }

  try {
    await assertProfileEditable(applicantId);

    // Validate domain_id if provided
    if (domain_id) {
      const domain = await ExperienceDomain.findByPk(domain_id);
      if (!domain) {
        throw new ApiError(400, 'Invalid experience domain ID');
      }
    }

    const certificatePath = filesData?.certificate?.path
      ? getRelativePath(filesData.certificate.path).replace(/\\/g, '/')
      : null;
    const offerLetterPath = filesData?.offer_letter?.path
      ? getRelativePath(filesData.offer_letter.path).replace(/\\/g, '/')
      : null;
    const salarySlipPath = filesData?.salary_slip?.path
      ? getRelativePath(filesData.salary_slip.path).replace(/\\/g, '/')
      : null;

    const experience = await ApplicantExperience.create({
      applicant_id: applicantId,
      organization_name,
      designation,
      domain_id,
      work_domain,
      employer_type,
      start_date,
      end_date,
      is_current: normalizedCurrent,
      is_relevant_for_eligibility,
      description,
      certificate_path: certificatePath,
      offer_letter_path: offerLetterPath,
      salary_slip_path: salarySlipPath
    });

    // Fetch with domain details
    const created = await ApplicantExperience.findByPk(experience.experience_id, {
      include: [{ model: ExperienceDomain, as: 'domain' }]
    });

    const json = created ? created.toJSON() : experience.toJSON();
    json.certificate_path = toPublicUploadPath(json.certificate_path);
    json.offer_letter_path = toPublicUploadPath(json.offer_letter_path);
    json.salary_slip_path = toPublicUploadPath(json.salary_slip_path);

    logger.info(`Experience added for applicant: ${applicantId}`);
    return json;
  } catch (error) {
    logger.error('Add experience error:', error);
    throw error;
  }
};

/**
 * Update experience record
 * @param {number} applicantId - Applicant ID
 * @param {number} experienceId - Experience ID
 * @param {Object} data - Experience data
 * @returns {Promise<Object>} - Updated experience record
 */
const updateExperience = async (applicantId, experienceId, data, filesData = {}) => {
  try {
    await assertProfileEditable(applicantId);

    const experience = await ApplicantExperience.findOne({
      where: { experience_id: experienceId, applicant_id: applicantId }
    });

    if (!experience) {
      throw new ApiError(404, 'Experience record not found');
    }

    const normalizedCurrent = data.hasOwnProperty('is_current')
      ? normalizeBoolean(data.is_current)
      : experience.is_current;

    const start_date = data.hasOwnProperty('start_date')
      ? sanitizeDate(data.start_date)
      : experience.start_date;

    if (!start_date) {
      throw new ApiError(400, 'Start date is required and must be a valid date');
    }

    const end_date_raw = data.hasOwnProperty('end_date')
      ? sanitizeDate(data.end_date)
      : experience.end_date;
    const end_date = normalizedCurrent ? null : end_date_raw;

    const updateData = {
      organization_name: data.organization_name ?? experience.organization_name,
      designation: data.designation ?? experience.designation,
      domain_id: data.domain_id ?? experience.domain_id,
      work_domain: data.work_domain ?? experience.work_domain,
      employer_type: data.employer_type ?? experience.employer_type,
      start_date,
      end_date,
      is_current: normalizedCurrent,
      is_relevant_for_eligibility:
        data.hasOwnProperty('is_relevant_for_eligibility')
          ? normalizeBoolean(data.is_relevant_for_eligibility)
          : experience.is_relevant_for_eligibility,
      description: data.description ?? experience.description
    };

    // Update file paths if new files provided
    if (filesData?.certificate?.path) {
      updateData.certificate_path = getRelativePath(filesData.certificate.path).replace(/\\/g, '/');
    }
    if (filesData?.offer_letter?.path) {
      updateData.offer_letter_path = getRelativePath(filesData.offer_letter.path).replace(/\\/g, '/');
    }
    if (filesData?.salary_slip?.path) {
      updateData.salary_slip_path = getRelativePath(filesData.salary_slip.path).replace(/\\/g, '/');
    }

    await experience.update(updateData);
    logger.info(`Experience updated for applicant: ${applicantId}`);

    const json = experience.toJSON();
    json.certificate_path = toPublicUploadPath(json.certificate_path);
    json.offer_letter_path = toPublicUploadPath(json.offer_letter_path);
    json.salary_slip_path = toPublicUploadPath(json.salary_slip_path);

    return json;
  } catch (error) {
    logger.error('Update experience error:', error);
    throw error;
  }
};

/**
 * Delete experience record
 * @param {number} applicantId - Applicant ID
 * @param {number} experienceId - Experience ID
 * @returns {Promise<Object>} - Result
 */
const deleteExperience = async (applicantId, experienceId) => {
  try {
    await assertProfileEditable(applicantId);

    const experience = await ApplicantExperience.findOne({
      where: { experience_id: experienceId, applicant_id: applicantId }
    });

    if (!experience) {
      throw new ApiError(404, 'Experience record not found');
    }

    await experience.update({
      is_deleted: true,
      deleted_at: new Date(),
      updated_at: new Date()
    });
    logger.info(`Experience deleted for applicant: ${applicantId}`);
    return { message: 'Experience record deleted successfully' };
  } catch (error) {
    logger.error('Delete experience error:', error);
    throw error;
  }
};

module.exports = {
  addExperience,
  updateExperience,
  deleteExperience
};
