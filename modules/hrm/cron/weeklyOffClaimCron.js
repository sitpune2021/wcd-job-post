/**
 * Weekly Off Claim Cron Jobs
 * Handles automatic entitlement generation, auto-approval, and expiry
 */

const weeklyOffClaimService = require('../services/weeklyOffClaimService');
const logger = require('../../../config/logger');

/**
 * Generate weekly off entitlements for all active employees
 * Should run: Every Sunday at 11:59 PM or Monday at 12:01 AM
 */
async function generateWeeklyEntitlementsJob() {
  try {
    logger.info('Starting weekly off entitlement generation job');
    const result = await weeklyOffClaimService.generateWeeklyOffEntitlements();
    logger.info('Weekly off entitlement generation job completed', {
      created: result.created,
      skipped: result.skipped,
      total: result.total
    });
    return result;
  } catch (error) {
    logger.error('Weekly off entitlement generation job failed:', error);
    throw error;
  }
}

/**
 * Auto-approve weekly off claims pending for more than 24 hours
 * Should run: Every hour
 */
async function autoApproveWeeklyOffClaimsJob() {
  try {
    logger.info('Starting auto-approval job for weekly off claims');
    const result = await weeklyOffClaimService.autoApproveWeeklyOffClaims();
    logger.info('Weekly off claims auto-approval job completed', {
      approved: result.approved,
      total: result.total
    });
    return result;
  } catch (error) {
    logger.error('Weekly off claims auto-approval job failed:', error);
    throw error;
  }
}

/**
 * Expire unclaimed weekly off entitlements from previous month
 * Should run: Every day at 12:05 AM (after midnight)
 */
async function expireMonthlyWeeklyOffClaimsJob() {
  try {
    logger.info('Starting monthly expiry job for weekly off claims');
    const result = await weeklyOffClaimService.expireMonthlyWeeklyOffClaims();
    logger.info('Weekly off claims monthly expiry job completed', {
      expired: result.expired,
      monthCode: result.monthCode
    });
    return result;
  } catch (error) {
    logger.error('Weekly off claims monthly expiry job failed:', error);
    throw error;
  }
}

module.exports = {
  generateWeeklyEntitlementsJob,
  autoApproveWeeklyOffClaimsJob,
  expireMonthlyWeeklyOffClaimsJob
};
