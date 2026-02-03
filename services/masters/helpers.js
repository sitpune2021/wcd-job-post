// ============================================================================
// MASTER SERVICE HELPERS
// ============================================================================
// Purpose: Shared utility functions for all master services
// Used by: districtService, talukaService, componentService, etc.
// ============================================================================

/**
 * Helper function to localize response based on language
 * Returns Marathi value if language is 'mr' and Marathi field exists
 * @param {Object} record - Database record
 * @param {string} fieldName - Base field name (e.g., 'district_name')
 * @param {string} language - Language code ('en' or 'mr')
 * @returns {string} Localized field value
 */
const localizeField = (record, fieldName, language) => {
  const mrField = `${fieldName}_mr`;
  return language === 'mr' && record[mrField] ? record[mrField] : record[fieldName];
};

module.exports = {
  localizeField
};
