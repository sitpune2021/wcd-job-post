// ============================================================================
// APPLICANT EDUCATION SERVICE
// ============================================================================
// Purpose: Education record management for applicants
// Table: ms_applicant_education
// ============================================================================

const db = require('../../models');
const { ApplicantEducation, EducationLevel, Application } = db;
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

// ==================== EDUCATION CRUD OPERATIONS ====================

/**
 * Add education record
 * @param {number} applicantId - Applicant ID
 * @param {Object} data - Education data
 * @returns {Promise<Object>} - Created education record
 */
const addEducation = async (applicantId, data, fileData = null) => {
  const { 
    education_level_id, qualification_level, degree_name, 
    university_board, passing_year, percentage, specialization, stream_subject
  } = data;

  try {
    await assertProfileEditable(applicantId);

    // Validate education_level_id if provided
    if (education_level_id) {
      const level = await EducationLevel.findByPk(education_level_id);
      if (!level) {
        throw new ApiError(400, 'Invalid education level ID');
      }
    }

    const certificatePath = fileData?.path
      ? getRelativePath(fileData.path).replace(/\\/g, '/')
      : null;

    const education = await ApplicantEducation.create({
      applicant_id: applicantId,
      education_level_id,
      qualification_level,
      degree_name,
      university_board,
      passing_year,
      percentage,
      specialization,
      stream_subject,
      certificate_path: certificatePath
    });

    // Fetch with education level details
    const created = await ApplicantEducation.findByPk(education.education_id, {
      include: [{ model: EducationLevel, as: 'educationLevel' }]
    });

    const json = created ? created.toJSON() : education.toJSON();
    json.certificate_path = toPublicUploadPath(json.certificate_path);

    logger.info(`Education added for applicant: ${applicantId}`);
    return json;
  } catch (error) {
    logger.error('Add education error:', error);
    throw error;
  }
};

/**
 * Update education record
 * @param {number} applicantId - Applicant ID
 * @param {number} educationId - Education ID
 * @param {Object} data - Education data
 * @returns {Promise<Object>} - Updated education record
 */
const updateEducation = async (applicantId, educationId, data) => {
  try {
    await assertProfileEditable(applicantId);

    const education = await ApplicantEducation.findOne({
      where: { education_id: educationId, applicant_id: applicantId }
    });

    if (!education) {
      throw new ApiError(404, 'Education record not found');
    }

    await education.update(data);
    logger.info(`Education updated for applicant: ${applicantId}`);
    return education;
  } catch (error) {
    logger.error('Update education error:', error);
    throw error;
  }
};

/**
 * Delete education record
 * @param {number} applicantId - Applicant ID
 * @param {number} educationId - Education ID
 * @returns {Promise<Object>} - Result
 */
const deleteEducation = async (applicantId, educationId) => {
  try {
    await assertProfileEditable(applicantId);

    const education = await ApplicantEducation.findOne({
      where: { education_id: educationId, applicant_id: applicantId }
    });

    if (!education) {
      throw new ApiError(404, 'Education record not found');
    }

    await education.update({
      is_deleted: true,
      deleted_at: new Date(),
      updated_at: new Date()
    });
    logger.info(`Education deleted for applicant: ${applicantId}`);
    return { message: 'Education record deleted successfully' };
  } catch (error) {
    logger.error('Delete education error:', error);
    throw error;
  }
};

module.exports = {
  addEducation,
  updateEducation,
  deleteEducation
};
