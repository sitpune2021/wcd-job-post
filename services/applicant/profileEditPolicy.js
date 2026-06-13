const db = require('../../models');
const { ApiError } = require('../../middleware/errorHandler');

const isProfileLocked = async (applicantId) => {
  const applicant = await db.ApplicantMaster.findByPk(applicantId, {
    attributes: ['profile_edit_override']
  });
  if (applicant?.profile_edit_override) return false;

  const activeDrive = await require('../recruitmentDriveService').getActiveDrive();
  if (!activeDrive || activeDrive.status === 'OPEN') return false;

  const applicationCount = await db.Application.count({
    where: {
      applicant_id: applicantId,
      recruitment_drive_id: activeDrive.recruitment_drive_id,
      is_deleted: false
    }
  });
  return applicationCount > 0;
};

const assertProfileEditable = async (applicantId) => {
  if (await isProfileLocked(applicantId)) {
    throw new ApiError(403, 'Profile is locked after applications close. Contact an administrator to unlock it.');
  }
};

module.exports = { isProfileLocked, assertProfileEditable };
