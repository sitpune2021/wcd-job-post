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
      const error = new Error('This email address is already registered. Please use a different email or try logging in.');
      error.statusCode = 400;
      error.isClientError = true;
      throw error;
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
      const error = new Error('Email is required');
      error.statusCode = 400;
      error.isClientError = true;
      throw error;
    }

    if (!password) {
      const error = new Error('Password is required');
      error.statusCode = 400;
      error.isClientError = true;
      throw error;
    }

    if (!fullName) {
      const error = new Error('Full name is required');
      error.statusCode = 400;
      error.isClientError = true;
      throw error;
    }

    if (!otp) {
      const error = new Error('OTP is required');
      error.statusCode = 400;
      error.isClientError = true;
      throw error;
    }

    // Verify OTP
    const otpVerification = await otpService.verifyOtp(email, otp, 'REGISTRATION');
    if (!otpVerification.verified) {
      const error = new Error(otpVerification.message || 'Invalid or expired OTP');
      error.statusCode = 400;
      error.isClientError = true;
      throw error;
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
      const duplicateError = new Error('This email address is already registered. Please use a different email or try logging in.');
      duplicateError.statusCode = 400;
      duplicateError.isClientError = true;
      throw duplicateError;
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
      const error = new Error('Email is required');
      error.statusCode = 400;
      error.isClientError = true;
      throw error;
    }

    if (password === undefined || password === null) {
      const error = new Error('Password is required');
      error.statusCode = 400;
      error.isClientError = true;
      throw error;
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
      const error = new Error('Invalid email or password');
      error.statusCode = 401;
      error.isClientError = true;
      throw error;
    }

    const applicant = applicants[0];

    // Check if account is locked
    if (applicant.locked_until && new Date(applicant.locked_until) > new Date()) {
      const error = new Error(buildLockoutMessage(applicant.locked_until));
      error.statusCode = 423;
      error.isClientError = true;
      throw error;
    }

    // Check if applicant is an employee and get employee details
    let isEmployee = false;
    let employee = null;
    let profileComplete = false;
    
    // Use the applicant_id directly from the SQL result
    const applicantId = applicant.applicant_id;
    
    try {
      
      // First check if the table exists
      const [tableCheck] = await sequelize.query(
        `SELECT table_name FROM information_schema.tables 
         WHERE table_schema = 'public' AND table_name = 'ms_employee_master'`
      );
      
      if (tableCheck.length === 0) {
        // Continue without employee status if table doesn't exist
      } else {
        // Use the same query that works in our test
        const [employees] = await sequelize.query(
          `SELECT 
            e.employee_id, 
            e.employee_code, 
            e.applicant_id,
            e.onboarding_status, 
            e.is_active,
            e.password_change_required,
            e.allotment_letter_uploaded_at,
            e.allotment_letter_path,
            e.temp_password_hash,
            e.onboarding_completed_at
          FROM ms_employee_master e
          WHERE e.applicant_id = :applicantId 
          AND e.is_deleted = false`,
          { 
            replacements: { applicantId: applicantId }
          }
        );
        
        isEmployee = employees.length > 0;
        employee = isEmployee ? employees[0] : null;
      }
      
      // Check profile completion if user is an employee
      if (isEmployee) {
        try {
          const eligibilityService = require('../services/eligibilityService');
          const completion = await eligibilityService.getProfileCompletion(applicantId);
          profileComplete = completion.canApply; // Only true if profile is 100% complete
        } catch (error) {
          logger.error('Error checking profile completion:', error);
          profileComplete = false;
        }
      }
    } catch (error) {
      // Continue without employee status if query fails
    }

    // Verify password
    let isPasswordValid = false;
    let passwordType = '';
    
    // Check if applicant is an employee and needs to use temp password
    if (isEmployee && employee.password_change_required && employee.temp_password_hash) {
      // Use employee's temporary password
      isPasswordValid = await bcrypt.compare(password, employee.temp_password_hash);
      passwordType = 'temp_password';
      logger.info('Login: Verifying against temp password', { 
        applicantId, 
        employeeId: employee.employee_id,
        isValid: isPasswordValid 
      });
    } else {
      // Use applicant's regular password
      isPasswordValid = await bcrypt.compare(password, applicant.password_hash);
      passwordType = 'applicant_password';
      logger.info('Login: Verifying against applicant password', { 
        applicantId, 
        isEmployee,
        password_change_required: isEmployee ? employee.password_change_required : 'N/A',
        isValid: isPasswordValid 
      });
    }

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
        role: 'APPLICANT',
        // Employee status flags
        is_employee: isEmployee,
        employee_code: employee?.employee_code || null,
        password_changed: employee?.password_change_required === false, // Inverted logic
        allotment_uploaded: !!(employee?.allotment_letter_uploaded_at || employee?.allotment_letter_path), // Check if timestamp or path exists
        can_view_crm: isEmployee && profileComplete ? true : false
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
      const error = new Error('Email not found');
      error.statusCode = 404;
      error.isClientError = true;
      throw error;
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
      const error = new Error('Invalid or expired OTP');
      error.statusCode = 400;
      error.isClientError = true;
      throw error;
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
      const error = new Error('Email not found');
      error.statusCode = 404;
      error.isClientError = true;
      throw error;
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
    // Check if applicant is an employee and needs temp password verification
    let isPasswordValid = false;
    let passwordType = '';
    
    // First check if employee exists
    const [employees] = await sequelize.query(
      `SELECT employee_id, password_change_required, temp_password_hash
       FROM ms_employee_master 
       WHERE applicant_id = :applicantId AND is_deleted = false`,
      { replacements: { applicantId } }
    );
    
    const isEmployee = employees.length > 0;
    const employee = isEmployee ? employees[0] : null;
    
    if (isEmployee && employee.password_change_required && employee.temp_password_hash) {
      // Verify against temp password
      isPasswordValid = await bcrypt.compare(currentPassword, employee.temp_password_hash);
      passwordType = 'temp_password';
      logger.info('Password change: Verifying against temp password', { 
        applicantId, 
        employeeId: employee.employee_id,
        isValid: isPasswordValid 
      });
    } else {
      // Get applicant's regular password hash
      const [applicants] = await sequelize.query(
        `SELECT password_hash FROM ms_applicant_master WHERE applicant_id = :applicantId AND is_deleted = false`,
        { replacements: { applicantId } }
      );

      if (applicants.length === 0) {
        const error = new Error('Applicant not found');
        error.statusCode = 404;
        error.isClientError = true;
        throw error;
      }

      // Verify against regular password
      isPasswordValid = await bcrypt.compare(currentPassword, applicants[0].password_hash);
      passwordType = 'applicant_password';
      logger.info('Password change: Verifying against applicant password', { 
        applicantId, 
        isValid: isPasswordValid 
      });
    }
    
    if (!isPasswordValid) {
      logger.error('Password change verification failed', { 
        applicantId, 
        passwordType,
        isEmployee 
      });
      const error = new Error('Current password is incorrect');
      error.statusCode = 400;
      error.isClientError = true;
      throw error;
    }

    // Hash new password
    const passwordHash = await bcrypt.hash(newPassword, getBcryptRounds());

    // Update applicant password
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

    // If employee exists, update employee record too
    if (isEmployee) {
      await sequelize.query(
        `UPDATE ms_employee_master 
         SET password_change_required = false, 
             temp_password_hash = NULL, 
             updated_at = NOW()
         WHERE applicant_id = :applicantId`,
        { replacements: { applicantId } }
      );
      
      logger.info(`Password changed for employee: ${employee.employee_id}, temp password cleared`);
    } else {
      logger.info(`Password changed for applicant: ${applicantId}`);
    }
    
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
