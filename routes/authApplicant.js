const express = require('express');
const router = express.Router();
const authService = require('../services/authServiceEmail');
const { authenticate } = require('../middleware/auth');

/**
 * Applicant Authentication Routes
 * Email-based registration and login
 */

// Send registration OTP
router.post('/send-otp', async (req, res) => {
  try {
    const result = await authService.sendRegistrationOTP(req.body.email);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
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
    const msg = (error && error.message) ? error.message : 'Registration failed';
    const isClientError =
      msg.toLowerCase().includes('required') ||
      msg.toLowerCase().includes('invalid') ||
      msg.toLowerCase().includes('expired') ||
      msg.toLowerCase().includes('not found') ||
      msg.toLowerCase().includes('already');

    res.status(isClientError ? 400 : 500).json({ success: false, message: msg });
  }
});

// Login applicant
router.post('/login', async (req, res) => {
  try {
    const result = await authService.loginApplicant(req.body.email, req.body.password);
    res.json({ 
      success: true, 
      data: result,
      message: 'Login successful' 
    });
  } catch (error) {
    const msg = (error && error.message) ? error.message : 'Login failed';
    const lower = String(msg).toLowerCase();

    let status = 500;
    if (lower.includes('email is required') || lower.includes('password is required')) {
      status = 400;
    } else if (lower.includes('invalid email or password')) {
      status = 401;
    } else if (lower.includes('account is locked')) {
      status = 423;
    }

    res.status(status).json({ success: false, message: msg });
  }
});

// Send password reset OTP
router.post('/forgot-password', async (req, res) => {
  try {
    const result = await authService.sendPasswordResetOTP(req.body.email);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Reset password with OTP
router.post('/reset-password', async (req, res) => {
  try {
    const result = await authService.resetPassword(
      req.body.email,
      req.body.otp,
      req.body.new_password
    );
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
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
    res.status(500).json({ success: false, message: error.message });
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
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
