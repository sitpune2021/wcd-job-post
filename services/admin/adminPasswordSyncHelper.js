const { sequelize } = require('../../config/db');
const bcrypt = require('bcryptjs');
const logger = require('../../config/logger');

/**
 * Find admin accounts linked to a given employee email
 */
const findLinkedAdminAccounts = async (email) => {
  try {
    const [rows] = await sequelize.query(
      `SELECT admin_id, username, email, full_name, is_active
       FROM ms_admin_users 
       WHERE LOWER(email) = LOWER(:email) 
         AND is_deleted = false
       LIMIT 10`,
      { replacements: { email } }
    );
    return rows;
  } catch (error) {
    logger.error('findLinkedAdminAccounts error:', error);
    throw error;
  }
};

/**
 * Sync password hash from employee/applicant to linked admin accounts
 */
const syncPasswordToLinkedAdmins = async (email, passwordHash) => {
  try {
    if (!email || !passwordHash) {
      throw new Error('Email and password hash required for sync');
    }

    const linkedAdmins = await findLinkedAdminAccounts(email);
    if (linkedAdmins.length === 0) {
      logger.info(`No linked admin accounts found for email: ${email}`);
      return { synced: 0, admins: [] };
    }

    const adminIds = linkedAdmins.map(a => a.admin_id);
    const [result] = await sequelize.query(
      `UPDATE ms_admin_users 
       SET password_hash = :passwordHash, updated_at = NOW()
       WHERE admin_id IN (:adminIds) AND is_deleted = false`,
      {
        replacements: {
          passwordHash,
          adminIds
        }
      }
    );

    logger.info(`Password synced to ${result.affectedRows} linked admin accounts for email: ${email}`);
    return {
      synced: result.affectedRows,
      admins: linkedAdmins.map(a => ({ admin_id: a.admin_id, username: a.username, email: a.email }))
    };
  } catch (error) {
    logger.error('syncPasswordToLinkedAdmins error:', error);
    throw error;
  }
};

/**
 * Hook: call after applicant password change/reset
 */
const afterApplicantPasswordChange = async (applicantId, newPasswordHash) => {
  try {
    const [applicants] = await sequelize.query(
      `SELECT email FROM ms_applicant_master 
       WHERE applicant_id = :applicantId AND is_deleted = false
       LIMIT 1`,
      { replacements: { applicantId } }
    );

    if (applicants.length === 0) {
      logger.warn(`Applicant not found for password sync: ${applicantId}`);
      return { synced: 0 };
    }

    const email = applicants[0].email;
    return await syncPasswordToLinkedAdmins(email, newPasswordHash);
  } catch (error) {
    logger.error('afterApplicantPasswordChange error:', error);
    throw error;
  }
};

module.exports = {
  findLinkedAdminAccounts,
  syncPasswordToLinkedAdmins,
  afterApplicantPasswordChange
};
