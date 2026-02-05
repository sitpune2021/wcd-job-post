// ============================================================================
// APPLICATION WORKFLOW SERVICE
// ============================================================================
// Purpose: Manages application status transitions with audit trail
// Handles: status changes, eligibility computation, merit score calculation
// ============================================================================

const db = require('../models');
const { Application, ApplicationStatusHistory, EligibilityResult } = db;
const logger = require('../config/logger');
const { ApiError } = require('../middleware/errorHandler');
const {
  APPLICATION_STATUS,
  ACTOR_TYPE,
  isValidTransition,
  isTerminalStatus,
  isLockedStatus
} = require('../constants/applicationStatus');
const { APP_CONFIG } = require('../constants/appConfig');

/**
 * Change application status with audit trail
 * @param {number} applicationId - Application ID
 * @param {string} newStatus - New status code
 * @param {Object} options - Options { actorId, actorType, remarks, metadata, skipValidation }
 * @returns {Promise<Object>} Updated application
 */
const changeStatus = async (applicationId, newStatus, options = {}) => {
  const {
    actorId = null,
    actorType = ACTOR_TYPE.SYSTEM,
    remarks = null,
    metadata = null,
    skipValidation = false
  } = options;

  try {
    const application = await Application.findByPk(applicationId);

    if (!application) {
      throw new ApiError(404, 'Application not found');
    }

    const oldStatus = application.status;

    // Validate transition unless skipped
    if (!skipValidation && !isValidTransition(oldStatus, newStatus)) {
      throw new ApiError(400, `Invalid status transition from ${oldStatus} to ${newStatus}`);
    }

    // Check if already terminal
    if (isTerminalStatus(oldStatus)) {
      throw new ApiError(400, `Cannot change status of terminal application (${oldStatus})`);
    }

    // Update application status
    await application.update({
      status: newStatus,
      is_locked: isLockedStatus(newStatus)
    });

    // Record in history
    await ApplicationStatusHistory.create({
      application_id: applicationId,
      old_status: oldStatus,
      new_status: newStatus,
      changed_by: actorId,
      changed_by_type: actorType,
      remarks,
      metadata
    });

    logger.info(`Application ${applicationId} status changed: ${oldStatus} -> ${newStatus} by ${actorType}:${actorId || 'system'}`);

    return application;
  } catch (error) {
    logger.error('Change status error:', error);
    throw error;
  }
};

/**
 * Calculate merit score for an application based on multiple criteria
 * 
 * Merit Score Calculation (5-tier system):
 * 1. Education Level (highest display_order) - PRIMARY
 * 2. Percentage in highest education level - SECONDARY
 * 3. Local Resident (same district as post) - TERTIARY
 * 4. Relevant Experience (months) - QUATERNARY
 * 5. Age Preference (OLDER or YOUNGER as per config) - QUINARY
 * 
 * Score formula: 
 * edu_rank * 100,000,000 + percentage * 100,000 + locality * 10,000 + experience * 10 + age_score
 * 
 * Final tie-breakers (at query time): submitted_at ASC, application_no ASC
 * 
 * @param {number|Object} applicationOrId - Application ID or pre-fetched Application object with includes
 * @param {Object} transaction - Optional Sequelize transaction
 * @returns {Promise<number>} Calculated merit score
 */
const calculateMeritScore = async (applicationOrId, transaction = null) => {
  try {
    let application;

    // If an object is passed, assume it's the application with necessary includes
    if (typeof applicationOrId === 'object' && applicationOrId !== null) {
      application = applicationOrId;
    } else {
      // Otherwise fetch from DB with all required associations
      const queryOptions = {
        include: [
          { model: db.PostMaster, as: 'post', attributes: ['post_id', 'district_id'] },
          {
            model: db.ApplicantMaster,
            as: 'applicant',
            include: [
              { model: db.ApplicantPersonal, as: 'personal' },
              { model: db.ApplicantAddress, as: 'address', attributes: ['address_id', 'permanent_district_id'] },
              {
                model: db.ApplicantEducation,
                as: 'education',
                include: [{ model: db.EducationLevel, as: 'educationLevel' }]
              },
              { model: db.ApplicantExperience, as: 'experience' }
            ]
          }
        ]
      };

      if (transaction) {
        queryOptions.transaction = transaction;
      }

      application = await Application.findByPk(applicationOrId, queryOptions);
    }

    if (!application) {
      throw new ApiError(404, 'Application not found');
    }

    const applicant = application.applicant;
    const appId = application.application_id;

    // ========== 1. EDUCATION RANK (display_order) ==========
    let highestEduRank = 0;
    let highestPercentageInTopLevel = 0;

    if (applicant?.education && applicant.education.length > 0) {
      // First pass: Find the highest education rank
      for (const edu of applicant.education) {
        let eduRank = 0;
        if (edu.educationLevel) {
          eduRank = edu.educationLevel.display_order || 0;
        } else if (edu.education_level_id) {
          const level = await db.EducationLevel.findByPk(edu.education_level_id);
          eduRank = level?.display_order || 0;
        }

        if (eduRank > highestEduRank) {
          highestEduRank = eduRank;
        }
      }

      // Second pass: Find highest percentage ONLY within the highest education level
      for (const edu of applicant.education) {
        let eduRank = 0;
        if (edu.educationLevel) {
          eduRank = edu.educationLevel.display_order || 0;
        } else if (edu.education_level_id) {
          const level = await db.EducationLevel.findByPk(edu.education_level_id);
          eduRank = level?.display_order || 0;
        }

        // Only consider percentage if this education matches the highest rank
        if (eduRank === highestEduRank) {
          const pct = parseFloat(edu.percentage) || 0;
          if (pct > highestPercentageInTopLevel) {
            highestPercentageInTopLevel = pct;
          }
        }
      }
    }

    // ========== 2. LOCALITY CHECK (District Match) ==========
    let localityBonus = 0;
    const postDistrictId = application.post?.district_id;
    const permanentDistrictId = applicant?.address?.permanent_district_id;

    if (postDistrictId && permanentDistrictId && postDistrictId === permanentDistrictId) {
      localityBonus = 1; // Local candidate gets 1 point
    }

    // ========== 3. EXPERIENCE MONTHS ==========
    let totalExperienceMonths = 0;

    if (applicant?.experience && applicant.experience.length > 0) {
      for (const exp of applicant.experience) {
        // Use pre-calculated total_months if available
        if (exp.total_months) {
          totalExperienceMonths += exp.total_months;
        } else if (exp.start_date) {
          const start = new Date(exp.start_date);
          const end = exp.is_current || !exp.end_date ? new Date() : new Date(exp.end_date);
          const months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
          totalExperienceMonths += Math.max(0, months);
        }
      }
    }

    // Cap experience at 999 months (~83 years) to fit in score formula
    totalExperienceMonths = Math.min(totalExperienceMonths, 999);

    // ========== 4. AGE PREFERENCE (Dynamic Logic) ==========
    let ageScore = 0;
    const dob = applicant?.personal?.dob;

    if (dob) {
      const birthDate = new Date(dob);
      const today = new Date();
      let age = today.getFullYear() - birthDate.getFullYear();
      const monthDiff = today.getMonth() - birthDate.getMonth();

      // Adjust age if birthday hasn't occurred this year
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        age--;
      }

      // Cap age between 0-100 for score calculation
      age = Math.max(0, Math.min(age, 100));

      const agePreference = APP_CONFIG?.MERIT_CRITERIA?.AGE_PREFERENCE || 'YOUNGER';

      if (agePreference === 'OLDER') {
        // OLDER Candidates preferred: higher age = higher score (0-100)
        ageScore = age;
      } else {
        // YOUNGER Candidates preferred: lower age = higher score (100-0)
        ageScore = 100 - age;
      }
    }

    // ========== COMPUTE MERIT SCORE ==========
    // Formula: edu_rank * 100,000,000 + percentage * 100,000 + locality * 10,000 + experience * 10 + age_score
    const score =
      (highestEduRank * 100000000) +
      (highestPercentageInTopLevel * 100000) +
      (localityBonus * 10000) +
      (totalExperienceMonths * 10) +
      ageScore;

    // NOTE: We do NOT store merit_score in database anymore for live view,
    // though we return it for the API response.
    logger.info(`Merit score calculated for app ${appId}: ${score} (edu=${highestEduRank}, pct=${highestPercentageInTopLevel}, local=${localityBonus}, exp=${totalExperienceMonths}, age_pre=${APP_CONFIG?.MERIT_CRITERIA?.AGE_PREFERENCE})`);
    return score;
  } catch (error) {
    logger.error('Calculate merit score error:', error);
    throw error;
  }
};

/**
 * Process application submission - runs eligibility check and sets final status
 * @param {number} applicationId - Application ID
 * @param {Object} eligibilityResult - Pre-computed eligibility result from eligibilityService
 * @returns {Promise<Object>} Updated application with eligibility result
 */
const processSubmission = async (applicationId, eligibilityResult) => {
  try {
    const application = await Application.findByPk(applicationId);

    if (!application) {
      throw new ApiError(404, 'Application not found');
    }

    if (application.status !== APPLICATION_STATUS.DRAFT) {
      throw new ApiError(400, 'Only draft applications can be submitted');
    }

    const isEligible = eligibilityResult?.isEligible || false;
    const newStatus = isEligible ? APPLICATION_STATUS.ELIGIBLE : APPLICATION_STATUS.NOT_ELIGIBLE;
    const eventTimestamp = new Date();

    // Update application with eligibility info
    await application.update({
      status: newStatus,
      is_locked: true,
      system_eligibility: isEligible,
      system_eligibility_reason: eligibilityResult?.failedChecks?.join('; ') || null,
      eligibility_checked_at: eventTimestamp
    });

    // Save eligibility result snapshot
    let eligResult = await EligibilityResult.findOne({ where: { application_id: applicationId } });
    if (eligResult) {
      await eligResult.update({
        is_eligible: isEligible,
        eligibility_criteria: JSON.stringify(eligibilityResult.checks || []),
        checked_at: eventTimestamp
      });
    } else {
      eligResult = await EligibilityResult.create({
        application_id: applicationId,
        is_eligible: isEligible,
        eligibility_criteria: JSON.stringify(eligibilityResult.checks || []),
        checked_at: eventTimestamp
      });
    }

    // Record status transition: DRAFT -> SUBMITTED -> ELIGIBLE/NOT_ELIGIBLE
    // First record SUBMITTED
    await ApplicationStatusHistory.create({
      application_id: applicationId,
      old_status: APPLICATION_STATUS.DRAFT,
      new_status: APPLICATION_STATUS.SUBMITTED,
      changed_by_type: ACTOR_TYPE.APPLICANT,
      remarks: 'Declaration accepted and submitted',
      metadata: { submitted_at: eventTimestamp },
      created_at: eventTimestamp
    });

    // Then record eligibility result
    await ApplicationStatusHistory.create({
      application_id: applicationId,
      old_status: APPLICATION_STATUS.SUBMITTED,
      new_status: newStatus,
      changed_by_type: ACTOR_TYPE.SYSTEM,
      remarks: isEligible ? 'System eligibility check passed' : 'System eligibility check failed',
      metadata: {
        eligibility_result: eligibilityResult,
        checked_at: eventTimestamp
      },
      created_at: eventTimestamp
    });

    // Calculate merit score if eligible
    if (isEligible) {
      await calculateMeritScore(applicationId);
    }

    logger.info(`Application ${applicationId} processed: ${newStatus}`);

    return {
      application,
      eligibilityResult: eligResult,
      status: newStatus
    };
  } catch (error) {
    logger.error('Process submission error:', error);
    throw error;
  }
};

/**
 * Bulk update application statuses (for admin actions)
 * @param {Array<number>} applicationIds - Array of application IDs
 * @param {string} newStatus - New status
 * @param {Object} options - { actorId, remarks }
 * @returns {Promise<Object>} Result with success/failed counts
 */
const bulkChangeStatus = async (applicationIds, newStatus, options = {}) => {
  const { actorId, remarks = null } = options;

  const results = {
    success: [],
    failed: []
  };

  for (const appId of applicationIds) {
    try {
      await changeStatus(appId, newStatus, {
        actorId,
        actorType: ACTOR_TYPE.ADMIN,
        remarks
      });
      results.success.push(appId);
    } catch (error) {
      results.failed.push({ id: appId, error: error.message });
    }
  }

  logger.info(`Bulk status change to ${newStatus}: ${results.success.length} success, ${results.failed.length} failed`);
  return results;
};

/**
 * Get application status history
 * @param {number} applicationId - Application ID
 * @returns {Promise<Array>} Status history records
 */
const getStatusHistory = async (applicationId) => {
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
    logger.error('Get status history error:', error);
    throw error;
  }
};

module.exports = {
  changeStatus,
  calculateMeritScore,
  processSubmission,
  bulkChangeStatus,
  getStatusHistory,
  APPLICATION_STATUS,
  ACTOR_TYPE
};
