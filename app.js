require('dotenv').config();
const express = require('express');
const path = require('path');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const routes = require('./routes');
const initMiddleware = require('./middleware/initMiddleware');

// Initialize express app
const app = express();

// Trust proxy (important for PM2 / reverse proxy)
app.set('trust proxy', 1);

// ===================== MIDDLEWARE =====================
initMiddleware(app);

// ===================== HEALTH CHECK =====================
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'UP',
    timestamp: new Date(),
    service: 'WCD Portal Backend',
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

module.exports = app;
