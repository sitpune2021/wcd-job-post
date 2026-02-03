const express = require('express');
const router = express.Router();
const { validate, schemas } = require('../middleware/validate');
const { loginRateLimiter } = require('../config/security');
const authService = require('../services/authService');
const { ApiError } = require('../middleware/errorHandler');
const ApiResponse = require('../utils/ApiResponse');
const logger = require('../config/logger');
const { authenticate } = require('../middleware/auth');

/**
 * Admin Authentication Routes
 * Note: Applicant auth is handled via /api/auth/applicant/* (email-based)
 */

/**
 * @route POST /api/v1/auth/admin/login
 * @desc Login an admin user
 * @access Public
 */
router.post('/admin/login', loginRateLimiter, async (req, res, next) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      throw ApiError.badRequest('Username and password are required');
    }
    
    const result = await authService.loginAdmin({ username, password }, req.ip);
    return ApiResponse.success(res, result, 'Admin login successful');
  } catch (error) {
    next(error);
  }
});

router.post('/admin/change-password', authenticate, async (req, res, next) => {
  try {
    const userRole = req.user.dataValues?.role_code || req.user.dataValues?.role || req.user.role;
    if (userRole === 'APPLICANT') {
      throw ApiError.forbidden('Only admin users can change password');
    }

    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) {
      throw ApiError.badRequest('Current password and new password are required');
    }

    const adminId = req.user.admin_id || req.user.id;
    const result = await authService.changeAdminPassword(adminId, current_password, new_password);
    return ApiResponse.success(res, result, 'Password changed successfully');
  } catch (error) {
    next(error);
  }
});

/**
 * @route POST /api/v1/auth/refresh
 * @desc Refresh access token
 * @access Public
 */
router.post('/refresh', validate(schemas.refreshToken), async (req, res, next) => {
  try {
    const { refresh_token } = req.body;

    logger.info('Refresh token API called', {
      path: req.originalUrl,
      ip: req.ip,
      has_refresh_token: Boolean(refresh_token),
      refresh_token_prefix: refresh_token ? refresh_token.substring(0, 8) : null,
      user_agent: req.get('user-agent') || null
    });

    const result = await authService.refreshToken(refresh_token, req.ip);
    return ApiResponse.success(res, result, 'Token refreshed successfully');
  } catch (error) {
    next(error);
  }
});

/**
 * @route POST /api/v1/auth/logout
 * @desc Logout user
 * @access Public
 */
router.post('/logout', validate(schemas.refreshToken), async (req, res, next) => {
  try {
    const { refresh_token } = req.body;

    logger.info('Logout API called', {
      path: req.originalUrl,
      ip: req.ip,
      has_refresh_token: Boolean(refresh_token),
      refresh_token_prefix: refresh_token ? refresh_token.substring(0, 8) : null,
      user_agent: req.get('user-agent') || null
    });

    await authService.logout(refresh_token);
    return ApiResponse.success(res, null, 'Logged out successfully');
  } catch (error) {
    next(error);
  }
});

module.exports = router;
