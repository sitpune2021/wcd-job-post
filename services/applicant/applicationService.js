// ============================================================================
// APPLICANT APPLICATION SERVICE
// ============================================================================
// Purpose: Job application management for applicants
// Table: ms_applications
// ============================================================================

const db = require('../../models');
const {
  ApplicantMaster,
  ApplicantPersonal,
  // CategoryMaster, // commented out
  ApplicantAddress,
  ApplicantEducation,
  ApplicantExperience,
  ApplicantSkill,
  ApplicantDocument,
  ApplicantAcknowledgement,
  Application,
  ApplicationStatusHistory,
  EligibilityResult,
  PostMaster,
  DistrictMaster,
  TalukaMaster,
  Component,
  EducationLevel,
  ExperienceDomain,
  SkillMaster,
  DocumentType
} = db;
const logger = require('../../config/logger');
const { ApiError } = require('../../middleware/errorHandler');
const { APPLICATION_STATUS } = require('../../constants/applicationStatus');
const { Op } = require('sequelize');
const applicationRestrictionService = require('../applicationRestrictionService');

// NOTE: Max applications are now controlled by applicationRestrictionService (ENV-driven)

// ==================== APPLICATION OPERATIONS ====================

/**
 * Get eligible posts for applicant
 * @param {number} applicantId - Applicant ID
 * @returns {Promise<Array>} - List of active posts
 */
const getEligiblePosts = async (applicantId) => {
  try {
    // Get all active posts
    const posts = await PostMaster.findAll({
      where: {
        is_active: true,
        is_deleted: false
      },
      include: [{ model: Component, as: 'component' }],
      order: [['updated_at', 'DESC'], ['created_at', 'DESC'], ['post_id', 'DESC']]
    });

    return posts;
  } catch (error) {
    logger.error('Get eligible posts error:', error);
    throw error;
  }
};

const getApplicationStatusList = async (applicantId, query = {}) => {
  try {
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 10));
    const offset = (page - 1) * limit;

    const q = (query.q || query.search || '').toString().trim();
    const statusFilter = (query.status || '').toString().trim();
    const year = query.year ? parseInt(query.year, 10) : null;
    const postId = query.post_id ? parseInt(query.post_id, 10) : null;
    const districtId = query.district_id ? parseInt(query.district_id, 10) : null;
    const sortDir = (query.sort_dir || 'DESC').toString().toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const normalizeStatus = (raw) => {
      if (!raw) return null;
      const s = raw.toString().trim().toUpperCase().replace(/\s+/g, '_');
      if (s === 'HOLD' || s === 'ONHOLD' || s === 'ON-HOLD') return APPLICATION_STATUS.ON_HOLD;
      if (s === 'REJECT' || s === 'REJECTED') return APPLICATION_STATUS.REJECTED;
      if (s === 'SELECT' || s === 'SELECTED') return APPLICATION_STATUS.SELECTED;
      if (s === 'NOTELIGIBLE' || s === 'NOT-ELIGIBLE') return APPLICATION_STATUS.NOT_ELIGIBLE;
      if (s === 'UNDERREVIEW' || s === 'UNDER-REVIEW') return APPLICATION_STATUS.UNDER_REVIEW;
      return s;
    };

    const where = { applicant_id: applicantId };
    const andConditions = [];
    if (statusFilter) {
      const statuses = statusFilter
        .split(',')
        .map((s) => normalizeStatus(s))
        .filter(Boolean);
      if (statuses.length > 0) {
        where.status = { [Op.in]: statuses };
      }
    }
    if (Number.isFinite(postId)) where.post_id = postId;
    if (Number.isFinite(districtId)) where.district_id = districtId;

    if (Number.isFinite(year) && year > 1900) {
      const start = new Date(Date.UTC(year, 0, 1, 0, 0, 0));
      const end = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));
      andConditions.push({
        [Op.or]: [
          { submitted_at: { [Op.between]: [start, end] } },
          { submitted_at: null, created_at: { [Op.between]: [start, end] } }
        ]
      });
    }

    const include = [
      {
        model: PostMaster,
        as: 'post',
        required: true,
        attributes: ['post_id', 'post_code', 'post_name', 'post_name_mr'],
        include: [
          {
            model: Component,
            as: 'component',
            required: false,
            attributes: ['component_id', 'component_code', 'component_name', 'component_name_mr']
          }
        ]
      },
      {
        model: DistrictMaster,
        as: 'district',
        required: false,
        attributes: ['district_id', 'district_name', 'district_name_mr']
      }
    ];

    if (q) {
      const orConditions = [
        { application_no: { [Op.iLike]: `%${q}%` } },
        { '$post.post_name$': { [Op.iLike]: `%${q}%` } },
        { '$post.post_name_mr$': { [Op.iLike]: `%${q}%` } },
        { '$post.post_code$': { [Op.iLike]: `%${q}%` } },
        { '$post.component.component_name$': { [Op.iLike]: `%${q}%` } },
        { '$post.component.component_name_mr$': { [Op.iLike]: `%${q}%` } },
        { '$post.component.component_code$': { [Op.iLike]: `%${q}%` } },
        { '$district.district_name$': { [Op.iLike]: `%${q}%` } },
        { '$district.district_name_mr$': { [Op.iLike]: `%${q}%` } }
      ];

      const qAsNumber = parseInt(q, 10);
      if (Number.isFinite(qAsNumber)) {
        orConditions.push(
          { application_id: qAsNumber },
          { post_id: qAsNumber },
          { district_id: qAsNumber },
          { '$post.component.component_id$': qAsNumber }
        );
      }

      const qAsStatus = normalizeStatus(q);
      if (qAsStatus) {
        orConditions.push({ status: qAsStatus });
      }

      andConditions.push({ [Op.or]: orConditions });
    }

    if (andConditions.length > 0) {
      where[Op.and] = andConditions;
    }

    const order = [
      [
        Application.sequelize.literal('COALESCE("Application"."submitted_at", "Application"."created_at")'),
        sortDir
      ],
      ['application_id', sortDir]
    ];

    const { rows, count } = await Application.findAndCountAll({
      where,
      include,
      attributes: [
        'application_id',
        'application_no',
        'post_id',
        'district_id',
        'status',
        'is_locked',
        'declaration_accepted',
        'submitted_at',
        'system_eligibility',
        'system_eligibility_reason',
        'merit_score',
        'created_at',
        'updated_at'
      ],
      order,
      limit,
      offset,
      distinct: true,
      subQuery: false
    });

    const items = rows.map((r) => r.toJSON());
    const applicationIds = items.map((a) => a.application_id);

    const latestStatusByAppId = new Map();
    if (applicationIds.length > 0) {
      const historyRows = await ApplicationStatusHistory.findAll({
        where: { application_id: { [Op.in]: applicationIds } },
        attributes: ['history_id', 'application_id', 'old_status', 'new_status', 'changed_by_type', 'remarks', 'created_at'],
        order: [['application_id', 'ASC'], ['created_at', 'DESC']]
      });

      for (const h of historyRows) {
        const json = h.toJSON();
        if (!latestStatusByAppId.has(json.application_id)) {
          latestStatusByAppId.set(json.application_id, json);
        }
      }
    }

    items.forEach((a) => {
      a.latest_status_event = latestStatusByAppId.get(a.application_id) || null;
    });

    const totalPages = Math.max(1, Math.ceil((count || 0) / limit));

    return {
      applications: items,
      pagination: {
        total: count || 0,
        page,
        limit,
        totalPages
      },
      filters: {
        q: q || null,
        status: statusFilter || null,
        post_id: Number.isFinite(postId) ? postId : null,
        district_id: Number.isFinite(districtId) ? districtId : null,
        year: Number.isFinite(year) ? year : null,
        sort_dir: sortDir
      }
    };
  } catch (error) {
    logger.error('Get application status list error:', error);
    throw error;
  }
};

/**
 * Create draft application for a post
 * @param {number} applicantId - Applicant ID
 * @param {Object} data - Application data with eligibility
 * @param {Object} transaction - Optional Sequelize transaction
 * @returns {Promise<Object>} - Created draft application
 */
const createApplication = async (applicantId, data, transaction = null) => {
  const { post_id, district_id, eligibility } = data;

  try {
    // If applicant is already selected in any post, do not allow applying to any other post
    const alreadySelected = await Application.findOne({
      where: {
        applicant_id: applicantId,
        is_deleted: false,
        [Op.or]: [
          { selection_status: APPLICATION_STATUS.SELECTED },
          { status: APPLICATION_STATUS.SELECTED }
        ]
      },
      attributes: ['application_id', 'post_id']
    });

    if (alreadySelected) {
      throw new ApiError(400, 'You have already been selected in a post. You cannot apply to any other post.');
    }

    // Check restriction service (post name + OSC + district limits)
    const restrictionCheck = await applicationRestrictionService.canApplyToPost(applicantId, post_id, district_id);
    if (!restrictionCheck.allowed) {
      throw new ApiError(400, restrictionCheck.reason);
    }


    // Check if post exists and is active
    const post = await PostMaster.findByPk(post_id, {
      include: [{ model: Component, as: 'component' }]
    });
    if (!post || !post.is_active) {
      throw new ApiError(400, 'Invalid or inactive post');
    }

    // Check if post is closed
    if (post.is_closed) {
      throw new ApiError(400, 'This post is closed for applications');
    }

    // Check closing date
    if (post.closing_date) {
      const closing = new Date(post.closing_date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (closing < today) {
        throw new ApiError(400, 'This post is closed for applications');
      }
    }

    // Generate application number
    // Check if already applied for this post
    const existing = await Application.findOne({
      where: { applicant_id: applicantId, post_id: post_id }
    });

    if (existing) {
      throw new ApiError(400, 'You have already applied for this post');
    }

    // Get applicant personal data for snapshot
    const personal = await ApplicantPersonal.findOne({ where: { applicant_id: applicantId } });
    const address = await ApplicantAddress.findOne({ where: { applicant_id: applicantId } });

    if (!personal || !address) {
      throw new ApiError(400, 'Please complete your profile before applying');
    }

    const finalDistrictId = district_id || post.district_id;
    if (!finalDistrictId) {
      throw new ApiError(400, 'Post district is not configured. Please contact administration.');
    }

    // Create draft application
    const application = await Application.create({
      applicant_id: applicantId,
      post_id,
      district_id: finalDistrictId,
      status: 'DRAFT',
      is_locked: false,
      declaration_accepted: false,
      // Snapshot applicant data at time of application
      gender: personal.gender,
      date_of_birth: personal.dob,
      aadhaar_number: personal.aadhar_no,
      address_line1: address.address_line,
      city: address.city,
      pincode: address.pincode,
      is_local_resident: personal.domicile_maharashtra,
      // Store eligibility result
      system_eligibility: eligibility?.isEligible || null,
      system_eligibility_reason: eligibility?.failedChecks?.join('; ') || null
    }, transaction ? { transaction } : {});

    logger.info(`Draft application created for applicant: ${applicantId}, post: ${post_id}`);

    // Fetch with relations
    const createdApp = await Application.findByPk(application.application_id, {
      include: [
        { model: PostMaster, as: 'post', include: [{ model: Component, as: 'component' }] },
        { model: DistrictMaster, as: 'district' }
      ],
      transaction
    });

    return {
      application: createdApp,
      eligibility: eligibility
    };
  } catch (error) {
    logger.error('Create application error:', error);
    throw error;
  }
};

/**
 * Final submit application with acknowledgment
 * Automatically runs eligibility check and sets final status (ELIGIBLE/NOT_ELIGIBLE)
 * @param {number} applicantId - Applicant ID
 * @param {number} applicationId - Application ID
 * @param {boolean} declarationAccepted - Whether declaration was accepted
 * @param {Object} meta - Metadata (ip_address, user_agent, place)
 * @param {Object} transaction - Optional Sequelize transaction
 * @returns {Promise<Object>} - Submitted application with eligibility result
 */
const finalSubmitApplication = async (applicantId, applicationId, declarationAccepted, meta = {}, transaction = null) => {
  try {
    // Find the draft application
    const application = await Application.findOne({
      where: {
        application_id: applicationId,
        applicant_id: applicantId,
        status: APPLICATION_STATUS.DRAFT
      },
      transaction
    });

    if (!application) {
      throw new ApiError(404, 'Draft application not found or already submitted');
    }

    if (application.is_locked) {
      throw new ApiError(400, 'This application is already locked');
    }

    // Run eligibility and document checks
    const eligibilityService = require('../eligibilityService');
    const [eligibilityResult, docCheck] = await Promise.all([
      eligibilityService.checkEligibility(applicantId, application.post_id),
      eligibilityService.checkRequiredDocuments(applicantId, application.post_id)
    ]);

    // Determine final eligibility (must pass both eligibility and have all required docs)
    const isEligible = eligibilityResult.isEligible && docCheck.complete;
    const finalStatus = isEligible ? APPLICATION_STATUS.ELIGIBLE : APPLICATION_STATUS.NOT_ELIGIBLE;

    // Build eligibility reason
    let eligibilityReason = null;
    if (!isEligible) {
      const reasons = [];
      if (eligibilityResult.failedChecks && eligibilityResult.failedChecks.length > 0) {
        reasons.push(...eligibilityResult.failedChecks);
      }
      if (!docCheck.complete && docCheck.missing && docCheck.missing.length > 0) {
        reasons.push(`Missing documents: ${docCheck.missing.map(d => d.doc_name || d.doc_code).join(', ')}`);
      }
      eligibilityReason = reasons.join('; ');
    }

    // Generate unique application number
    const applicationNo = await application.constructor.generateApplicationNo();

    // Update application with submission + eligibility result
    const submissionTimestamp = new Date();

    await application.update({
      application_no: applicationNo,
      status: finalStatus, // persist final status instead of leaving as SUBMITTED
      selection_status: null,
      is_locked: true,
      declaration_accepted: declarationAccepted,
      submitted_at: submissionTimestamp,
      system_eligibility: isEligible,
      system_eligibility_reason: eligibilityReason,
      eligibility_checked_at: submissionTimestamp
    }, transaction ? { transaction } : {});

    // Store declaration acceptance as a durable acknowledgement record
    await ApplicantAcknowledgement.create({
      applicant_id: applicantId,
      application_id: applicationId,
      action_type: 'APPLICATION_DECLARATION',
      checkbox_code: 'DECLARATION_ACCEPTED',
      checkbox_label: 'Declaration accepted and submitted',
      accepted_at: submissionTimestamp,
      ip_address: meta?.ip_address || null,
      user_agent: meta?.user_agent || null,
      place: meta?.place || null
    }, transaction ? { transaction } : {});

    // Save eligibility result snapshot
    let eligResult = await EligibilityResult.findOne({ where: { application_id: applicationId }, transaction });
    if (eligResult) {
      await eligResult.update({
        is_eligible: isEligible,
        eligibility_criteria: JSON.stringify(eligibilityResult.checks || []),
        checked_at: submissionTimestamp
      }, transaction ? { transaction } : {});
    } else {
      eligResult = await EligibilityResult.create({
        application_id: applicationId,
        is_eligible: isEligible,
        eligibility_criteria: JSON.stringify(eligibilityResult.checks || []),
        checked_at: submissionTimestamp
      }, transaction ? { transaction } : {});
    }

    // Record status history: DRAFT -> (submit) -> ELIGIBLE/NOT_ELIGIBLE
    const workflowService = require('../applicationWorkflowService');

    // Record submission
    await db.ApplicationStatusHistory.create({
      application_id: applicationId,
      old_status: APPLICATION_STATUS.DRAFT,
      new_status: APPLICATION_STATUS.SUBMITTED,
      changed_by_type: 'APPLICANT',
      remarks: 'Declaration accepted and submitted',
      metadata: { submitted_at: submissionTimestamp, declaration_accepted: declarationAccepted },
      created_at: submissionTimestamp
    }, transaction ? { transaction } : {});

    // Record eligibility result
    await db.ApplicationStatusHistory.create({
      application_id: applicationId,
      old_status: APPLICATION_STATUS.SUBMITTED,
      new_status: finalStatus,
      changed_by_type: 'SYSTEM',
      remarks: isEligible ? 'System eligibility check passed' : 'System eligibility check failed',
      metadata: {
        eligibility_result: eligibilityResult,
        document_check: docCheck,
        checked_at: submissionTimestamp
      },
      created_at: submissionTimestamp
    }, transaction ? { transaction } : {});

    // NOTE: Merit score is NOT calculated here anymore - it's computed live when needed
    // (e.g., in review/merit list pages) to avoid slowing down application submission

    logger.info(`Application ${applicationNo} submitted and processed: ${finalStatus} by applicant: ${applicantId}`);

    // Fetch with full relations
    const submittedApp = await Application.findByPk(application.application_id, {
      include: [
        { model: PostMaster, as: 'post', include: [{ model: Component, as: 'component' }] },
        { model: DistrictMaster, as: 'district' },
        { model: EligibilityResult, as: 'eligibility' }
      ],
      transaction
    });

    return {
      message: isEligible
        ? 'Application submitted successfully. You are eligible for this post.'
        : 'Application submitted. Unfortunately, you do not meet the eligibility criteria.',
      application_no: applicationNo,
      submitted_at: submittedApp.submitted_at,
      status: finalStatus,
      is_eligible: isEligible,
      eligibility_reason: eligibilityReason,
      eligibility_checks: eligibilityResult.checks,
      document_check: docCheck,
      merit_score: submittedApp.merit_score,
      application: submittedApp
    };
  } catch (error) {
    logger.error('Final submit application error:', error);
    throw error;
  }
};

/**
 * Get all applications for applicant with computed readiness
 * @param {number} applicantId - Applicant ID
 * @returns {Promise<Object>} - List of applications with status summary and readiness info
 */
const getApplications = async (applicantId) => {
  try {
    const applications = await Application.findAll({
      where: { applicant_id: applicantId },
      include: [
        { model: PostMaster, as: 'post', include: [{ model: Component, as: 'component' }] },
        { model: DistrictMaster, as: 'district' },
        { model: EligibilityResult, as: 'eligibility' }
      ],
      order: [['created_at', 'DESC']]
    });

    // For draft applications, compute readiness on-the-fly
    const eligibilityService = require('../eligibilityService');
    const enrichedApplications = await Promise.all(applications.map(async (app) => {
      const appJson = app.toJSON();

      // Add readiness info for draft applications
      if (app.status === APPLICATION_STATUS.DRAFT) {
        try {
          const [eligibility, docCheck] = await Promise.all([
            eligibilityService.checkEligibility(applicantId, app.post_id),
            eligibilityService.checkRequiredDocuments(applicantId, app.post_id)
          ]);

          appJson.readiness = {
            isEligible: eligibility.isEligible,
            eligibilityChecks: eligibility.checks,
            failedChecks: eligibility.failedChecks,
            documentsComplete: docCheck.complete,
            missingDocuments: docCheck.missing,
            canSubmit: eligibility.isEligible && docCheck.complete
          };
        } catch (e) {
          logger.warn(`Could not compute readiness for app ${app.application_id}:`, e.message);
          appJson.readiness = { error: 'Could not compute readiness' };
        }
      } else {
        // For submitted/processed applications, show stored eligibility
        appJson.readiness = {
          isEligible: app.system_eligibility,
          reason: app.system_eligibility_reason,
          checkedAt: app.eligibility_checked_at
        };
      }

      return appJson;
    }));

    // Add status summary
    const summary = {
      total: applications.length,
      draft: applications.filter(a => a.status === APPLICATION_STATUS.DRAFT).length,
      submitted: applications.filter(a => a.status === APPLICATION_STATUS.SUBMITTED).length,
      eligible: applications.filter(a => a.status === APPLICATION_STATUS.ELIGIBLE).length,
      not_eligible: applications.filter(a => a.status === APPLICATION_STATUS.NOT_ELIGIBLE).length,
      on_hold: applications.filter(a => a.status === APPLICATION_STATUS.ON_HOLD).length,
      selected: applications.filter(a => a.status === APPLICATION_STATUS.SELECTED).length,
      rejected: applications.filter(a => a.status === APPLICATION_STATUS.REJECTED).length
    };

    return {
      applications: enrichedApplications,
      summary
    };
  } catch (error) {
    logger.error('Get applications error:', error);
    throw error;
  }
};

/**
 * Get application by ID with full details, readiness, and history
 * @param {number} applicantId - Applicant ID
 * @param {number} applicationId - Application ID
 * @returns {Promise<Object>} - Application details with readiness and history
 */
const getApplicationById = async (applicantId, applicationId) => {
  try {
    const application = await Application.findOne({
      where: { application_id: applicationId, applicant_id: applicantId },
      include: [
        { model: PostMaster, as: 'post', include: [{ model: Component, as: 'component' }] },
        { model: DistrictMaster, as: 'district' },
        { model: EligibilityResult, as: 'eligibility' },
        {
          model: ApplicationStatusHistory,
          as: 'statusHistory',
          order: [['created_at', 'DESC']],
          limit: 20
        },
        {
          model: ApplicantMaster,
          as: 'applicant',
          required: false,
          include: [
            { model: ApplicantPersonal, as: 'personal', required: false },
            {
              model: ApplicantAddress,
              as: 'address',
              required: false,
              include: [
                { model: DistrictMaster, as: 'district', required: false },
                { model: TalukaMaster, as: 'taluka', required: false },
                { model: DistrictMaster, as: 'permanentDistrict', required: false },
                { model: TalukaMaster, as: 'permanentTaluka', required: false }
              ]
            },
            {
              model: ApplicantEducation,
              as: 'education',
              required: false,
              include: [{ model: EducationLevel, as: 'educationLevel', required: false }]
            },
            {
              model: ApplicantExperience,
              as: 'experience',
              required: false,
              include: [{ model: ExperienceDomain, as: 'domain', required: false }]
            },
            { model: ApplicantSkill, as: 'skills', required: false, include: [{ model: SkillMaster, as: 'skill', required: false }] },
            {
              model: ApplicantDocument,
              as: 'documents',
              required: false,
              include: [{ model: DocumentType, as: 'documentType', required: false }]
            }
          ]
        }
      ]
    });

    if (!application) {
      throw new ApiError(404, 'Application not found');
    }

    const { getRelativePath } = require('../../utils/fileUpload');
    const appJson = application.get({ plain: true });
    const applicant = appJson.applicant;

    // Normalize media paths
    if (applicant?.personal) {
      const p = applicant.personal;
      const normalize = (val) =>
        val ? '/' + String(getRelativePath(val)).replace(/\\/g, '/').replace(/^\/+/, '') : null;
      p.photo_path = normalize(p.photo_path);
      p.signature_path = normalize(p.signature_path);
      p.aadhaar_path = normalize(p.aadhaar_path);
      p.pan_path = normalize(p.pan_path);
      p.resume_path = normalize(p.resume_path);
      p.domicile_path = normalize(p.domicile_path);

      // Surface identifiers directly
      p.aadhar_no = p.aadhar_no || p.aadhaar_no || null;
    }

    if (Array.isArray(applicant?.documents)) {
      applicant.documents.forEach((doc) => {
        const normalize = (val) =>
          val ? '/' + String(getRelativePath(val)).replace(/\\/g, '/').replace(/^\/+/, '') : null;
        doc.file_path = normalize(doc.file_path);
        doc.compressed_path = normalize(doc.compressed_path);
        doc.thumbnail_path = normalize(doc.thumbnail_path);
      });
    }

    // Compute readiness for draft applications
    if (application.status === APPLICATION_STATUS.DRAFT) {
      try {
        const eligibilityService = require('../eligibilityService');
        const [eligibility, docCheck] = await Promise.all([
          eligibilityService.checkEligibility(applicantId, application.post_id),
          eligibilityService.checkRequiredDocuments(applicantId, application.post_id)
        ]);

        appJson.readiness = {
          isEligible: eligibility.isEligible,
          eligibilityChecks: eligibility.checks,
          failedChecks: eligibility.failedChecks,
          warnings: eligibility.warnings,
          documentsComplete: docCheck.complete,
          missingDocuments: docCheck.missing,
          uploadedDocuments: docCheck.uploaded,
          canSubmit: eligibility.isEligible && docCheck.complete
        };
      } catch (e) {
        logger.warn(`Could not compute readiness for app ${applicationId}:`, e.message);
        appJson.readiness = { error: 'Could not compute readiness' };
      }
    } else {
      // For submitted/processed applications, show stored eligibility
      appJson.readiness = {
        isEligible: application.system_eligibility,
        reason: application.system_eligibility_reason,
        checkedAt: application.eligibility_checked_at,
        meritScore: application.merit_score
      };
    }

    return appJson;
  } catch (error) {
    logger.error('Get application error:', error);
    throw error;
  }
};

/**
 * Get applicant statistics for admin dashboard
 * @returns {Promise<Object>} - Statistics
 */
const getStatistics = async () => {
  try {
    const totalApplicants = await ApplicantMaster.count({ where: { is_deleted: false } });
    const verifiedApplicants = await ApplicantMaster.count({ where: { is_verified: true, is_deleted: false } });
    const totalApplications = await Application.count();
    const submittedApplications = await Application.count({ where: { status: 'SUBMITTED' } });

    // Applications by status
    const byStatus = await Application.findAll({
      attributes: ['status', [db.sequelize.fn('COUNT', db.sequelize.col('application_id')), 'count']],
      group: ['status']
    });

    return {
      applicants: {
        total: totalApplicants,
        verified: verifiedApplicants,
        unverified: totalApplicants - verifiedApplicants
      },
      applications: {
        total: totalApplications,
        submitted: submittedApplications,
        byStatus: byStatus.reduce((acc, s) => { acc[s.status] = parseInt(s.dataValues.count); return acc; }, {})
      }
    };
  } catch (error) {
    logger.error('Get statistics error:', error);
    throw error;
  }
};

module.exports = {
  getEligiblePosts,
  createApplication,
  finalSubmitApplication,
  getApplications,
  getApplicationStatusList,
  getApplicationById,
  getStatistics
};
