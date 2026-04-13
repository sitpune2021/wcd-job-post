/**
 * Middleware to automatically format all date fields in API responses to IST
 * Handles both TIMESTAMPTZ and naive TIMESTAMP columns consistently
 */
const { formatDateTimeIST } = require('../utils/dateUtils');

// Fields that should be formatted as dates only (no time)
const DATE_ONLY_FIELDS = [
  'dob', 'date_of_birth', 'start_date', 'end_date', 
  'opening_date', 'closing_date'
];

// Fields that should be formatted as date+time
const DATE_TIME_FIELDS = [
  'created_at', 'updated_at', 'deleted_at', 'submitted_at',
  'verified_at', 'last_login_at', 'locked_until', 'expires_at',
  'password_reset_token_expires_at', 'activation_token_expires_at',
  'email_verified_at', 'paid_at', 'sent_at', 'started_at',
  'completed_at', 'generated_at', 'checked_at', 'attempt_time',
  'revoked_at', 'closed_at', 'scheduled_date', 'entered_at',
  'exited_at', 'eligibility_checked_at', 'selected_at'
];

/**
 * Recursively format dates in an object
 */
function formatDatesRecursive(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  
  if (obj instanceof Date) {
    return formatDateTimeIST(obj);
  }
  
  if (Array.isArray(obj)) {
    return obj.map(formatDatesRecursive);
  }
  
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) {
      result[key] = value;
      continue;
    }
    
    // Check if this is a date field
    const isDateField = DATE_ONLY_FIELDS.some(field => key.includes(field)) ||
                       DATE_TIME_FIELDS.some(field => key.includes(field));
    
    if (isDateField) {
      if (DATE_ONLY_FIELDS.some(field => key.includes(field))) {
        // Date only field
        result[key] = formatDateTimeIST(value).date;
      } else {
        // Date+time field
        result[key] = formatDateTimeIST(value);
      }
    } else {
      result[key] = formatDatesRecursive(value);
    }
  }
  
  return result;
}

/**
 * Express middleware to format dates in responses
 */
const formatDatesInResponse = (req, res, next) => {
  const originalJson = res.json;
  
  res.json = function(data) {
    // Format dates in the response data
    const formatted = formatDatesRecursive(data);
    return originalJson.call(this, formatted);
  };
  
  next();
};

module.exports = formatDatesInResponse;
