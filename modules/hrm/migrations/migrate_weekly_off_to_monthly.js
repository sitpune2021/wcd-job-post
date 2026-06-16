/**
 * Migration Script: Weekly Off System - 7-Day Window to Monthly Quota
 * 
 * This script migrates the weekly off system from a 7-day rolling window 
 * to a monthly quota system (4 claims per month per employee).
 * 
 * Changes:
 * - Remove: entitlement_week_start, entitlement_week_end columns
 * - Add: monthly_quota column (default: 4)
 * - Update: unique constraint from (employee_id, entitlement_week_start, entitlement_week_end) 
 *           to (employee_id, entitlement_month, claim_status, claimed_off_date)
 * - Update: claim_status validation to remove 'ELIGIBLE' and 'USED'
 * 
 * IMPORTANT: This is a production migration. Test thoroughly before running in production.
 */

const db = require('../../../models');
const logger = require('../../../config/logger');

async function migrateWeeklyOffToMonthly() {
  const transaction = await db.sequelize.transaction();
  
  try {
    logger.info('Starting weekly off to monthly quota migration...');
    
    // Check if columns already exist to avoid errors
    const tableInfo = await db.sequelize.query(
      "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'ms_hrm_weekly_off_claims' ORDER BY ordinal_position",
      { type: db.Sequelize.QueryTypes.SELECT, transaction }
    );
    
    const existingColumns = tableInfo.map(col => col.column_name);
    logger.info('Existing columns:', existingColumns);
    
    // Step 1: Add monthly_quota column if it doesn't exist
    if (!existingColumns.includes('monthly_quota')) {
      logger.info('Adding monthly_quota column...');
      await db.sequelize.query(
        "ALTER TABLE ms_hrm_weekly_off_claims ADD COLUMN monthly_quota INTEGER NOT NULL DEFAULT 4",
        { transaction }
      );
      logger.info('✓ monthly_quota column added');
    } else {
      logger.info('✓ monthly_quota column already exists, skipping...');
    }
    
    // Step 2: Migrate existing data - set monthly_quota to 4 for all records
    logger.info('Setting monthly_quota to 4 for existing records...');
    await db.sequelize.query(
      "UPDATE ms_hrm_weekly_off_claims SET monthly_quota = 4 WHERE monthly_quota IS NULL",
      { transaction }
    );
    logger.info('✓ Existing records updated with monthly_quota');
    
    // Step 3: Drop old unique constraint if it exists
    logger.info('Checking for old unique constraint...');
    const constraints = await db.sequelize.query(
      "SELECT constraint_name FROM information_schema.table_constraints WHERE table_name = 'ms_hrm_weekly_off_claims' AND constraint_type = 'UNIQUE'",
      { type: db.Sequelize.QueryTypes.SELECT, transaction }
    );
    
    const oldConstraint = constraints.find(c => c.constraint_name === 'uq_weekly_off_employee_week');
    if (oldConstraint) {
      logger.info('Dropping old unique constraint uq_weekly_off_employee_week...');
      await db.sequelize.query(
        "ALTER TABLE ms_hrm_weekly_off_claims DROP CONSTRAINT uq_weekly_off_employee_week",
        { transaction }
      );
      logger.info('✓ Old unique constraint dropped');
    } else {
      logger.info('✓ Old unique constraint not found, skipping...');
    }
    
    // Step 4: Add new unique constraint if it doesn't exist
    const newConstraint = constraints.find(c => c.constraint_name === 'uq_weekly_off_employee_month_date');
    if (!newConstraint) {
      logger.info('Adding new unique constraint uq_weekly_off_employee_month_date...');
      await db.sequelize.query(
        "ALTER TABLE ms_hrm_weekly_off_claims ADD CONSTRAINT uq_weekly_off_employee_month_date UNIQUE (employee_id, entitlement_month, claim_status, claimed_off_date)",
        { transaction }
      );
      logger.info('✓ New unique constraint added');
    } else {
      logger.info('✓ New unique constraint already exists, skipping...');
    }
    
    // Step 5: Remove old columns if they exist (entitlement_week_start, entitlement_week_end)
    if (existingColumns.includes('entitlement_week_start')) {
      logger.info('Dropping entitlement_week_start column...');
      await db.sequelize.query(
        "ALTER TABLE ms_hrm_weekly_off_claims DROP COLUMN entitlement_week_start",
        { transaction }
      );
      logger.info('✓ entitlement_week_start column dropped');
    } else {
      logger.info('✓ entitlement_week_start column already removed, skipping...');
    }
    
    if (existingColumns.includes('entitlement_week_end')) {
      logger.info('Dropping entitlement_week_end column...');
      await db.sequelize.query(
        "ALTER TABLE ms_hrm_weekly_off_claims DROP COLUMN entitlement_week_end",
        { transaction }
      );
      logger.info('✓ entitlement_week_end column dropped');
    } else {
      logger.info('✓ entitlement_week_end column already removed, skipping...');
    }
    
    // Step 6: Clean up claim_status values - remove 'ELIGIBLE' and 'USED' if they exist
    logger.info('Cleaning up claim_status values...');
    await db.sequelize.query(
      "UPDATE ms_hrm_weekly_off_claims SET claim_status = 'PENDING' WHERE claim_status IN ('ELIGIBLE', 'USED')",
      { transaction }
    );
    logger.info('✓ claim_status values cleaned up');
    
    // Step 7: Update index if needed
    logger.info('Checking and updating indexes...');
    const indexes = await db.sequelize.query(
      "SELECT indexname FROM pg_indexes WHERE tablename = 'ms_hrm_weekly_off_claims'",
      { type: db.Sequelize.QueryTypes.SELECT, transaction }
    );
    
    // Remove old week-based index if it exists
    const oldWeekIndex = indexes.find(i => i.indexname === 'idx_weekly_off_employee_week');
    if (oldWeekIndex) {
      logger.info('Dropping old index idx_weekly_off_employee_week...');
      await db.sequelize.query(
        "DROP INDEX idx_weekly_off_employee_week",
        { transaction }
      );
      logger.info('✓ Old index dropped');
    }
    
    await transaction.commit();
    
    logger.info('✅ Weekly off to monthly quota migration completed successfully!');
    
    // Summary
    const summary = {
      monthly_quota_added: !existingColumns.includes('monthly_quota'),
      old_constraint_dropped: !!oldConstraint,
      new_constraint_added: !newConstraint,
      old_columns_dropped: existingColumns.includes('entitlement_week_start') || existingColumns.includes('entitlement_week_end'),
      status_values_cleaned: true
    };
    
    logger.info('Migration summary:', JSON.stringify(summary, null, 2));
    
    return summary;
    
  } catch (error) {
    await transaction.rollback();
    logger.error('❌ Migration failed:', error);
    throw error;
  }
}

// Run migration if called directly
if (require.main === module) {
  migrateWeeklyOffToMonthly()
    .then(() => {
      logger.info('Migration completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('Migration failed:', error);
      process.exit(1);
    });
}

module.exports = { migrateWeeklyOffToMonthly };
