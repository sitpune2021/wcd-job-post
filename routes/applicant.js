const express = require('express');
const router = express.Router();
const { authenticate, requireRole, auditLog } = require('../middleware/auth');
const { Op } = require('sequelize');
const { validate, schemas } = require('../middleware/validate');
const { ApiError } = require('../middleware/errorHandler');
const ApiResponse = require('../utils/ApiResponse');
const applicantService = require('../services/applicant');
const eligibilityService = require('../services/eligibilityService');
const acknowledgementService = require('../services/applicant/acknowledgementService');
const applicationRestrictionService = require('../services/applicationRestrictionService');
const { upload } = require('../utils/fileUpload');
const logger = require('../config/logger');
const {
  toBool,
  buildFileUrl,
  sendPdfFromHtml,
  buildApplicationPdfHtml
} = require('../utils/applicationPdf');

// All routes require authentication
router.use(authenticate);
router.use(requireRole('APPLICANT'));

// ==================== DASHBOARD ====================

/**
 * @route GET /api/v1/applicant/dashboard
 * @desc Get applicant dashboard data
 * @access Private (Applicant)
 */
router.get('/dashboard', auditLog('VIEW_DASHBOARD'), async (req, res, next) => {
  try {
    const dashboard = await applicantService.getDashboard(req.user.applicant_id);
    res.status(200).json(dashboard);
  } catch (error) {
    next(error);
  }
});

router.post(
  '/profile/personal/photo',
  (req, res, next) => {
    req.uploadDocType = 'PHOTO';
    next();
  },
  upload.single('file'),
  auditLog('UPLOAD_PERSONAL_PHOTO'),
  async (req, res, next) => {
    try {
      if (!req.file) {
        throw new ApiError(400, 'No file uploaded');
      }

      const personal = await applicantService.savePhoto(req.user.applicant_id, req.file);

      res.status(200).json({
        success: true,
        message: 'Photo uploaded successfully',
        data: personal
      });
    } catch (error) {
      next(error);
    }
  }
);

// Experience preference: mark whether applicant wants to add experience
router.patch(
  '/profile/experience-preference',
  upload.none(),
  auditLog('SET_EXPERIENCE_PREFERENCE'),
  async (req, res, next) => {
    try {
      const { has_experience } = req.body;
      const result = await applicantService.setExperiencePreference(req.user.applicant_id, has_experience);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/profile/personal/signature',
  (req, res, next) => {
    req.uploadDocType = 'SIGNATURE';
    next();
  },
  upload.single('file'),
  auditLog('UPLOAD_PERSONAL_SIGNATURE'),
  async (req, res, next) => {
    try {
      if (!req.file) {
        throw new ApiError(400, 'No file uploaded');
      }

      const personal = await applicantService.saveSignature(req.user.applicant_id, req.file);

      res.status(200).json({
        success: true,
        message: 'Signature uploaded successfully',
        data: personal
      });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/profile/personal/aadhaar',
  (req, res, next) => {
    req.uploadDocType = 'AADHAAR';
    next();
  },
  upload.single('file'),
  auditLog('UPLOAD_PERSONAL_AADHAAR'),
  async (req, res, next) => {
    try {
      if (!req.file) {
        throw new ApiError(400, 'No file uploaded');
      }

      const personal = await applicantService.saveAadhaar(req.user.applicant_id, req.file);

      res.status(200).json({
        success: true,
        message: 'Aadhaar uploaded successfully',
        data: personal
      });
    } catch (error) {
      next(error);
    }
  }
);

// PAN upload temporarily disabled as per requirement.
// router.post(
//   '/profile/personal/pan',
//   (req, res, next) => {
//     req.uploadDocType = 'PAN';
//     next();
//   },
//   upload.single('file'),
//   auditLog('UPLOAD_PERSONAL_PAN'),
//   async (req, res, next) => {
//     try {
//       if (!req.file) {
//         throw new ApiError(400, 'No file uploaded');
//       }
//
//       const personal = await applicantService.savePan(req.user.applicant_id, req.file);
//
//       res.status(200).json({
//         success: true,
//         message: 'PAN uploaded successfully',
//         data: personal
//       });
//     } catch (error) {
//       next(error);
//     }
//   }
// );

router.post(
  '/profile/personal/resume',
  (req, res, next) => {
    req.uploadDocType = 'RESUME';
    next();
  },
  upload.single('file'),
  auditLog('UPLOAD_PERSONAL_RESUME'),
  async (req, res, next) => {
    try {
      if (!req.file) {
        throw new ApiError(400, 'No file uploaded');
      }

      const personal = await applicantService.saveResume(req.user.applicant_id, req.file);

      res.status(200).json({
        success: true,
        message: 'Resume uploaded successfully',
        data: personal
      });
    } catch (error) {
      next(error);
    }
  }
);

// ==================== PROFILE ====================

/**
 * @route GET /api/v1/applicant/profile
 * @desc Get complete profile
 * @access Private (Applicant)
 */
router.get('/profile', async (req, res, next) => {
  try {
    const profile = await applicantService.getProfile(req.user.applicant_id);
    res.status(200).json(profile);
  } catch (error) {
    next(error);
  }
});

/**
 * @route POST /api/v1/applicant/profile/personal
 * @desc Save or update personal profile
 * @access Private (Applicant)
 */
router.post(
  '/profile/personal',
  upload.none(),
  auditLog('UPDATE_PERSONAL_PROFILE'),
  async (req, res, next) => {
    try {
      const personal = await applicantService.savePersonalProfile(req.user.applicant_id, req.body);
      res.status(200).json(personal);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @route POST /api/v1/applicant/profile/personal/domicile
 * @desc Upload domicile certificate (only when domicile_maharashtra=true)
 * @access Private (Applicant)
 * @body file - The document file (PDF, JPEG, PNG)
 */
router.post(
  '/profile/personal/domicile',
  (req, res, next) => {
    req.uploadDocType = 'DOMICILE';
    next();
  },
  upload.single('file'),
  auditLog('UPLOAD_DOMICILE_CERTIFICATE'),
  async (req, res, next) => {
    try {
      if (!req.file) {
        throw new ApiError(400, 'No file uploaded');
      }

      const personal = await applicantService.saveDomicileCertificate(req.user.applicant_id, req.file);

      res.status(200).json({
        success: true,
        message: 'Domicile certificate uploaded successfully',
        data: personal
      });
    } catch (error) {
      next(error);
    }
  });

/**
 * @route POST /api/v1/applicant/profile/address
 * @desc Save or update address profile
 * @access Private (Applicant)
 */
router.post(
  '/profile/address',
  upload.none(),
  auditLog('UPDATE_ADDRESS_PROFILE'),
  async (req, res, next) => {
    try {
      const address = await applicantService.saveAddressProfile(req.user.applicant_id, req.body);
      res.status(200).json(address);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @route POST /api/v1/applicant/profile/education
 * @desc Add education record
 * @access Private (Applicant)
 */
router.post(
  '/profile/education',
  (req, res, next) => {
    req.uploadDocType = 'EDUCATION_CERT';
    next();
  },
  upload.single('file'),
  auditLog('ADD_EDUCATION'),
  async (req, res, next) => {
    try {
      const education = await applicantService.addEducation(req.user.applicant_id, req.body, req.file);
      res.status(201).json(education);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @route PUT /api/v1/applicant/profile/education/:id
 * @desc Update education record
 * @access Private (Applicant)
 */
router.put('/profile/education/:id', auditLog('UPDATE_EDUCATION'), async (req, res, next) => {
  try {
    const education = await applicantService.updateEducation(req.user.applicant_id, req.params.id, req.body);
    res.status(200).json(education);
  } catch (error) {
    next(error);
  }
});

/**
 * @route DELETE /api/v1/applicant/profile/education/:id
 * @desc Delete education record
 * @access Private (Applicant)
 */
router.delete('/profile/education/:id', auditLog('DELETE_EDUCATION'), async (req, res, next) => {
  try {
    const result = await applicantService.deleteEducation(req.user.applicant_id, req.params.id);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * @route POST /api/v1/applicant/profile/experience
 * @desc Add experience record
 * @access Private (Applicant)
 */
router.post(
  '/profile/experience',
  (req, res, next) => {
    req.uploadDocType = 'EXPERIENCE_CERT';
    next();
  },
  upload.fields([
    { name: 'certificate', maxCount: 1 },
    { name: 'offer_letter', maxCount: 1 },
    { name: 'salary_slip', maxCount: 1 }
  ]),
  auditLog('ADD_EXPERIENCE'),
  async (req, res, next) => {
    try {
      const filesData = {
        certificate: req.files?.certificate?.[0],
        offer_letter: req.files?.offer_letter?.[0],
        salary_slip: req.files?.salary_slip?.[0]
      };
      const experience = await applicantService.addExperience(req.user.applicant_id, req.body, filesData);
      res.status(201).json(experience);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @route PUT /api/v1/applicant/profile/experience/:id
 * @desc Update experience record
 * @access Private (Applicant)
 */
router.put(
  '/profile/experience/:id',
  (req, res, next) => {
    req.uploadDocType = 'EXPERIENCE_CERT';
    next();
  },
  upload.fields([
    { name: 'certificate', maxCount: 1 },
    { name: 'offer_letter', maxCount: 1 },
    { name: 'salary_slip', maxCount: 1 }
  ]),
  auditLog('UPDATE_EXPERIENCE'),
  async (req, res, next) => {
    try {
      const filesData = {
        certificate: req.files?.certificate?.[0],
        offer_letter: req.files?.offer_letter?.[0],
        salary_slip: req.files?.salary_slip?.[0]
      };
      const experience = await applicantService.updateExperience(req.user.applicant_id, req.params.id, req.body, filesData);
      res.status(200).json(experience);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @route DELETE /api/v1/applicant/profile/experience/:id
 * @desc Delete experience record
 * @access Private (Applicant)
 */
router.delete('/profile/experience/:id', auditLog('DELETE_EXPERIENCE'), async (req, res, next) => {
  try {
    const result = await applicantService.deleteExperience(req.user.applicant_id, req.params.id);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

// ==================== SKILLS ====================

/**
 * @route GET /api/v1/applicant/profile/skills
 * @desc Get applicant skills
 * @access Private (Applicant)
 */
router.get('/profile/skills', auditLog('VIEW_SKILLS'), async (req, res, next) => {
  try {
    const skills = await applicantService.getSkills(req.user.applicant_id);
    res.status(200).json({ skills });
  } catch (error) {
    next(error);
  }
});

/**
 * @route POST /api/v1/applicant/profile/skills
 * @desc Add applicant skill (future-ready for optional certificate/image upload)
 * @access Private (Applicant)
 */
router.post(
  '/profile/skills',
  (req, res, next) => {
    req.uploadDocType = 'SKILL_CERT';
    next();
  },
  upload.fields([
    { name: 'file', maxCount: 1 },
    { name: 'image', maxCount: 1 }
  ]),
  auditLog('ADD_SKILL'),
  async (req, res, next) => {
    try {
      const uploadedFile = req?.files?.file?.[0] || req?.files?.image?.[0] || null;
      const skill = await applicantService.addSkill(req.user.applicant_id, req.body, uploadedFile);
      res.status(201).json(skill);
    } catch (error) {
      next(error);
    }
  }
);

/**
 * @route DELETE /api/v1/applicant/profile/skills/:id
 * @desc Delete applicant skill
 * @access Private (Applicant)
 */
router.delete('/profile/skills/:id', auditLog('DELETE_SKILL'), async (req, res, next) => {
  try {
    const result = await applicantService.deleteSkill(req.user.applicant_id, req.params.id);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

// ==================== DOCUMENTS ====================

/**
 * @route POST /api/v1/applicant/documents
 * @desc Upload document with document type
 * @access Private (Applicant)
 * @body file - The document file (PDF, JPEG, PNG)
 * @body doc_type_id - Document type ID from document_types table
 * @body doc_type - Document type code (fallback if doc_type_id not provided)
 */
// NOTE: This route is currently used for uploading EXTRA documents only.
// Education/Experience certificates and Personal core documents are uploaded via their dedicated profile routes.
router.post(
  '/documents',
  (req, res, next) => {
    const fromQuery = req.query?.doc_type_code;
    const fromHeader = req.headers?.['x-doc-type-code'];
    if (fromQuery || fromHeader) {
      req.uploadDocType = fromQuery || fromHeader;
    }
    next();
  },
  upload.single('file'),
  auditLog('UPLOAD_DOCUMENT'),
  async (req, res, next) => {
    try {
      if (!req.file) {
        throw new ApiError(400, 'No file uploaded');
      }

      const { doc_type_id, doc_type } = req.body;

      if (!doc_type_id && !doc_type) {
        throw new ApiError(400, 'Document type is required. Provide doc_type_id or doc_type');
      }

      // Validate doc_type_id if provided
      if (doc_type_id) {
        const docType = await require('../models').DocumentType.findByPk(doc_type_id);
        if (!docType) {
          throw new ApiError(400, 'Invalid document type ID');
        }
      }

      const document = await applicantService.saveDocument(req.user.applicant_id, req.file, {
        doc_type_id: doc_type_id ? parseInt(doc_type_id) : null,
        doc_type: doc_type
      });

      res.status(200).json({
        success: true,
        message: 'Document uploaded successfully',
        data: document
      });
    } catch (error) {
      next(error);
    }
  });

/**
 * @route GET /api/v1/applicant/documents
 * @desc Get all documents
 * @access Private (Applicant)
 */
router.get('/documents', auditLog('VIEW_DOCUMENTS'), async (req, res, next) => {
  try {
    const documents = await applicantService.getDocuments(req.user.applicant_id);
    res.status(200).json(documents);
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/v1/applicant/documents/required
 * @desc Get required document types for this applicant (mandatory-for-all + conditional)
 * @access Private (Applicant)
 */
router.get('/documents/required', auditLog('VIEW_REQUIRED_DOCUMENT_TYPES'), async (req, res, next) => {
  try {
    // Prevent browser/proxy caching (avoids 304 Not Modified masking changes during development)
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('Surrogate-Control', 'no-store');
    // Force a unique ETag so Express does not short-circuit to 304
    res.set('ETag', `W/"${Date.now()}"`);

    const includeSectionDocs = req.query.include_section_docs === 'true';
    const includeCorePersonal = req.query.include_core_personal === 'true';
    const requiredDocs = await applicantService.getRequiredDocumentTypes(req.user.applicant_id, {
      post_id: req.query.post_id,
      include_section_docs: includeSectionDocs,
      include_core_personal: includeCorePersonal
    });
    res.status(200).json(requiredDocs);
  } catch (error) {
    next(error);
  }
});

/**
 * @route DELETE /api/v1/applicant/documents/:id
 * @desc Delete document
 * @access Private (Applicant)
 */
router.delete('/documents/:id', auditLog('DELETE_DOCUMENT'), async (req, res, next) => {
  try {
    const result = await applicantService.deleteDocument(req.user.applicant_id, req.params.id);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

// ==================== POSTS & APPLICATIONS ====================

/**
 * @route GET /api/v1/applicant/profile/completion
 * @desc Get profile completion status
 * @access Private (Applicant)
 */
router.get('/profile/completion', async (req, res, next) => {
  try {
    const completion = await eligibilityService.getProfileCompletion(req.user.applicant_id);
    res.status(200).json(completion);
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/v1/applicant/posts/eligible
 * @desc Get all posts with eligibility status for this applicant
 * @access Private (Applicant)
 */
router.get('/posts/eligible', auditLog('VIEW_ELIGIBLE_POSTS'), async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('Surrogate-Control', 'no-store');
    res.set('ETag', `W/"${Date.now()}"`);
    const onlyEligible = req.query.only_eligible !== 'false';
    const includeLocked = req.query.include_locked === 'true';
    const page = req.query.page;
    const limit = req.query.limit;
    const search = req.query.search || req.query.q || '';
    const districtId = req.query.district_id || req.query.districtId || null;

    const result = await eligibilityService.getEligiblePosts(
      req.user.applicant_id,
      {
        onlyEligible,
        includeLocked,
        page,
        limit,
        search,
        districtId
      }
    );

    return ApiResponse.success(res, result, 'Eligible posts retrieved successfully');
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/v1/applicant/posts/:postId/eligibility
 * @desc Check eligibility for a specific post
 * @access Private (Applicant)
 */
router.get('/posts/:postId/eligibility', auditLog('CHECK_ELIGIBILITY'), async (req, res, next) => {
  try {
    const eligibility = await eligibilityService.checkEligibility(req.user.applicant_id, req.params.postId);
    return ApiResponse.success(res, eligibility,
      eligibility.isEligible ? 'You are eligible for this post' : 'You are not eligible for this post'
    );
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/v1/applicant/posts/:postId/documents-check
 * @desc Check if applicant has uploaded required documents for a post
 * @access Private (Applicant)
 */
router.get('/posts/:postId/documents-check', auditLog('CHECK_DOCUMENTS'), async (req, res, next) => {
  try {
    const docCheck = await eligibilityService.checkRequiredDocuments(req.user.applicant_id, req.params.postId);
    return ApiResponse.success(res, docCheck, 'Document check completed');
  } catch (error) {
    next(error);
  }
});

// to save or draft heres where application is created 1st and id genrated
/**
 * @route POST /api/v1/applicant/applications
 * @desc Create draft application for a post
 * @access Private (Applicant)
 */
router.post('/applications', auditLog('CREATE_APPLICATION'), async (req, res, next) => {
  try {
    const { post_id, district_id } = req.body;

    if (!post_id) {
      throw new ApiError(400, 'Post ID is required');
    }

    // STEP 1: Check application restrictions (post name, OSC, district limits)
    const restrictionCheck = await applicationRestrictionService.canApplyToPost(req.user.applicant_id, post_id, district_id);
    if (!restrictionCheck.allowed) {
      return res.status(400).json({
        success: false,
        message: restrictionCheck.reason,
        details: restrictionCheck.details,
        code: 'APPLICATION_LIMIT_EXCEEDED'
      });
    }

    // STEP 2: Check profile completion (MUST be 100%)
    const completion = await eligibilityService.getProfileCompletion(req.user.applicant_id);
    if (!completion.canApply) {
      return res.status(400).json({
        success: false,
        message: `Profile incomplete. Cannot apply.`,
        profileCompletion: completion
      });
    }

    // STEP 3: Check eligibility for this specific post
    const eligibility = await eligibilityService.checkEligibility(req.user.applicant_id, post_id);

    // STEP 3: Check if applicant has uploaded required documents for this post
    const docCheck = await eligibilityService.checkRequiredDocuments(req.user.applicant_id, post_id);
    if (!docCheck.complete) {
      return res.status(400).json({
        success: false,
        message: 'Required documents not uploaded',
        missingDocuments: docCheck.missing,
        uploadedDocuments: docCheck.uploaded
      });
    }

    // STEP 5: Create application (even if not eligible - admin can override)
    const application = await applicantService.createApplication(req.user.applicant_id, {
      post_id,
      district_id,
      eligibility,
      docCheck
    });

    res.status(201).json({
      success: true,
      message: 'Application created successfully',
      data: application
    });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// PAYMENT INTEGRATION - APPLICATION SUBMISSION WITH RAZORPAY
// ============================================================================

/**
 * @route POST /api/v1/applicant/applications/apply
 * @desc Step 1: Validate application and handle payment requirement
 *       - If payment required: Creates Razorpay order, stores data in payment metadata, returns payment details
 *       - If no payment: Directly creates application + acknowledgement in transaction
 * @access Private (Applicant)
 * @body {number} post_id - Post ID
 * @body {number} district_id - District ID (optional)
 * @body {boolean} declaration_accepted - Declaration acceptance (required)
 * @body {string} place - Place of submission (required)
 * @returns {Object} Payment order details OR completed application
 */
router.post('/applications/apply', auditLog('APPLY_APPLICATION'), async (req, res, next) => {
  try {
    const { post_id, district_id, declaration_accepted, place } = req.body;

    // === VALIDATION: Required Fields ===
    if (!post_id) {
      throw new ApiError(400, 'Post ID is required');
    }

    if (!declaration_accepted) {
      throw new ApiError(400, 'You must accept the declaration to submit the application');
    }

    if (!place || !place.trim()) {
      throw new ApiError(400, 'Place is required');
    }

    // STEP 1: Check application restrictions (post name, OSC, district limits)
    const restrictionCheck = await applicationRestrictionService.canApplyToPost(req.user.applicant_id, post_id, district_id);
    if (!restrictionCheck.allowed) {
      return res.status(400).json({
        success: false,
        message: restrictionCheck.reason,
        details: restrictionCheck.details,
        code: 'APPLICATION_LIMIT_EXCEEDED'
      });
    }

    // STEP 2: Check profile completion (MUST be 100%)
    const completion = await eligibilityService.getProfileCompletion(req.user.applicant_id);
    if (!completion.canApply) {
      return res.status(400).json({
        success: false,
        message: 'Profile incomplete. Cannot apply.',
        profileCompletion: completion,
        code: 'PROFILE_INCOMPLETE'
      });
    }

    // STEP 3: Check eligibility for this specific post
    const eligibility = await eligibilityService.checkEligibility(req.user.applicant_id, post_id);
    if (!eligibility.isEligible) {
      return res.status(400).json({
        success: false,
        message: 'You are not eligible for this post',
        eligibility: eligibility,
        code: 'NOT_ELIGIBLE'
      });
    }

    // === STEP 4: Check Required Documents ===
    // All mandatory documents must be uploaded
    const docCheck = await eligibilityService.checkRequiredDocuments(req.user.applicant_id, post_id);
    if (!docCheck.complete) {
      return res.status(400).json({
        success: false,
        message: 'Required documents not uploaded',
        missingDocuments: docCheck.missing,
        uploadedDocuments: docCheck.uploaded,
        code: 'DOCUMENTS_INCOMPLETE'
      });
    }

    // === STEP 5: Get Post Details ===
    const db = require('../models');
    const paymentService = require('../services/paymentService');
    
    const post = await db.PostMaster.findByPk(post_id, {
      attributes: ['post_id', 'post_name', 'district_id']
    });

    if (!post) {
      throw new ApiError(404, 'Post not found');
    }

    const finalDistrictId = district_id || post.district_id;

    // === STEP 6: Check Payment Requirement ===
    // Payment required only for distinct post names (max 2)
    // Same post name in same district = FREE (no additional payment)
    const paymentCheck = await paymentService.checkPaymentRequired(
      req.user.applicant_id,
      post_id,
      post.post_name,
      finalDistrictId
    );

    // === CASE A: PAYMENT REQUIRED ===
    // Create Razorpay order and store application data in payment metadata
    // Application will be created later in verify-payment API after payment success
    if (paymentCheck.required) {
      const paymentOrder = await paymentService.createPaymentOrder(
        req.user.applicant_id,
        post_id,
        post.post_name,
        finalDistrictId,
        {
          declaration_accepted,
          place: place.trim(),
          ip_address: req.ip,
          user_agent: req.get('user-agent')
        }
      );

      return res.status(200).json({
        success: true,
        message: 'Validation successful. Payment required.',
        paymentRequired: true,
        paymentOrder: {
          razorpay_order_id: paymentOrder.razorpay_order_id,
          amount: paymentOrder.amount,
          breakdown: paymentOrder.breakdown,
          razorpay_key_id: paymentOrder.razorpay_key_id
        },
        post: {
          post_id: post.post_id,
          post_name: post.post_name,
          district_id: finalDistrictId
        }
      });
    }

    // === CASE B: NO PAYMENT REQUIRED ===
    // Directly create application + acknowledgement in single transaction
    // No need to call verify-payment API
    const transaction = await db.sequelize.transaction();

    try {
      // Re-check eligibility (already validated above, but needed for application creation)
      const eligibility = await eligibilityService.checkEligibility(req.user.applicant_id, post_id);
      const docCheck = await eligibilityService.checkRequiredDocuments(req.user.applicant_id, post_id);

      // Check if already applied to this post
      const existing = await db.Application.findOne({
        where: { applicant_id: req.user.applicant_id, post_id },
        transaction
      });

      if (existing && existing.status !== 'DRAFT' && existing.status !== 'Draft') {
        await transaction.rollback();
        throw new ApiError(400, 'You have already applied for this post');
      }

      let applicationId;

      if (existing) {
        applicationId = existing.application_id;
      } else {
        // Create application within transaction
        const created = await applicantService.createApplication(
          req.user.applicant_id,
          {
            post_id,
            district_id: finalDistrictId,
            eligibility,
            docCheck
          },
          transaction
        );

        applicationId = created?.application?.application_id;
      }

      if (!applicationId) {
        await transaction.rollback();
        throw new ApiError(500, 'Failed to create application');
      }

      // Submit application within transaction
      const submitted = await applicantService.finalSubmitApplication(
        req.user.applicant_id,
        applicationId,
        declaration_accepted,
        {
          ip_address: req.ip,
          user_agent: req.get('user-agent'),
          place: place.trim()
        },
        transaction
      );

      // Commit transaction
      await transaction.commit();

      return res.status(200).json({
        ...submitted,
        paymentRequired: false,
        paymentStatus: 'NOT_REQUIRED'
      });

    } catch (txError) {
      await transaction.rollback();
      throw txError;
    }

  } catch (error) {
    next(error);
  }
});

// ============================================================================
// STEP 2: VERIFY PAYMENT AND COMPLETE APPLICATION SUBMISSION
// ============================================================================

/**
 * @route POST /api/v1/applicant/applications/verify-payment
 * @desc Step 2: Verify Razorpay payment and create application + acknowledgement in single transaction
 *       All application data (declaration, place, etc.) is retrieved from payment metadata
 * @access Private (Applicant)
 * @body {string} razorpay_order_id - Razorpay order ID (required)
 * @body {string} razorpay_payment_id - Razorpay payment ID (required)
 * @body {string} razorpay_signature - Razorpay signature (required)
 * @returns {Object} Completed application details
 */
router.post('/applications/verify-payment', auditLog('VERIFY_PAYMENT_AND_SUBMIT'), async (req, res, next) => {
  const db = require('../models');
  const paymentService = require('../services/paymentService');
  let transaction;

  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    // === VALIDATION: Required Payment Fields ===
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({
        success: false,
        message: 'Payment details incomplete. All payment fields are required.',
        code: 'PAYMENT_DETAILS_INCOMPLETE'
      });
    }

    // === START DATABASE TRANSACTION ===
    // All operations (payment update, application creation, acknowledgement) happen atomically
    transaction = await db.sequelize.transaction();

    // === STEP 1: Find Payment Record ===
    const payment = await db.Payment.findOne({
      where: {
        razorpay_order_id: razorpay_order_id,
        applicant_id: req.user.applicant_id,
        is_deleted: false
      },
      transaction
    });

    if (!payment) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: 'Invalid payment order. Order not found or does not belong to you.',
        code: 'INVALID_PAYMENT_ORDER'
      });
    }

    // === STEP 2: Check if Payment Already Processed ===
    if (payment.payment_status === 'SUCCESS') {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: 'Payment already processed. Application may already be submitted.',
        code: 'PAYMENT_ALREADY_PROCESSED'
      });
    }

    // === STEP 3: Verify Payment Signature with Razorpay ===
    const isValid = paymentService.verifyPaymentSignature(
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature
    );

    if (!isValid) {
      // Mark payment as FAILED within transaction
      await payment.update({
        payment_status: 'FAILED',
        failure_reason: 'Invalid payment signature - Razorpay verification failed'
      }, { transaction });

      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: 'Payment verification failed. Invalid signature.',
        code: 'PAYMENT_VERIFICATION_FAILED'
      });
    }

    // === STEP 4: Update Payment Status to SUCCESS ===
    await payment.update({
      razorpay_payment_id: razorpay_payment_id,
      razorpay_signature: razorpay_signature,
      payment_status: 'SUCCESS',
      paid_at: new Date()
    }, { transaction });

    // === STEP 5: Retrieve Application Data from Payment Metadata ===
    // Data was stored during payment order creation in apply API
    const applicationData = payment.metadata?.application_data || {};
    const finalPostId = payment.post_id;
    const finalDistrictId = payment.district_id;

    // === STEP 6: Get Post Details ===
    const post = await db.PostMaster.findByPk(finalPostId, {
      attributes: ['post_id', 'post_name', 'district_id'],
      transaction
    });

    if (!post) {
      await transaction.rollback();
      throw new ApiError(404, 'Post not found');
    }

    const finalDistrictIdResolved = finalDistrictId || post.district_id;

    // === STEP 7: Re-check Eligibility ===
    // Ensures applicant still meets requirements at time of submission
    const eligibility = await eligibilityService.checkEligibility(req.user.applicant_id, finalPostId);
    const docCheck = await eligibilityService.checkRequiredDocuments(req.user.applicant_id, finalPostId);

    // === STEP 8: Check for Duplicate Application ===
    const existing = await db.Application.findOne({
      where: { applicant_id: req.user.applicant_id, post_id: finalPostId },
      transaction
    });

    if (existing && existing.status !== 'DRAFT' && existing.status !== 'Draft') {
      await transaction.rollback();
      throw new ApiError(400, 'You have already applied for this post');
    }

    // === STEP 9: Create Application Record ===
    let applicationId;

    if (existing) {
      // Reuse existing draft
      applicationId = existing.application_id;
    } else {
      // Create new application within transaction
      const created = await applicantService.createApplication(
        req.user.applicant_id,
        {
          post_id: finalPostId,
          district_id: finalDistrictIdResolved,
          eligibility,
          docCheck
        },
        transaction
      );

      applicationId = created?.application?.application_id;
    }

    if (!applicationId) {
      await transaction.rollback();
      throw new ApiError(500, 'Failed to create application');
    }

    // === STEP 10: Link Payment to Application ===
    await payment.update(
      { application_id: applicationId },
      { transaction }
    );

    // === STEP 11: Submit Application + Create Acknowledgement ===
    // This creates the final application record and acknowledgement entry
    const submitted = await applicantService.finalSubmitApplication(
      req.user.applicant_id,
      applicationId,
      applicationData.declaration_accepted || true,
      {
        ip_address: applicationData.ip_address,
        user_agent: applicationData.user_agent,
        place: applicationData.place
      },
      transaction
    );

    // === COMMIT TRANSACTION ===
    // All operations successful - payment verified, application created, acknowledgement saved
    await transaction.commit();

    return res.status(200).json({
      ...submitted,
      paymentStatus: 'PAID'
    });

  } catch (error) {
    // === ROLLBACK TRANSACTION ON ERROR ===
    // Ensures no partial data is saved (payment, application, acknowledgement all rolled back)
    if (transaction) {
      await transaction.rollback();
    }
    next(error);
  }
});

// pass the genrated id of aplication you get on draft or save of application and this api will lock it 
/**
 * @route POST /api/v1/applicant/applications/:id/submit
 * @desc Final submit application with acknowledgment
 * @access Private (Applicant)
 */
router.post('/applications/:id/submit', auditLog('SUBMIT_APPLICATION'), async (req, res, next) => {
  try {
    const { declaration_accepted } = req.body;

    if (!declaration_accepted) {
      throw new ApiError(400, 'You must accept the declaration to submit the application');
    }

    const application = await applicantService.finalSubmitApplication(
      req.user.applicant_id,
      req.params.id,
      declaration_accepted,
      { ip_address: req.ip, user_agent: req.get('user-agent') }
    );
    res.status(200).json(application);
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/v1/applicant/applications/summary
 * @desc Get application summary with restrictions and limits
 * @access Private (Applicant)
 */
router.get('/applications/summary', auditLog('VIEW_APPLICATION_SUMMARY'), async (req, res, next) => {
  try {
    const summary = await applicationRestrictionService.getApplicationSummary(req.user.applicant_id);
    res.status(200).json({
      success: true,
      data: summary
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/v1/applicant/posts/:postId/can-apply
 * @desc Check if applicant can apply to a specific post
 * @access Private (Applicant)
 */
router.get('/posts/:postId/can-apply', auditLog('CHECK_CAN_APPLY'), async (req, res, next) => {
  try {
    const result = await applicationRestrictionService.canApplyToPost(req.user.applicant_id, req.params.postId);
    res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/v1/applicant/applications
 * @desc Get all applications
 * @access Private (Applicant)
 */
router.get('/applications', auditLog('VIEW_APPLICATIONS'), async (req, res, next) => {
  try {
    const applications = await applicantService.getApplications(req.user.applicant_id);
    res.status(200).json(applications);
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/v1/applicant/applications/status
 * @desc Get applicant applications with current status (search/filter/pagination)
 * @access Private (Applicant)
 * @query page, limit, q/search, status (comma-separated), post_id, district_id, component_id, sort_by, sort_dir
 */
router.get('/applications/status', auditLog('VIEW_APPLICATION_STATUS_LIST'), async (req, res, next) => {
  try {
    const result = await applicantService.getApplicationStatusList(req.user.applicant_id, req.query);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/v1/applicant/applications/:id
 * @desc Get application details
 * @access Private (Applicant)
 */
router.get('/applications/:id', auditLog('VIEW_APPLICATION_DETAILS'), async (req, res, next) => {
  try {
    const application = await applicantService.getApplicationById(req.user.applicant_id, req.params.id);
    res.status(200).json(application);
  } catch (error) {
    next(error);
  }
});

router.post('/applications/:id/pdf', auditLog('EXPORT_APPLICATION_PDF'), async (req, res, next) => {
  try {
    const includeImages = toBool(req?.query?.include_images ?? req?.body?.include_images, true);
    logger.info(`Applicant PDF export started for application ${req.params.id}`, { includeImages });
    
    const application = await applicantService.getApplicationById(req.user.applicant_id, req.params.id);
    logger.info(`Application data retrieved`, { appNo: application?.application_no });

    const db = require('../models');
    const acknowledgement = await db.ApplicantAcknowledgement.findOne({
      where: {
        application_id: req.params.id,
        checkbox_code: 'DECLARATION_ACCEPTED',
        action_type: {
          [Op.in]: ['APPLICATION_DECLARATION', 'APPLICATION_SUBMIT']
        }
      },
      order: [['accepted_at', 'DESC'], ['acknowledgement_id', 'DESC']]
    });
    logger.info(`Acknowledgement retrieved`, { hasAck: !!acknowledgement });

    // Fetch payment data for this application OR the original payment for same post_name + district_id
    let payment = await db.Payment.findOne({
      where: {
        application_id: req.params.id,
        payment_status: 'SUCCESS'
      },
      order: [['paid_at', 'DESC'], ['payment_id', 'DESC']]
    });

    // If no payment found for this application, find the original payment for same post_name + district_id
    if (!payment && application?.post_id && application?.district_id) {
      payment = await db.Payment.findOne({
        where: {
          applicant_id: req.user.applicant_id,
          post_name: application.post?.post_name,
          district_id: application.district_id,
          payment_status: 'SUCCESS'
        },
        order: [['paid_at', 'ASC'], ['payment_id', 'ASC']]
      });
    }
    logger.info(`Payment retrieved`, { hasPayment: !!payment });

    const applicant = application?.applicant || {};
    const personal = applicant?.personal || {};
    const docs = Array.isArray(applicant?.documents) ? applicant.documents : [];

    const photoPath = personal?.photo_path || docs.find(d => d?.doc_type === 'PHOTO')?.file_path || null;
    const signaturePath = personal?.signature_path || docs.find(d => d?.doc_type === 'SIGNATURE')?.file_path || null;

    const photoUrl = includeImages ? buildFileUrl(req, photoPath) : null;
    const signatureUrl = includeImages ? buildFileUrl(req, signaturePath) : null;
    logger.info(`Image URLs built`, { hasPhoto: !!photoUrl, hasSignature: !!signatureUrl });

    const isFreeApplication = payment && payment.application_id !== parseInt(req.params.id);

    logger.info(`Building PDF HTML...`);
    const html = buildApplicationPdfHtml(req, application, {
      includeImages,
      photoUrl,
      signatureUrl,
      acknowledgement: acknowledgement ? acknowledgement.toJSON() : null,
      payment: payment ? payment.toJSON() : null,
      isFreeApplication
    });
    logger.info(`PDF HTML built successfully`);

    const safeNo = application?.application_no || application?.application_id || req.params.id;
    logger.info(`Sending PDF response...`);
    return await sendPdfFromHtml(res, `application_${safeNo}`, html);
  } catch (error) {
    logger.error(`Applicant PDF export failed for application ${req.params.id}:`, {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    next(error);
  }
});

/**
 * @route GET /api/v1/applicant/applications/:id/history
 * @desc Get application status history (for applicant to track their application)
 * @access Private (Applicant)
 */
router.get('/applications/:id/history', auditLog('VIEW_APPLICATION_HISTORY'), async (req, res, next) => {
  try {
    const db = require('../models');
    const { ApplicationStatusHistory, Application } = db;

    // Verify application belongs to this applicant
    const application = await Application.findOne({
      where: {
        application_id: req.params.id,
        applicant_id: req.user.applicant_id
      }
    });

    if (!application) {
      return next(ApiError.notFound('Application not found'));
    }

    // Get history (without admin details for privacy)
    const history = await ApplicationStatusHistory.findAll({
      where: { application_id: req.params.id },
      attributes: ['history_id', 'old_status', 'new_status', 'changed_by_type', 'remarks', 'created_at'],
      order: [['created_at', 'DESC']]
    });

    res.status(200).json({
      application_id: application.application_id,
      application_no: application.application_no,
      current_status: application.status,
      history
    });
  } catch (error) {
    next(error);
  }
});

// ==================== ACKNOWLEDGEMENTS ====================

/**
 * @route POST /api/v1/applicant/acknowledgements
 * @desc Save multiple acknowledgments (checkboxes)
 * @access Private (Applicant)
 * @body acknowledgements - Array of { code, label } objects
 * @body application_id - Optional application ID if linked to specific application
 * @body action_type - Action type (e.g., PROFILE_SUBMIT, APPLICATION_SUBMIT)
 */
router.post('/acknowledgements', auditLog('SAVE_ACKNOWLEDGEMENTS'), async (req, res, next) => {
  try {
    const { acknowledgements, application_id, action_type = 'GENERAL' } = req.body;

    if (!acknowledgements || !Array.isArray(acknowledgements)) {
      throw new ApiError(400, 'Acknowledgements array is required');
    }

    if (acknowledgements.length === 0) {
      throw new ApiError(400, 'At least one acknowledgement is required');
    }

    // Validate each acknowledgement has required fields
    for (const ack of acknowledgements) {
      if (!ack.code || !ack.label) {
        throw new ApiError(400, 'Each acknowledgement must have code and label');
      }
    }

    const saved = await acknowledgementService.saveAcknowledgements(
      req.user.applicant_id,
      acknowledgements,
      {
        applicationId: application_id,
        actionType: action_type,
        ipAddress: req.ip,
        userAgent: req.get('user-agent')
      }
    );

    res.status(201).json({
      success: true,
      message: `${saved.length} acknowledgments saved successfully`,
      data: saved
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/v1/applicant/acknowledgements
 * @desc Get applicant acknowledgments
 * @access Private (Applicant)
 * @query action_type - Filter by action type
 * @query application_id - Filter by application ID
 */
router.get('/acknowledgements', auditLog('VIEW_ACKNOWLEDGEMENTS'), async (req, res, next) => {
  try {
    const acknowledgements = await acknowledgementService.getApplicantAcknowledgements(
      req.user.applicant_id,
      {
        actionType: req.query.action_type,
        applicationId: req.query.application_id
      }
    );

    res.status(200).json({
      success: true,
      data: acknowledgements
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route POST /api/v1/applicant/acknowledgements/check
 * @desc Check if applicant has accepted specific acknowledgments
 * @access Private (Applicant)
 * @body required_codes - Array of required checkbox codes
 * @body action_type - Optional action type to filter by
 */
router.post('/acknowledgements/check', auditLog('CHECK_ACKNOWLEDGEMENTS'), async (req, res, next) => {
  try {
    const { required_codes, action_type } = req.body;

    if (!required_codes || !Array.isArray(required_codes)) {
      throw new ApiError(400, 'Required codes array is required');
    }

    const check = await acknowledgementService.checkRequiredAcknowledgements(
      req.user.applicant_id,
      required_codes,
      { actionType: action_type }
    );

    res.status(200).json({
      success: true,
      data: check
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/v1/applicant/acknowledgements/summary
 * @desc Get acknowledgment summary for applicant
 * @access Private (Applicant)
 */
router.get('/acknowledgements/summary', auditLog('VIEW_ACKNOWLEDGEMENT_SUMMARY'), async (req, res, next) => {
  try {
    const summary = await acknowledgementService.getAcknowledgementSummary(req.user.applicant_id);

    res.status(200).json({
      success: true,
      data: summary
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route POST /api/v1/applicant/declaration
 * @desc Save a simple declaration acknowledgment
 * @access Private (Applicant)
 * @body declaration_name - Name of the declaration being accepted
 */
router.post('/declaration', auditLog('SAVE_DECLARATION'), async (req, res, next) => {
  try {
    const { declaration_name } = req.body;

    if (!declaration_name) {
      throw new ApiError(400, 'Declaration name is required');
    }

    // Determine action_type based on declaration_name
    let actionType = 'PROFILE_DECLARATION'; // default
    if (declaration_name === 'Mission Shakti Guidelines Declaration') {
      actionType = 'GUIDELINES_DECLARATION';
    } else if (declaration_name === 'File Upload Declaration') {
      actionType = 'PROFILE_DECLARATION';
    }

    // Check if already accepted
    const existing = await require('../models').ApplicantAcknowledgement.findOne({
      where: {
        applicant_id: req.user.applicant_id,
        checkbox_code: declaration_name,
        action_type: actionType
      }
    });

    if (existing) {
      return res.status(200).json({
        success: true,
        message: 'Declaration already acknowledged',
        data: existing
      });
    }

    // Save the acknowledgment
    const saved = await require('../models').ApplicantAcknowledgement.create({
      applicant_id: req.user.applicant_id,
      application_id: null, // Not linked to specific application
      action_type: actionType,
      checkbox_code: declaration_name,
      checkbox_label: declaration_name,
      ip_address: req.ip,
      user_agent: req.get('user-agent'),
      accepted_at: new Date()
    });

    res.status(201).json({
      success: true,
      message: 'Declaration acknowledged successfully',
      data: saved
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
