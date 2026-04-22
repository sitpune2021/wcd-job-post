// ============================================================================
// ADMIN APPLICATION REVIEW SERVICE
// ============================================================================
// Purpose: Admin APIs for reviewing applications, merit lists, and bulk actions
// ============================================================================

const db = require('../../models');
const {
  Application,
  ApplicantMaster,
  ApplicantPersonal,
  ApplicantAddress,
  // CategoryMaster,
  ApplicantEducation,
  EducationLevel,
  ApplicantExperience,
  ApplicantSkill,
  ApplicantDocument,
  DocumentType,
  SkillMaster,
  PostMaster,
  DistrictMaster,
  TalukaMaster,
  Hub,
  Component,
  EligibilityResult,
  ApplicationStatusHistory
} = db;
const logger = require('../../config/logger');
const cache = require('../../utils/cache');
const { ApiError } = require('../../middleware/errorHandler');
const { APPLICATION_STATUS, ACTOR_TYPE } = require('../../constants/applicationStatus');
const { Op } = require('sequelize');
const applicantDocumentService = require('../applicant/documentService');
const { getRelativePath } = require('../../utils/fileUpload');
const { calculateMeritScore } = require('../applicationWorkflowService');

// ==================== POSTS FOR MERIT REVIEW ====================

/**
 * Get posts with application counts for admin merit page
 * @param {Object} filters - Optional filters { component_id, district_id, search }
 * @returns {Promise<Array>} - List of posts with counts
 */
const getActivePostsWithCounts = async (filters = {}) => {
  try {
    // Create cache key
    const cacheKey = `active_posts_counts:${JSON.stringify(filters)}`;

    // Try cache first
    const cachedResult = await cache.get(cacheKey);
    if (cachedResult) {
      logger.info('Active posts with counts retrieved from cache');
      return cachedResult;
    }

    const whereClause = {
      is_deleted: false
    };

    if (filters.component_id) {
      whereClause.component_id = filters.component_id;
    }

    if (filters.district_id) {
      whereClause.district_id = filters.district_id;
    }

    if (filters.hub_id) {
      whereClause.hub_id = filters.hub_id;
    }

    // Text search across post/component/district (en + mr)
    const search = (filters.search || '').trim();
    if (search) {
      const like = { [Op.iLike]: `%${search}%` };
      whereClause[Op.or] = [
        { post_name: like },
        { post_name_mr: like },
        { post_code: like },
        { '$component.component_name$': like },
        { '$component.component_name_mr$': like },
        { '$district.district_name$': like },
        { '$district.district_name_mr$': like }
      ];
    }

    const posts = await PostMaster.findAll({
      where: whereClause,
      attributes: [
        'post_id',
        'post_name',
        'post_name_mr',
        'component_id',
        'hub_id',
        'district_id',
        'post_code',
        'description',
        'description_mr'
      ],
      include: [
        { model: Component, as: 'component', required: false, attributes: ['component_id', 'component_code', 'component_name', 'component_name_mr'] },
        { model: DistrictMaster, as: 'district', required: false, attributes: ['district_id', 'district_name', 'district_name_mr'] },
        { model: Hub, as: 'hub', required: false, attributes: ['hub_id', 'hub_name', 'hub_name_mr'] }
      ],
      order: [['updated_at', 'DESC'], ['created_at', 'DESC'], ['post_id', 'DESC']]
    });

    if (!posts.length) return [];

    // Batch fetch application counts for all posts in one query for speed
    const postIds = posts.map((p) => p.post_id);
    const [countRows] = await db.sequelize.query(`
      SELECT 
        post_id,
        COUNT(*) FILTER (WHERE status = 'DRAFT') as draft_count,
        COUNT(*) FILTER (WHERE status = 'SUBMITTED') as submitted_count,
        COUNT(*) FILTER (WHERE status = 'ELIGIBLE') as eligible_count,
        COUNT(*) FILTER (WHERE status = 'NOT_ELIGIBLE') as not_eligible_count,
        COUNT(*) FILTER (WHERE status = 'ON_HOLD') as on_hold_count,
        COUNT(*) FILTER (WHERE status = 'PROVISIONAL_SELECTED') as provisional_selected_count,
        COUNT(*) FILTER (WHERE status = 'SELECTED') as selected_count,
        COUNT(*) FILTER (WHERE status = 'REJECTED') as rejected_count,
        COUNT(*) as total_count
      FROM ms_applications
      WHERE post_id IN (:postIds) AND is_deleted = false
      GROUP BY post_id
    `, { replacements: { postIds } });

    const countsMap = countRows.reduce((acc, row) => {
      acc[row.post_id] = row;
      return acc;
    }, {});

    const result = posts.map((post) => {
      const postJson = post.toJSON();
      postJson.application_counts = countsMap[post.post_id] || {
        draft_count: 0,
        submitted_count: 0,
        eligible_count: 0,
        not_eligible_count: 0,
        on_hold_count: 0,
        provisional_selected_count: 0,
        selected_count: 0,
        rejected_count: 0,
        total_count: 0
      };
      return postJson;
    });

    // Cache for 2 minutes
    await cache.set(cacheKey, result, 120);
    logger.info(`Active posts with counts cached: ${result.length} posts`);

    return result;
  } catch (error) {
    logger.error('Get active posts with counts error:', error);
    throw error;
  }
};

// ==================== APPLICATIONS FOR A POST (MERIT VIEW) ====================

/**
 * Get applications for a specific post, ordered by merit score
 * @param {number} postId - Post ID
 * @param {Object} filters - { status, district_id, search, page, limit }
 * @returns {Promise<Object>} - Paginated applications with summary
 */
const getApplicationsForPost = async (postId, filters = {}) => {
  try {
    const cacheKey = `admin_post_apps:${postId}:${JSON.stringify(filters)}`;

    // Short cache (60s) to shield DB from repeated heavy pulls
    const cached = await cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const {
      status = APPLICATION_STATUS.ELIGIBLE,
      district_id,
      search,
      page = 1,
      limit = 50,
      adminUser
    } = filters;

    // Build where clause - ONLY truly submitted applications
    const whereClause = {
      post_id: postId,
      declaration_accepted: true,
      submitted_at: { [Op.ne]: null }
    };

    // Special handling for ELIGIBLE: show ALL submitted applications
    // For other statuses: filter by specific status
    if (status && status !== APPLICATION_STATUS.ELIGIBLE) {
      if (Array.isArray(status)) {
        whereClause.status = { [Op.in]: status };
      } else {
        whereClause.status = status;
      }
    }

    if (district_id) {
      whereClause.district_id = district_id;
    }

    // Build applicant search if provided
    let applicantWhere = {};
    if (search) {
      applicantWhere = {
        [Op.or]: [
          { '$applicant.personal.full_name$': { [Op.iLike]: `%${search}%` } },
          { '$applicant.email$': { [Op.iLike]: `%${search}%` } },
          { '$applicant.mobile_no$': { [Op.iLike]: `%${search}%` } },
          { application_no: { [Op.iLike]: `%${search}%` } }
        ]
      };
    }

    const offset = (page - 1) * limit;

    // Get total count
    const totalCount = await Application.count({
      where: { ...whereClause, ...applicantWhere },
      include: [{
        model: ApplicantMaster,
        as: 'applicant',
        required: false,
        attributes: { exclude: ['password_hash', 'password_reset_token', 'password_reset_token_expires_at', 'activation_token', 'activation_token_expires_at'] },
        include: [{ model: ApplicantPersonal, as: 'personal', required: false }]
      }]
    });

    // Fetch ALL applications for this post (we'll calculate merit scores and sort in-memory)
    const applications = await Application.findAll({
      where: { ...whereClause, ...applicantWhere },
      include: [
        { model: DistrictMaster, as: 'district', required: false, attributes: ['district_id', 'district_name', 'district_name_mr'] },
        { model: EligibilityResult, as: 'eligibility', required: false },
        { model: PostMaster, as: 'post', required: false },
        {
          model: db.ApplicantMaster,
          as: 'applicant',
          required: false,
          attributes: { exclude: ['password_hash', 'password_reset_token', 'password_reset_token_expires_at', 'activation_token', 'activation_token_expires_at'] },
          include: [
            { model: db.ApplicantPersonal, as: 'personal', required: false },
            {
              model: db.ApplicantAddress,
              as: 'address',
              attributes: ['address_id', 'permanent_district_id'],
              required: false,
              include: [
                {
                  model: db.DistrictMaster,
                  as: 'permanentDistrict',
                  attributes: ['district_id', 'district_name', 'district_name_mr'],
                  required: false
                }
              ]
            },
            {
              model: ApplicantEducation,
              as: 'education',
              required: false,
              include: [{ 
                model: EducationLevel, 
                as: 'educationLevel', 
                required: false 
              }],
              order: [
                [{ model: EducationLevel, as: 'educationLevel' }, 'display_order', 'ASC'],
                ['passing_year', 'DESC']
              ]
            },
            { model: ApplicantExperience, as: 'experience', required: false }
          ]
        }
      ],
      order: [
        ['submitted_at', 'ASC'],
        ['application_no', 'ASC']
      ]
    });

    logger.info(`Calculating merit scores for ${applications.length} applications in post ${postId}`);

    // Calculate merit score for each application in-memory
    const applicationsWithScores = await Promise.all(applications.map(async (app) => {
      try {
        // PERF: Passing the pre-fetched app object avoids N+1 queries for 50,000+ records
        const score = await calculateMeritScore(app);
        return { ...app.toJSON(), calculated_merit_score: score };
      } catch (error) {
        logger.error(`Failed to calculate merit score for application ${app.application_id}:`, error);
        return { ...app.toJSON(), calculated_merit_score: 0 };
      }
    }));

    // Sort by calculated merit score (descending), then submission time, then app number
    applicationsWithScores.sort((a, b) => {
      if (b.calculated_merit_score !== a.calculated_merit_score) {
        return b.calculated_merit_score - a.calculated_merit_score;
      }
      if (a.submitted_at && b.submitted_at) {
        const timeCompare = new Date(a.submitted_at) - new Date(b.submitted_at);
        if (timeCompare !== 0) return timeCompare;
      }
      return (a.application_no || '').localeCompare(b.application_no || '');
    });

    // Apply batch filtering if user has assigned batch range
    let batchInfo = null;
    let filteredApplications = applicationsWithScores;
    
    if (adminUser && adminUser.review_batch_start && adminUser.review_batch_end) {
      const startRank = adminUser.review_batch_start;
      const endRank = adminUser.review_batch_end;
      
      // Filter by rank range (1-indexed)
      filteredApplications = applicationsWithScores.filter((app, index) => {
        const rank = index + 1; // Convert 0-indexed to 1-indexed rank
        return rank >= startRank && rank <= endRank;
      });
      
      batchInfo = {
        batch_start: startRank,
        batch_end: endRank,
        batch_size: endRank - startRank + 1,
        is_filtered: true,
        note: 'Global rank range - applies to all posts'
      };
    } else {
      batchInfo = {
        batch_start: null,
        batch_end: null,
        batch_size: null,
        is_filtered: false,
        note: 'No rank range assigned - sees all applications'
      };
    }

    // Apply pagination after filtering
    const paginatedApplications = filteredApplications.slice(offset, offset + parseInt(limit));

    // Get status summary for this post (only submitted applications)
    const [statusSummary] = await db.sequelize.query(`
      SELECT status, COUNT(*) as count
      FROM ms_applications
      WHERE post_id = :postId 
        AND declaration_accepted = true 
        AND submitted_at IS NOT NULL
      GROUP BY status
    `, { replacements: { postId } });

    const statusKeys = [
      APPLICATION_STATUS.ELIGIBLE,
      APPLICATION_STATUS.ON_HOLD,
      APPLICATION_STATUS.PROVISIONAL_SELECTED,
      APPLICATION_STATUS.SELECTED,
      APPLICATION_STATUS.SELECTED_IN_OTHER_POST,
      APPLICATION_STATUS.REJECTED
    ];

    const normalizedStatusSummary = statusKeys.reduce((acc, key) => {
      acc[key] = 0;
      return acc;
    }, {});

    statusSummary.forEach((s) => {
      if (s?.status) {
        normalizedStatusSummary[s.status] = parseInt(s.count);
      }
    });

    const postDetails = await PostMaster.findByPk(postId, {
      include: [
        { model: Component, as: 'component', attributes: ['component_id', 'component_name', 'component_name_mr'] },
        { model: DistrictMaster, as: 'district', attributes: ['district_id', 'district_name', 'district_name_mr'] }
      ]
    });

    // Batch fetch applicant-level aggregates for the current page to avoid N+1 queries
    const applicantIds = Array.from(new Set(paginatedApplications
      .map((a) => a.applicant_id)
      .filter(Boolean)));

    let applicantCountsMap = {};
    let applicantOtherPostsMap = {};

    if (applicantIds.length) {
      // Total applications per applicant
      const [counts] = await db.sequelize.query(`
        SELECT applicant_id, COUNT(*)::int AS total_applications
        FROM ms_applications
        WHERE applicant_id IN (:applicantIds)
          AND is_deleted = false
        GROUP BY applicant_id
      `, { replacements: { applicantIds } });

      applicantCountsMap = Object.fromEntries(
        (counts || []).map((row) => [row.applicant_id, row.total_applications])
      );

      // Other applied posts (excluding current post)
      const [otherPosts] = await db.sequelize.query(`
        SELECT 
          a.applicant_id,
          a.application_id,
          a.application_no,
          a.status,
          a.submitted_at,
          pm.post_id,
          pm.post_name,
          pm.post_code,
          dm.district_name
        FROM ms_applications a
        LEFT JOIN ms_post_master pm ON a.post_id = pm.post_id
        LEFT JOIN ms_district_master dm ON a.district_id = dm.district_id
        WHERE a.applicant_id IN (:applicantIds)
          AND a.post_id != :currentPostId
          AND a.is_deleted = false
        ORDER BY a.submitted_at DESC
      `, {
        replacements: { applicantIds, currentPostId: postId }
      });

      applicantOtherPostsMap = (otherPosts || []).reduce((acc, row) => {
        if (!acc[row.applicant_id]) acc[row.applicant_id] = [];
        acc[row.applicant_id].push(row);
        return acc;
      }, {});
    }

    // For each application, attach aggregated applicant data
    const applicationsWithDetails = paginatedApplications.map((app, index) => {
      const appJson = app; // Already JSON from previous step
      appJson.merit_rank = offset + index + 1;
      appJson.merit_score = app.calculated_merit_score; // Use calculated score

      appJson.applicant_total_applications = applicantCountsMap[appJson.applicant_id] || 0;
      appJson.applicant_other_applications = applicantOtherPostsMap[appJson.applicant_id] || [];

      return appJson;
    });
    // Build lightweight status summary (only non-zero entries)
    const filteredStatusSummary = Object.fromEntries(
      Object.entries(normalizedStatusSummary).filter(([, v]) => Number(v) > 0)
    );

    // Build lightweight post info
    const lightPost = postDetails
      ? {
        post_name: postDetails.post_name,
        post_code: postDetails.post_code,
        component: postDetails.component ? { component_name: postDetails.component.component_name } : null,
        district: postDetails.district ? { district_name: postDetails.district.district_name } : null
      }
      : null;

    // Trim application fields for response
    const trimmedApplications = applicationsWithDetails.map((app, idx) => {
      const applicant = app.applicant || {};
      const personal = applicant.personal || {};
      const address = applicant.address || {};
      const permanentDistrict = address.permanentDistrict || {};
      const education = Array.isArray(applicant.education) ? applicant.education[0] || null : null;
      const experience = Array.isArray(applicant.experience) ? applicant.experience[0] || null : null;

      const otherApps = Array.isArray(app.applicant_other_applications)
        ? app.applicant_other_applications.map((o) => ({
          application_no: o.application_no || null,
          status: o.status || null,
          post_name: o.post_name || null,
          post_code: o.post_code || null,
          district_name: o.district_name || null
        }))
        : [];

      return {
        application_id: app.application_id,
        application_no: app.application_no || null,
        status: app.status,
        applicant_total_applications: app.applicant_total_applications || 0,
        applicant_other_applications: otherApps,
        applicant: {
          personal: {
            full_name: personal.full_name || null
          },
          address: {
            permanentDistrict: {
              district_name: permanentDistrict.district_name || null
            }
          },
          education: education
            ? [{
              degree_name: education.degree_name || null,
              stream_subject: education.stream_subject || null,
              passing_year: education.passing_year || null,
              percentage: education.percentage || null,
              educationLevel: education.educationLevel
                ? {
                  level_name: education.educationLevel.level_name || null,
                  display_order: education.educationLevel.display_order || null
                }
                : null
            }]
            : [],
          experience: experience
            ? [{
              organization_name: experience.organization_name || null,
              designation: experience.designation || null,
              total_months: experience.total_months || null,
              start_date: experience.start_date || null,
              is_current: experience.is_current || false
            }]
            : []
        }
      };
    });

    const responsePayload = {
      applications: trimmedApplications,
      statusSummary: filteredStatusSummary,
      post: lightPost,
      batchInfo: batchInfo,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: filteredApplications.length, // Use filtered count for pagination
        totalPages: Math.ceil(filteredApplications.length / limit)
      }
    };

    // Cache the final response briefly
    await cache.set(cacheKey, responsePayload, 60);

    return responsePayload;
  } catch (error) {
    logger.error('Get applications for post error:', error);
    throw error;
  }
};

// ==================== ALL CANDIDATES VIEW ====================

/**
 * Get all candidates who have at least one application (draft or submitted)
 * @param {Object} filters - { status, post_id, district_id, search, page, limit }
 * @returns {Promise<Object>} - Paginated list of applications
 */
const getAllApplications = async (filters = {}) => {
  try {
    const {
      status,
      post_id,
      district_id,
      search,
      page = 1,
      limit = 50
    } = filters;

    const whereClause = {};

    if (status) {
      if (Array.isArray(status)) {
        whereClause.status = { [Op.in]: status };
      } else {
        whereClause.status = status;
      }
    }

    if (post_id) {
      whereClause.post_id = post_id;
    }

    if (district_id) {
      whereClause.district_id = district_id;
    }

    const offset = (page - 1) * limit;

    // Build search condition and lean includes (only required fields)
    let searchInclude = [{
      model: ApplicantMaster,
      as: 'applicant',
      required: false,
      attributes: ['applicant_id'],
      include: [
        { model: ApplicantPersonal, as: 'personal', required: false, attributes: ['full_name'] },
        {
          model: ApplicantAddress,
          as: 'address',
          required: false,
          attributes: ['address_id', 'permanent_district_id'],
          include: [
            {
              model: DistrictMaster,
              as: 'permanentDistrict',
              attributes: ['district_id', 'district_name'],
              required: false
            }
          ]
        }
      ]
    }];

    if (search) {
      whereClause[Op.or] = [
        { application_no: { [Op.iLike]: `%${search}%` } },
        { '$applicant.email$': { [Op.iLike]: `%${search}%` } },
        { '$applicant.mobile_no$': { [Op.iLike]: `%${search}%` } },
        { '$applicant.personal.full_name$': { [Op.iLike]: `%${search}%` } },
        { '$district.district_name$': { [Op.iLike]: `%${search}%` } },
        { '$district.district_name_mr$': { [Op.iLike]: `%${search}%` } },
        { '$post.post_name$': { [Op.iLike]: `%${search}%` } },
        { '$post.post_name_mr$': { [Op.iLike]: `%${search}%` } }
      ];
    }

    const { count, rows } = await Application.findAndCountAll({
      where: whereClause,
      attributes: ['application_id', 'application_no', 'status', 'submitted_at', 'applicant_id', 'post_id', 'district_id'],
      include: [
        ...searchInclude,
        { model: PostMaster, as: 'post', attributes: ['post_id', 'post_name'], required: false },
        { model: DistrictMaster, as: 'district', attributes: ['district_id', 'district_name'], required: false }
      ],
      order: [['created_at', 'DESC']],
      limit,
      offset,
      distinct: true,
      subQuery: false
    });

    // Get overall status summary
    const [statusSummary] = await db.sequelize.query(`
      SELECT status, COUNT(*) as count
      FROM ms_applications
      GROUP BY status
    `);

    return {
      applications: rows,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(count / limit)
      },
      statusSummary: statusSummary.reduce((acc, s) => {
        acc[s.status] = parseInt(s.count);
        return acc;
      }, {})
    };
  } catch (error) {
    logger.error('Get all applications error:', error);
    throw error;
  }
};

// ==================== BULK ACTIONS ====================

/**
 * Bulk update application status (hold/select/reject)
 * @param {Array<number>} applicationIds - Array of application IDs
 * @param {string} action - Action: ON_HOLD, SELECTED, REJECTED
 * @param {Object} options - { adminId, remarks }
 * @returns {Promise<Object>} - Result with success/failed counts
 */
const bulkUpdateStatus = async (applicationIds, action, options = {}) => {
  const { adminId, remarks = null } = options;

  // Validate action
  const validActions = [APPLICATION_STATUS.ON_HOLD, APPLICATION_STATUS.SELECTED, APPLICATION_STATUS.REJECTED];
  if (!validActions.includes(action)) {
    throw new ApiError(400, `Invalid action. Must be one of: ${validActions.join(', ')}`);
  }

  const results = {
    success: [],
    failed: [],
    action,
    total: applicationIds.length
  };

  for (const appId of applicationIds) {
    try {
      const application = await Application.findByPk(appId);

      if (!application) {
        results.failed.push({ id: appId, error: 'Application not found' });
        continue;
      }

      // Only allow actions on ELIGIBLE or ON_HOLD applications
      if (![APPLICATION_STATUS.ELIGIBLE, APPLICATION_STATUS.ON_HOLD].includes(application.status)) {
        results.failed.push({
          id: appId,
          error: `Cannot ${action} application with status ${application.status}`
        });
        continue;
      }

      const oldStatus = application.status;

      const actionTimestamp = new Date();

      // Update status
      await application.update({
        status: action,
        verified_by: adminId,
        verified_at: actionTimestamp,
        verification_remarks: remarks
      });

      // Record in history
      await ApplicationStatusHistory.create({
        application_id: appId,
        old_status: oldStatus,
        new_status: action,
        changed_by: adminId,
        changed_by_type: ACTOR_TYPE.ADMIN,
        remarks,
        metadata: { bulk_action: true },
        created_at: actionTimestamp
      });

      results.success.push(appId);
    } catch (error) {
      results.failed.push({ id: appId, error: error.message });
    }
  }

  logger.info(`Bulk ${action}: ${results.success.length} success, ${results.failed.length} failed by admin ${adminId}`);
  return results;
};

// ==================== SINGLE APPLICATION ACTIONS ====================

/**
 * Update single application status
 * @param {number} applicationId - Application ID
 * @param {string} newStatus - New status
 * @param {Object} options - { adminId, remarks }
 * @returns {Promise<Object>} - Updated application
 */
const updateApplicationStatus = async (applicationId, newStatus, options = {}) => {
  const { adminId, remarks = null } = options;

  try {
    const application = await Application.findByPk(applicationId, {
      include: [
        { model: PostMaster, as: 'post' },
        { model: DistrictMaster, as: 'district', attributes: ['district_id', 'district_name', 'district_name_mr'] },
        {
          model: ApplicantMaster,
          as: 'applicant',
          required: false,
          attributes: { exclude: ['password_hash', 'password_reset_token', 'password_reset_token_expires_at', 'activation_token', 'activation_token_expires_at'] },
          include: [{ model: ApplicantPersonal, as: 'personal', required: false }]
        }
      ]
    });

    if (!application) {
      throw new ApiError(404, 'Application not found');
    }

    const oldStatus = application.status;

    const actionTimestamp = new Date();

    // Update status
    await application.update({
      status: newStatus,
      verified_by: adminId,
      verified_at: actionTimestamp,
      verification_remarks: remarks
    });

    // Record in history
    await ApplicationStatusHistory.create({
      application_id: applicationId,
      old_status: oldStatus,
      new_status: newStatus,
      changed_by: adminId,
      changed_by_type: ACTOR_TYPE.ADMIN,
      remarks,
      created_at: actionTimestamp
    });

    logger.info(`Application ${applicationId} status changed: ${oldStatus} -> ${newStatus} by admin ${adminId}`);

    // Reload with associations
    await application.reload();
    return application;
  } catch (error) {
    logger.error('Update application status error:', error);
    throw error;
  }
};

// ==================== APPLICATION DETAIL ====================

/**
 * Get application detail for admin view
 * @param {number} applicationId - Application ID
 * @returns {Promise<Object>} - Full application details with history
 */
const getApplicationDetail = async (applicationId) => {
  try {
    const application = await Application.findByPk(applicationId, {
      attributes: ['application_id', 'application_no', 'status', 'gender', 'date_of_birth', 'aadhaar_number', 'system_eligibility_reason', 'merit_score'],
      include: [
        { model: PostMaster, as: 'post', attributes: ['post_name'] },
        { model: DistrictMaster, as: 'district', attributes: ['district_name'] },
        { model: EligibilityResult, as: 'eligibility', attributes: ['is_eligible', 'checked_at', 'rejection_reasons'] },
        {
          model: ApplicationStatusHistory,
          as: 'statusHistory',
          attributes: ['history_id', 'old_status', 'new_status', 'changed_by_type', 'remarks', 'created_at'],
          include: [{ model: db.AdminUser, as: 'changedByUser', attributes: ['full_name'] }],
          order: [['created_at', 'DESC']]
        },
        {
          model: db.ApplicantMaster,
          as: 'applicant',
          required: false,
          attributes: ['email', 'mobile_no'],
          include: [
            {
              model: db.ApplicantPersonal,
              as: 'personal',
              required: false,
              attributes: ['full_name', 'dob', 'age', 'gender', 'category', 'aadhar_no', 'photo_path', 'signature_path', 'aadhaar_path', 'resume_path', 'domicile_path'],
              include: [
                {
                  model: db.CategoryMaster,
                  as: 'categoryMaster',
                  required: false,
                  attributes: ['category_name']
                }
              ]
            },
            {
              model: db.ApplicantAddress,
              as: 'address',
              required: false,
              attributes: ['address_line', 'address_line2', 'pincode', 'permanent_address_same', 'permanent_address_line', 'permanent_address_line2', 'permanent_pincode'],
              include: [
                { model: DistrictMaster, as: 'district', required: false, attributes: ['district_name'] },
                { model: TalukaMaster, as: 'taluka', required: false, attributes: ['taluka_name'] },
                { model: DistrictMaster, as: 'permanentDistrict', required: false, attributes: ['district_name'] },
                { model: TalukaMaster, as: 'permanentTaluka', required: false, attributes: ['taluka_name'] }
              ]
            },
            {
              model: db.ApplicantEducation,
              as: 'education',
              required: false,
              attributes: ['degree_name', 'stream_subject', 'university_board', 'passing_year', 'percentage', 'certificate_path'],
              include: [{ model: EducationLevel, as: 'educationLevel', required: false, attributes: ['level_name'] }]
            },
            {
              model: db.ApplicantExperience,
              as: 'experience',
              required: false,
              attributes: ['organization_name', 'designation', 'start_date', 'end_date', 'is_current', 'total_months', 'certificate_path']
            },
            {
              model: db.ApplicantSkill,
              as: 'skills',
              required: false,
              attributes: ['applicant_skill_id', 'skill_id', 'notes', 'certificate_path'],
              include: [{ model: SkillMaster, as: 'skill', required: false, attributes: ['skill_name'] }]
            },
            {
              model: db.ApplicantDocument,
              as: 'documents',
              required: false,
              attributes: ['document_id', 'doc_type_id', 'doc_type', 'file_path', 'compressed_path', 'thumbnail_path', 'is_verified']
            }
          ]
        }
      ]
    });

    if (!application) {
      throw new ApiError(404, 'Application not found');
    }

    // Convert to plain object for easier manipulation and to ensure all data is preserved
    const applicationData = application.get({ plain: true });
    const applicant = applicationData.applicant;

    // Remove sensitive data
    if (applicant) {
      delete applicant.password_hash;
      delete applicant.password_reset_token;
      delete applicant.password_reset_token_expires_at;
      delete applicant.activation_token;
      delete applicant.activation_token_expires_at;
    }

    // Normalize media paths for applicant personal and documents
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

      // Also surface identifiers directly for detail pages
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

    return applicationData;
  } catch (error) {
    logger.error('Get application detail error:', error);
    throw error;
  }
};

const getApplicationRequiredDocuments = async (applicationId) => {
  try {
    const application = await Application.findByPk(applicationId, {
      attributes: ['application_id', 'applicant_id', 'post_id']
    });

    if (!application) {
      throw new ApiError(404, 'Application not found');
    }

    const applicantId = application.applicant_id;
    const postId = application.post_id;

    const requiredDocTypes = await applicantDocumentService.getRequiredDocumentTypes(applicantId, {
      post_id: postId,
      include_section_docs: false,
      include_core_personal: false
    });

    const docTypeIds = Array.from(new Set((requiredDocTypes || []).map((d) => d.doc_type_id).filter(Boolean)));

    const uploadedDocs = docTypeIds.length
      ? await ApplicantDocument.findAll({
        where: {
          applicant_id: applicantId,
          is_deleted: false,
          doc_type_id: { [Op.in]: docTypeIds }
        },
        order: [['created_at', 'DESC']]
      })
      : [];

    const uploadedByDocTypeId = new Map();
    for (const d of uploadedDocs) {
      const json = d.toJSON();
      if (!uploadedByDocTypeId.has(json.doc_type_id)) {
        uploadedByDocTypeId.set(json.doc_type_id, json);
      }
    }

    return (requiredDocTypes || []).map((dt) => {
      const uploaded = uploadedByDocTypeId.get(dt.doc_type_id) || null;

      const publicFilePath = uploaded?.file_path
        ? ('/' + String(uploaded.file_path).replace(/\\/g, '/').replace(/^\/+/, ''))
        : null;

      return {
        ...dt,
        uploaded: !!uploaded,
        uploaded_document: uploaded
          ? {
            document_id: uploaded.document_id,
            doc_type_id: uploaded.doc_type_id,
            doc_type: uploaded.doc_type,
            file_path: publicFilePath,
            mime_type: uploaded.mime_type,
            created_at: uploaded.created_at,
            updated_at: uploaded.updated_at
          }
          : null
      };
    });
  } catch (error) {
    logger.error('Get application required documents error:', error);
    throw error;
  }
};

// ==================== STATUS HISTORY ====================

/**
 * Get status history for an application
 * @param {number} applicationId - Application ID
 * @returns {Promise<Array>} - Status history records
 */
const getApplicationHistory = async (applicationId) => {
  try {
    const history = await ApplicationStatusHistory.findAll({
      where: { application_id: applicationId },
      include: [{
        model: db.AdminUser,
        as: 'changedByUser',
        attributes: ['admin_id', 'username', 'full_name']
      }],
      order: [['created_at', 'DESC']]
    });

    return history;
  } catch (error) {
    logger.error('Get application history error:', error);
    throw error;
  }
};

module.exports = {
  getActivePostsWithCounts,
  getApplicationsForPost,
  getAllApplications,
  bulkUpdateStatus,
  updateApplicationStatus,
  getApplicationDetail,
  getApplicationHistory,
  getApplicationRequiredDocuments
};
