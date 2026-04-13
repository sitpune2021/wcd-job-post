require('dotenv').config();
const express = require('express');
const compression = require('compression');
const path = require('path');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const routes = require('./routes');
const initMiddleware = require('./middleware/initMiddleware');
const { requestTimeout } = require('./config/security');
const logger = require('./config/logger');

// Initialize express app
const app = express();

// Trust proxy (important for PM2 / reverse proxy)
app.set('trust proxy', 1);

// Set request timeout (30 seconds)
app.use(requestTimeout(30000));

// ===================== MIDDLEWARE =====================
initMiddleware(app);

// Add compression middleware
app.use(compression({
  filter: (req, res) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    // Don't compress compressed responses
    return compression.filter(req, res);
  },
  level: 6, // Default compression level
  threshold: 1024, // Only compress responses larger than 1KB
}));

// ===================== HEALTH CHECK =====================
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'UP',
    timestamp: new Date(),
    service: 'WCD Portal Backend',
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    uptime: process.uptime()
  });
});

// ===================== API ROUTES =====================
app.use('/api', routes);

// ===================== FRONTEND =====================
const adminPath = path.join(__dirname, 'public', 'admin');
const appPath = path.join(__dirname, 'public', 'app');

// Serve admin frontend static files under /admin
app.use('/admin', express.static(adminPath, {
  setHeaders: (res, path) => {
    if (path.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript');
    } else if (path.endsWith('.css')) {
      res.setHeader('Content-Type', 'text/css');
    }
  }
}));

// Serve user app frontend static files under root
app.use(express.static(appPath, {
  setHeaders: (res, path) => {
    if (path.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript');
    } else if (path.endsWith('.css')) {
      res.setHeader('Content-Type', 'text/css');
    }
  }
}));

// SPA fallback for admin routes - ONLY for page routes, not static files
app.get('/admin/*', (req, res, next) => {
  // Skip if it has a file extension (static assets)
  if (req.path.includes('.')) return next();
  // Skip API routes
  if (req.path.startsWith('/api')) return next();
  
  res.sendFile(path.join(adminPath, 'index.html'));
});

// SPA fallback for user app routes (everything else)
app.get('*', (req, res, next) => {
  // Skip API routes
  if (req.path.startsWith('/api')) return next();
  // Skip admin routes (they're handled above)
  if (req.path.startsWith('/admin')) return next();
  // Skip if it has a file extension (static assets)
  if (req.path.includes('.')) return next();

  res.sendFile(path.join(appPath, 'index.html'));
});

// ===================== ERRORS =====================
app.use(notFoundHandler);
app.use(errorHandler);

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  process.exit(0);
});

module.exports = app;
