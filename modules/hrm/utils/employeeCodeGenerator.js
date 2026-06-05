const db = require('../../../models');
const logger = require('../../../config/logger');

/**
 * Generate next employee code using existing EmployeeMaster records
 * New Format: MSCE-27MH-0001, MSCE-27MH-0002, etc.
 * Backward Compatible: Still supports existing EMPxxxx codes
 */
async function generateEmployeeCode(transaction = null) {
  try {
    const EmployeeMaster = db.EmployeeMaster;
    
    // Find the highest sequence number from existing MSCE-27MH- codes
    const lastEmployee = await EmployeeMaster.max('employee_code', {
      where: {
        employee_code: {
          [db.Sequelize.Op.like]: 'MSCE-27MH-%'
        }
      },
      transaction
    });
    
    let nextSequence = 1;
    
    if (lastEmployee) {
      // Extract sequence number from last code (e.g., MSCE-27MH-0001 -> 1)
      const lastSequence = parseInt(lastEmployee.split('-')[2]);
      if (!isNaN(lastSequence)) {
        nextSequence = lastSequence + 1;
      }
    }
    
    const employeeCode = `MSCE-27MH-${String(nextSequence).padStart(4, '0')}`;
    
    logger.info('Generated employee code using sequential approach', {
      employeeCode,
      sequence: nextSequence,
      lastEmployeeCode: lastEmployee
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
