const helmet = require('helmet');
const jwt = require('jsonwebtoken');

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

// Feature toggles (defaults ON; set env to 'false' to disable)
const ENABLE_SECURITY_MW = process.env.ENABLE_SECURITY_MW !== 'false';

// Helpers
const sanitizeValue = (val) => {
  if (typeof val === 'string') {
    // Strip script tags and control chars
    return val.replace(/<\/?script[^>]*>/gi, '').replace(/[\u0000-\u001F\u007F]/g, '');
  }
  return val;
};

const sanitizeObject = (obj) => {
  if (!obj || typeof obj !== 'object') return obj;
  for (const key of Object.keys(obj)) {
    const value = obj[key];

    // Basic NoSQL injection guard: drop keys starting with $ or containing .
    if (key.startsWith('$') || key.includes('.')) {
      delete obj[key];
      continue;
    }

    if (Array.isArray(value)) {
      obj[key] = value.map((item) => (typeof item === 'object' ? sanitizeObject(item) : sanitizeValue(item)));
    } else if (value && typeof value === 'object') {
      obj[key] = sanitizeObject(value);
    } else {
      obj[key] = sanitizeValue(value);
    }
  }
  return obj;
};

// Security middleware (restored)
const xssProtection = (req, res, next) => {
  if (!ENABLE_SECURITY_MW) return next();
  req.body = sanitizeObject(req.body);
  req.query = sanitizeObject(req.query);
  req.params = sanitizeObject(req.params);
  next();
};

const nosqlProtection = (req, res, next) => {
  if (!ENABLE_SECURITY_MW) return next();
  req.body = sanitizeObject(req.body);
  req.query = sanitizeObject(req.query);
  req.params = sanitizeObject(req.params);
  next();
};

const preventParameterPollution = (req, res, next) => {
  if (!ENABLE_SECURITY_MW) return next();
  // For any duplicate query param, keep the first value only
  for (const key of Object.keys(req.query || {})) {
    const value = req.query[key];
    if (Array.isArray(value)) {
      req.query[key] = value[0];
    }
  }
  next();
};

const validateContentType = (req, res, next) => {
  if (!ENABLE_SECURITY_MW) return next();
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const contentType = (req.headers['content-type'] || '').toLowerCase();

  // If no content-type is provided and there is no body, allow
  if (!contentType || req.headers['content-length'] === '0') {
    return next();
  }

  if (
    contentType.startsWith('application/json') ||
    contentType.startsWith('multipart/form-data') ||
    contentType.startsWith('application/x-www-form-urlencoded')
  ) {
    return next();
  }
  res.status(415).json({ error: 'Unsupported Content-Type' });
};

const securityHeaders = (req, res, next) => {
  if (!ENABLE_SECURITY_MW) return next();
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
};

// Request timeout middleware
const requestTimeout = (timeoutMs = 30000) => (req, res, next) => {
  // Let Node handle the socket timeout; respond with a clear message
  req.setTimeout(timeoutMs, () => {
    if (!res.headersSent) {
      res.status(503).json({ error: 'Request timed out' });
    }
    req.destroy();
  });
  next();
};

// Helmet configuration
const buildHelmetConfig = (nonce) => helmet({
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "'unsafe-inline'",
        nonce ? `'nonce-${nonce}'` : null,
        "https://checkout.razorpay.com",
        "https://*.razorpay.com",
      ].filter(Boolean),
      scriptSrcElem: [
        "'self'",
        nonce ? `'nonce-${nonce}'` : null,
        "https://checkout.razorpay.com"
      ].filter(Boolean),
      styleSrc: [
        "'self'",
        // 'unsafe-inline',
        nonce ? `'nonce-${nonce}'` : null,
        "https://fonts.googleapis.com",
        "https://cdn.jsdelivr.net"
      ].filter(Boolean),
      styleSrcElem: [
        "'self'",
        "'unsafe-inline'",
        nonce ? `'nonce-${nonce}'` : null,
        "https://fonts.googleapis.com",
        "https://cdn.jsdelivr.net",
        "https://*.razorpay.com",
      ].filter(Boolean),
      imgSrc: [
        "'self'",
        "data:",
        "blob:",
        "https:",
        "http://localhost:5000",
        "http://103.39.134.85:5000",
        "http://192.168.1.2:5000",
        "https://wcdchrms.in",
        "https://dev.wcdchrms.in",
        "https://fonts.gstatic.com"
      ],
      fontSrc: [
        "'self'",
        "https://fonts.gstatic.com"
      ],
      connectSrc: [
        "'self'",
        "https://api.razorpay.com",
        "https://checkout.razorpay.com",
        "https://inputtools.google.com",
        "https://lumberjack.razorpay.com",
        "https://cdn.jsdelivr.net",
        "https://wcdchrms.in",
        "https://*.razorpay.com",
        "https://fonts.googleapis.com",
        "https://fonts.gstatic.com",
        "data:",
        "blob:",
        "http://localhost:5000",
        "http://localhost:5173",
        "http://103.39.134.85:3001",
        "http://103.39.134.85:5000"
      ],
      frameSrc: [
        "'self'",
        "https://checkout.razorpay.com",
        "https://api.razorpay.com",
        "https://*.razorpay.com",
      ],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'self'"],
      scriptSrcAttr: ["'unsafe-inline'"]
    }
  },
  xssFilter: true,
  noSniff: true,
  referrerPolicy: { policy: 'same-origin' }
});

module.exports = {
  buildHelmetConfig,
  generateToken,
  verifyToken,
  getBcryptRounds,
  getJwtExpiry,
  requestTimeout,
  xssProtection,
  nosqlProtection,
  preventParameterPollution,
  validateContentType,
  securityHeaders
};
