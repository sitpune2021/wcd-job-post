const { Sequelize } = require('sequelize');
const logger = require('./logger');
const slowQueryLogger = require('./slowQueryLogger');

// Database configuration from environment variables
const DB_SSL = process.env.DB_SSL === 'true';

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'mission_shakti',
  username: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  dialect: 'postgres',
  logging: slowQueryLogger.logQuery,
  benchmark: true,
  // Connection pool settings - optimized for better performance
  pool: {
    max: process.env.DB_POOL_MAX ? parseInt(process.env.DB_POOL_MAX) : 20, // Reduced from 25
    min: process.env.DB_POOL_MIN ? parseInt(process.env.DB_POOL_MIN) : 2,   
    acquire: 15000,  // Reduced from 30s to 15s for faster failover
    idle: 5000,      // Reduced from 10s to 5s to free connections faster
    evict: 1000      
  },
  define: {
    timestamps: true,
    underscored: false,
    paranoid: false // We'll use our own soft delete mechanism
  },
  // Query optimization
  dialectOptions: {
    // Enable query logging in development
    logging: process.env.NODE_ENV === 'development' ? console.log : false,
    // SSL configuration controlled by DB_SSL flag
    ssl: DB_SSL ? { 
      require: true,
      rejectUnauthorized: false 
    } : false,
    // CRITICAL: Kill connections stuck in "idle in transaction (aborted)" after 30 seconds
    // This prevents connection pool exhaustion from zombie transactions
    idle_in_transaction_session_timeout: 30000
  },
  // Connection retry configuration - DISABLED to prevent TimeoutError
  // retry-as-promised was causing "unknown timed out" errors under high load
  retry: {
    max: 0         // Disable retries - fail fast, don't hang
  }
};

// Create Sequelize instance
const sequelize = new Sequelize(
  dbConfig.database,
  dbConfig.username,
  dbConfig.password,
  {
    host: dbConfig.host,
    port: dbConfig.port,
    dialect: dbConfig.dialect,
    logging: dbConfig.logging,
    pool: dbConfig.pool,
    define: dbConfig.define,
    timezone: '+00:00', // Store and retrieve all timestamps in UTC
    dialectOptions: dbConfig.dialectOptions,
    retry: dbConfig.retry
  }
);

// Test database connection
const testConnection = async () => {
  try {
    await sequelize.authenticate();
    logger.info('Database connection established successfully');
    
    // Check if database is ready
    await sequelize.query('SELECT 1');
    logger.info('Database is ready for queries');
    
    return true;
  } catch (error) {
    logger.error('Unable to connect to database:', error);
    return false;
  }
};

// Graceful shutdown
const closeConnection = async () => {
  try {
    await sequelize.close();
    logger.info('Database connection closed successfully');
  } catch (error) {
    logger.error('Error closing database connection:', error);
  }
};

// Export sequelize instance directly for models
module.exports = sequelize;
module.exports.sequelize = sequelize;
module.exports.Sequelize = Sequelize;
module.exports.testConnection = testConnection;
module.exports.closeConnection = closeConnection;
