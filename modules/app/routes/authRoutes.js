const express = require('express');
const Joi = require('joi');
const { passwordResetRateLimiter, loginRateLimiter } = require('../../../config/rateLimiters');
const { requireAppEmployee } = require('../middleware/appAuth');
const appAuthService = require('../services/appAuthService');
const ApiResponse = require('../../../utils/ApiResponse');

const router = express.Router();

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required()
});

const forgotPasswordSchema = Joi.object({
  email: Joi.string().email().required()
});

const resetPasswordSchema = Joi.object({
  email: Joi.string().email().required(),
  otp: Joi.string().required(),
  new_password: Joi.string().min(6).required()
});

const changePasswordSchema = Joi.object({
  current_password: Joi.string().required(),
  new_password: Joi.string().min(6).required()
});

const validateBody = (schema, body) => {
  const { error, value } = schema.validate(body, { abortEarly: true, stripUnknown: true });
  if (error) {
    const err = new Error(error.details[0].message);
    err.statusCode = 400;
    err.isClientError = true;
    throw err;
  }
  return value;
};

router.post('/login', loginRateLimiter, async (req, res, next) => {
  try {
    const value = validateBody(loginSchema, req.body);
    const result = await appAuthService.login(value);
    return ApiResponse.success(res, result, 'Login successful');
  } catch (error) {
    next(error);
  }
});

router.post('/forgot-password', passwordResetRateLimiter, async (req, res, next) => {
  try {
    const value = validateBody(forgotPasswordSchema, req.body);
    const result = await appAuthService.forgotPassword(value.email);
    return ApiResponse.success(res, result, result.message || 'OTP sent to email');
  } catch (error) {
    next(error);
  }
});

router.post('/reset-password', passwordResetRateLimiter, async (req, res, next) => {
  try {
    const value = validateBody(resetPasswordSchema, req.body);
    const result = await appAuthService.resetPassword(value.email, value.otp, value.new_password);
    return ApiResponse.success(res, result, result.message || 'Password reset successfully');
  } catch (error) {
    next(error);
  }
});

router.post('/change-password', requireAppEmployee, async (req, res, next) => {
  try {
    const value = validateBody(changePasswordSchema, req.body);
    const result = await appAuthService.changePassword(
      req.user.applicant_id,
      value.current_password,
      value.new_password
    );
    return ApiResponse.success(res, result, result.message || 'Password changed successfully');
  } catch (error) {
    next(error);
  }
});

module.exports = router;
