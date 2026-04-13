/**
 * Slow Query Logger with DB Stats Tracking
 * 
 * Logs slow queries and connection pool stats to file
 * Enable/disable via ENABLE_SLOW_QUERY_LOG in .env
 */

const logger = require('./logger');
const fs = require('fs');
const path = require('path');

// Simple enable/disable flag
const ENABLE_SLOW_QUERY_LOG = process.env.ENABLE_SLOW_QUERY_LOG === 'true';
const SLOW_QUERY_THRESHOLD_MS = 500; // Fixed threshold

// Log file paths
const SLOW_QUERY_LOG_FILE = path.join(__dirname, '../logs/slow-queries.log');
const DB_STATS_LOG_FILE = path.join(__dirname, '../logs/db-stats.log');

// Ensure logs directory exists
const logsDir = path.dirname(SLOW_QUERY_LOG_FILE);
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Query statistics
const queryStats = {
  totalQueries: 0,
  slowQueries: 0,
  verySlowQueries: 0,
  totalExecutionTime: 0,
  slowestQuery: { sql: '', time: 0 },
  queryTypeCount: {
    SELECT: 0,
    INSERT: 0,
    UPDATE: 0,
    DELETE: 0,
    OTHER: 0
  }
};

/**
 * Sequelize logging hook - logs slow queries
 * Use this in config/db.js: logging: slowQueryLogger.logQuery
 * With benchmark: true, Sequelize passes (sql, timingMs)
 */
const logQuery = (sql, timing) => {
  if (!ENABLE_SLOW_QUERY_LOG) return;

  // When benchmark: true, timing is the execution time in ms
  // Otherwise it might be undefined or an options object
  let duration = 0;
  if (typeof timing === 'number') {
    duration = timing;
  } else if (timing && typeof timing === 'object' && timing.benchmark) {
    duration = timing.benchmark;
  }

  queryStats.totalQueries++;
  queryStats.totalExecutionTime += duration;

  // Determine query type
  const queryType = sql.trim().split(' ')[0].toUpperCase();
  if (queryStats.queryTypeCount[queryType] !== undefined) {
    queryStats.queryTypeCount[queryType]++;
  } else {
    queryStats.queryTypeCount.OTHER++;
  }

  // Track slowest query
  if (duration > queryStats.slowestQuery.time) {
    queryStats.slowestQuery = { sql: sql.substring(0, 200), time: duration };
  }

  // Log slow queries
  if (duration >= SLOW_QUERY_THRESHOLD_MS) {
    queryStats.slowQueries++;
    
    const severity = duration >= 2000 ? 'CRITICAL' : 'WARNING';
    
    if (duration >= 2000) {
      queryStats.verySlowQueries++;
    }

    const recommendation = getQueryRecommendation(sql, timing);

    // Append to slow query log file
    const logLine = `[${new Date().toISOString()}] [${severity}] ${duration}ms\nQuery: ${sql.substring(0, 300)}\nSuggestion: ${recommendation}\n\n`;
    fs.appendFileSync(SLOW_QUERY_LOG_FILE, logLine, 'utf8');
  }
};

/**
 * Get recommendation based on query pattern
 */
const getQueryRecommendation = (sql, timing) => {
  const sqlLower = sql.toLowerCase();
  
  if (sqlLower.includes('seq scan') || sqlLower.includes('sequential scan')) {
    return 'Add index to avoid sequential scan';
  }
  
  if (sqlLower.includes('select *')) {
    return 'Use field projection instead of SELECT *';
  }
  
  if (!sqlLower.includes('limit') && sqlLower.includes('select')) {
    return 'Consider adding LIMIT clause for large result sets';
  }
  
  if (sqlLower.includes('is_deleted') || sqlLower.includes('is_active')) {
    return 'Ensure indexes exist on is_deleted and is_active columns';
  }
  
  if (timing >= VERY_SLOW_QUERY_THRESHOLD_MS) {
    return 'CRITICAL: Query exceeds 2s - immediate optimization required';
  }
  
  return 'Review query execution plan (EXPLAIN ANALYZE)';
};

/**
 * Log DB connection pool stats
 */
const logPoolStats = (sequelize) => {
  try {
    const pool = sequelize.connectionManager.pool;
    
    const stats = {
      timestamp: new Date().toISOString(),
      poolSize: pool.size || 0,
      available: pool.available || 0,
      using: pool.using || 0,
      waiting: pool.waiting || 0,
      maxConnections: pool.max || 0,
      minConnections: pool.min || 0,
      utilizationPercent: pool.max ? Math.round((pool.using / pool.max) * 100) : 0
    };

    // Warn if pool is saturated
    if (stats.utilizationPercent >= 80) {
      logger.warn('DB connection pool saturation detected', stats);
    } else if (stats.utilizationPercent >= 60) {
      logger.info('DB connection pool usage high', stats);
    } else {
      logger.debug('DB connection pool stats', stats);
    }

    // Append to DB stats log file
    const logLine = `[${stats.timestamp}] Pool: ${stats.using}/${stats.maxConnections} (${stats.utilizationPercent}%), Available: ${stats.available}, Waiting: ${stats.waiting}\n`;
    fs.appendFileSync(DB_STATS_LOG_FILE, logLine, 'utf8');

    // Warn on high pool utilization
    if (stats.utilizationPercent >= 80) {
      logger.warn(` HIGH CONNECTION POOL USAGE: ${stats.utilizationPercent}% (${stats.using}/${stats.maxConnections}), Waiting: ${stats.waiting}`);
    }
    
    // Critical warning if requests are waiting
    if (stats.waiting > 0) {
      logger.error(` CONNECTION POOL SATURATION: ${stats.waiting} requests waiting for connections! Pool: ${stats.using}/${stats.maxConnections}`);
    }

    return stats;
  } catch (error) {
    logger.error('Error logging pool stats', { error: error.message });
    return null;
  }
};

/**
 * Get query statistics summary
 */
const getQueryStats = () => {
  const avgExecutionTime = queryStats.totalQueries > 0 
    ? Math.round(queryStats.totalExecutionTime / queryStats.totalQueries) 
    : 0;

  return {
    totalQueries: queryStats.totalQueries,
    slowQueries: queryStats.slowQueries,
    verySlowQueries: queryStats.verySlowQueries,
    totalExecutionTime: `${Math.round(queryStats.totalExecutionTime)}ms`,
    slowestQuery: queryStats.slowestQuery,
    queryTypeCount: queryStats.queryTypeCount,
    avgExecutionTime: `${avgExecutionTime}ms`,
    slowQueryPercentage: queryStats.totalQueries > 0 
      ? ((queryStats.slowQueries / queryStats.totalQueries) * 100).toFixed(2) + '%'
      : '0.00%'
  };
};

/**
 * Log comprehensive DB stats summary
 */
const logDbStatsSummary = (sequelize) => {
  const poolStats = logPoolStats(sequelize);
  const queries = getQueryStats();

  const summary = {
    timestamp: new Date().toISOString(),
    connectionPool: poolStats,
    queryPerformance: queries
  };

  logger.info('DB Performance Summary', summary);

  // Write detailed summary to file
  const summaryLine = `\n${'='.repeat(80)}\n[${summary.timestamp}] DB PERFORMANCE SUMMARY\n${'='.repeat(80)}\n`;
  const detailsLine = JSON.stringify(summary, null, 2) + '\n';
  
  fs.appendFileSync(DB_STATS_LOG_FILE, summaryLine + detailsLine, 'utf8');

  return summary;
};

/**
 * Reset query statistics (useful for periodic resets)
 */
const resetQueryStats = () => {
  queryStats.totalQueries = 0;
  queryStats.slowQueries = 0;
  queryStats.verySlowQueries = 0;
  queryStats.totalExecutionTime = 0;
  queryStats.slowestQuery = { sql: '', time: 0 };
  queryStats.queryTypeCount = {
    SELECT: 0,
    INSERT: 0,
    UPDATE: 0,
    DELETE: 0,
    OTHER: 0
  };
  logger.info('Query statistics reset');
};

/**
 * Start periodic DB stats logging
 */
const startPeriodicLogging = (sequelize, intervalMinutes = 10) => {
  if (!ENABLE_SLOW_QUERY_LOG) return;

  const intervalMs = intervalMinutes * 60 * 1000;
  
  setInterval(() => {
    logDbStatsSummary(sequelize);
  }, intervalMs);

  logger.info(`Periodic DB stats logging started (every ${intervalMinutes} minutes)`);
};

module.exports = {
  logQuery,
  logPoolStats,
  logDbStatsSummary,
  getQueryStats,
  resetQueryStats,
  startPeriodicLogging,
  SLOW_QUERY_THRESHOLD_MS
};
