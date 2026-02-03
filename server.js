require('dotenv').config();

// Set timezone to UTC for consistent timestamp handling
process.env.TZ = 'UTC';

const app = require('./app');
const { sequelize } = require('./models');
const logger = require('./config/logger');
const { initCronJobs } = require('./cron/scheduler');

const PORT = process.env.PORT || 3001;

// Test database connection and sync tables
async function assertDatabaseConnectionOk() {
  logger.info('Checking database connection...');
  logger.info(`Connecting to database: ${process.env.DB_NAME || 'mission_shakti'}`);
  try {
    await sequelize.authenticate();
    logger.info('Database connection OK!');
    
    // Sync all models (create tables if they don't exist)
    // Use { alter: true } in development to update tables
    if (process.env.NODE_ENV === 'development') {
      logger.info('Syncing database models...');
      await sequelize.sync({ alter: false }); // Set to true to auto-update schema
      logger.info('Database models synced!');
    }
  } catch (error) {
    logger.error('Unable to connect to the database:');
    logger.error(error.message);
    process.exit(1);
  }
}

// Start server
async function init() {
  await assertDatabaseConnectionOk();

  // Initialize cron jobs for scheduled tasks
  initCronJobs();

  app.listen(PORT, '0.0.0.0', () => {
    logger.info(`Server running on port ${PORT}`);
    logger.info(`Environment: ${process.env.NODE_ENV}`);
  });
}

init().catch(err => {
  logger.error('Failed to start server:');
  logger.error(err);
  process.exit(1);
});
