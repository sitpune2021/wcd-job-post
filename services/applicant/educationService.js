// ============================================================================
// APPLICANT EDUCATION SERVICE
// ============================================================================
// Purpose: Education record management for applicants
// Table: ms_applicant_education
// ============================================================================

const db = require('../../models');
const { ApplicantEducation, EducationLevel, Application, ApplicantMaster, ApplicantPersonal } = db;
const logger = require('../../config/logger');
const { ApiError } = require('../../middleware/errorHandler');
const { getRelativePath } = require('../../utils/fileUpload');
const crypto = require('crypto');
const fs = require('fs').promises;

const toPublicUploadPath = (filePath) => {
  if (!filePath) return null;
  const rel = getRelativePath(filePath).replace(/\\/g, '/');
  return '/' + rel.replace(/^\/+/, '');
};

const isOcrEnabled = () => {
  const enabled = process.env.OCR_VERIFICATION_ENABLED;
  return enabled === 'true' || enabled === '1';
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

/**
 * Relaxed name match: any single word match is allowed
 * This handles cases where names might be rearranged or have spelling variations
 */
const checkNameMatch = (certificateName, applicantFullName) => {
  if (!certificateName || !applicantFullName) return false;

  const norm = (str) => String(str).toLowerCase().trim().replace(/\s+/g, ' ');
  const certParts = norm(certificateName).split(' ').filter(Boolean);
  const appParts = norm(applicantFullName).split(' ').filter(Boolean);

  if (certParts.length === 0 || appParts.length === 0) return false;

  // Check if any word from certificate matches any word from applicant name
  for (const certWord of certParts) {
    // Skip very short words (like initials) unless it's the only word
    if (certWord.length < 2 && certParts.length > 1) continue;
    
    for (const appWord of appParts) {
      // Skip very short words (like initials) unless it's the only word
      if (appWord.length < 2 && appParts.length > 1) continue;
      
      // Exact match
      if (certWord === appWord) {
        return true;
      }
      
      // Fuzzy match for words with length >= 3 (handles minor spelling variations)
      if (certWord.length >= 3 && appWord.length >= 3) {
        // Check if one word contains the other (handles abbreviations or partial matches)
        if (certWord.includes(appWord) || appWord.includes(certWord)) {
          return true;
        }
        
        // Simple Levenshtein distance for minor spelling errors
        if (calculateLevenshteinDistance(certWord, appWord) <= 1) {
          return true;
        }
      }
    }
  }

  return false;
};

/**
 * Calculate Levenshtein distance between two strings
 * Used for fuzzy matching of names with minor spelling variations
 */
const calculateLevenshteinDistance = (str1, str2) => {
  const matrix = [];
  
  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  
  return matrix[str2.length][str1.length];
};

// Simple in-memory cache to avoid repeated OCR name extraction per file hash
const candidateNameCache = new Map(); // key: fileHash, value: candidate_name string
const MAX_CACHE_SIZE = 50;

const getFileHash = async (filePath) => {
  try {
    const buffer = await fs.readFile(filePath);
    return crypto.createHash('sha256').update(buffer).digest('hex');
  } catch (err) {
    logger.warn(`Failed to hash file for cache: ${err.message}`);
    return null;
  }
};

const getCandidateNameFromCertificate = async (filePath) => {
  if (!isOcrEnabled()) return null;

  const fileHash = await getFileHash(filePath);
  if (fileHash && candidateNameCache.has(fileHash)) {
    return candidateNameCache.get(fileHash);
  }

  const { analyzeEducationDocument } = require('../../utils/ocr/openaiClient');
  const ocrResult = await analyzeEducationDocument(filePath);

  if (ocrResult?.success && ocrResult.data?.candidate_name?.value) {
    const name = ocrResult.data.candidate_name.value;
    if (fileHash) {
      if (candidateNameCache.size >= MAX_CACHE_SIZE) {
        // Simple eviction: remove first inserted
        const firstKey = candidateNameCache.keys().next().value;
        candidateNameCache.delete(firstKey);
      }
      candidateNameCache.set(fileHash, name);
    }
    return name;
  }

  return null;
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
    education_level_id, qualification_level, degree_name, seatNumber,
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

      // Prevent duplicate education level entries (non-deleted)
      const existing = await ApplicantEducation.findOne({
        where: {
          applicant_id: applicantId,
          education_level_id,
          is_deleted: false
        }
      });
      if (existing) {
        throw new ApiError(400, 'This education level is already added. Please edit the existing record.');
      }
    }

    const certificatePath = fileData?.path
      ? getRelativePath(fileData.path).replace(/\\/g, '/')
      : null;

    // ==================== SIMPLIFIED DUPLICATE VALIDATIONS ====================
    
    // 1. Check for duplicate passing year (for different education levels)
    if (passing_year && education_level_id) {
      const duplicateYear = await ApplicantEducation.findOne({
        where: {
          applicant_id: applicantId,
          passing_year: passing_year,
          is_deleted: false,
          education_level_id: { [db.Sequelize.Op.ne]: education_level_id }
        },
        include: [{ model: EducationLevel, as: 'educationLevel', attributes: ['level_name'] }]
      });
      
      if (duplicateYear) {
        throw new ApiError(400, 
          `This passing year (${passing_year}) is already used for ${duplicateYear.educationLevel?.level_name || 'another education level'}. Each education level should be from a different year.`);
      }
    }

    // 2. Check if certificate name matches applicant's name
    if (fileData?.path) {
      // Get applicant's full name from personal table
      const personal = await ApplicantPersonal.findOne({
        where: { applicant_id: applicantId, is_deleted: false },
        attributes: ['full_name']
      });

      if (!personal || !personal.full_name) {
        throw new ApiError(400, 'Personal details are incomplete. Please fill your full name before uploading certificates.');
      }
      
      // Extract name from certificate using OCR (cached)
      const certificateName = await getCandidateNameFromCertificate(fileData.path);

      if (certificateName) {
        const nameMatch = checkNameMatch(certificateName, personal.full_name);
        
        if (!nameMatch) {
          logger.warn(`Name mismatch detected for applicant ${applicantId}: Certificate="${certificateName}" vs Profile="${personal.full_name}"`);
          throw new ApiError(400, 
            `The name on the certificate (${certificateName}) does not match your profile name (${personal.full_name}). Please upload your own certificate.`);
        }
        
        logger.info(`Name validation passed for applicant ${applicantId}`);
      }
    }

    const education = await ApplicantEducation.create({
      applicant_id: applicantId,
      education_level_id,
      qualification_level,
      degree_name,
      university_board,
      seatNumber,
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
const updateEducation = async (applicantId, educationId, data, fileData = null) => {
  try {
    await assertProfileEditable(applicantId);

    const education = await ApplicantEducation.findOne({
      where: { education_id: educationId, applicant_id: applicantId }
    });

    if (!education) {
      throw new ApiError(404, 'Education record not found');
    }

    // If changing education_level_id, ensure no duplicate
    if (data.education_level_id && data.education_level_id !== education.education_level_id) {
      const level = await EducationLevel.findByPk(data.education_level_id);
      if (!level) {
        throw new ApiError(400, 'Invalid education level ID');
      }

      const duplicate = await ApplicantEducation.findOne({
        where: {
          applicant_id: applicantId,
          education_level_id: data.education_level_id,
          is_deleted: false,
          education_id: { [db.Sequelize.Op.ne]: educationId }
        }
      });
      if (duplicate) {
        throw new ApiError(400, 'This education level is already added. Please edit the existing record.');
      }
    }

    // ==================== SIMPLIFIED DUPLICATE VALIDATIONS (if updating) ====================
    
    // 1. Update certificate path if new file provided
    if (fileData?.path) {
      data.certificate_path = getRelativePath(fileData.path).replace(/\\/g, '/');
    }

    // 2. Check for duplicate passing year (if being updated)
    const newYear = data.passing_year !== undefined ? data.passing_year : education.passing_year;
    const newEducationLevelId = data.education_level_id !== undefined ? data.education_level_id : education.education_level_id;
    
    if (newYear && newEducationLevelId && data.passing_year !== undefined) {
      const duplicateYear = await ApplicantEducation.findOne({
        where: {
          applicant_id: applicantId,
          passing_year: newYear,
          is_deleted: false,
          education_level_id: { [db.Sequelize.Op.ne]: newEducationLevelId },
          education_id: { [db.Sequelize.Op.ne]: educationId }
        },
        include: [{ model: EducationLevel, as: 'educationLevel', attributes: ['level_name'] }]
      });
      
      if (duplicateYear) {
        throw new ApiError(400, 
          `This passing year (${newYear}) is already used for ${duplicateYear.educationLevel?.level_name || 'another education level'}. Each education level should be from a different year.`);
      }
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
