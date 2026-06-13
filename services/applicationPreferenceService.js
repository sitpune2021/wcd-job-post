const db = require('../models');
const { Op } = require('sequelize');
const { ApiError } = require('../middleware/errorHandler');
const recruitmentDriveService = require('./recruitmentDriveService');

const listPreferences = async (applicantId) => {
  const drive = await recruitmentDriveService.getActiveDrive();
  if (!drive) return [];
  return db.ApplicationPreference.findAll({
    where: {
      applicant_id: applicantId,
      recruitment_drive_id: drive.recruitment_drive_id
    },
    include: [{
      model: db.Application,
      as: 'application',
      include: [{ model: db.PostMaster, as: 'post' }]
    }],
    order: [['preference_rank', 'ASC']]
  });
};

const replacePreferences = async (applicantId, preferences) => {
  const drive = await recruitmentDriveService.assertApplicationsOpen();
  if (!Array.isArray(preferences)) throw new ApiError(400, 'Preferences must be an array');
  if (preferences.length > 6) throw new ApiError(400, 'A maximum of six preferences is allowed');

  const normalized = preferences.map((item) => ({
    application_id: parseInt(item.application_id, 10),
    preference_rank: parseInt(item.preference_rank, 10)
  }));
  const applicationIds = normalized.map((item) => item.application_id);
  const ranks = normalized.map((item) => item.preference_rank);
  if (applicationIds.some(Number.isNaN) || ranks.some((rank) => Number.isNaN(rank) || rank < 1 || rank > 6)) {
    throw new ApiError(400, 'Invalid application preference');
  }
  if (new Set(applicationIds).size !== applicationIds.length || new Set(ranks).size !== ranks.length) {
    throw new ApiError(400, 'Applications and preference ranks must be unique');
  }

  const applications = applicationIds.length
    ? await db.Application.findAll({
      where: {
        application_id: { [Op.in]: applicationIds },
        applicant_id: applicantId,
        recruitment_drive_id: drive.recruitment_drive_id,
        is_deleted: false
      }
    })
    : [];
  if (applications.length !== applicationIds.length) {
    throw new ApiError(400, 'Every preference must reference your current recruitment application');
  }

  const transaction = await db.sequelize.transaction();
  try {
    await db.ApplicationPreference.destroy({
      where: {
        applicant_id: applicantId,
        recruitment_drive_id: drive.recruitment_drive_id
      },
      transaction
    });
    if (normalized.length) {
      await db.ApplicationPreference.bulkCreate(normalized.map((item) => ({
        ...item,
        applicant_id: applicantId,
        recruitment_drive_id: drive.recruitment_drive_id,
        created_at: new Date(),
        updated_at: new Date()
      })), { transaction });
    }
    await transaction.commit();
    return listPreferences(applicantId);
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};

module.exports = { listPreferences, replacePreferences };
