// ============================================================================
// APPLICANT PROFILE SERVICE
// ============================================================================
// Purpose: Profile management operations for applicants
// Tables: ms_applicant_master, ms_applicant_personal, ms_applicant_address
// ============================================================================

const db = require('../../models');
const {
  ApplicantMaster,
  ApplicantPersonal,
  ApplicantAddress,
  ApplicantEducation,
  ApplicantExperience,
  ApplicantDocument,
  ApplicantSkill,
  SkillMaster,
  Application,
  DistrictMaster,
  TalukaMaster,
  DocumentType
} = db;
const logger = require('../../config/logger');
const { ApiError } = require('../../middleware/errorHandler');
const { getRelativePath, getAbsolutePath } = require('../../utils/fileUpload');
const { Op } = require('sequelize');
const documentService = require('./documentService');
const eligibilityService = require('../eligibilityService');
const path = require('path');
const fs = require('fs');

const isProfileLocked = async (applicantId) => {
  const count = await Application.count({
    where: {
      applicant_id: applicantId,
      is_deleted: false
    }
  });
  return (count || 0) > 0;
};

const assertProfileEditable = async (applicantId) => {
  const locked = await isProfileLocked(applicantId);
  if (locked) {
    throw new ApiError(403, 'Profile is locked after applying. You can only upload required documents.');
  }
};

// ==================== HELPER FUNCTIONS ====================

const toPublicUploadPath = (filePath) => {
  if (!filePath) return null;
  const rel = getRelativePath(filePath).replace(/\\/g, '/');
  return '/' + rel.replace(/^\/+/, '');
};

const normalizeBoolean = (value) => {
  if (typeof value === 'boolean') return value;
  if (value === null || value === undefined) return false;
  const v = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(v)) return true;
  if (['false', '0', 'no', 'n'].includes(v)) return false;
  return false;
};

const normalizeNullableInt = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
};

const replacePersonalFile = async (applicantId, fileData, columnName, options = {}) => {
  const requirePersonal = options.requirePersonal !== false;
  const validate = options.validate;

  if (!fileData?.path) {
    throw new ApiError(400, 'No file uploaded');
  }

  await assertProfileEditable(applicantId);

  const personal = await ApplicantPersonal.findOne({ where: { applicant_id: applicantId, is_deleted: false } });
  if (!personal && requirePersonal) {
    throw new ApiError(400, 'Please save personal profile before uploading document');
  }
  if (!personal) {
    throw new ApiError(404, 'Personal profile not found');
  }

  if (typeof validate === 'function') {
    validate(personal);
  }

  const relativePath = getRelativePath(fileData.path).replace(/\\/g, '/');

  if (personal[columnName]) {
    const oldFsPath = path.isAbsolute(personal[columnName])
      ? personal[columnName]
      : getAbsolutePath(personal[columnName]);

    if (fs.existsSync(oldFsPath)) {
      fs.unlinkSync(oldFsPath);
    }
  }

  await personal.update({ [columnName]: relativePath });

  const json = personal.toJSON();
  json[columnName] = toPublicUploadPath(json[columnName]);
  return json;
};

/**
 * Upload and store domicile certificate path in personal profile
 * Only allowed when domicile_maharashtra = true
 * @param {number} applicantId
 * @param {Object} fileData - multer file object
 */
const saveDomicileCertificate = async (applicantId, fileData) => {
  try {
    return await replacePersonalFile(applicantId, fileData, 'domicile_path', {
      validate: (personal) => {
        if (!personal.domicile_maharashtra) {
          throw new ApiError(400, 'Domicile certificate upload is allowed only when domicile_maharashtra is true');
        }
      }
    });
  } catch (error) {
    logger.error('Save domicile certificate error:', error);
    throw error;
  }
};

const savePhoto = async (applicantId, fileData) => {
  try {
    return await replacePersonalFile(applicantId, fileData, 'photo_path');
  } catch (error) {
    logger.error('Save photo error:', error);
    throw error;
  }
};

const saveSignature = async (applicantId, fileData) => {
  try {
    return await replacePersonalFile(applicantId, fileData, 'signature_path');
  } catch (error) {
    logger.error('Save signature error:', error);
    throw error;
  }
};

const saveAadhaar = async (applicantId, fileData) => {
  try {
    return await replacePersonalFile(applicantId, fileData, 'aadhaar_path');
  } catch (error) {
    logger.error('Save aadhaar error:', error);
    throw error;
  }
};

const savePan = async (applicantId, fileData) => {
  try {
    return await replacePersonalFile(applicantId, fileData, 'pan_path');
  } catch (error) {
    logger.error('Save pan error:', error);
    throw error;
  }
};

const saveResume = async (applicantId, fileData) => {
  try {
    return await replacePersonalFile(applicantId, fileData, 'resume_path');
  } catch (error) {
    logger.error('Save resume error:', error);
    throw error;
  }
};

// ==================== EXPERIENCE PREFERENCE ====================

const setExperiencePreference = async (applicantId, hasExperience) => {
  try {
    await assertProfileEditable(applicantId);

    const personal = await ApplicantPersonal.findOne({ where: { applicant_id: applicantId, is_deleted: false } });

    if (!personal) {
      throw new ApiError(400, 'Please save personal profile before setting experience preference');
    }

    const normalized = normalizeBoolean(hasExperience);

    await personal.update({ has_experience: normalized });

    return { has_experience: personal.has_experience };
  } catch (error) {
    logger.error('Set experience preference error:', error);
    throw error;
  }
};

// ==================== DASHBOARD ====================

/**
 * Get applicant dashboard data
 * @param {number} applicantId - Applicant ID
 * @returns {Promise<Object>} - Dashboard data
 */
const getDashboard = async (applicantId) => {
  try {
    logger.info(`Dashboard requested for applicantId=${applicantId}`);

    const applicant = await ApplicantMaster.findByPk(applicantId, {
      include: [
        { model: ApplicantPersonal, as: 'personal' },
        { model: ApplicantAddress, as: 'address' },
        { model: ApplicantEducation, as: 'education', required: false },
        { model: ApplicantExperience, as: 'experience', required: false },
        { model: ApplicantDocument, as: 'documents' }
      ]
    });

    if (!applicant) {
      logger.warn(`Dashboard: Applicant not found for applicantId=${applicantId}`);
      throw new ApiError(404, 'Applicant not found');
    }

    // Profile completion breakdown
    const personal = applicant.personal;
    const address = applicant.address;
    const education = applicant.education || [];
    const experience = applicant.experience || [];
    const documents = (applicant.documents || []).filter(d => !d.is_deleted);

    // Personal section
    const personalMissing = [];
    if (!personal || !personal.dob) personalMissing.push('dob');
    if (!personal || !personal.gender) personalMissing.push('gender');
    const personalCompleted = personalMissing.length === 0;

    // Address section
    const addressMissing = [];
    if (!address || !address.address_line) addressMissing.push('address_line');
    if (!address || !address.district_id) addressMissing.push('district_id');
    if (!address || !address.taluka_id) addressMissing.push('taluka_id');
    if (!address || !address.pincode) addressMissing.push('pincode');
    const addressCompleted = addressMissing.length === 0;

    // Education section
    const educationMissing = [];
    const educationCompleted = education.length > 0;
    if (!educationCompleted) {
      educationMissing.push('At least one education record required');
    }

    // Experience section
    const experienceMissing = [];
    const wantsExperience = personal?.has_experience;

    let experienceCompleted;
    if (wantsExperience === true) {
      experienceCompleted = experience.length > 0;
      if (!experienceCompleted) {
        experienceMissing.push('At least one experience record required');
      }
    } else if (wantsExperience === false) {
      experienceCompleted = true; // opted out
    } else {
      // Not explicitly opted; fall back to legacy behavior (at least one record), but guide user
      experienceCompleted = experience.length > 0;
      if (!experienceCompleted) {
        experienceMissing.push('Add experience or mark No experience');
      }
    }

    // Documents section (source of truth: /api/v1/applicant/documents/required)
    const documentsMissing = [];
    const requiredDocTypes = await documentService.getRequiredDocumentTypes(applicantId);
    const requiredDocTypeIds = (requiredDocTypes || []).map(d => d.doc_type_id).filter(Boolean);
    const uploadedDocTypeIds = new Set(
      documents
        .filter(d => !d.is_deleted)
        .map(d => d.doc_type_id)
        .filter(Boolean)
    );
    const uploadedDocCodes = new Set(
      documents
        .filter(d => !d.is_deleted)
        .map(d => (d.doc_type || '').toString().trim().toUpperCase())
        .filter(Boolean)
    );

    for (const req of (requiredDocTypes || [])) {
      const requiredId = req?.doc_type_id;
      const requiredCode = (req?.doc_code || '').toString().trim().toUpperCase();
      if (!requiredId && !requiredCode) continue;

      const hasById = requiredId ? uploadedDocTypeIds.has(requiredId) : false;
      const hasByCode = requiredCode ? uploadedDocCodes.has(requiredCode) : false;

      if (!hasById && !hasByCode) {
        documentsMissing.push(`${req.doc_type_name} required`);
      }
    }

    const documentsCompleted = requiredDocTypeIds.length === 0 ? true : documentsMissing.length === 0;

    // Weights for each section
    const weights = {
      personal: 25,
      address: 20,
      education: 25,
      experience: 15,
      documents: 15
    };

    const sections = {
      personal: { weight: weights.personal, completed: personalCompleted, fields: personalMissing },
      address: { weight: weights.address, completed: addressCompleted, fields: addressMissing },
      education: { weight: weights.education, completed: educationCompleted, fields: educationMissing },
      experience: { weight: weights.experience, completed: experienceCompleted, fields: experienceMissing },
      documents: { weight: weights.documents, completed: documentsCompleted, fields: documentsMissing }
    };

    const totalWeight = Object.values(weights).reduce((sum, w) => sum + w, 0);
    const completedWeight = Object.entries(sections)
      .filter(([, s]) => s.completed)
      .reduce((sum, [, s]) => sum + s.weight, 0);

    const percentage = Math.round((completedWeight / totalWeight) * 100);
    const isComplete = percentage === 100;
    const canApply = isComplete;

    // Backward-compatible simple completion summary
    // NOTE: include experience so total can reach 100
    const steps = {
      personal: personalCompleted ? weights.personal : 0,
      address: addressCompleted ? weights.address : 0,
      education: educationCompleted ? weights.education : 0,
      experience: experienceCompleted ? weights.experience : 0,
      documents: documentsCompleted ? weights.documents : 0
    };
    const completion = steps.personal + steps.address + steps.education + steps.experience + steps.documents;

    // Get application counts
    const applications = await Application.findAll({
      where: { applicant_id: applicantId, is_deleted: false },
      attributes: ['status']
    });

    const normalizeStatus = (raw) => {
      if (!raw) return null;
      const s = raw.toString().trim().toUpperCase().replace(/\s+/g, '_');
      if (s === 'HOLD' || s === 'ONHOLD' || s === 'ON-HOLD') return 'ON_HOLD';
      if (s === 'REJECT' || s === 'REJECTED') return 'REJECTED';
      if (s === 'SELECT' || s === 'SELECTED') return 'SELECTED';
      if (s === 'NOTELIGIBLE' || s === 'NOT-ELIGIBLE') return 'NOT_ELIGIBLE';
      return s;
    };

    const counts = {
      total: 0,
      draft: 0,
      eligible: 0,
      selected: 0,
      rejected: 0,
      on_hold: 0,
      not_eligible: 0
    };

    for (const a of applications) {
      counts.total += 1;
      const s = normalizeStatus(a.status);
      if (s === 'DRAFT') counts.draft += 1;
      else if (s === 'ELIGIBLE') counts.eligible += 1;
      else if (s === 'SELECTED') counts.selected += 1;
      else if (s === 'REJECTED') counts.rejected += 1;
      else if (s === 'ON_HOLD') counts.on_hold += 1;
      else if (s === 'NOT_ELIGIBLE') counts.not_eligible += 1;
    }

    // Eligible posts count (skipped heavy eligibility computation on dashboard load)
    const eligiblePosts = [];
    const eligiblePostsCount = 0;
    const eligiblePostsTotal = 0;

    const applicationStats = {
      total: counts.total,
      draft: counts.draft,
      eligible: counts.eligible,
      selected: counts.selected,
      rejected: counts.rejected,
      on_hold: counts.on_hold,
      not_eligible: counts.not_eligible,
      eligible_posts: eligiblePostsCount,
      total_open_posts: Array.isArray(eligiblePosts) ? eligiblePosts.length : 0
    };

    // Profile summary
    // Profile summary photo: use photo_path from personal table
    const photo_url = personal?.photo_path ? toPublicUploadPath(personal.photo_path) : null;
    const full_name = personal?.full_name || null;
    const email = applicant.email || null;

    return {
      profileCompletion: completion,
      completionSteps: steps,
      applicationStats,
      eligiblePosts: {
        total_posts: Array.isArray(eligiblePosts) ? eligiblePosts.length : 0,
        eligible_count: eligiblePostsCount
      },
      profile: {
        full_name,
        email,
        mobile_no: applicant.mobile_no,
        is_mobile_verified: applicant.is_mobile_verified,
        status: applicant.status,
        photo_url
      },
      completionStatus: {
        percentage,
        isComplete,
        canApply,
        sections
      }
    };
  } catch (error) {
    logger.error('Get dashboard error:', error);
    throw error;
  }
};


// ==================== PROFILE MANAGEMENT ====================

/**
 * Get complete profile
 * @param {number} applicantId - Applicant ID
 * @returns {Promise<Object>} - Complete profile
 */
const getProfile = async (applicantId) => {
  try {
    const applicant = await ApplicantMaster.findByPk(applicantId, {
      include: [
        { model: ApplicantPersonal, as: 'personal', required: false },
        {
          model: ApplicantAddress,
          as: 'address',
          required: false,
          include: [
            { model: DistrictMaster, as: 'district', required: false },
            { model: TalukaMaster, as: 'taluka', required: false }
          ]
        },
        { model: ApplicantEducation, as: 'education', required: false, where: { is_deleted: false }, required: false },
        { model: ApplicantExperience, as: 'experience', required: false, where: { is_deleted: false }, required: false },
        { model: ApplicantSkill, as: 'skills', required: false, include: [{ model: SkillMaster, as: 'skill', required: false }] },
        { model: ApplicantDocument, as: 'documents', required: false }
      ]
    });

    if (!applicant) {
      throw new ApiError(404, 'Applicant not found');
    }

    const json = applicant.toJSON();

    // Remove sensitive/auth-only fields
    delete json.password_hash;
    delete json.activation_token;
    delete json.activation_token_expires_at;
    delete json.password_reset_token;
    delete json.password_reset_token_expires_at;

    json.profile_locked = await isProfileLocked(applicantId);

    if (json.personal) {
      // PAN temporarily disabled
      delete json.personal.pan_no;
      delete json.personal.pan_path;

      // Normalize media paths to public /uploads path and avoid duplicate *_url keys
      json.personal.photo_path = toPublicUploadPath(json.personal.photo_path);
      json.personal.signature_path = toPublicUploadPath(json.personal.signature_path);
      json.personal.resume_path = toPublicUploadPath(json.personal.resume_path);
      json.personal.domicile_path = toPublicUploadPath(json.personal.domicile_path);
      json.personal.aadhaar_path = toPublicUploadPath(json.personal.aadhaar_path);
    }

    if (Array.isArray(json.education)) {
      json.education = json.education.map((e) => {
        const row = { ...e };
        row.certificate_path = toPublicUploadPath(row.certificate_path);
        return row;
      });
    }

    if (Array.isArray(json.experience)) {
      json.experience = json.experience.map((e) => {
        const row = { ...e };
        row.certificate_path = toPublicUploadPath(row.certificate_path);
        row.offer_letter_path = toPublicUploadPath(row.offer_letter_path);
        row.salary_slip_path = toPublicUploadPath(row.salary_slip_path);
        return row;
      });
    }

    if (Array.isArray(json.skills)) {
      json.skills = json.skills.map((s) => {
        const row = { ...s };
        row.certificate_path = toPublicUploadPath(row.certificate_path);
        return row;
      });
    }

    if (Array.isArray(json.documents)) {
      json.documents = json.documents.map((d) => {
        const row = { ...d };
        row.file_path = toPublicUploadPath(row.file_path);
        if (Object.prototype.hasOwnProperty.call(row, 'compressed_path')) {
          row.compressed_path = toPublicUploadPath(row.compressed_path);
        }
        if (Object.prototype.hasOwnProperty.call(row, 'thumbnail_path')) {
          row.thumbnail_path = toPublicUploadPath(row.thumbnail_path);
        }
        return row;
      });
    }

    json.profile_img = json.personal?.photo_path || null;

    return json;
  } catch (error) {
    logger.error('Get profile error:', error);
    throw error;
  }
};

/**
 * Save or update personal profile
 * @param {number} applicantId - Applicant ID
 * @param {Object} data - Personal data
 * @returns {Promise<Object>} - Saved personal profile
 */
const savePersonalProfile = async (applicantId, data) => {
  const {
    full_name, dob, gender, category_id: _category_id, domicile_maharashtra,
    aadhar_no, father_name, mother_name, marital_status,
    // PAN temporarily disabled
    // pan_no,
    mobile_no
  } = data;

  try {
    await assertProfileEditable(applicantId);

    logger.info('savePersonalProfile input', {
      applicantId, full_name, dob, gender, domicile_maharashtra, has_mobile_no: !!mobile_no
    });

    let personal = await ApplicantPersonal.findOne({ where: { applicant_id: applicantId } });

    const normalizedDomicile = normalizeBoolean(domicile_maharashtra);

    // If mobile_no is provided, update it on ApplicantMaster
    if (mobile_no) {
      const normalizedMobile = String(mobile_no).replace(/\D/g, '');
      if (normalizedMobile.length !== 10) {
        throw new ApiError(400, 'Mobile number must be 10 digits');
      }
      await ApplicantMaster.update({ mobile_no: normalizedMobile }, { where: { applicant_id: applicantId } });
    }

    if (personal) {
      await personal.update({
        full_name, dob, gender, domicile_maharashtra: normalizedDomicile,
        aadhar_no, father_name, mother_name, marital_status
      });
    } else {
      personal = await ApplicantPersonal.create({
        applicant_id: applicantId, full_name, dob, gender, domicile_maharashtra: normalizedDomicile,
        aadhar_no, father_name, mother_name, marital_status
      });
    }

    logger.info(`Personal profile saved for applicant: ${applicantId}`);
    return personal;
  } catch (error) {
    logger.error('Save personal profile error:', error);
    throw error;
  }
};

/**
 * Save or update address profile
 * @param {number} applicantId - Applicant ID
 * @param {Object} data - Address data
 * @returns {Promise<Object>} - Saved address profile
 */
const saveAddressProfile = async (applicantId, data) => {
  const {
    address_line, address_line2, district_id, taluka_id, pincode,
    permanent_address_same, permanent_address_line, permanent_address_line2,
    permanent_district_id, permanent_taluka_id, permanent_pincode
  } = data;

  try {
    await assertProfileEditable(applicantId);

    let address = await ApplicantAddress.findOne({ where: { applicant_id: applicantId } });

    const same = normalizeBoolean(permanent_address_same);

    let finalPermanentAddressLine = permanent_address_line || null;
    let finalPermanentAddressLine2 = permanent_address_line2 || null;
    let finalPermanentDistrictId = normalizeNullableInt(permanent_district_id);
    let finalPermanentTalukaId = normalizeNullableInt(permanent_taluka_id);
    let finalPermanentPincode = permanent_pincode || null;

    let finalAddressLine = address_line || null;
    let finalAddressLine2 = address_line2 || null;
    let finalDistrictId = normalizeNullableInt(district_id);
    let finalTalukaId = normalizeNullableInt(taluka_id);
    let finalPincode = pincode || null;

    if (same) {
      const sourceAddressLine = permanent_address_line || address_line || null;
      const sourceAddressLine2 = permanent_address_line2 || address_line2 || null;
      const sourceDistrictId = normalizeNullableInt(permanent_district_id) ?? normalizeNullableInt(district_id);
      const sourceTalukaId = normalizeNullableInt(permanent_taluka_id) ?? normalizeNullableInt(taluka_id);
      const sourcePincode = permanent_pincode || pincode || null;

      finalPermanentAddressLine = sourceAddressLine;
      finalPermanentAddressLine2 = sourceAddressLine2;
      finalPermanentDistrictId = sourceDistrictId;
      finalPermanentTalukaId = sourceTalukaId;
      finalPermanentPincode = sourcePincode;

      finalAddressLine = sourceAddressLine;
      finalAddressLine2 = sourceAddressLine2;
      finalDistrictId = sourceDistrictId;
      finalTalukaId = sourceTalukaId;
      finalPincode = sourcePincode;
    }

    const addressData = {
      address_line: finalAddressLine,
      address_line2: finalAddressLine2,
      district_id: finalDistrictId,
      taluka_id: finalTalukaId,
      pincode: finalPincode,
      permanent_address_same: same,
      permanent_address_line: finalPermanentAddressLine,
      permanent_address_line2: finalPermanentAddressLine2,
      permanent_district_id: finalPermanentDistrictId,
      permanent_taluka_id: finalPermanentTalukaId,
      permanent_pincode: finalPermanentPincode
    };

    if (address) {
      await address.update(addressData);
    } else {
      address = await ApplicantAddress.create({ applicant_id: applicantId, ...addressData });
    }

    logger.info(`Address profile saved for applicant: ${applicantId}`);
    return address;
  } catch (error) {
    logger.error('Save address profile error:', error);
    throw error;
  }
};

module.exports = {
  getDashboard,
  getProfile,
  savePersonalProfile,
  saveAddressProfile,
  saveDomicileCertificate,
  savePhoto,
  saveSignature,
  saveAadhaar,
  savePan,
  saveResume,
  setExperiencePreference,
};
