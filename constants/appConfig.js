// ============================================================================
// APPLICATION CONFIGURATION CONSTANTS
// ============================================================================
// Purpose: Centralized application-wide configuration constants
// These are compile-time constants, not runtime environment variables
// ============================================================================

const APP_CONFIG = {
  // ==================== APPLICATION INFO ====================
  APP_NAME: 'Mission Shakti',
  APP_VERSION: '1.0.0',
  API_VERSION: 'v1',
  
  // ==================== PAGINATION DEFAULTS ====================
  PAGINATION: {
    DEFAULT_PAGE: 1,
    DEFAULT_LIMIT: 10,
    MAX_LIMIT: 100,
    DEFAULT_SORT_ORDER: 'DESC'
  },
  
  // ==================== FILE UPLOAD LIMITS ====================
  FILE_UPLOAD: {
    MAX_FILE_SIZE: 5 * 1024 * 1024,  // 5MB
    MAX_PHOTO_SIZE: 500 * 1024,       // 500KB for passport photo
    MAX_SIGNATURE_SIZE: 200 * 1024,   // 200KB for signature
    ALLOWED_IMAGE_TYPES: ['image/jpeg', 'image/png', 'image/jpg'],
    ALLOWED_DOC_TYPES: ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg']
  },
  
  // ==================== AUTH SETTINGS ====================
  AUTH: {
    MAX_LOGIN_ATTEMPTS: 5,
    LOCKOUT_DURATION_MINUTES: 30,
    OTP_EXPIRY_MINUTES: 10,
    PASSWORD_MIN_LENGTH: 8,
    SESSION_TIMEOUT_HOURS: 24
  },
  
  // ==================== APPLICATION STATUS ====================
  APPLICATION_STATUS: {
    DRAFT: 'DRAFT',
    SUBMITTED: 'SUBMITTED',
    UNDER_REVIEW: 'UNDER_REVIEW',
    ELIGIBLE: 'ELIGIBLE',
    NOT_ELIGIBLE: 'NOT_ELIGIBLE',
    SELECTED: 'SELECTED',
    REJECTED: 'REJECTED',
    WITHDRAWN: 'WITHDRAWN'
  },
  
  // ==================== DOCUMENT VERIFICATION STATUS ====================
  DOCUMENT_STATUS: {
    PENDING: 'PENDING',
    VERIFIED: 'VERIFIED',
    REJECTED: 'REJECTED'
  },
  
  // ==================== USER TYPES ====================
  USER_TYPES: {
    ADMIN: 'admin',
    APPLICANT: 'applicant',
    SYSTEM: 'system'
  },
  
  // ==================== GENDER OPTIONS ====================
  GENDER: {
    MALE: 'Male',
    FEMALE: 'Female',
    OTHER: 'Other'
  },
  
  // ==================== MARITAL STATUS ====================
  MARITAL_STATUS: {
    SINGLE: 'Single',
    MARRIED: 'Married',
    DIVORCED: 'Divorced',
    WIDOWED: 'Widowed'
  },
  
  // ==================== EMPLOYER TYPES ====================
  EMPLOYER_TYPES: {
    GOVERNMENT: 'Government',
    PRIVATE: 'Private',
    NGO: 'NGO',
    SELF_EMPLOYED: 'Self-Employed'
  },
  
  // ==================== MERIT CALCULATION CRITERIA ====================
  MERIT_CRITERIA: {
    AGE_PREFERENCE: 'OLDER', // Options: 'YOUNGER' or 'OLDER'
  }
};

// Application status flow (valid transitions)
const STATUS_TRANSITIONS = {
  [APP_CONFIG.APPLICATION_STATUS.DRAFT]: [
    APP_CONFIG.APPLICATION_STATUS.SUBMITTED,
    APP_CONFIG.APPLICATION_STATUS.WITHDRAWN
  ],
  [APP_CONFIG.APPLICATION_STATUS.SUBMITTED]: [
    APP_CONFIG.APPLICATION_STATUS.UNDER_REVIEW,
    APP_CONFIG.APPLICATION_STATUS.WITHDRAWN
  ],
  [APP_CONFIG.APPLICATION_STATUS.UNDER_REVIEW]: [
    APP_CONFIG.APPLICATION_STATUS.ELIGIBLE,
    APP_CONFIG.APPLICATION_STATUS.NOT_ELIGIBLE
  ],
  [APP_CONFIG.APPLICATION_STATUS.ELIGIBLE]: [
    APP_CONFIG.APPLICATION_STATUS.SELECTED,
    APP_CONFIG.APPLICATION_STATUS.REJECTED
  ],
  [APP_CONFIG.APPLICATION_STATUS.NOT_ELIGIBLE]: [],
  [APP_CONFIG.APPLICATION_STATUS.SELECTED]: [],
  [APP_CONFIG.APPLICATION_STATUS.REJECTED]: [],
  [APP_CONFIG.APPLICATION_STATUS.WITHDRAWN]: []
};

module.exports = {
  APP_CONFIG,
  STATUS_TRANSITIONS
};
