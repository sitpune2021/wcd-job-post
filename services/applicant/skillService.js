// ============================================================================
// APPLICANT SKILL SERVICE
// ============================================================================
// Purpose: Skill record management for applicants
// Table: ms_applicant_skills
// ============================================================================

const db = require('../../models');
const { ApplicantSkill, SkillMaster, Application } = db;
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

const addSkill = async (applicantId, data, fileData = null) => {
  const {
    skill_id,
    notes
  } = data;

  try {
    await assertProfileEditable(applicantId);

    if (!skill_id) {
      throw new ApiError(400, 'skill_id is required');
    }

    const skillMaster = await SkillMaster.findOne({
      where: {
        skill_id,
        is_active: true,
        is_deleted: false
      }
    });

    if (!skillMaster) {
      throw new ApiError(400, 'Invalid or inactive skill_id');
    }

    const existing = await ApplicantSkill.findOne({
      where: {
        applicant_id: applicantId,
        skill_id,
        is_deleted: false
      }
    });

    if (existing) {
      throw new ApiError(400, 'Skill already added');
    }

    const certificatePath = fileData?.path
      ? getRelativePath(fileData.path).replace(/\\/g, '/')
      : null;

    const created = await ApplicantSkill.create({
      applicant_id: applicantId,
      skill_id,
      notes: notes || null,
      certificate_path: certificatePath
    });

    const row = await ApplicantSkill.findByPk(created.applicant_skill_id, {
      include: [{ model: SkillMaster, as: 'skill' }]
    });

    const json = row ? row.toJSON() : created.toJSON();
    json.certificate_path = toPublicUploadPath(json.certificate_path);

    logger.info(`Skill added for applicant: ${applicantId} (skill_id=${skill_id})`);
    return json;
  } catch (error) {
    logger.error('Add skill error:', error);
    throw error;
  }
};

const getSkills = async (applicantId) => {
  try {
    const rows = await ApplicantSkill.findAll({
      where: {
        applicant_id: applicantId,
        is_deleted: false
      },
      include: [{ model: SkillMaster, as: 'skill' }],
      order: [['applicant_skill_id', 'DESC']]
    });

    return rows.map((r) => {
      const json = r.toJSON();
      json.certificate_path = toPublicUploadPath(json.certificate_path);
      return json;
    });
  } catch (error) {
    logger.error('Get skills error:', error);
    throw error;
  }
};

const deleteSkill = async (applicantId, applicantSkillId) => {
  try {
    await assertProfileEditable(applicantId);

    const row = await ApplicantSkill.findOne({
      where: {
        applicant_skill_id: applicantSkillId,
        applicant_id: applicantId,
        is_deleted: false
      }
    });

    if (!row) {
      throw new ApiError(404, 'Skill record not found');
    }

    await row.update({
      is_deleted: true,
      deleted_at: new Date(),
      updated_at: new Date()
    });

    logger.info(`Skill deleted for applicant: ${applicantId} (applicant_skill_id=${applicantSkillId})`);
    return { message: 'Skill deleted successfully' };
  } catch (error) {
    logger.error('Delete skill error:', error);
    throw error;
  }
};

module.exports = {
  addSkill,
  getSkills,
  deleteSkill
};
