/**
 * Application Constants
 */

module.exports = {
  // User Types
  USER_TYPES: {
    APPLICANT: 'APPLICANT',
    ADMIN: 'ADMIN'
  },

  // Application Statuses
  APPLICATION_STATUS: {
    DRAFT: 'DRAFT',
    SUBMITTED: 'SUBMITTED',
    UNDER_REVIEW: 'UNDER_REVIEW',
    DOCUMENTS_VERIFIED: 'DOCUMENTS_VERIFIED',
    ELIGIBLE: 'ELIGIBLE',
    NOT_ELIGIBLE: 'NOT_ELIGIBLE',
    SHORTLISTED: 'SHORTLISTED',
    SELECTED: 'SELECTED',
    REJECTED: 'REJECTED',
    WITHDRAWN: 'WITHDRAWN'
  },

  // Document Types
  DOC_TYPES: {
    PHOTO: 'PHOTO',
    SIGNATURE: 'SIGNATURE',
    AADHAR: 'AADHAR',
    PAN: 'PAN',
    DOMICILE: 'DOMICILE',
    EDUCATION: 'EDUCATION',
    EXPERIENCE: 'EXPERIENCE',
    CASTE: 'CASTE',
    DISABILITY: 'DISABILITY'
  },

  // File Upload
  FILE_UPLOAD: {
    MAX_SIZE: 2 * 1024 * 1024, // 2MB
    ALLOWED_TYPES: ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'],
    ALLOWED_EXTENSIONS: ['.pdf', '.jpg', '.jpeg', '.png'],
    IMAGE_QUALITY: 80,
    THUMBNAIL_SIZE: { width: 200, height: 200 }
  },

  // OTP
  OTP: {
    LENGTH: 6,
    EXPIRY_MINUTES: 5,
    MAX_ATTEMPTS: 5
  },

  // Password
  PASSWORD: {
    MIN_LENGTH: 8,
    REGEX: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[a-zA-Z\d@$!%*?&]{8,}$/
  },

  // Pagination
  PAGINATION: {
    DEFAULT_PAGE: 1,
    DEFAULT_LIMIT: 10,
    MAX_LIMIT: 100
  },

  // Languages
  LANGUAGES: {
    ENGLISH: 'en',
    MARATHI: 'mr'
  },

  // Roles
  ROLES: {
    SUPER_ADMIN: 'SUPER_ADMIN',
    STATE_ADMIN: 'STATE_ADMIN',
    POST_MANAGER: 'POST_MANAGER',
    APP_REVIEWER: 'APP_REVIEWER',
    REPORT_VIEWER: 'REPORT_VIEWER'
  },

  // Permission Modules
  PERMISSION_MODULES: {
    USERS: 'users',
    ROLES: 'roles',
    POSTS: 'posts',
    APPLICATIONS: 'applications',
    APPLICANTS: 'applicants',
    ELIGIBILITY: 'eligibility',
    MERIT: 'merit',
    REPORTS: 'reports',
    ANALYTICS: 'analytics',
    MASTERS: 'masters',
    AUDIT: 'audit',
    NOTIFICATIONS: 'notifications'
  },

  // Audit Actions
  AUDIT_ACTIONS: {
    CREATE: 'CREATE',
    UPDATE: 'UPDATE',
    DELETE: 'DELETE',
    LOGIN: 'LOGIN',
    LOGOUT: 'LOGOUT',
    VIEW: 'VIEW',
    EXPORT: 'EXPORT',
    APPROVE: 'APPROVE',
    REJECT: 'REJECT',
    SUBMIT: 'SUBMIT',
    WITHDRAW: 'WITHDRAW'
  },

  // Gender
  GENDER: {
    MALE: 'MALE',
    FEMALE: 'FEMALE',
    OTHER: 'OTHER'
  },

  // Category
  CATEGORY: {
    GENERAL: 'GENERAL',
    OBC: 'OBC',
    SC: 'SC',
    ST: 'ST',
    NT: 'NT',
    VJ: 'VJ',
    SBC: 'SBC'
  },

  // Qualification Levels
  QUALIFICATION_LEVELS: {
    SSC: 'SSC',
    HSC: 'HSC',
    DIPLOMA: 'DIPLOMA',
    GRADUATE: 'GRADUATE',
    POST_GRADUATE: 'POST_GRADUATE',
    PHD: 'PHD'
  },

  // Profile Completion Weights
  PROFILE_WEIGHTS: {
    PERSONAL: 20,
    ADDRESS: 15,
    EDUCATION: 20,
    EXPERIENCE: 15,
    DOCUMENTS: 30
  }
};
