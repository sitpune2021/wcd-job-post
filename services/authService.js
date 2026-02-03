const db = require('../models');
const { ApplicantMaster, AdminUser, RefreshToken, LoginAttempt, Role, Permission } = db;
const { generateToken } = require('../config/security');
const otpService = require('./otpService');
const logger = require('../config/logger');
const { ApiError } = require('../middleware/errorHandler');
const {
  getMaxLoginAttempts,
  getLockDurationMinutes,
  createLockUntilDate,
  buildLockoutMessage
} = require('../utils/authLock');

/**
 * Authentication Service
 * Handles user registration, login, and token management
 * For mobile-based authentication (Admin and Applicant with mobile)
 */
class AuthService {
  /**
   * Register a new applicant
   * @param {Object} data - Registration data
   * @param {string} data.mobile_no - Mobile number
   * @param {string} data.password - Password
   * @param {string} data.otp - OTP for verification
   * @param {string} ip - IP address
   * @returns {Promise<Object>} - Registration result
   */
  async registerApplicant(data, ip) {
    const { mobile_no, password, otp } = data;
    
    try {
      // Check if mobile number already exists
      const existingUser = await ApplicantMaster.findOne({
        where: { mobile_no }
      });
      
      if (existingUser) {
        throw new ApiError(400, 'Mobile number already registered');
      }
      
      // Verify OTP
      const otpVerification = await otpService.verifyOtp(mobile_no, otp, 'REGISTRATION');
      
      if (!otpVerification.verified) {
        throw new ApiError(400, otpVerification.message);
      }
      
      // Create applicant
      const applicant = await ApplicantMaster.create({
        mobile_no,
        password_hash: password, // Will be hashed in model hook
        is_mobile_verified: true,
        status: 'Active'
      });
      
      // Generate tokens
      const payload = {
        id: applicant.applicant_id,
        role: 'APPLICANT'
      };
      
      const accessToken = generateToken(payload);
      const refreshTokenData = await RefreshToken.createToken(
        applicant.applicant_id,
        'APPLICANT',
        'Registration',
        ip
      );
      
      logger.info(`New applicant registered: ${mobile_no}`);
      
      return {
        user: {
          id: applicant.applicant_id,
          mobile_no: applicant.mobile_no,
          role: 'APPLICANT'
        },
        tokens: {
          access_token: accessToken,
          refresh_token: refreshTokenData.token,
          expires_at: refreshTokenData.expires_at
        }
      };
    } catch (error) {
      logger.error('Registration error:', error);
      throw error;
    }
  }

  async changeAdminPassword(adminId, currentPassword, newPassword) {
    try {
      if (!currentPassword || !newPassword) {
        throw new ApiError(400, 'Current password and new password are required');
      }

      if (newPassword.length < 8) {
        throw new ApiError(400, 'New password must be at least 8 characters');
      }

      const admin = await AdminUser.findOne({
        where: {
          admin_id: adminId,
          is_deleted: false
        }
      });

      if (!admin) {
        throw new ApiError(404, 'Admin user not found');
      }

      const isMatch = await admin.validatePassword(currentPassword);
      if (!isMatch) {
        throw new ApiError(400, 'Current password is incorrect');
      }

      admin.password_hash = newPassword;
      await admin.save();

      logger.info(`Admin password changed: ${adminId}`);

      return { message: 'Password changed successfully' };
    } catch (error) {
      logger.error('Admin change password error:', error);
      throw error;
    }
  }

  /**
   * Login an applicant
   * @param {Object} data - Login data
   * @param {string} data.mobile_no - Mobile number
   * @param {string} data.password - Password
   * @param {string} ip - IP address
   * @returns {Promise<Object>} - Login result
   */
  async loginApplicant(data, ip) {
    const { mobile_no, password } = data;
    
    try {
      const maxAttempts = getMaxLoginAttempts('APPLICANT');
      const lockMinutes = getLockDurationMinutes('APPLICANT');

      // Check if account is locked due to failed attempts
      const isLocked = await LoginAttempt.isLocked(mobile_no, 'APPLICANT', maxAttempts, lockMinutes);
      
      if (isLocked) {
        const lockedUntil = isLocked === true ? null : isLocked;
        throw new ApiError(401, buildLockoutMessage(lockedUntil));
      }
      
      // Find applicant
      const applicant = await ApplicantMaster.findOne({
        where: { mobile_no }
      });
      
      // If no applicant found or password doesn't match
      if (!applicant || !(await applicant.validatePassword(password))) {
        // Record failed attempt
        await LoginAttempt.recordAttempt(mobile_no, 'APPLICANT', false, ip);
        
        // Check if this attempt should lock the account
        const failedAttempts = await LoginAttempt.getRecentFailedAttempts(mobile_no, 'APPLICANT', lockMinutes);
        
        if (failedAttempts >= maxAttempts) {
          const lockUntil = createLockUntilDate('APPLICANT');
          await LoginAttempt.lockAccount(mobile_no, 'APPLICANT', lockUntil);
          throw new ApiError(401, buildLockoutMessage(lockUntil));
        }
        
        throw new ApiError(401, 'Invalid mobile number or password');
      }
      
      // Check if account is active
      if (applicant.status !== 'Active') {
        throw new ApiError(401, 'Account is inactive. Please contact support.');
      }
      
      // Record successful login
      await LoginAttempt.recordAttempt(mobile_no, 'APPLICANT', true, ip);
      
      // Generate tokens
      const payload = {
        id: applicant.applicant_id,
        role: 'APPLICANT'
      };
      
      const accessToken = generateToken(payload);
      const refreshTokenData = await RefreshToken.createToken(
        applicant.applicant_id,
        'APPLICANT',
        'Login',
        ip
      );
      
      logger.info(`Applicant logged in: ${mobile_no}`);
      
      return {
        user: {
          id: applicant.applicant_id,
          mobile_no: applicant.mobile_no,
          role: 'APPLICANT'
        },
        tokens: {
          access_token: accessToken,
          refresh_token: refreshTokenData.token,
          expires_at: refreshTokenData.expires_at
        }
      };
    } catch (error) {
      logger.error('Login error:', error);
      throw error;
    }
  }

  /**
   * Login an admin user
   * @param {Object} data - Login data
   * @param {string} data.username - Username
   * @param {string} data.password - Password
   * @param {string} ip - IP address
   * @returns {Promise<Object>} - Login result
   */
  async loginAdmin(data, ip) {
    const { username, password } = data;
    
    try {
      const maxAttempts = getMaxLoginAttempts('ADMIN');
      const lockMinutes = getLockDurationMinutes('ADMIN');

      // Check if account is locked due to failed attempts
      const isLocked = await LoginAttempt.isLocked(username, 'ADMIN', maxAttempts, lockMinutes);
      
      if (isLocked) {
        const lockedUntil = isLocked === true ? null : isLocked;
        throw new ApiError(401, buildLockoutMessage(lockedUntil));
      }
      
      // Find admin with role and permissions (check is_deleted only first)
      const admin = await AdminUser.findOne({
        where: { username, is_deleted: false },
        include: [{
          model: Role,
          as: 'role',
          include: [{
            model: Permission,
            as: 'permissions',
            through: { attributes: [] }
          }]
        }]
      });
      
      // If no admin found or password doesn't match
      if (!admin || !(await admin.validatePassword(password))) {
        // Record failed attempt
        await LoginAttempt.recordAttempt(username, 'ADMIN', false, ip);
        
        // Check if this attempt should lock the account
        const failedAttempts = await LoginAttempt.getRecentFailedAttempts(username, 'ADMIN', lockMinutes);
        
        if (failedAttempts >= maxAttempts) {
          const lockUntil = createLockUntilDate('ADMIN');
          await LoginAttempt.lockAccount(username, 'ADMIN', lockUntil);
          throw new ApiError(401, buildLockoutMessage(lockUntil));
        }
        
        throw new ApiError(401, 'Invalid username or password');
      }
      
      // Check if account is active (separate check for clear error message)
      if (!admin.is_active) {
        throw new ApiError(403, 'Account inactive. Please contact administrator.');
      }
      
      // Record successful login
      await LoginAttempt.recordAttempt(username, 'ADMIN', true, ip);
      
      // Update last login
      await admin.update({ last_login: new Date() });
      
      // Get permissions list (direct permissions)
      const directPermissions = admin.role?.permissions?.map(p => p.permission_code) || [];
      
      // Get wildcard permissions for the role
      let wildcardPermissions = [];
      if (admin.role_id) {
        const rbacService = require('./rbac');
        try {
          const effectivePerms = await rbacService.getUserEffectivePermissions(admin.admin_id);
          wildcardPermissions = effectivePerms.filter(p => p.includes('*') || !directPermissions.includes(p));
        } catch (e) {
          logger.warn('Could not fetch wildcard permissions:', e.message);
        }
      }
      
      // Combine direct and wildcard permissions
      const permissions = [...new Set([...directPermissions, ...wildcardPermissions])];
      
      // Generate tokens
      const payload = {
        id: admin.admin_id,
        role: admin.role?.role_code || 'UNKNOWN',
        role_id: admin.role_id,
        permissions
      };
      
      const accessToken = generateToken(payload);
      const refreshTokenData = await RefreshToken.createToken(
        admin.admin_id,
        'ADMIN',
        'Login',
        ip
      );
      
      logger.info(`Admin logged in: ${username}`);
      
      return {
        user: {
          id: admin.admin_id,
          username: admin.username,
          full_name: admin.full_name,
          email: admin.email,
          role: admin.role?.role_code,
          role_name: admin.role?.role_name,
          permissions
        },
        tokens: {
          access_token: accessToken,
          refresh_token: refreshTokenData.token,
          expires_at: refreshTokenData.expires_at
        }
      };
    } catch (error) {
      logger.error('Admin login error:', error);
      throw error;
    }
  }

  /**
   * Refresh access token
   * @param {string} refreshToken - Refresh token
   * @param {string} ip - IP address
   * @returns {Promise<Object>} - New tokens
   */
  async refreshToken(refreshToken, ip) {
    try {
      // Find token in database
      const tokenRecord = await RefreshToken.findByToken(refreshToken);
      
      if (!tokenRecord) {
        throw new ApiError(401, 'Invalid refresh token');
      }
      
      // Check if token is expired
      if (tokenRecord.isExpired()) {
        await tokenRecord.revoke();
        throw new ApiError(401, 'Refresh token expired');
      }
      
      // Get user based on token
      let user;
      if (tokenRecord.user_type === 'APPLICANT') {
        user = await ApplicantMaster.findByPk(tokenRecord.user_id);
        if (!user) {
          throw new ApiError(401, 'User not found');
        }
        
        // Generate new tokens
        const payload = {
          id: user.applicant_id,
          role: 'APPLICANT'
        };
        
        const accessToken = generateToken(payload);
        
        // Revoke old token and create new one
        await tokenRecord.revoke();
        const newRefreshTokenData = await RefreshToken.createToken(
          user.applicant_id,
          'APPLICANT',
          'Token Refresh',
          ip
        );
        
        return {
          access_token: accessToken,
          refresh_token: newRefreshTokenData.token,
          expires_at: newRefreshTokenData.expires_at
        };
      } else {
        user = await AdminUser.findByPk(tokenRecord.user_id);
        if (!user) {
          throw new ApiError(401, 'User not found');
        }
        
        // Generate new tokens
        const payload = {
          id: user.admin_id,
          role: user.role
        };
        
        const accessToken = generateToken(payload);
        
        // Revoke old token and create new one
        await tokenRecord.revoke();
        const newRefreshTokenData = await RefreshToken.createToken(
          user.admin_id,
          'ADMIN',
          'Token Refresh',
          ip
        );
        
        return {
          access_token: accessToken,
          refresh_token: newRefreshTokenData.token,
          expires_at: newRefreshTokenData.expires_at
        };
      }
    } catch (error) {
      logger.error('Token refresh error:', error);
      throw error;
    }
  }

  /**
   * Logout user
   * @param {string} refreshToken - Refresh token to revoke
   * @returns {Promise<Object>} - Logout result
   */
  async logout(refreshToken) {
    try {
      // Find token in database
      const tokenRecord = await RefreshToken.findByToken(refreshToken);
      
      if (!tokenRecord) {
        return { message: 'Logged out successfully' };
      }
      
      // Revoke token
      await tokenRecord.revoke();
      
      return { message: 'Logged out successfully' };
    } catch (error) {
      logger.error('Logout error:', error);
      throw error;
    }
  }
}

module.exports = new AuthService();
