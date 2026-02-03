const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');

// Rate limiting configuration
const createRateLimiter = (windowMs, max, message) => {
  return rateLimit({
    windowMs: windowMs || 10 * 60 * 1000, // Default: 10 minutes
    max: max || 100, // Default: 100 requests per windowMs
    message: { error: message || 'Too many requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
    // Skip validation for X-Forwarded-For in development
    validate: { xForwardedForHeader: false }
  });
};

// Login rate limiter (5 requests per 10 minutes)
const loginRateLimiter = createRateLimiter(
  parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 10 * 60 * 1000,
  parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 5,
  'Too many login attempts, please try again later.'
);

// OTP rate limiter (5 requests per 10 minutes)
const otpRateLimiter = createRateLimiter(
  parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 10 * 60 * 1000,
  parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 5,
  'Too many OTP requests, please try again later.'
);

// API rate limiter (100 requests per minute)
const apiRateLimiter = createRateLimiter(
  60 * 1000, // 1 minute
  100,
  'Too many API requests, please try again later.'
);

// JWT helper functions
const getJwtExpiry = () => {
  // Support both JWT_EXPIRES_IN (preferred) and JWT_EXPIRY (legacy)
  const raw = process.env.JWT_EXPIRES_IN || process.env.JWT_EXPIRY || '7d';

  // If value is purely numeric (e.g. '5'), interpret it as seconds ('5s')
  if (/^\d+$/.test(raw)) {
    return `${raw}s`;
  }

  // Otherwise, trust jsonwebtoken/ms format (e.g. '5s', '15m', '1h', '7d')
  return raw;
};

// Bcrypt rounds - higher is more secure but slower
const getBcryptRounds = () => {
  return parseInt(process.env.BCRYPT_ROUNDS) || 12;
};

const generateToken = (payload, expiresIn = getJwtExpiry()) => {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn });
};

const verifyToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    return null;
  }
};

// Helmet configuration
const helmetConfig = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
     // connectSrc: ["'self'"],
       connectSrc: [
        "'self'",
        'http://103.165.118.71:3001',
        'http://103.165.118.71:5000',
        'https://inputtools.google.com',
        'http://localhost:5000',
         'http://localhost:5173',
      ],
 
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"]
    }
  },
  xssFilter: true,
  noSniff: true,
  referrerPolicy: { policy: 'same-origin' }
});

module.exports = {
  helmetConfig,
  loginRateLimiter,
  otpRateLimiter,
  apiRateLimiter,
  generateToken,
  verifyToken,
  getBcryptRounds,
  getJwtExpiry
};
