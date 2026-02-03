const logger = require('../config/logger');
const { OtpLog } = require('../models');

/**
 * OTP Service
 * Handles OTP generation, verification, and sending
 */
class OtpService {
  /**
   * Generate and send OTP
   * @param {string} mobileNo - Mobile number
   * @param {string} purpose - Purpose of OTP (REGISTRATION, LOGIN, RESET)
   * @returns {Promise<Object>} - OTP details
   */
  async generateAndSendOtp(mobileNo, purpose) {
    try {
      // Generate OTP
      const { otp, expires_at } = await OtpLog.createOtp(mobileNo, purpose);
      
      // Send OTP (mock for development)
      await this.sendOtp(mobileNo, otp, purpose);
      
      return {
        mobile_no: mobileNo,
        expires_at,
        message: 'OTP sent successfully'
      };
    } catch (error) {
      logger.error('Error generating OTP:', error);
      throw error;
    }
  }

  /**
   * Send OTP via SMS/Email (mock for development)
   * @param {string} mobileNo - Mobile number
   * @param {string} otp - OTP code
   * @param {string} purpose - Purpose of OTP
   */
  async sendOtp(mobileNo, otp, purpose) {
    // Mock implementation for development
    if (process.env.SMS_PROVIDER === 'mock') {
      logger.info(`MOCK SMS: OTP ${otp} sent to ${mobileNo} for ${purpose}`);
      console.log(`MOCK SMS: OTP ${otp} sent to ${mobileNo} for ${purpose}`);
      return true;
    }
    
    // Real SMS implementation would go here
    // Example: await smsGateway.sendSMS(mobileNo, `Your OTP is: ${otp}`);
    
    return true;
  }

  /**
   * Verify OTP
   * @param {string} mobileNo - Mobile number
   * @param {string} otp - OTP to verify
   * @param {string} purpose - Purpose of OTP
   * @returns {Promise<boolean>} - Verification result
   */
  async verifyOtp(mobileNo, otp, purpose) {
    try {
      // Find the latest non-verified OTP for this mobile and purpose
      const otpRecord = await OtpLog.findOne({
        where: {
          mobile_no: mobileNo,
          purpose,
          is_verified: false
        },
        order: [['created_at', 'DESC']]
      });
      
      // If no OTP found
      if (!otpRecord) {
        logger.warn(`No active OTP found for ${mobileNo} and purpose ${purpose}`);
        return {
          verified: false,
          message: 'No active OTP found. Please request a new OTP.'
        };
      }
      
      // Check if OTP is expired
      if (otpRecord.isExpired()) {
        logger.warn(`OTP expired for ${mobileNo}`);
        return {
          verified: false,
          message: 'OTP has expired. Please request a new OTP.'
        };
      }
      
      // Check if max attempts reached (configurable via env)
      const maxAttempts = OtpLog.getMaxAttempts();
      if (otpRecord.attempts >= maxAttempts) {
        logger.warn(`Max OTP attempts reached for ${mobileNo}`);
        return {
          verified: false,
          message: 'Maximum verification attempts reached. Please request a new OTP.'
        };
      }
      
      // Verify OTP
      const isValid = await otpRecord.validateOtp(otp);
      
      // Increment attempts
      await otpRecord.incrementAttempts();
      
      // If valid, mark as verified
      if (isValid) {
        await otpRecord.markVerified();
        logger.info(`OTP verified successfully for ${mobileNo}`);
        return {
          verified: true,
          message: 'OTP verified successfully'
        };
      }
      
      logger.warn(`Invalid OTP attempt for ${mobileNo}`);
      return {
        verified: false,
        message: 'Invalid OTP. Please try again.'
      }
    } catch (error) {
      logger.error('Error verifying OTP:', error);
      throw error;
    }
  }

  /**
   * Generate OTP without sending (for email-based flows)
   * @param {string} identifier - Email or mobile identifier
   * @param {string} purpose - Purpose of OTP (REGISTRATION, PASSWORD_RESET, etc.)
   * @returns {Promise<string>} - The generated OTP code
   */
  async generateOtp(identifier, purpose) {
    try {
      // Reuse the same underlying OTP creation logic
      const { otp } = await OtpLog.createOtp(identifier, purpose);

      logger.info(`OTP generated for ${identifier} with purpose ${purpose}`);
      return otp;
    } catch (error) {
      logger.error('Error generating OTP (generateOtp):', error);
      throw error;
    }
  }
}

module.exports = new OtpService();
