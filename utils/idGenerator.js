const { sequelize } = require('../config/db');
const logger = require('../config/logger');

// ============================================================================
// ID GENERATOR UTILITY
// ============================================================================
// Purpose: Generate unique sequential IDs for applicants, applications, etc.
// Format: YY-MM-XXXXX (e.g., 25-12-00001)
// 
// How it works:
// 1. Uses ms_sequence_counters table to track last used sequence per month
// 2. Atomically increments sequence using INSERT...ON CONFLICT (upsert)
// 3. Resets sequence to 1 when month changes
// 4. Thread-safe due to PostgreSQL's atomic upsert operation
// ============================================================================

// ==================== CORE ID GENERATION ====================
// Main function that generates unique IDs atomically
// Uses upsert pattern to handle concurrent requests safely

const generateUniqueId = async (counterType) => {
  try {
    // Get current year-month in YY-MM format
    const now = new Date();
    const yearMonth = now.toISOString().slice(2, 4) + '-' + 
                      String(now.getMonth() + 1).padStart(2, '0');
    
    // Atomic upsert: Insert new counter or increment existing
    // This is thread-safe - PostgreSQL handles concurrent access
    const [result] = await sequelize.query(
      `INSERT INTO ms_sequence_counters (counter_type, year_month, last_sequence, created_at, updated_at)
       VALUES (:counterType, :yearMonth, 1, NOW(), NOW())
       ON CONFLICT (counter_type) 
       DO UPDATE SET 
         last_sequence = CASE 
           WHEN ms_sequence_counters.year_month = :yearMonth 
           THEN ms_sequence_counters.last_sequence + 1
           ELSE 1
         END,
         year_month = :yearMonth,
         updated_at = NOW()
       RETURNING last_sequence`,
      {
        replacements: { 
          counterType: counterType.toUpperCase(),
          yearMonth 
        }
      }
    );

    if (!result || result.length === 0) {
      throw new Error('Failed to generate unique ID - no result returned');
    }

    const sequence = result[0].last_sequence;
    const uniqueId = `${yearMonth}-${String(sequence).padStart(5, '0')}`;

    logger.info(`Generated unique ID: ${uniqueId} for ${counterType}`);
    return uniqueId;
  } catch (error) {
    logger.error(`Error generating unique ID for ${counterType}:`, error);
    throw error;
  }
};

/**
 * Generate applicant number
 * @returns {Promise<string>} - Format: YY-MM-XXXXX
 */
const generateApplicantNo = async () => {
  return await generateUniqueId('APPLICANT');
};

/**
 * Generate application number
 * @returns {Promise<string>} - Format: YY-MM-XXXXX
 */
const generateApplicationNo = async () => {
  return await generateUniqueId('APPLICATION');
};

/**
 * Get current sequence for a counter type
 * @param {string} counterType - Type of counter
 * @returns {Promise<number>} - Current sequence number
 */
const getCurrentSequence = async (counterType) => {
  try {
    const yearMonth = new Date().toISOString().slice(2, 7).replace('-', '-');
    
    const [result] = await sequelize.query(
      `SELECT last_sequence FROM ms_sequence_counters 
       WHERE counter_type = :counterType AND year_month = :yearMonth`,
      {
        replacements: { 
          counterType: counterType.toUpperCase(),
          yearMonth 
        },
        type: sequelize.QueryTypes.SELECT
      }
    );

    return result ? result.last_sequence : 0;
  } catch (error) {
    logger.error(`Error getting current sequence for ${counterType}:`, error);
    return 0;
  }
};

/**
 * Reset sequence for new month (admin function)
 * @param {string} counterType - Type of counter
 * @returns {Promise<boolean>}
 */
const resetSequence = async (counterType) => {
  try {
    const yearMonth = new Date().toISOString().slice(2, 7).replace('-', '-');
    
    await sequelize.query(
      `UPDATE ms_sequence_counters 
       SET last_sequence = 0, updated_at = NOW()
       WHERE counter_type = :counterType AND year_month = :yearMonth`,
      {
        replacements: { 
          counterType: counterType.toUpperCase(),
          yearMonth 
        }
      }
    );

    logger.info(`Sequence reset for ${counterType}`);
    return true;
  } catch (error) {
    logger.error(`Error resetting sequence for ${counterType}:`, error);
    return false;
  }
};

/**
 * Validate ID format
 * @param {string} id - ID to validate
 * @returns {boolean}
 */
const validateIdFormat = (id) => {
  // Format: YY-MM-XXXXX (e.g., 25-08-00001)
  const regex = /^\d{2}-\d{2}-\d{5}$/;
  return regex.test(id);
};

/**
 * Parse ID to get year, month, and sequence
 * @param {string} id - ID to parse
 * @returns {Object} - {year, month, sequence}
 */
const parseId = (id) => {
  if (!validateIdFormat(id)) {
    throw new Error('Invalid ID format');
  }

  const [year, month, sequence] = id.split('-');
  return {
    year: parseInt(`20${year}`),
    month: parseInt(month),
    sequence: parseInt(sequence)
  };
};

module.exports = {
  generateUniqueId,
  generateApplicantNo,
  generateApplicationNo,
  getCurrentSequence,
  resetSequence,
  validateIdFormat,
  parseId
};
