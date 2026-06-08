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

// ===================== SERVICE WORKER DISABLE =====================
// Completely disable service worker
app.get('/sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  // Return empty SW that does nothing
  res.send('// Service worker disabled');
});

// ===================== ADMIN ROUTES =====================

// Serve admin with service worker disabled
app.get(['/admin', '/admin/'], (req, res) => {
  // Read HTML and serve fresh content
  const fs = require('fs');
  const indexPath = path.join(adminPath, 'index.html');
  let html = fs.readFileSync(indexPath, 'utf8');
  
  // Add script to disable service worker
  const swDisableScript = `
  <script>
    // Disable service worker completely
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(registrations => {
        registrations.forEach(registration => {
          registration.unregister();
        });
      });
    }
  </script>`;
  
  html = html.replace('</body>', swDisableScript + '</body>');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.send(html);
});

// ===================== FRONTEND =====================
const adminPath = path.join(__dirname, 'public', 'admin');
const appPath = path.join(__dirname, 'public', 'app');

// Helper to send index.html with strict no-cache headers
const sendNoCache = (res, filePath) => {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Surrogate-Control': 'no-store'
  });
  // Use sendFile with options to disable ETag generation
  res.sendFile(filePath, {
    etag: false,
    lastModified: false
  });
};

// Serve admin with service worker disabled
app.get(['/admin', '/admin/'], (req, res) => {
  // Read HTML and serve fresh content
  const fs = require('fs');
  const indexPath = path.join(adminPath, 'index.html');
  let html = fs.readFileSync(indexPath, 'utf8');
  
  // Add script to disable service worker
  const swDisableScript = `
  <script>
    // Disable service worker completely
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(registrations => {
        registrations.forEach(registration => {
          registration.unregister();
        });
      });
    }
  </script>`;
  
  html = html.replace('</body>', swDisableScript + '</body>');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.send(html);
});

// Serve admin static ASSETS (JS/CSS/images)
app.use('/admin', express.static(adminPath, {
  maxAge: '1d', // 1 day is reasonable for production
  etag: true, // Enable ETag for proper caching
  lastModified: true, // Enable Last-Modified for proper caching
  index: false, // Do NOT auto-serve index.html (handled above)
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    } else if (filePath.endsWith('.css')) {
      res.setHeader('Content-Type', 'text/css; charset=utf-8');
    } else if (filePath.endsWith('.json')) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
  }
}));

// SPA fallback for admin sub-routes
app.get('/admin/*', (req, res, next) => {
  if (req.path.split('?')[0].includes('.')) return next(); // skip static assets
  
  // Read HTML and serve fresh content
  const fs = require('fs');
  const indexPath = path.join(adminPath, 'index.html');
  let html = fs.readFileSync(indexPath, 'utf8');
  
  // Add script to disable service worker
  const swDisableScript = `
  <script>
    // Disable service worker completely
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(registrations => {
        registrations.forEach(registration => {
          registration.unregister();
        });
      });
    }
  </script>`;
  
  html = html.replace('</body>', swDisableScript + '</body>');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.send(html);
});

// --- APP: serve index.html with simple no-cache ---
app.get('/', (req, res) => {
  sendNoCache(res, path.join(appPath, 'index.html'));
});

// Serve app static ASSETS with long-term caching
app.use(express.static(appPath, {
  maxAge: '1y',
  etag: true,
  lastModified: true,
  index: false, // Do NOT auto-serve index.html (handled above)
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    } else if (filePath.endsWith('.css')) {
      res.setHeader('Content-Type', 'text/css; charset=utf-8');
    } else if (filePath.endsWith('.json')) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
  }
}));

// SPA fallback for app routes
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  if (req.path.startsWith('/admin')) return next();
  if (req.path.split('?')[0].includes('.')) return next();
  sendNoCache(res, path.join(appPath, 'index.html'));
});

// ===================== ERRORS =====================
app.use(notFoundHandler);
app.use(errorHandler);

// NOTE: SIGTERM / SIGINT lifecycle is intentionally handled in server.js only.
// Registering them here was forcing immediate process.exit(0) before the
// graceful shutdown in server.js could close the HTTP server / DB pool, which
// caused brief backend unavailability and Apache "Connection Refused" errors.

module.exports = app;
