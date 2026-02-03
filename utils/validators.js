const Joi = require('joi');
const { PASSWORD, OTP } = require('./constants');

/**
 * Common Validation Schemas
 */

// Email validation
const email = Joi.string().email().required().messages({
  'string.email': 'Invalid email address',
  'any.required': 'Email is required'
});

// Password validation
const password = Joi.string()
  .min(PASSWORD.MIN_LENGTH)
  .pattern(PASSWORD.REGEX)
  .required()
  .messages({
    'string.min': `Password must be at least ${PASSWORD.MIN_LENGTH} characters`,
    'string.pattern.base': 'Password must contain at least one uppercase letter, one lowercase letter, and one number',
    'any.required': 'Password is required'
  });

// Mobile number validation
const mobile = Joi.string()
  .pattern(/^[6-9]\d{9}$/)
  .messages({
    'string.pattern.base': 'Invalid mobile number. Must be 10 digits starting with 6-9'
  });

// OTP validation
const otp = Joi.string()
  .length(OTP.LENGTH)
  .pattern(/^\d+$/)
  .required()
  .messages({
    'string.length': `OTP must be ${OTP.LENGTH} digits`,
    'string.pattern.base': 'OTP must contain only numbers',
    'any.required': 'OTP is required'
  });

// ID validation
const id = Joi.number().integer().positive().required().messages({
  'number.base': 'Invalid ID',
  'number.positive': 'ID must be positive',
  'any.required': 'ID is required'
});

// Pagination
const pagination = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(10)
});

// Language
const language = Joi.string().valid('en', 'mr').default('en');

/**
 * Auth Schemas
 */
const authSchemas = {
  // Applicant registration
  applicantRegister: Joi.object({
    email: email,
    otp: otp,
    password: password,
    full_name: Joi.string().min(2).max(100).required().messages({
      'string.min': 'Name must be at least 2 characters',
      'string.max': 'Name must not exceed 100 characters',
      'any.required': 'Full name is required'
    })
  }),

  // Applicant login
  applicantLogin: Joi.object({
    email: email,
    password: password
  }),

  // Admin login
  adminLogin: Joi.object({
    username: Joi.string().min(3).max(50).required().messages({
      'string.min': 'Username must be at least 3 characters',
      'any.required': 'Username is required'
    }),
    password: password
  }),

  // Send OTP
  sendOtp: Joi.object({
    email: email
  }),

  // Reset password
  resetPassword: Joi.object({
    email: email,
    otp: otp,
    new_password: password
  }),

  // Change password
  changePassword: Joi.object({
    current_password: password,
    new_password: password
  })
};

/**
 * Profile Schemas
 */
const profileSchemas = {
  // Personal details
  personal: Joi.object({
    full_name: Joi.string().min(2).max(100).required(),
    dob: Joi.date().max('now').required().messages({
      'date.max': 'Date of birth cannot be in the future'
    }),
    // Match model-level validation: 'Male' | 'Female' | 'Other'
    gender: Joi.string().valid('Male', 'Female', 'Other').required(),
    // Category is ignored; strip if sent
    category_id: Joi.any().strip(),
    domicile_maharashtra: Joi.boolean().required(),
    aadhar_no: Joi.string().pattern(/^\d{12}$/).messages({
      'string.pattern.base': 'Aadhar number must be 12 digits'
    }),
    mobile_no: mobile.optional(),
    // PAN temporarily disabled; accept and strip if sent
    pan_no: Joi.any().strip()
  }),

  // Address
  address: Joi.object({
    address_line: Joi.string().min(10).max(500).required(),
    address_line2: Joi.string().max(500),
    district_id: id,
    taluka_id: id,
    pincode: Joi.string().pattern(/^\d{6}$/).required().messages({
      'string.pattern.base': 'Pincode must be 6 digits'
    }),
    permanent_address_same: Joi.boolean().default(false),
    permanent_address_line: Joi.string().min(10).max(500).
      when('permanent_address_same', { is: true, then: Joi.optional(), otherwise: Joi.required() }),
    permanent_address_line2: Joi.string().max(500),
    permanent_district_id: id.when('permanent_address_same', { is: true, then: Joi.optional(), otherwise: Joi.required() }),
    permanent_taluka_id: id.when('permanent_address_same', { is: true, then: Joi.optional(), otherwise: Joi.required() }),
    permanent_pincode: Joi.string().pattern(/^\d{6}$/).
      when('permanent_address_same', { is: true, then: Joi.optional(), otherwise: Joi.required() }).messages({
        'string.pattern.base': 'Permanent pincode must be 6 digits'
      })
  }),

  // Education
  education: Joi.object({
    qualification_level: Joi.string().valid('SSC', 'HSC', 'DIPLOMA', 'GRADUATE', 'POST_GRADUATE', 'PHD').required(),
    degree_name: Joi.string().max(100).required(),
    specialization: Joi.string().max(100),
    university_board: Joi.string().max(100).required(),
    passing_year: Joi.number().integer().min(1950).max(new Date().getFullYear()).required(),
    percentage: Joi.number().min(0).max(100).required()
  }),

  // Experience
  experience: Joi.object({
    organization_name: Joi.string().max(200).required(),
    designation: Joi.string().max(100).required(),
    work_domain: Joi.string().max(100),
    start_date: Joi.date().max('now').required(),
    end_date: Joi.date().min(Joi.ref('start_date')).when('is_current', {
      is: false,
      then: Joi.required()
    }),
    is_current: Joi.boolean().default(false)
  })
};

/**
 * Master Data Schemas
 */
const masterSchemas = {
  // District
  district: Joi.object({
    district_name: Joi.string().min(2).max(100).required(),
    district_name_mr: Joi.string().min(2).max(100),
    is_active: Joi.boolean().default(true)
  }),

  // Taluka
  taluka: Joi.object({
    taluka_name: Joi.string().min(2).max(100).required(),
    taluka_name_mr: Joi.string().min(2).max(100),
    district_id: id,
    is_active: Joi.boolean().default(true)
  })
};

/**
 * Admin Schemas
 */
const adminSchemas = {
  // Create user
  createUser: Joi.object({
    username: Joi.string().min(3).max(50).required(),
    email: email,
    full_name: Joi.string().min(2).max(100).required(),
    mobile_no: mobile,
    role_id: id
  }),

  // Update user
  updateUser: Joi.object({
    email: email.optional(),
    full_name: Joi.string().min(2).max(100),
    mobile_no: mobile.optional(),
    role_id: id.optional(),
    is_active: Joi.boolean()
  }),

  // Create role
  createRole: Joi.object({
    role_name: Joi.string().min(2).max(100).required(),
    role_code: Joi.string().min(2).max(50).uppercase().required(),
    description: Joi.string().max(500)
  }),

  // Assign permissions to role
  assignPermissions: Joi.object({
    permission_ids: Joi.array().items(id).min(1).required()
  })
};

/**
 * Post Schemas
 */
const postSchemas = {
  // Create/Update post
  post: Joi.object({
    post_name: Joi.string().min(5).max(200).required(),
    post_name_mr: Joi.string().min(5).max(200),
    description: Joi.string().max(2000),
    description_mr: Joi.string().max(2000),
    min_qualification: Joi.string().max(100),
    min_experience_months: Joi.number().integer().min(0),
    required_domains: Joi.string().max(500),
    min_age: Joi.number().integer().min(18).max(65),
    max_age: Joi.number().integer().min(18).max(65).greater(Joi.ref('min_age')),
    opening_date: Joi.date().required(),
    closing_date: Joi.date().greater(Joi.ref('opening_date')).required(),
    total_positions: Joi.number().integer().min(1).required(),
    district_specific: Joi.boolean().default(false),
    is_state_level: Joi.boolean().default(true),
    is_active: Joi.boolean().default(true)
  })
};

/**
 * Application Schemas
 */
const applicationSchemas = {
  // Create application
  createApplication: Joi.object({
    post_id: id
  }),

  // Update status
  updateStatus: Joi.object({
    status: Joi.string().valid(
      'DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'DOCUMENTS_VERIFIED',
      'ELIGIBLE', 'NOT_ELIGIBLE', 'SHORTLISTED', 'SELECTED', 'REJECTED', 'WITHDRAWN'
    ).required(),
    remarks: Joi.string().max(1000)
  })
};

module.exports = {
  authSchemas,
  profileSchemas,
  masterSchemas,
  adminSchemas,
  postSchemas,
  applicationSchemas,
  pagination,
  language,
  email,
  password,
  mobile,
  otp,
  id
};
