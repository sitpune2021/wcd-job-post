/**
 * Permission Sync Script
 * 
 * This script syncs all registered permissions to the database.
 * It can be run manually or automatically on server startup.
 * 
 * Usage:
 *   node scripts/syncPermissions.js
 * 
 * Or call programmatically:
 *   require('./scripts/syncPermissions').syncAllPermissions();
 */

const { syncToDatabase } = require('../utils/permissionRegistry');
const db = require('../models');
const logger = require('../config/logger');

/**
 * Sync all permissions to database
 */
const syncAllPermissions = async () => {
  try {
    logger.info('Starting permission sync...');
    
    const result = await syncToDatabase(db.sequelize);
    
    logger.info('Permission sync completed successfully', {
      created: result.created,
      updated: result.updated,
      total: result.total
    });
    
    console.log(' Permission sync completed:');
    console.log(`   Created: ${result.created}`);
    console.log(`   Updated: ${result.updated}`);
    console.log(`   Total: ${result.total}`);
    
    return result;
  } catch (error) {
    logger.error('Permission sync failed:', error);
    console.error('❌ Permission sync failed:', error.message);
    throw error;
  }
};

/**
 * Run sync if this file is executed directly
 */
if (require.main === module) {
  syncAllPermissions()
    .then(() => {
      console.log('Permission sync completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Permission sync failed:', error);
      process.exit(1);
    });
}

module.exports = {
  syncAllPermissions
};
