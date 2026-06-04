const db = require('../../../models');
const logger = require('../../../config/logger');

/**
 * Generate next employee code using existing EmployeeMaster records
 * New Format: MSCE-27MH-0001, MSCE-27MH-0002, etc.
 * Backward Compatible: Still supports existing EMPxxxx codes
 */
async function generateEmployeeCode(transaction = null) {
  const useTransaction = transaction || await db.sequelize.transaction();
  
  try {
    // Find the highest existing MSCE code
    const lastMSCEEmployee = await db.EmployeeMaster.findOne({
      attributes: ['employee_code'],
      where: {
        employee_code: {
          [db.Sequelize.Op.like]: 'MSCE-27MH-%'
        }
      },
      order: [['employee_code', 'DESC']],
      limit: 1,
      transaction: useTransaction,
      lock: true
    });

    let nextSequence = 1;
    
    if (lastMSCEEmployee && lastMSCEEmployee.employee_code) {
      // Extract numeric part from MSCE-27MH-0001 format
      const parts = lastMSCEEmployee.employee_code.split('-');
      if (parts.length === 3) {
        const numericPart = parts[2];
        const lastSequence = parseInt(numericPart, 10);
        
        if (!isNaN(lastSequence)) {
          nextSequence = lastSequence + 1;
        }
      }
    }
    
    // Format as MSCE-27MH-0001, MSCE-27MH-0002, etc. (4 digits with leading zeros)
    const employeeCode = `MSCE-27MH-${String(nextSequence).padStart(4, '0')}`;
    
    logger.info('Generated employee code', { 
      employeeCode, 
      sequence: nextSequence,
      format: 'MSCE-27MH-XXXX'
    });
    
    // Only commit if we created our own transaction
    if (!transaction) {
      await useTransaction.commit();
    }
    return employeeCode;
    
  } catch (error) {
    // Only rollback if we created our own transaction
    if (!transaction) {
      await useTransaction.rollback();
    }
    logger.error('Error generating employee code:', error);
    throw error;
  }
}

module.exports = {
  generateEmployeeCode
};
