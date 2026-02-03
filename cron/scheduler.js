/**
 * Cron Scheduler
 * Sets up scheduled tasks using node-cron
 * 
 * Usage: Import and call initCronJobs() from server.js after DB connection
 */
const cron = require('node-cron');
const cronService = require('../services/cronService');
const allotmentEmailService = require('../services/admin/allotmentEmailService');
const logger = require('../config/logger');

/**
 * Initialize all cron jobs
 */
function initCronJobs() {
  logger.info('CRON: Initializing scheduled jobs...');
  
  // Run daily at 00:05 AM IST to close expired posts
  // Cron expression: minute hour day-of-month month day-of-week
  cron.schedule('5 0 * * *', async () => {
    logger.info('CRON: Running daily post closure check...');
    try {
      await cronService.closeExpiredPosts();
    } catch (error) {
      logger.error('CRON: Daily post closure failed:', error);
    }
  }, {
    scheduled: true,
    timezone: 'Asia/Kolkata'
  });
  
  // Run every 5 minutes to process scheduled allotment emails  // we use this to run corn every 5 min or the time shown here to check for emails to send
  // This checks for emails scheduled to be sent and sends them
  cron.schedule('*/5 * * * *', async () => {
    logger.info('CRON: Checking for scheduled allotment emails...');
    try {
      await allotmentEmailService.processScheduledEmails();
    } catch (error) {
      logger.error('CRON: Email processing failed:', error);
    }
  }, {
    scheduled: true,
    timezone: 'Asia/Kolkata'
  });
  
  logger.info('CRON: Scheduled jobs initialized');
  logger.info('CRON: - Post auto-close: Daily at 00:05 AM IST');
  logger.info('CRON: - Email processing: Every 5 minutes IST');
}

/**
 * Run cron tasks manually (for testing or manual trigger)
 */
async function runManually() {
  return await cronService.runScheduledTasks();
}

module.exports = {
  initCronJobs,
  runManually
};
