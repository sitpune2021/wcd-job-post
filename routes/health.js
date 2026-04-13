const express = require('express');
const router = express.Router();
const { sequelize } = require('../config/db');
const cache = require('../utils/cache');
const slowQueryLogger = require('../config/slowQueryLogger');
const logger = require('../config/logger');

/**
 * Basic health check
 */
router.get('/', async (req, res) => {
  try {
    await sequelize.authenticate();
    res.json({ 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage()
    });
  } catch (error) {
    logger.error('Health check failed:', error);
    res.status(503).json({ 
      status: 'error', 
      message: 'Database connection failed',
      timestamp: new Date().toISOString()
    });
  }
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
    
    // Get cache stats
    const cacheStats = cache.getStats();
    
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
      cache: cacheStats,
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
