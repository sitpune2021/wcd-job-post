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
const frontendDistPath = path.join(__dirname, 'public');

// Serve static assets
app.use(express.static(frontendDistPath));

// SPA fallback (ONLY if request is not API and not a file)
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  if (req.path.includes('.')) return next(); // allow assets

  res.sendFile(path.join(frontendDistPath, 'index.html'));
});

// ===================== ERRORS =====================
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
