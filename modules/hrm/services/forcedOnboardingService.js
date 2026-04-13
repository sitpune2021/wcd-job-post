const db = require('../../../models');
const { EmployeeOnboardingLog } = require('../models');
const EmployeeMaster = db.EmployeeMaster;
const bcrypt = require('bcryptjs');
const { getBcryptRounds } = require('../../../config/security');
const { sendPasswordChangeConfirmation } = require('./hrmEmailService');
const logger = require('../../../config/logger');
const path = require('path');
const fs = require('fs').promises;

/**
 * Forced Onboarding Service for Flow B
 * Handles password change and allotment letter upload requirements
 */

/**
 * Check if applicant needs forced onboarding
 * Returns onboarding status and requirements
 */
async function checkOnboardingStatus(applicantId) {
  try {
    const employee = await EmployeeMaster.findOne({
      where: {
        applicant_id: applicantId,
        onboarding_type: 'EXISTING_IMPORT',
        is_deleted: false
      }
    });

    if (!employee) {
      return {
        isOnboardingEmployee: false,
        needsOnboarding: false
      };
    }

    const needsPasswordChange = employee.password_change_required === true;
    const needsAllotmentLetter = !employee.allotment_letter_path;

    return {
      isOnboardingEmployee: true,
      needsOnboarding: needsPasswordChange || needsAllotmentLetter,
      onboardingStatus: employee.onboarding_status,
      requirements: {
        passwordChange: needsPasswordChange,
        allotmentLetter: needsAllotmentLetter
      },
      employee_id: employee.employee_id,
      employee_code: employee.employee_code
    };
  } catch (error) {
    logger.error('Error checking onboarding status', {
      applicant_id: applicantId,
      error: error.message
    });
    throw error;
  }
}

/**
 * Complete forced password change for Flow B employee
 */
async function completePasswordChange(applicantId, currentPassword, newPassword) {
  const transaction = await db.sequelize.transaction();

  try {
    // Get applicant and employee records
    const applicant = await db.ApplicantMaster.findOne({
      where: { applicant_id: applicantId, is_deleted: false },
      transaction
    });

    if (!applicant) {
      throw new Error('Applicant not found');
    }

    const employee = await EmployeeMaster.findOne({
      where: {
        applicant_id: applicantId,
        onboarding_type: 'EXISTING_IMPORT',
        is_deleted: false
      },
      transaction
    });

    if (!employee) {
      throw new Error('Employee record not found');
    }

    if (!employee.password_change_required) {
      throw new Error('Password change not required for this employee');
    }

    // Verify current password (should be User@123)
    const isValidPassword = await bcrypt.compare(currentPassword, applicant.password_hash);
    if (!isValidPassword) {
      throw new Error('Current password is incorrect');
    }

    // Validate new password
    if (newPassword.length < 8) {
      throw new Error('New password must be at least 8 characters long');
    }

    if (newPassword === currentPassword) {
      throw new Error('New password must be different from current password');
    }

    // Hash new password
    const newPasswordHash = await bcrypt.hash(newPassword, getBcryptRounds());

    // Update applicant password
    await db.ApplicantMaster.update(
      {
        password_hash: newPasswordHash,
        updated_by: applicantId
      },
      {
        where: { applicant_id: applicantId },
        transaction
      }
    );

    // Update employee record
    await EmployeeMaster.update(
      {
        password_change_required: false,
        temp_password_hash: null,
        onboarding_status: employee.allotment_letter_path ? 'ONBOARDING_COMPLETE' : 'ONBOARDING_INCOMPLETE',
        updated_by: applicantId
      },
      {
        where: { employee_id: employee.employee_id },
        transaction
      }
    );

    // Log the action
    await EmployeeOnboardingLog.create({
      employee_id: employee.employee_id,
      action: 'PASSWORD_CHANGED',
      details: {
        changed_by: 'EMPLOYEE_SELF',
        forced_onboarding: true
      },
      performed_by: null,
      performed_at: new Date()
    }, { transaction });

    // If both requirements are met, activate employee
    if (employee.allotment_letter_path) {
      await EmployeeMaster.update(
        {
          is_active: true,
          onboarding_status: 'ACTIVE',
          onboarding_completed_at: new Date()
        },
        {
          where: { employee_id: employee.employee_id },
          transaction
        }
      );

      await EmployeeOnboardingLog.create({
        employee_id: employee.employee_id,
        action: 'ONBOARDING_COMPLETED',
        details: {
          all_requirements_met: true
        },
        performed_by: null,
        performed_at: new Date()
      }, { transaction });
    }

    await transaction.commit();

    logger.info('Password changed successfully for onboarding employee', {
      employee_id: employee.employee_id,
      applicant_id: applicantId
    });

    // Send confirmation email (non-blocking)
    try {
      await sendPasswordChangeConfirmation(
        applicant.email,
        employee.applicant?.personal?.full_name || 'Employee'
      );
    } catch (emailError) {
      logger.error('Failed to send password change confirmation email', {
        error: emailError.message
      });
    }

    return {
      success: true,
      message: 'Password changed successfully',
      onboardingComplete: employee.allotment_letter_path ? true : false,
      nextStep: employee.allotment_letter_path ? null : 'Upload allotment letter'
    };
  } catch (error) {
    await transaction.rollback();
    logger.error('Error changing password for onboarding employee', {
      applicant_id: applicantId,
      error: error.message
    });
    throw error;
  }
}

/**
 * Upload allotment letter for Flow B employee
 */
async function uploadAllotmentLetter(applicantId, file) {
  const transaction = await db.sequelize.transaction();

  try {
    const employee = await EmployeeMaster.findOne({
      where: {
        applicant_id: applicantId,
        onboarding_type: 'EXISTING_IMPORT',
        is_deleted: false
      },
      transaction
    });

    if (!employee) {
      throw new Error('Employee record not found');
    }

    if (employee.allotment_letter_path) {
      throw new Error('Allotment letter already uploaded');
    }

    // Validate file
    if (!file) {
      throw new Error('No file provided');
    }

    const allowedExtensions = ['.pdf'];
    const fileExtension = path.extname(file.originalname).toLowerCase();

    if (!allowedExtensions.includes(fileExtension)) {
      throw new Error('Only PDF files are allowed');
    }

    // Generate unique filename
    const timestamp = Date.now();
    const sanitizedFilename = `${employee.employee_code}_allotment_${timestamp}${fileExtension}`;
    const uploadPath = path.join('uploads', 'hrm', 'allotment_letters', sanitizedFilename);

    // Move file to destination
    await fs.rename(file.path, uploadPath);

    // Update employee record
    await EmployeeMaster.update(
      {
        allotment_letter_path: uploadPath,
        allotment_letter_uploaded_at: new Date(),
        onboarding_status: employee.password_change_required ? 'ONBOARDING_INCOMPLETE' : 'ONBOARDING_COMPLETE',
        updated_by: applicantId
      },
      {
        where: { employee_id: employee.employee_id },
        transaction
      }
    );

    // Log the action
    await EmployeeOnboardingLog.create({
      employee_id: employee.employee_id,
      action: 'ALLOTMENT_LETTER_UPLOADED',
      details: {
        file_path: uploadPath,
        file_name: file.originalname,
        file_size: file.size
      },
      performed_by: null,
      performed_at: new Date()
    }, { transaction });

    // If both requirements are met, activate employee
    if (!employee.password_change_required) {
      await EmployeeMaster.update(
        {
          is_active: true,
          onboarding_status: 'ACTIVE',
          onboarding_completed_at: new Date()
        },
        {
          where: { employee_id: employee.employee_id },
          transaction
        }
      );

      await EmployeeOnboardingLog.create({
        employee_id: employee.employee_id,
        action: 'ONBOARDING_COMPLETED',
        details: {
          all_requirements_met: true
        },
        performed_by: null,
        performed_at: new Date()
      }, { transaction });
    }

    await transaction.commit();

    logger.info('Allotment letter uploaded successfully', {
      employee_id: employee.employee_id,
      file_path: uploadPath
    });

    return {
      success: true,
      message: 'Allotment letter uploaded successfully',
      onboardingComplete: !employee.password_change_required,
      nextStep: employee.password_change_required ? 'Change password' : null
    };
  } catch (error) {
    await transaction.rollback();
    
    // Clean up uploaded file if exists
    if (file && file.path) {
      try {
        await fs.unlink(file.path);
      } catch (unlinkError) {
        logger.error('Failed to clean up uploaded file', { error: unlinkError.message });
      }
    }

    logger.error('Error uploading allotment letter', {
      applicant_id: applicantId,
      error: error.message
    });
    throw error;
  }
}

/**
 * Get allotment letter file path for download
 */
async function getAllotmentLetterPath(applicantId) {
  try {
    const employee = await EmployeeMaster.findOne({
      where: {
        applicant_id: applicantId,
        is_deleted: false
      },
      attributes: ['employee_id', 'allotment_letter_path']
    });

    if (!employee || !employee.allotment_letter_path) {
      throw new Error('Allotment letter not found');
    }

    return employee.allotment_letter_path;
  } catch (error) {
    logger.error('Error getting allotment letter path', {
      applicant_id: applicantId,
      error: error.message
    });
    throw error;
  }
}

module.exports = {
  checkOnboardingStatus,
  completePasswordChange,
  uploadAllotmentLetter,
  getAllotmentLetterPath
};
