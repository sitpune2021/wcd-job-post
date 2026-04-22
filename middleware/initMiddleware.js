// ============================================================================
// MIDDLEWARE INITIALIZATION
// ============================================================================

const passport = require('passport');
const { initializePassport } = require('./auth');
const cors = require('cors');
const express = require('express');
const path = require('path');
const csrf = require('csurf');
const cookieParser = require('cookie-parser');
const logger = require('../config/logger');
const { ENABLE_RATE_LIMIT: RATE_LIMIT_ENABLED, apiRateLimiter } = require('../config/rateLimiters');
const {
  xssProtection,
  nosqlProtection,
  preventParameterPollution,
  validateContentType,
  securityHeaders,
  buildHelmetConfig
} = require('../config/security');
const formatDatesInResponse = require('./formatDates');

// Feature toggles (defaults ON; set env to 'false' to disable)
const ENABLE_CSP = process.env.ENABLE_CSP !== 'false';
const ENABLE_CORS = process.env.ENABLE_CORS !== 'false';
const ENABLE_SECURITY_MW = process.env.ENABLE_SECURITY_MW !== 'false';
const ENABLE_CSRF = process.env.ENABLE_CSRF === 'true'; // default off to avoid breaking existing flows

// CSRF setup (cookie-based, double-submit)
const csrfSkips = [
  '/health',
  '/api/health',
  '/api/webhooks',
  '/uploads',
  '/api/auth/admin/login',
  '/api/auth/applicant/login',
  '/api/auth/applicant/register',
  '/api/auth/refresh'
];

// Extend skips from env (comma-separated paths)
if (process.env.CSRF_SKIP_PATHS) {
  csrfSkips.push(...process.env.CSRF_SKIP_PATHS.split(',').map((p) => p.trim()).filter(Boolean));
}

const csrfMiddleware = csrf({
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production'
  }
});

// ==================== CORS HELPERS ====================

const normalizeOrigin = (origin) => {
  if (!origin || typeof origin !== 'string') return null;
  const trimmed = origin.trim().replace(/\/+$/, '');
  try {
    const url = new URL(trimmed);
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch (_) {
    return trimmed;
  }
};

const getAllowedOrigins = () => {
  const origins = [
    'http://localhost:3000',
    'http://localhost:5000',
    'http://localhost:5174',
    'http://localhost:5175',
    'http://127.0.0.1:5174',
    'http://127.0.0.1:5175',
    'http://192.168.1.2:5000',
    'http://192.168.1.31:5174',
    'http://192.168.1.31:5175',
    'http://192.168.1.50:5174',
    'http://192.168.1.11:5174',
    'http://192.168.1.50:5175',
    'http://192.168.1.55:5174',
    'http://192.168.1.24:5173',
    'http://103.165.118.71:5000',
    'http://192.168.1.17:5173',
    'http://192.168.1.49:5174/',
    'http://192.168.1.14:5174/',
    'http://192.168.1.34:5000/',
    'https://dev.wcdchrms.in',
    'https://wcdchrms.in'
  ];

  if (process.env.FRONTEND_URL) origins.push(process.env.FRONTEND_URL);
  if (process.env.ALLOWED_ORIGINS) {
    origins.push(...process.env.ALLOWED_ORIGINS.split(','));
  }

  return [...new Set(origins.map(normalizeOrigin).filter(Boolean))];
};

// ==================== INIT ====================

const initMiddleware = (app) => {
  initializePassport();
  app.use(passport.initialize());

  // Cookies (required for CSRF cookies)
  app.use(cookieParser());

  // Per-request CSP nonce for inline script/style avoidance
  app.use((req, res, next) => {
    res.locals.cspNonce = require('crypto').randomBytes(16).toString('base64');
    next();
  });

  // Helmet with CSP (nonce-aware) and security headers
  if (ENABLE_CSP) {
    app.use((req, res, next) => buildHelmetConfig(res.locals.cspNonce)(req, res, next));
  }
  if (ENABLE_SECURITY_MW) {
    app.use(securityHeaders);
  }

  // CSRF (optional; cookie-based)
  if (ENABLE_CSRF) {
    app.use((req, res, next) => {
      // Skip listed paths or safe methods
      if (csrfSkips.some((p) => req.path.startsWith(p))) return next();

      return csrfMiddleware(req, res, (err) => {
        if (err) return next(err);
        // Expose token for clients to send on mutating requests
        res.setHeader('X-CSRF-TOKEN', req.csrfToken());
        next();
      });
    });
  }

  const allowedOrigins = getAllowedOrigins();

  const buildCorsValidator = () => ({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, same-origin fetch)
      if (!origin) return callback(null, true);

      const normalized = normalizeOrigin(origin);

      if (process.env.NODE_ENV === 'production') {
        if (!allowedOrigins.includes(normalized)) {
          logger.warn(`CORS blocked for origin: ${origin}`);
          return callback(new Error('Not allowed by CORS'), false);
        }
      } else if (!allowedOrigins.includes(normalized)) {
        // In development, warn but allow
        logger.warn(`CORS allowed (dev mode): ${origin}`);
      }

      return callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Request-Id', 'x-request-id'],
    exposedHeaders: ['Content-Length']
  });

  //  SECURE CORS - Strict in production
  if (ENABLE_CORS) {
    app.use(cors(buildCorsValidator()));
  }

  // Rate limiting skip list (similar to CSRF)
  const rateLimitSkips = ['/health', '/api/health', '/uploads'];
  if (process.env.RATE_LIMIT_SKIP_PATHS) {
    rateLimitSkips.push(...process.env.RATE_LIMIT_SKIP_PATHS.split(',').map((p) => p.trim()).filter(Boolean));
  }

  // Apply light rate limiting to all API routes (anti-flood only)
  if (RATE_LIMIT_ENABLED) {
    app.use((req, res, next) => {
      // Skip listed paths
      if (rateLimitSkips.some((p) => req.path.startsWith(p))) return next();
      return apiRateLimiter(req, res, next);
    });
  }

  // Format all dates in API responses to IST
  // app.use(formatDatesInResponse);

  // Request logging middleware with hit tracking and abuse detection (non-invasive)
  const apiHitCounts = {};
  const apiResponseTimes = {};

  app.use((req, res, next) => {
    req.correlationId = req.headers['x-correlation-id'] || require('uuid').v4();
    res.setHeader('X-Correlation-ID', req.correlationId);

    const startTime = Date.now();
    const routeKey = `${req.method} ${req.route ? req.route.path : req.originalUrl}`;

    apiHitCounts[routeKey] = (apiHitCounts[routeKey] || 0) + 1;
    logger.info(`${req.method} ${req.originalUrl} - IP: ${req.ip} - CID: ${req.correlationId} - Hits: ${apiHitCounts[routeKey]}`);

    res.on('finish', () => {
      const responseTime = Date.now() - startTime;
      apiResponseTimes[routeKey] = apiResponseTimes[routeKey] || [];
      apiResponseTimes[routeKey].push(responseTime);
      if (apiResponseTimes[routeKey].length > 100) {
        apiResponseTimes[routeKey] = apiResponseTimes[routeKey].slice(-100);
      }

      // Set response time header safely before finish (Express sets headers before finish)
      try { res.setHeader('X-Response-Time', `${responseTime}ms`); } catch (_) {}

      if (responseTime > 1000) {
        logger.warn(`SLOW API: ${req.method} ${req.originalUrl} - ${responseTime}ms - IP: ${req.ip} - CID: ${req.correlationId}`);
      }

      if (apiHitCounts[routeKey] > 100) {
        logger.warn(`HIGH TRAFFIC: ${routeKey} - ${apiHitCounts[routeKey]} hits - Potential abuse or inefficient usage`);
      }

      const logLevel = res.statusCode >= 500 ? 'error' : (res.statusCode >= 400 ? 'warn' : 'info');
      logger[logLevel](`[${req.correlationId}] ${req.method} ${req.originalUrl} ${res.statusCode} ${responseTime}ms`);
    });

    next();
  });

  // Body parsers (run before sanitization so payload is available)
  app.use(express.json({ 
    limit: '10mb',
    strict: true // Allow primitives like null, true, false, numbers
  }));
  app.use(express.urlencoded({ 
    extended: true, 
    limit: '10mb',
    parameterLimit: 1000 // Limit number of parameters
  }));

  // Security middleware (single sanitization pass)
  if (ENABLE_SECURITY_MW) {
    app.use(xssProtection);
    app.use(preventParameterPollution);
    app.use(validateContentType);
  }

  // Uploads with permissive CORS (public GET, no credentials)
  const uploadCors = {
    origin: '*',
    credentials: false,
    methods: ['GET', 'HEAD', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Request-Id', 'x-request-id'],
    exposedHeaders: ['Content-Length']
  };
  app.options('/uploads/*', cors(uploadCors));
  app.use('/uploads', cors(uploadCors), express.static(path.join(__dirname, '../uploads'), {
    maxAge: '1d', // Cache static files for 1 day
    etag: true
  }));
};

module.exports = initMiddleware;
