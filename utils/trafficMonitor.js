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
    // Database connection pool stats - enhanced with better error handling
    let poolStats = {
      total: 0,
      used: 0,
      free: 0,
      waiting: 0,
      max: 0,
      min: 0
    };
    
    try {
      const pool = db.sequelize.connectionManager.pool;
      if (pool) {
        // Try different pool property structures
        const used = pool.used || pool.numUsed || 0;
        const free = pool.free || pool.numFree || 0;
        const waiting = pool.pending || pool.waitingClients || 0;
        const max = pool.max || pool.options?.max || 0;
        const min = pool.min || pool.options?.min || 0;
        
        poolStats = {
          total: used + free,
          used: used,
          free: free,
          waiting: waiting,
          max: max,
          min: min
        };
        
        logger.debug('Pool stats retrieved:', poolStats);
      }
    } catch (error) {
      logger.warn('Failed to get pool stats:', error.message);
    }
    
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
    
    // Active users in last 15 minutes (more accurate for currently logged-in users)
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
    
    // Get more accurate active user counts by checking recent activity and login logs
    const [
      activeAdmins,
      activeApplicants,
      recentApplications,
      recentAdminLogins,
      recentApplicantLogins
    ] = await Promise.all([
      // Active admins: logged in within 15 minutes AND have recent activity
      getCount(db.AdminUser, {
        last_login: { [db.Sequelize.Op.gte]: fifteenMinutesAgo },
        is_active: true
      }),
      // Active applicants: logged in within 15 minutes
      getCount(db.ApplicantMaster, {
        last_login_at: { [db.Sequelize.Op.gte]: fifteenMinutesAgo }
      }),
      // Recent applications (activity indicator)
      getCount(db.Application, {
        created_at: { [db.Sequelize.Op.gte]: fifteenMinutesAgo },
        is_deleted: false
      }),
      // Admin login logs in last 15 minutes
      getCount(db.LoginLog, {
        login_time: { [db.Sequelize.Op.gte]: fifteenMinutesAgo },
        user_type: 'admin'
      }),
      // Applicant login logs in last 15 minutes
      getCount(db.LoginLog, {
        login_time: { [db.Sequelize.Op.gte]: fifteenMinutesAgo },
        user_type: 'applicant'
      })
    ]);
    
    // Use login logs as more accurate indicator of currently logged-in users
    const currentlyActiveAdmins = Math.max(activeAdmins, recentAdminLogins);
    const currentlyActiveApplicants = Math.max(activeApplicants, recentApplicantLogins);
    
    // Traffic level assessment - use more accurate counts
    const totalActiveUsers = currentlyActiveAdmins + currentlyActiveApplicants;
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
          admins: currentlyActiveAdmins,
          applicants: currentlyActiveApplicants,
          total: totalActiveUsers
        },
        recentActivity: {
          applications: recentApplications,
          adminLogins: recentAdminLogins,
          applicantLogins: recentApplicantLogins,
          totalLogins: recentAdminLogins + recentApplicantLogins
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
