// =============================================================================
// PRODUCTION SERVER — single process, PM2 handles multi-instance clustering
// =============================================================================

require('dotenv').config();

// Set timezone to UTC for consistent timestamps
process.env.TZ = 'UTC';

const app = require('./app');
const { testConnection, closeConnection } = require('./config/db');
const { initCronJobs } = require('./cron/scheduler');
const logger = require('./config/logger');
const slowQueryLogger = require('./config/slowQueryLogger');
const systemHealthLogger = require('./config/systemHealthLogger');
const { syncAllPermissions } = require('./utils/syncPermissions');

const PORT = process.env.PORT || 3001;
const NODE_ENV = process.env.NODE_ENV || 'development';
const ENABLE_CRON = process.env.ENABLE_CRON !== 'false';

// =============================================================================
// Helper: notify PM2 that this process is ready to receive traffic.
// Required by ecosystem.config.js `wait_ready: true`. Without this PM2 sends
// SIGTERM after `listen_timeout` thinking the process is hung.
// =============================================================================
const notifyReady = () => {
  if (typeof process.send === 'function') {
    try { process.send('ready'); } catch (_) { /* ignore */ }
  }
};

// =============================================================================
// Helper: log reason + stack BEFORE every process.exit so restarts are always
// traceable in production logs.
// =============================================================================
const logExit = (code, reason, err) => {
  try {
    logger.error('PROCESS EXIT', {
      code,
      reason,
      pid: process.pid,
      error: err && (err.stack || err.message || String(err)),
      uptime: process.uptime(),
      memory: process.memoryUsage()
    });
  } catch (_) { /* ignore logger errors */ }
};

// =============================================================================
// Global process-level error handlers.
// unhandledRejection: log only — do NOT exit, a forgotten .catch() anywhere
// should never take down the server.
// uncaughtException: exit after logging — leaves process in unknown state.
// =============================================================================
process.on('uncaughtException', (error) => {
  logger.error('UNCAUGHT EXCEPTION', {
    message: error && error.message,
    stack: error && error.stack,
    pid: process.pid
  });
  // Uncaught exceptions leave the process in an unknown state — exit so PM2
  // can restart cleanly. Logged above with full stack.
  logExit(1, 'uncaughtException', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('UNHANDLED REJECTION (kept alive)', {
    reason: reason && (reason.stack || reason.message || String(reason)),
    pid: process.pid
  });
  // Intentionally NOT calling process.exit here. A single forgotten .catch()
  // anywhere in the codebase used to crash the worker, which caused random
  // production restarts and Apache "Connection Refused" errors.
});

const server = app.listen(PORT, async () => {
  logger.info(`Server started on port ${PORT} in ${NODE_ENV} mode`);

  const dbConnected = await testConnection();
  if (!dbConnected) {
    logger.error('Failed to connect to database, exiting...');
    logExit(1, 'db_connect_failed');
    process.exit(1);
  }

  try {
    await syncAllPermissions();
  } catch (error) {
    logger.error('Failed to sync permissions:', error);
  }

  const isCronWorker = !process.env.NODE_APP_INSTANCE || process.env.NODE_APP_INSTANCE === '0';
  if (ENABLE_CRON && isCronWorker) {
    initCronJobs();
  } else if (ENABLE_CRON) {
    logger.info('CRON: Skipped on non-primary PM2 worker', {
      nodeAppInstance: process.env.NODE_APP_INSTANCE,
      pid: process.pid
    });
  }

  const db = require('./config/db');
  slowQueryLogger.startPeriodicLogging(db.sequelize, 10);
  systemHealthLogger.startPeriodicMonitoring(10);

  logger.info('Server ready', {
    pid: process.pid,
    nodeVersion: process.version,
    platform: process.platform,
    memory: process.memoryUsage()
  });
  notifyReady();
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    logger.error(`Port ${PORT} is already in use`);
  } else {
    logger.error('Server error:', error);
  }
  logExit(1, 'server_error', error);
  process.exit(1);
});

const gracefulShutdown = async (signal) => {
  logger.info(`Received ${signal}, shutting down gracefully`);
  server.close(async () => {
    logger.info('HTTP server closed');
    await closeConnection();
    logger.info('Shutdown complete');
    logExit(0, `signal_${signal}`);
    process.exit(0);
  });
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    logExit(1, `signal_${signal}_timeout`);
    process.exit(1);
  }, 30000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
