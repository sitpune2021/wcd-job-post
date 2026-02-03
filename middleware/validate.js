const Joi = require('joi');
const { ApiError } = require('./errorHandler');

// Custom validation for mobile number (10 digits)
const customJoi = Joi.extend((joi) => ({
  type: 'string',
  base: joi.string(),
  messages: {
    'string.mobile': '{{#label}} must be a valid 10-digit mobile number'
  },
  rules: {
    mobile: {
      validate(value, helpers) {
        if (!/^\d{10}$/.test(value)) {
          return helpers.error('string.mobile');
        }
        return value;
      }
    }
  }
}));

// Middleware factory for request validation
const validate = (schema) => {
  return (req, res, next) => {
    const validationOptions = {
      abortEarly: false, // Return all errors
      allowUnknown: true, // Ignore unknown props
      stripUnknown: false // Keep unknown props
    };

    // Validate request based on schema
    const { error, value } = schema.validate(
      {
        body: req.body,
        query: req.query,
        params: req.params
      },
      validationOptions
    );

    if (error) {
      const errorMessage = error.details
        .map((detail) => detail.message)
        .join(', ');
      return next(new ApiError(400, errorMessage));
    }

    // Replace request values with validated ones
    req.body = value.body;
    req.query = value.query;
    req.params = value.params;

    return next();
  };
};

// Common validation schemas
const schemas = {
  // Auth schemas
  register: Joi.object({
    body: Joi.object({
      mobile_no: customJoi.string().mobile().required(),
      password: Joi.string().min(8).required(),
      otp: Joi.string().length(6).pattern(/^\d+$/).required()
    })
  }),

  login: Joi.object({
    body: Joi.object({
      mobile_no: customJoi.string().mobile().required(),
      password: Joi.string().required()
    })
  }),

  sendOtp: Joi.object({
    body: Joi.object({
      mobile_no: customJoi.string().mobile().required(),
      purpose: Joi.string().valid('REGISTRATION', 'LOGIN', 'RESET').required()
    })
  }),

  verifyOtp: Joi.object({
    body: Joi.object({
      mobile_no: customJoi.string().mobile().required(),
      otp: Joi.string().length(6).pattern(/^\d+$/).required(),
      purpose: Joi.string().valid('REGISTRATION', 'LOGIN', 'RESET').required()
    })
  }),

  refreshToken: Joi.object({
    body: Joi.object({
      refresh_token: Joi.string().required()
    })
  }),

  // Profile schemas
  personalProfile: Joi.object({
    body: Joi.object({
      full_name: Joi.string().min(3).max(100).required(),
      dob: Joi.date().iso().required(),
      gender: Joi.string().valid('Male', 'Female', 'Other').required(),
      category: Joi.string().valid('General', 'OBC', 'SC', 'ST', 'Other').required(),
      domicile_maharashtra: Joi.boolean().required(),
      aadhar_no: Joi.string().pattern(/^\d{12}$/).required()
    })
  }),

  addressProfile: Joi.object({
    body: Joi.object({
      address_line: Joi.string().min(5).max(255).required(),
      district_id: Joi.number().integer().positive().required(),
      taluka_id: Joi.number().integer().positive().required(),
      pincode: Joi.string().pattern(/^\d{6}$/).required()
    })
  }),

  educationProfile: Joi.object({
    body: Joi.object({
      qualification_level: Joi.string().required(),
      degree_name: Joi.string().required(),
      specialization: Joi.string().allow('', null),
      university_board: Joi.string().required(),
      passing_year: Joi.number().integer().min(1950).max(new Date().getFullYear()).required(),
      percentage: Joi.number().min(35).max(100).required(),
      document_path: Joi.string().allow('', null)
    })
  }),

  experienceProfile: Joi.object({
    body: Joi.object({
      organization_name: Joi.string().required(),
      designation: Joi.string().required(),
      work_domain: Joi.string().required(),
      start_date: Joi.date().iso().required(),
      end_date: Joi.date().iso().allow(null),
      certificate_path: Joi.string().allow('', null),
      offer_letter_path: Joi.string().allow('', null),
      salary_slip_path: Joi.string().allow('', null)
    })
  }),

  // Application schemas
  applicationSubmit: Joi.object({
    body: Joi.object({
      post_id: Joi.number().integer().positive().required(),
      district_id: Joi.number().integer().positive().required(),
      declaration_accepted: Joi.boolean().valid(true).required()
    })
  }),

  // Common ID parameter schema
  idParam: Joi.object({
    params: Joi.object({
      id: Joi.number().integer().positive().required()
    })
  })
};

module.exports = {
  validate,
  schemas,
  customJoi
};
