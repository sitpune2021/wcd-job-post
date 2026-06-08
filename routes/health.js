const express = require('express');
const router = express.Router();
const { sequelize } = require('../config/db');
const slowQueryLogger = require('../config/slowQueryLogger');
const logger = require('../config/logger');

/**
 * Lightweight DB liveness check, cached for a short window so that frequent
 * health pings (Apache, PM2, monitoring) don't exhaust the small Sequelize
 * connection pool. Calling sequelize.authenticate() on every request
 * previously caused the endpoint to randomly report "Database connection
 * failed" under load even though the DB itself was healthy.
 */
const DB_HEALTH_TTL_MS = 5000;
let lastDbCheckAt = 0;
let lastDbHealthy = true;
let lastDbError = null;
let inflightDbCheck = null;

const checkDbHealth = async () => {
  const now = Date.now();
  if (now - lastDbCheckAt < DB_HEALTH_TTL_MS) {
    return { healthy: lastDbHealthy, error: lastDbError, cached: true };
  }
  if (inflightDbCheck) {
    return inflightDbCheck;
  }
  inflightDbCheck = (async () => {
    try {
      // SELECT 1 is cheap and acquires/releases a single connection.
      await sequelize.query('SELECT 1');
      lastDbHealthy = true;
      lastDbError = null;
    } catch (err) {
      lastDbHealthy = false;
      lastDbError = err && err.message;
      logger.error('Health check DB ping failed', { error: lastDbError });
    } finally {
      lastDbCheckAt = Date.now();
    }
    return { healthy: lastDbHealthy, error: lastDbError, cached: false };
  })();
  try {
    return await inflightDbCheck;
  } finally {
    inflightDbCheck = null;
  }
};

/**
 * Basic health check
 */
router.get('/', async (req, res) => {
  const dbStatus = await checkDbHealth();
  if (!dbStatus.healthy) {
    return res.status(503).json({
      status: 'error',
      message: 'Database connection failed',
      detail: dbStatus.error,
      timestamp: new Date().toISOString()
    });
  }
  res.json({
    status: 'ok',
    db: dbStatus.cached ? 'ok (cached)' : 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
});

/**
 * Detailed performance metrics endpoint
 * @access Private (should be protected in production)
 */
router.get('/metrics', async (req, res) => {
  try {
    // Get DB stats
    const poolStats = slowQueryLogger.logPoolStats(sequelize);
    const queryStats = slowQueryLogger.getQueryStats();
    
    // Cache removed - no in-memory stats
    
    // System metrics
    const systemMetrics = {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      cpu: process.cpuUsage(),
      nodeVersion: process.version,
      platform: process.platform,
      pid: process.pid
    };
    
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: {
        connectionPool: poolStats,
        queryPerformance: queryStats
      },
      system: systemMetrics
    });
  } catch (error) {
    logger.error('Metrics endpoint error:', error);
    res.status(500).json({ 
      status: 'error', 
      message: 'Failed to retrieve metrics',
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
