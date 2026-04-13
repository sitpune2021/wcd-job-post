const express = require('express');
const router = express.Router();
const authService = require('../services/authServiceEmail');
const { authenticate } = require('../middleware/auth');
const { loginRateLimiter, otpRateLimiter, passwordResetRateLimiter } = require('../config/rateLimiters');
const logger = require('../config/logger');

/**
 * Applicant Authentication Routes
 * Email-based registration and login
 */

// Send registration OTP
router.post('/send-otp', otpRateLimiter, async (req, res) => {
  try {
    const result = await authService.sendRegistrationOTP(req.body.email);
    res.json(result);
  } catch (error) {
    const statusCode = error.statusCode || (error.isClientError ? 400 : 500);
    const message = error.message || 'Failed to send OTP';
    
    logger.error(`Registration OTP error for ${req.body.email}: ${message}`, {
      email: req.body.email,
      isClientError: error.isClientError,
      statusCode
    });
    
    res.status(statusCode).json({
      success: false,
      message: message
    });
  }
});

// Register applicant
router.post('/register', async (req, res) => {
  try {
    const result = await authService.registerApplicant(req.body);
    res.status(201).json({ 
      success: true, 
      data: result,
      message: 'Registration successful' 
    });
  } catch (error) {
    const statusCode = error.statusCode || (error.isClientError ? 400 : 500);
    const message = error.message || 'Registration failed';
    
    logger.error(`Registration error for ${req.body.email}: ${message}`, {
      email: req.body.email,
      isClientError: error.isClientError,
      statusCode
    });
    
    res.status(statusCode).json({
      success: false,
      message: message
    });
  }
});

// Login applicant
router.post('/login', loginRateLimiter, async (req, res) => {
  try {
    const result = await authService.loginApplicant(req.body.email, req.body.password);
    res.json({ 
      success: true, 
      data: result,
      message: 'Login successful' 
    });
  } catch (error) {
    const statusCode = error.statusCode || (error.isClientError ? 400 : 500);
    const message = error.message || 'Login failed';
    
    logger.error(`Login error for ${req.body.email}: ${message}`, {
      email: req.body.email,
      isClientError: error.isClientError,
      statusCode
    });
    
    res.status(statusCode).json({
      success: false,
      message: message
    });
  }
});

// Send password reset OTP
router.post('/forgot-password', passwordResetRateLimiter, async (req, res) => {
  try {
    const result = await authService.sendPasswordResetOTP(req.body.email);
    res.json(result);
  } catch (error) {
    const statusCode = error.statusCode || (error.isClientError ? 400 : 500);
    const message = error.message || 'Failed to send password reset OTP';
    
    logger.error(`Password reset OTP error for ${req.body.email}: ${message}`, {
      email: req.body.email,
      isClientError: error.isClientError,
      statusCode
    });
    
    res.status(statusCode).json({
      success: false,
      message: message
    });
  }
});

// Reset password with OTP
router.post('/reset-password', passwordResetRateLimiter, async (req, res) => {
  try {
    const result = await authService.resetPassword(
      req.body.email,
      req.body.otp,
      req.body.new_password
    );
    res.json(result);
  } catch (error) {
    const statusCode = error.statusCode || (error.isClientError ? 400 : 500);
    const message = error.message || 'Failed to reset password';
    
    logger.error(`Password reset error for ${req.body.email}: ${message}`, {
      email: req.body.email,
      isClientError: error.isClientError,
      statusCode
    });
    
    res.status(statusCode).json({
      success: false,
      message: message
    });
  }
});

// Change password (when logged in)
router.post('/change-password', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'APPLICANT') {
      return res.status(403).json({ success: false, message: 'Only applicants can change password' });
    }
    const result = await authService.changePassword(
      req.user.applicant_id || req.user.id,
      req.body.current_password,
      req.body.new_password
    );
    res.json(result);
  } catch (error) {
    const statusCode = error.statusCode || (error.isClientError ? 400 : 500);
    const message = error.message || 'Failed to change password';
    
    logger.error(`Password change error for user ${req.user.applicant_id || req.user.id}: ${message}`, {
      userId: req.user.applicant_id || req.user.id,
      isClientError: error.isClientError,
      statusCode
    });
    
    res.status(statusCode).json({
      success: false,
      message: message
    });
  }
});

// Get profile
router.get('/profile', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'APPLICANT') {
      return res.status(403).json({ success: false, message: 'Only applicants can view profile' });
    }
    const profile = await authService.getApplicantProfile(req.user.applicant_id || req.user.id);
    res.json({ success: true, data: profile });
  } catch (error) {
    const statusCode = error.statusCode || (error.isClientError ? 400 : 500);
    const message = error.message || 'Failed to get profile';
    
    logger.error(`Profile error for user ${req.user.applicant_id || req.user.id}: ${message}`, {
      userId: req.user.applicant_id || req.user.id,
      isClientError: error.isClientError,
      statusCode
    });
    
    res.status(statusCode).json({
      success: false,
      message: message
    });
  }
});

module.exports = router;
