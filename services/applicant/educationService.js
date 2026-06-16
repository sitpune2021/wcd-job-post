// ============================================================================
// APPLICANT EDUCATION SERVICE
// ============================================================================
// Purpose: Education record management for applicants
// Table: ms_applicant_education
// ============================================================================

const db = require('../../models');
const { ApplicantEducation, EducationLevel, ApplicantMaster, ApplicantPersonal } = db;
const logger = require('../../config/logger');
const { ApiError } = require('../../middleware/errorHandler');
const { getRelativePath, optimizeUploadedImage } = require('../../utils/fileUpload');
const educationOcrVerifier = require('../ocr/educationOcrVerifier');

const toPublicUploadPath = (filePath) => {
  if (!filePath) return null;
  const rel = getRelativePath(filePath).replace(/\\/g, '/');
  return '/' + rel.replace(/^\/+/, '');
};

const { assertProfileEditable } = require('./profileEditPolicy');

const isCgpaColumnWriteError = (error) => {
  const code = error?.original?.code || error?.parent?.code;
  const sql = String(error?.original?.sql || error?.parent?.sql || '');
  return (
    sql.includes('"cgpa"') &&
    (code === '42703' || code === '22003')
  );
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
    education_level_id, qualification_level, degree_name, seatNumber, seat_number,
    university_board, passing_year, percentage, cgpa, specialization, stream_subject
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

    const normalizedCgpa = cgpa === undefined || cgpa === null || cgpa === '' ? null : Number(cgpa);
    const normalizedPercentage = percentage === undefined || percentage === null || percentage === ''
      ? (normalizedCgpa === null ? null : Number(((normalizedCgpa - 0.5) * 10).toFixed(2)))
      : Number(percentage);
    if (normalizedCgpa !== null && (!Number.isFinite(normalizedCgpa) || normalizedCgpa < 0.5 || normalizedCgpa > 10)) {
      throw new ApiError(400, 'CGPA must be between 0.5 and 10');
    }
    if (!Number.isFinite(normalizedPercentage) || normalizedPercentage < 0 || normalizedPercentage > 100) {
      throw new ApiError(400, 'Percentage must be between 0 and 100');
    }

    let personal = null;
    if (fileData?.path) {
      personal = await ApplicantPersonal.findOne({
        where: { applicant_id: applicantId, is_deleted: false },
        attributes: ['full_name']
      });

      if (!personal || !personal.full_name) {
        throw new ApiError(400, 'Personal details are incomplete. Please fill your full name before uploading certificates.');
      }

      await educationOcrVerifier.verifyEducationDocument({
        full_name: personal.full_name,
        degree_name,
        university_board,
        seat_number: seatNumber || seat_number,
        passing_year,
        percentage: normalizedPercentage,
        cgpa: normalizedCgpa
      }, fileData.path, applicantId, {
        preverifiedToken: data.ocr_verification_token
      });
    }
    fileData = await optimizeUploadedImage(fileData);
    const certificatePath = fileData?.path
      ? getRelativePath(fileData.path).replace(/\\/g, '/')
      : null;

    const createPayload = {
      applicant_id: applicantId,
      education_level_id,
      qualification_level,
      degree_name,
      university_board,
      seatnumber: seatNumber || seat_number,
      passing_year,
      percentage: normalizedPercentage,
      cgpa: normalizedCgpa,
      specialization,
      stream_subject,
      certificate_path: certificatePath
    };

    let education;
    try {
      education = await ApplicantEducation.create(createPayload);
    } catch (error) {
      if (!isCgpaColumnWriteError(error)) throw error;
      logger.warn(`CGPA column is not ready in DB, saving education for applicant ${applicantId} without cgpa`);
      delete createPayload.cgpa;
      education = await ApplicantEducation.create(createPayload);
    }

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
const updateEducation = async (applicantId, educationId, data, fileData = null) => {
  try {
    await assertProfileEditable(applicantId);

    const education = await ApplicantEducation.findOne({
      where: { education_id: educationId, applicant_id: applicantId }
    });

    if (!education) {
      throw new ApiError(404, 'Education record not found');
    }

    // Validate a changed education level.
    if (data.education_level_id && data.education_level_id !== education.education_level_id) {
      const level = await EducationLevel.findByPk(data.education_level_id);
      if (!level) {
        throw new ApiError(400, 'Invalid education level ID');
      }
    }

    // ==================== SIMPLIFIED DUPLICATE VALIDATIONS (if updating) ====================
    
    // 1. Update certificate path if new file provided
    if (fileData?.path) {
      const personal = await ApplicantPersonal.findOne({
        where: { applicant_id: applicantId, is_deleted: false },
        attributes: ['full_name']
      });

      if (!personal || !personal.full_name) {
        throw new ApiError(400, 'Personal details are incomplete. Please fill your full name before uploading certificates.');
      }

      await educationOcrVerifier.verifyEducationDocument({
        full_name: personal.full_name,
        degree_name: data.degree_name ?? education.degree_name,
        university_board: data.university_board ?? education.university_board,
        seat_number: data.seat_number ?? data.seatNumber ?? education.seatnumber,
        passing_year: data.passing_year ?? education.passing_year,
        percentage: data.percentage ?? education.percentage,
        cgpa: data.cgpa ?? education.cgpa
      }, fileData.path, applicantId, {
        preverifiedToken: data.ocr_verification_token
      });

      fileData = await optimizeUploadedImage(fileData);
      data.certificate_path = getRelativePath(fileData.path).replace(/\\/g, '/');
    }

    if (data.cgpa !== undefined) {
      const normalizedCgpa = data.cgpa === null || data.cgpa === '' ? null : Number(data.cgpa);
      if (normalizedCgpa !== null && (!Number.isFinite(normalizedCgpa) || normalizedCgpa < 0.5 || normalizedCgpa > 10)) {
        throw new ApiError(400, 'CGPA must be between 0.5 and 10');
      }
      data.cgpa = normalizedCgpa;
      if (normalizedCgpa !== null) data.percentage = Number(((normalizedCgpa - 0.5) * 10).toFixed(2));
    }

    try {
      await education.update(data);
    } catch (error) {
      if (!isCgpaColumnWriteError(error)) throw error;
      logger.warn(`CGPA column is not ready in DB, updating education ${educationId} without cgpa`);
      const retryData = { ...data };
      delete retryData.cgpa;
      await education.update(retryData);
    }
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
