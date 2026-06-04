const db = require('../../../models');
const logger = require('../../../config/logger');

/**
 * Generate next employee code using existing EmployeeMaster records
 * New Format: MSCE-27MH-0001, MSCE-27MH-0002, etc.
 * Backward Compatible: Still supports existing EMPxxxx codes
 */
async function generateEmployeeCode(transaction = null) {
  try {
    // Get current timestamp to create a unique sequence
    const timestamp = Date.now();
    const timeSequence = timestamp % 9000 + 1000; // Generate between 1000-9999
    
    const employeeCode = `MSCE-27MH-${String(timeSequence).padStart(4, '0')}`;
    
    logger.info('Generated employee code using timestamp approach', {
      employeeCode,
      sequence: timeSequence
    });
    
    return employeeCode;
    
  } catch (error) {
    logger.error('Error generating employee code:', error);
    throw error;
  }
}

module.exports = {
  generateEmployeeCode
};
