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

const DEFAULT_EMAIL_CRON = '*/5 * * * *';
const DEFAULT_POST_CLOSE_CRON = '5 0 * * *'; // Daily at 00:05 AM IST

function resolveAllotmentCron(rawValue) {
  if (!rawValue) return DEFAULT_EMAIL_CRON;

  // If numeric minutes are provided (e.g., 120), convert to cron
  const minutes = Number(rawValue);
  if (!Number.isNaN(minutes) && minutes > 0) {
    if (minutes < 60) {
      return `*/${minutes} * * * *`;
    }
    if (minutes % 60 === 0) {
      const hours = minutes / 60;
      return `0 */${hours} * * *`;
    }
    logger.warn(`CRON: ALLOTMENT_EMAIL_CRON=${rawValue} not supported (must be <60 or divisible by 60). Using default.`);
    return DEFAULT_EMAIL_CRON;
  }

  // Otherwise expect a cron expression
  return rawValue;
}

function resolvePostCloseCron(rawValue) {
  if (!rawValue) return DEFAULT_POST_CLOSE_CRON;
  
  // Validate cron expression
  if (cron.validate(rawValue)) {
    return rawValue;
  }
  
  logger.warn(`CRON: Invalid POST_CLOSE_CRON value (${rawValue}); using default ${DEFAULT_POST_CLOSE_CRON}`);
  return DEFAULT_POST_CLOSE_CRON;
}

/**
 * Initialize all cron jobs
 */
function initCronJobs() {
  logger.info('CRON: Initializing scheduled jobs...');

  const rawAllotmentCron = process.env.ALLOTMENT_EMAIL_CRON;
  const allotmentEmailCron = resolveAllotmentCron(rawAllotmentCron);
  const resolvedAllotmentCron = cron.validate(allotmentEmailCron) ? allotmentEmailCron : DEFAULT_EMAIL_CRON;
  if (!cron.validate(allotmentEmailCron)) {
    logger.warn(`CRON: Invalid ALLOTMENT_EMAIL_CRON value (${rawAllotmentCron}); using ${DEFAULT_EMAIL_CRON}`);
  }
  
  // Get post close cron schedule from environment or use default
  const rawPostCloseCron = process.env.POST_CLOSE_CRON;
  const postCloseCron = resolvePostCloseCron(rawPostCloseCron);
  
  // Run daily (default 00:05 AM IST) to close expired posts
  // Cron expression: minute hour day-of-month month day-of-week
  cron.schedule(postCloseCron, async () => {
    logger.info('CRON: Running post closure check...');
    try {
      await cronService.closeExpiredPosts();
    } catch (error) {
      logger.error('CRON: Post closure failed:', error);
    }
  }, {
    scheduled: true,
    timezone: 'Asia/Kolkata'
  });
  
  // Run on configured interval to process scheduled allotment emails
  // This checks for emails scheduled to be sent and sends them
  cron.schedule(resolvedAllotmentCron, async () => {
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
  logger.info(`CRON: - Post auto-close: ${postCloseCron} (IST)`);
  logger.info(`CRON: - Email processing: ${resolvedAllotmentCron} (IST)`);
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
