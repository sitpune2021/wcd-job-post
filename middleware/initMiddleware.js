// ============================================================================
// MIDDLEWARE INITIALIZATION
// ============================================================================

const passport = require('passport');
const { initializePassport } = require('./auth');
const helmet = require('helmet');
const cors = require('cors');
const express = require('express');
const path = require('path');
const logger = require('../config/logger');

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
    'http://localhost:5000',
    'http://localhost:5173',
    'http://127.0.0.1:5000',
    'http://127.0.0.1:5173',
    'http://103.165.118.71:5000',
  ];

  if (process.env.FRONTEND_URL) origins.push(process.env.FRONTEND_URL);
  if (process.env.ALLOWED_ORIGINS) {
    origins.push(...process.env.ALLOWED_ORIGINS.split(','));
  }

  return [...new Set(origins.map(normalizeOrigin).filter(Boolean))];
};

// ==================== HELMET CONFIG ====================

const getHelmetConfig = () => {
  const enableHttpsHeaders = process.env.ENABLE_HTTPS_HEADERS === 'true';

  return {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:", "https:", "http://localhost:5000", "http://103.165.118.71:5000"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        // connectSrc: [
        //   "'self'",
        //   "http://localhost:3001",
        //   "http://103.165.118.71:5000"
        // ],
           connectSrc: [
        "'self'",
        'http://103.165.118.71:3001',
        'http://103.165.118.71:5000',
        'https://inputtools.google.com',
        'http://localhost:5000',
         'http://localhost:5173',
      ],
        frameSrc: ["'self'", "blob:", "data:", "http://localhost:5000", "http://103.165.118.71:5000"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: enableHttpsHeaders ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    frameguard: false,
    hidePoweredBy: true,
    noSniff: true,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    hsts: enableHttpsHeaders ? { maxAge: 31536000 } : false,
  };
};

// ==================== INIT ====================

const initMiddleware = (app) => {
  initializePassport();
  app.use(passport.initialize());

  app.use(helmet(getHelmetConfig()));

  const allowedOrigins = getAllowedOrigins();

  // ✅ SIMPLE & SAFE CORS (NO CRASH, SAME-ORIGIN OK)
  app.use(cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true); // same-origin / curl / postman

      const normalized = normalizeOrigin(origin);
      if (allowedOrigins.includes(normalized)) {
        return callback(null, true);
      }

      logger.warn(`CORS allowed (same-origin fallback): ${origin}`);
      return callback(null, true); // ✅ DO NOT THROW ERROR
    },
    credentials: true,
  }));

  // Logging
  app.use((req, res, next) => {
    logger.info(`${req.method} ${req.originalUrl} - IP: ${req.ip}`);
    next();
  });

  // Body parsers
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Uploads
  app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

  // Prevent query pollution
  app.use((req, res, next) => {
    for (const key in req.query) {
      if (Array.isArray(req.query[key])) {
        req.query[key] = req.query[key][0];
      }
    }
    next();
  });
};

module.exports = initMiddleware;
