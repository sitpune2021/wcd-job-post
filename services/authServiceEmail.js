const { sequelize } = require('../config/db');
const bcrypt = require('bcryptjs');
const logger = require('../config/logger');
const { generateToken, getBcryptRounds } = require('../config/security');
const {
  createLockUntilDate,
  getMaxLoginAttempts,
  getRemainingLockText,
  buildLockoutMessage
} = require('../utils/authLock');
const { generateApplicantNo } = require('../utils/idGenerator');
const otpService = require('./otpService');
const emailService = require('./emailService');

/**
 * Email-Based Authentication Service
 * Handles applicant registration and login with email
 */

// Send OTP for registration
const sendRegistrationOTP = async (email) => {
  try {
    // Check if email already exists
    const [existing] = await sequelize.query(
      `SELECT applicant_id FROM ms_applicant_master WHERE email = :email AND is_deleted = false`,
      { replacements: { email } }
    );

    if (existing.length > 0) {
      throw new Error('Email already registered');
    }

    // Generate and send OTP
    const otp = await otpService.generateOtp(email, 'REGISTRATION');
    const sent = await emailService.sendOTP(email, otp);
    if (!sent || sent.success !== true) {
      throw new Error(sent?.error || 'Failed to send OTP email');
    }

    logger.info(`Registration OTP sent to ${email}`);
    return { success: true, message: 'OTP sent to email' };
  } catch (error) {
    logger.error('Error sending registration OTP:', error);
    throw error;
  }
};

// Register applicant with email
const registerApplicant = async (data) => {
  try {
    const { email, password, otp } = data;
    const fullName = data?.full_name || data?.fullName;

    if (!email) {
      throw new Error('Email is required');
    }

    if (!password) {
      throw new Error('Password is required');
    }

    if (!fullName) {
      throw new Error('Full name is required');
    }

    if (!otp) {
      throw new Error('OTP is required');
    }

    // Verify OTP
    const otpVerification = await otpService.verifyOtp(email, otp, 'REGISTRATION');
    if (!otpVerification.verified) {
      throw new Error(otpVerification.message || 'Invalid or expired OTP');
    }

    // Generate applicant number
    const applicantNo = await generateApplicantNo();

    // Hash password
    const passwordHash = await bcrypt.hash(password, getBcryptRounds());

    // Use a transaction so master + personal are created atomically
    const transaction = await sequelize.transaction();
    let applicant;

    try {
      // Create applicant
      const [result] = await sequelize.query(
        `INSERT INTO ms_applicant_master (
          email, applicant_no, password_hash, is_verified, created_at, updated_at
        )
        VALUES (
          :email, :applicantNo, :passwordHash, true, NOW(), NOW()
        )
        RETURNING applicant_id, email, applicant_no, is_verified`,
        {
          replacements: {
            email,
            applicantNo,
            passwordHash
          },
          transaction
        }
      );

      // Applicant record we just created
      applicant = result[0];

      // Insert into applicant_personal table
      await sequelize.query(
        `INSERT INTO ms_applicant_personal (
          applicant_id,
          full_name,
          created_at,
          updated_at
        ) VALUES (
          :applicantId,
          :fullName,
          NOW(),
          NOW()
        )`,
        {
          replacements: {
            applicantId: applicant.applicant_id,
            fullName: fullName
          },
          transaction
        }
      );

      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }

    // Generate JWT token
    const token = generateToken({
      id: applicant.applicant_id,
      email: applicant.email,
      role: 'APPLICANT'
    });

    logger.info(`Applicant registered: ${applicant.applicant_id} - ${email}`);

    return {
      user: {
        applicant_id: applicant.applicant_id,
        email: applicant.email,
        applicant_no: applicant.applicant_no,
        full_name: fullName,
        is_verified: applicant.is_verified,
        role: 'APPLICANT'
      },
      token
    };

  } catch (error) {
    // If this came from the DB unique constraint on email
    if (error.name === 'SequelizeUniqueConstraintError' || error.original?.code === '23505') {
      logger.warn('Duplicate email during registration attempt:', { email: data?.email });
      throw new Error('Email already registered');
    }

    logger.error('Error registering applicant:', error);
    throw error;
  }
};


// Login applicant with email
const loginApplicant = async (email, password) => {
  try {
    const normalizedEmail = String(email || '').trim().toLowerCase();

    if (!normalizedEmail) {
      throw new Error('Email is required');
    }

    if (password === undefined || password === null) {
      throw new Error('Password is required');
    }

    // Find applicant with personal details for full_name
    const [applicants] = await sequelize.query(
      `SELECT 
        am.applicant_id, am.email, am.applicant_no, am.password_hash,
        am.is_verified, am.failed_login_attempts, am.locked_until,
        ap.full_name
      FROM ms_applicant_master am
      LEFT JOIN ms_applicant_personal ap ON am.applicant_id = ap.applicant_id
      WHERE LOWER(am.email) = :email AND am.is_deleted = false`,
      { replacements: { email: normalizedEmail } }
    );

    if (applicants.length === 0) {
      throw new Error('Invalid email or password');
    }

    const applicant = applicants[0];

    // Check if account is locked
    if (applicant.locked_until && new Date(applicant.locked_until) > new Date()) {
      throw new Error(buildLockoutMessage(applicant.locked_until));
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, applicant.password_hash);

    if (!isPasswordValid) {
      // Increment login attempts
      const newAttempts = (applicant.failed_login_attempts || 0) + 1;
      const maxAttempts = getMaxLoginAttempts();
      const lockUntil = newAttempts >= maxAttempts ? createLockUntilDate() : null;

      await sequelize.query(
        `UPDATE ms_applicant_master 
         SET failed_login_attempts = :attempts, 
             locked_until = :lockUntil,
             updated_at = NOW()
         WHERE applicant_id = :applicantId`,
        {
          replacements: {
            attempts: newAttempts,
            lockUntil,
            applicantId: applicant.applicant_id
          }
        }
      );

      if (lockUntil) {
        throw new Error(buildLockoutMessage(lockUntil));
      }

      throw new Error('Invalid email or password');
    }

    // Reset login attempts and update timestamps
    await sequelize.query(
      `UPDATE ms_applicant_master 
       SET failed_login_attempts = 0, 
           locked_until = NULL,
           updated_at = NOW()
       WHERE applicant_id = :applicantId`,
      { replacements: { applicantId: applicant.applicant_id } }
    );

    // Check declaration status for user-level declarations
    const [declarations] = await sequelize.query(
      `SELECT action_type, checkbox_code, accepted_at
       FROM ms_applicant_acknowledgements
       WHERE applicant_id = :applicantId
         AND action_type IN ('GUIDELINES_DECLARATION', 'PROFILE_DECLARATION')
       ORDER BY accepted_at DESC`,
      { replacements: { applicantId: applicant.applicant_id } }
    );

    const guidelinesAccepted = declarations.some(
      d => d.action_type === 'GUIDELINES_DECLARATION' && d.checkbox_code === 'Mission Shakti Guidelines Declaration'
    );
    const profileDeclarationAccepted = declarations.some(
      d => d.action_type === 'PROFILE_DECLARATION' && d.checkbox_code === 'File Upload Declaration'
    );

    // Generate JWT token
    const token = generateToken({
      id: applicant.applicant_id,
      email: applicant.email,
      role: 'APPLICANT'
    });

    logger.info(`Applicant logged in: ${applicant.applicant_id} - ${normalizedEmail}`);

    return {
      user: {
        applicant_id: applicant.applicant_id,
        email: applicant.email,
        applicant_no: applicant.applicant_no,
        full_name: applicant.full_name,
        is_verified: applicant.is_verified,
        role: 'APPLICANT'
      },
      token,
      declarations: {
        guidelines_accepted: guidelinesAccepted,
        profile_declaration_accepted: profileDeclarationAccepted
      }
    };
  } catch (error) {
    logger.error('Error logging in applicant:', error);
    throw error;
  }
};

// Send password reset OTP
const sendPasswordResetOTP = async (email) => {
  try {
    // Check if email exists
    const [applicants] = await sequelize.query(
      `SELECT applicant_id FROM ms_applicant_master WHERE email = :email AND is_deleted = false`,
      { replacements: { email } }
    );

    if (applicants.length === 0) {
      throw new Error('Email not found');
    }

    // Generate and send OTP (purpose must match OtpLog isIn constraint)
    const otp = await otpService.generateOtp(email, 'RESET');
    const sent = await emailService.sendOTP(email, otp);
    if (!sent || sent.success !== true) {
      throw new Error(sent?.error || 'Failed to send OTP email');
    }

    logger.info(`Password reset OTP sent to ${email}`);
    return { success: true, message: 'OTP sent to email' };
  } catch (error) {
    logger.error('Error sending password reset OTP:', error);
    throw error;
  }
};

// Reset password with OTP
const resetPassword = async (email, otp, newPassword) => {
  try {
    // Verify OTP (purpose must match what was used for generation)
    const otpVerification = await otpService.verifyOtp(email, otp, 'RESET');
    if (!otpVerification.verified) {
      throw new Error('Invalid or expired OTP');
    }

    // Hash new password
    const passwordHash = await bcrypt.hash(newPassword, getBcryptRounds());

    // Update password
    const [result] = await sequelize.query(
      `UPDATE ms_applicant_master 
       SET password_hash = :passwordHash,
           failed_login_attempts = 0,
           locked_until = NULL,
           updated_at = NOW()
       WHERE email = :email AND is_deleted = false
       RETURNING applicant_id, email`,
      {
        replacements: {
          email,
          passwordHash
        }
      }
    );

    if (result.length === 0) {
      throw new Error('Email not found');
    }

    logger.info(`Password reset for applicant: ${result[0].applicant_id}`);
    return { success: true, message: 'Password reset successfully' };
  } catch (error) {
    logger.error('Error resetting password:', error);
    throw error;
  }
};

// Change password (when logged in)
const changePassword = async (applicantId, currentPassword, newPassword) => {
  try {
    // Get current password hash
    const [applicants] = await sequelize.query(
      `SELECT password_hash FROM ms_applicant_master WHERE applicant_id = :applicantId AND is_deleted = false`,
      { replacements: { applicantId } }
    );

    if (applicants.length === 0) {
      throw new Error('Applicant not found');
    }

    // Verify current password
    const isPasswordValid = await bcrypt.compare(currentPassword, applicants[0].password_hash);
    if (!isPasswordValid) {
      throw new Error('Current password is incorrect');
    }

    // Hash new password
    const passwordHash = await bcrypt.hash(newPassword, getBcryptRounds());

    // Update password
    await sequelize.query(
      `UPDATE ms_applicant_master 
       SET password_hash = :passwordHash, updated_at = NOW()
       WHERE applicant_id = :applicantId`,
      {
        replacements: {
          applicantId,
          passwordHash
        }
      }
    );

    logger.info(`Password changed for applicant: ${applicantId}`);
    return { success: true, message: 'Password changed successfully' };
  } catch (error) {
    logger.error('Error changing password:', error);
    throw error;
  }
};

// Get applicant profile
const getApplicantProfile = async (applicantId) => {
  try {
    const [applicants] = await sequelize.query(
      `SELECT 
        applicant_id, email, applicant_no, mobile_no,
        is_verified, failed_login_attempts, locked_until, created_at
      FROM ms_applicant_master
      WHERE applicant_id = ? AND is_deleted = false`,
      { replacements: [applicantId] }
    );

    return applicants.length > 0 ? applicants[0] : null;
  } catch (error) {
    logger.error('Error fetching applicant profile:', error);
    throw error;
  }
};

module.exports = {
  sendRegistrationOTP,
  registerApplicant,
  loginApplicant,
  sendPasswordResetOTP,
  resetPassword,
  changePassword,
  getApplicantProfile
};
