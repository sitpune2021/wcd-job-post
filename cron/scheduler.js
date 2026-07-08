/**
 * Cron Scheduler
 * Sets up scheduled tasks using node-cron
 * 
 * Usage: Import and call initCronJobs() from server.js after DB connection
 */
const cron = require('node-cron');
const cronService = require('../services/cronService');
const allotmentEmailService = require('../services/admin/allotmentEmailService');
const { runAttendanceCronTasks } = require('../modules/hrm/cron/attendanceCronService');
const { processPendingCheckOuts } = require('../services/admin/attendanceReminderHelper');
const {
  generateWeeklyEntitlementsJob,
  autoApproveWeeklyOffClaimsJob,
  expireMonthlyWeeklyOffClaimsJob
} = require('../modules/hrm/cron/weeklyOffClaimCron');
const logger = require('../config/logger');

const DEFAULT_EMAIL_CRON = '*/5 * * * *';
const DEFAULT_POST_CLOSE_CRON = '*/5 * * * *'; // Synchronize drive windows every five minutes

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
  
  // Synchronize scheduled recruitment registration/application windows.
  // Cron expression: minute hour day-of-month month day-of-week
  cron.schedule(postCloseCron, async () => {
    logger.info('CRON: Synchronizing recruitment drive schedule...');
    try {
      await cronService.closeExpiredRecruitmentDrives();
    } catch (error) {
      logger.error('CRON: Recruitment drive schedule sync failed:', error);
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
  
  // Run daily at 11:59 PM IST to process attendance tasks
  // This marks absent employees and generates summaries
  cron.schedule('59 23 * * *', async () => {
    logger.info('CRON: Running attendance cron tasks...');
    try {
      await runAttendanceCronTasks();
    } catch (error) {
      logger.error('CRON: Attendance cron tasks failed:', error);
    }
  }, {
    scheduled: true,
    timezone: 'Asia/Kolkata'
  });
  
  // Run every hour to check for employees who haven't checked out after 8+ hours
  // This sends reminder emails to scheme/hub admins
  cron.schedule('0 * * * *', async () => {
    logger.info('CRON: Checking for attendance check-out reminders...');
    try {
      const result = await processPendingCheckOuts();
      if (result.disabled) {
        logger.info('CRON: Attendance reminders disabled');
      } else {
        logger.info(`CRON: Attendance reminders processed - Employees: ${result.processed}, Reminders sent: ${result.remindersSent}, Errors: ${result.errors.length}`);
      }
    } catch (error) {
      logger.error('CRON: Attendance reminder check failed:', error);
    }
  }, {
    scheduled: true,
    timezone: 'Asia/Kolkata'
  });
  
  // Run on 1st of every month at 12:01 AM IST to generate monthly weekly off entitlements
  cron.schedule('1 0 1 * *', async () => {
    logger.info('CRON: Generating monthly weekly off entitlements...');
    try {
      await generateWeeklyEntitlementsJob();
    } catch (error) {
      logger.error('CRON: Weekly off entitlement generation failed:', error);
    }
  }, {
    scheduled: true,
    timezone: 'Asia/Kolkata'
  });

  // Run every hour so claims are auto-approved soon after crossing the 24-hour threshold
  cron.schedule('0 * * * *', async () => {
    logger.info('CRON: Auto-approving pending weekly off claims...');
    try {
      await autoApproveWeeklyOffClaimsJob();
    } catch (error) {
      logger.error('CRON: Weekly off auto-approval failed:', error);
    }
  }, {
    scheduled: true,
    timezone: 'Asia/Kolkata'
  });

  // Run daily at 12:05 AM IST to expire unclaimed weekly off entitlements from previous month
  cron.schedule('5 0 * * *', async () => {
    logger.info('CRON: Expiring monthly weekly off claims...');
    try {
      await expireMonthlyWeeklyOffClaimsJob();
    } catch (error) {
      logger.error('CRON: Monthly weekly off expiry failed:', error);
    }
  }, {
    scheduled: true,
    timezone: 'Asia/Kolkata'
  });

  logger.info('CRON: Scheduled jobs initialized');
  logger.info(`CRON: - Recruitment drive schedule sync: ${postCloseCron} (IST)`);
  logger.info(`CRON: - Email processing: ${resolvedAllotmentCron} (IST)`);
  logger.info('CRON: - Attendance processing: 59 23 * * * (11:59 PM IST)');
  logger.info('CRON: - Attendance reminders: 0 * * * * (Every hour, IST)');
  logger.info('CRON: - Weekly off entitlements: 1 0 1 * * (1st of month, 12:01 AM IST)');
  logger.info('CRON: - Weekly off auto-approval: 0 * * * * (Every hour, IST)');
  logger.info('CRON: - Weekly off monthly expiry: 5 0 * * * (Daily 12:05 AM IST)');
}

/**
 * Run cron tasks manually (for testing or manual trigger)
 */
async function runManually() {
  return await cronService.runScheduledTasks();
}

/**
 * Manually trigger attendance reminder check (for testing)
 */
async function runAttendanceReminders() {
  logger.info('MANUAL: Running attendance reminder check...');
  try {
    const result = await processPendingCheckOuts();
    if (result.disabled) {
      logger.info('MANUAL: Attendance reminders disabled');
    } else {
      logger.info(`MANUAL: Attendance reminders processed - Employees: ${result.processed}, Reminders sent: ${result.remindersSent}, Errors: ${result.errors.length}`);
    }
    return result;
  } catch (error) {
    logger.error('MANUAL: Attendance reminder check failed:', error);
    throw error;
  }
}

module.exports = {
  initCronJobs,
  runManually,
  runAttendanceReminders
};
