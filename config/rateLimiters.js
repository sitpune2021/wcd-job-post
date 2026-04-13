const rateLimit = require('express-rate-limit');
const logger = require('./logger');

// Feature toggle
const ENABLE_RATE_LIMIT = process.env.ENABLE_RATE_LIMIT !== 'false';

// Generic rate limiter factory
const createRateLimiter = (options = {}) => {
  const {
    windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    max = parseInt(process.env.RATE_LIMIT_MAX) || 100,
    message = 'Too many requests, please try again later.',
    skipSuccessfulRequests = false,
    skipFailedRequests = false,
    keyGenerator = (req) => req.ip,
  } = options;

  const humanWindow = () => {
    if (windowMs >= 60 * 60 * 1000) return `${Math.round(windowMs / (60 * 60 * 1000))} hour(s)`;
    if (windowMs >= 60 * 1000) return `${Math.round(windowMs / (60 * 1000))} minute(s)`;
    return `${Math.ceil(windowMs / 1000)} second(s)`;
  };

  return rateLimit({
    windowMs,
    max,
    message: {
      error: message,
      retryAfter: Math.ceil(windowMs / 1000)
    },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests,
    skipFailedRequests,
    keyGenerator,
    handler: (req, res, next) => {
      const key = keyGenerator(req);
      const retrySeconds = Math.ceil(windowMs / 1000);
      logger.warn(`Rate limit exceeded - Key: ${key}, Path: ${req.path}, Method: ${req.method}, Window: ${humanWindow()}`);
      res.status(429).json({
        error: `${message} Try again after ${humanWindow()}.`,
        retryAfter: retrySeconds
      });
    },
    validate: { xForwardedForHeader: false }
  });
};

// Login rate limiter - keys on username/email from request body
const loginRateLimiter = createRateLimiter({
  windowMs: parseInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.AUTH_RATE_LIMIT_MAX) || 10,
  keyGenerator: (req) => {
    // Key on username/email to throttle per account, not per IP
    const identifier = req.body?.username || req.body?.email || req.ip;
    return `login:${identifier}`;
  },
  skipSuccessfulRequests: true, // Only count failed login attempts
  message: 'Too many login attempts, please try again later.'
});

// OTP rate limiter - keys on email from request body
const otpRateLimiter = createRateLimiter({
  windowMs: parseInt(process.env.OTP_RATE_LIMIT_WINDOW_MS) || 60 * 60 * 1000, // 1 hour
  max: parseInt(process.env.OTP_RATE_LIMIT_MAX) || 5,
  keyGenerator: (req) => {
    // Key on email to throttle per email address
    const identifier = req.body?.email || req.ip;
    return `otp:${identifier}`;
  },
  message: 'Too many OTP requests, please try again later.'
});

// Password reset rate limiter - keys on email from request body
const passwordResetRateLimiter = createRateLimiter({
  windowMs: parseInt(process.env.RESET_RATE_LIMIT_WINDOW_MS) || 60 * 60 * 1000, // 1 hour
  max: parseInt(process.env.RESET_RATE_LIMIT_MAX) || 3,
  keyGenerator: (req) => {
    // Key on email to throttle per email address
    const identifier = req.body?.email || req.ip;
    return `reset:${identifier}`;
  },
  message: 'Too many password reset requests, please try again later.'
});

// Upload rate limiter - keys on user ID if authenticated, else IP
const uploadRateLimiter = createRateLimiter({
  windowMs: parseInt(process.env.UPLOAD_RATE_LIMIT_WINDOW_MS) || 60 * 60 * 1000, // 1 hour
  max: parseInt(process.env.UPLOAD_RATE_LIMIT_MAX) || 50,
  keyGenerator: (req) => {
    // Key on user ID if authenticated, otherwise IP
    const userId = req.user?.id || req.user?.applicant_id || req.user?.admin_id;
    const identifier = userId || req.ip;
    return `upload:${identifier}`;
  },
  message: 'Upload limit exceeded, please try again later.'
});

// Generic API rate limiter - light anti-flood protection
const apiRateLimiter = createRateLimiter({
  windowMs: parseInt(process.env.API_RATE_LIMIT_WINDOW_MS) || 60 * 1000, // 1 minute
  max: parseInt(process.env.API_RATE_LIMIT_MAX) || 200, // High limit
  keyGenerator: (req) => req.ip,
  message: 'Too many API requests, please slow down.'
});

module.exports = {
  ENABLE_RATE_LIMIT,
  createRateLimiter,
  loginRateLimiter,
  otpRateLimiter,
  passwordResetRateLimiter,
  uploadRateLimiter,
  apiRateLimiter
};
