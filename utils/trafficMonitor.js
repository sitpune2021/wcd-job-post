/**
 * Traffic Monitor Utility
 * Simple utility to track active users and database load
 * Similar to health/metrics pattern
 */

const db = require('../models');
const os = require('os');
const logger = require('../config/logger');

/**
 * Get traffic statistics
 * @returns {Promise<Object>} Traffic and database metrics
 */
async function getTrafficStats() {
  try {
    // Database connection pool stats
    const pool = db.sequelize.connectionManager.pool;
    const poolStats = {
      total: pool.used + pool.free,
      used: pool.used,
      free: pool.free,
      waiting: pool.pending,
      max: pool.max,
      min: pool.min
    };
    
    // Check for stuck connections
    const stuckConnectionsQuery = `
      SELECT 
        COUNT(*) as total_connections,
        COUNT(CASE WHEN state = 'idle in transaction' THEN 1 END) as idle_in_transaction,
        COUNT(CASE WHEN state = 'idle in transaction' AND query = '<IDLE> in transaction (aborted)' THEN 1 END) as aborted_transactions,
        COUNT(CASE WHEN state = 'active' THEN 1 END) as active_connections
      FROM pg_stat_activity 
      WHERE datname = current_database()
    `;
    
    const dbStats = await db.sequelize.query(stuckConnectionsQuery, {
      type: db.Sequelize.QueryTypes.SELECT
    });
    
    // Active users in last 15 minutes
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    
    // Safely get counts with error handling for missing models
    const getCount = async (model, whereClause) => {
      try {
        if (!model || typeof model.count !== 'function') return 0;
        return await model.count({ where: whereClause });
      } catch (error) {
        logger.warn(`Failed to get count for model: ${error.message}`);
        return 0;
      }
    };
    
    const [
      activeAdmins,
      activeApplicants,
      recentApplications,
      recentLogins
    ] = await Promise.all([
      getCount(db.AdminUser, {
        last_login_at: { [db.Sequelize.Op.gte]: fifteenMinutesAgo },
        is_active: true
      }),
      getCount(db.ApplicantMaster, {
        last_login_at: { [db.Sequelize.Op.gte]: fifteenMinutesAgo }
      }),
      getCount(db.Application, {
        created_at: { [db.Sequelize.Op.gte]: fifteenMinutesAgo },
        is_deleted: false
      }),
      getCount(db.LoginLog, {
        login_time: { [db.Sequelize.Op.gte]: fifteenMinutesAgo }
      })
    ]);
    
    // Traffic level assessment
    const totalActiveUsers = activeAdmins + activeApplicants;
    let trafficLevel = 'LOW';
    if (totalActiveUsers > 100) trafficLevel = 'HIGH';
    else if (totalActiveUsers > 50) trafficLevel = 'MEDIUM';
    
    // Database health assessment
    let dbHealth = 'HEALTHY';
    if (dbStats[0].aborted_transactions > 0) dbHealth = 'WARNING';
    if (dbStats[0].aborted_transactions > 5) dbHealth = 'CRITICAL';
    if (poolStats.waiting > 10) dbHealth = 'CRITICAL';
    
    return {
      timestamp: new Date().toISOString(),
      traffic: {
        level: trafficLevel,
        activeUsers: {
          admins: activeAdmins,
          applicants: activeApplicants,
          total: totalActiveUsers
        },
        recentActivity: {
          applications: recentApplications,
          logins: recentLogins
        }
      },
      database: {
        health: dbHealth,
        pool: poolStats,
        connections: dbStats[0],
        utilization: {
          poolUtilization: Math.round((poolStats.used / poolStats.max) * 100),
          waitingPercentage: poolStats.max > 0 ? Math.round((poolStats.waiting / poolStats.max) * 100) : 0
        }
      },
      system: {
        hostname: os.hostname(),
        uptime: os.uptime(),
        loadAverage: os.loadavg(),
        freeMemory: os.freemem(),
        totalMemory: os.totalmem(),
        cpuCount: os.cpus().length
      }
    };
    
  } catch (error) {
    logger.error('Error getting traffic stats:', error);
    throw error;
  }
}

module.exports = {
  getTrafficStats
};
