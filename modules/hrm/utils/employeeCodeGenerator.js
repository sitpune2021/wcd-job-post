const db = require('../../../models');
const logger = require('../../../config/logger');

/**
 * Generate next employee code using existing EmployeeMaster records
 * Format: EMP0001, EMP0002, etc.
 * Simple approach: Find the highest existing code and increment
 */
async function generateEmployeeCode() {
  try {
    // Find the highest existing employee code
    const lastEmployee = await db.EmployeeMaster.findOne({
      attributes: ['employee_code'],
      where: {
        employee_code: {
          [db.Sequelize.Op.like]: 'EMP%'
        }
      },
      order: [['employee_code', 'DESC']],
      limit: 1
    });

    let nextSequence = 1;
    
    if (lastEmployee && lastEmployee.employee_code) {
      // Extract numeric part from EMP0001 format
      const numericPart = lastEmployee.employee_code.replace('EMP', '');
      const lastSequence = parseInt(numericPart, 10);
      
      if (!isNaN(lastSequence)) {
        nextSequence = lastSequence + 1;
      }
    }
    
    // Format as EMP0001, EMP0002, etc. (4 digits with leading zeros)
    const employeeCode = `EMP${String(nextSequence).padStart(4, '0')}`;
    
    logger.info('Generated employee code', { 
      employeeCode, 
      sequence: nextSequence 
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
