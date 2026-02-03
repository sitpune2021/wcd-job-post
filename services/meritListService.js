/**
 * Merit List Service (LEGACY - Live calculation is now preferred)
 * Generates merit lists with new ranking criteria:
 * 1. Education level (higher display_order = better)
 * 2. Marks/Percentage (higher = better)
 * 3. Experience months (more = better)
 * 4. Age (Configurable: Older/Younger preferred)
 * 5. Local candidate preference (permanent_district matches post district)
 * 
 * NOTE: This service stores results in the MeritList table. 
 * Current system uses live calculation in applicationReviewService.js for better accuracy.
 */
const { APP_CONFIG } = require('../constants/appConfig');
const db = require('../models');
const { Op } = require('sequelize');
const logger = require('../config/logger');

// Scoring weights (can be configured)
const WEIGHTS = {
  EDUCATION: 30,      // Max 30 points for education
  MARKS: 25,          // Max 25 points for marks
  EXPERIENCE: 20,     // Max 20 points for experience
  AGE: 15,            // Max 15 points for age (younger = more points)
  LOCAL_PREFERENCE: 10 // Max 10 points for local candidate
};

// Normalization constants
const MAX_EDUCATION_ORDER = 10;  // Assuming max education level display_order is 10
const MAX_EXPERIENCE_MONTHS = 120; // 10 years max for scoring
const MIN_AGE = 18;
const MAX_AGE = 65;

class MeritListService {

  /**
   * Calculate education score based on highest education level
   * @param {Array} educationRecords - Applicant's education records
   * @returns {number} - Score (0-30)
   */
  calculateEducationScore(educationRecords) {
    if (!educationRecords || educationRecords.length === 0) return 0;

    let highestOrder = 0;
    for (const edu of educationRecords) {
      const order = edu.educationLevel?.display_order || edu.education_level_id || 0;
      if (order > highestOrder) {
        highestOrder = order;
      }
    }

    // Normalize to 0-30 scale
    return Math.min(WEIGHTS.EDUCATION, (highestOrder / MAX_EDUCATION_ORDER) * WEIGHTS.EDUCATION);
  }

  /**
   * Calculate marks score based on highest percentage
   * @param {Array} educationRecords - Applicant's education records
   * @returns {number} - Score (0-25)
   */
  calculateMarksScore(educationRecords) {
    if (!educationRecords || educationRecords.length === 0) return 0;

    let highestPercentage = 0;
    for (const edu of educationRecords) {
      const percentage = parseFloat(edu.percentage) || 0;
      if (percentage > highestPercentage) {
        highestPercentage = percentage;
      }
    }

    // Normalize to 0-25 scale (assuming 100% is max)
    return Math.min(WEIGHTS.MARKS, (highestPercentage / 100) * WEIGHTS.MARKS);
  }

  /**
   * Calculate experience score based on total months
   * @param {Array} experienceRecords - Applicant's experience records
   * @returns {number} - Score (0-20)
   */
  calculateExperienceScore(experienceRecords) {
    if (!experienceRecords || experienceRecords.length === 0) return 0;

    let totalMonths = 0;
    for (const exp of experienceRecords) {
      totalMonths += exp.total_months || 0;
    }

    // Normalize to 0-20 scale (cap at MAX_EXPERIENCE_MONTHS)
    const cappedMonths = Math.min(totalMonths, MAX_EXPERIENCE_MONTHS);
    return (cappedMonths / MAX_EXPERIENCE_MONTHS) * WEIGHTS.EXPERIENCE;
  }

  calculateAgeScore(personal) {
    if (!personal?.dob) return 0;

    const today = new Date();
    const birthDate = new Date(personal.dob);
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }

    if (age < MIN_AGE || age > MAX_AGE) return 0;

    const ageRange = MAX_AGE - MIN_AGE;
    const ageFromMin = age - MIN_AGE;

    const agePreference = APP_CONFIG?.MERIT_CRITERIA?.AGE_PREFERENCE || 'YOUNGER';
    let score;

    if (agePreference === 'OLDER') {
      // Older candidates get higher scores
      // Age 65 = 15 points, Age 18 = 0 points
      score = WEIGHTS.AGE * (ageFromMin / ageRange);
    } else {
      // Younger candidates get higher scores
      // Age 18 = 15 points, Age 65 = 0 points
      score = WEIGHTS.AGE * (1 - (ageFromMin / ageRange));
    }

    return Math.max(0, score);
  }

  /**
   * Calculate local preference score
   * @param {Object} address - Applicant's address with permanent_district_id
   * @param {number} postDistrictId - Post's district_id
   * @returns {Object} - { score: number, isLocal: boolean }
   */
  calculateLocalPreferenceScore(address, postDistrictId) {
    if (!address?.permanent_district_id || !postDistrictId) {
      return { score: 0, isLocal: false };
    }

    const isLocal = address.permanent_district_id === postDistrictId;
    return {
      score: isLocal ? WEIGHTS.LOCAL_PREFERENCE : 0,
      isLocal
    };
  }

  /**
   * Custom comparator for sorting applications by merit
   * New order: Education → Marks → District (local first) → Experience → Age
   * @param {Object} a - First application
   * @param {Object} b - Second application
   * @returns {number} - Comparison result
   */
  compareApplications(a, b) {
    // 1. Education score (higher is better)
    if (a.education_score !== b.education_score) {
      return b.education_score - a.education_score;
    }

    // 2. Marks score (higher is better)
    if (a.marks_score !== b.marks_score) {
      return b.marks_score - a.marks_score;
    }

    // 3. District locality (local candidates first)
    if (a.is_local_candidate !== b.is_local_candidate) {
      return b.is_local_candidate ? 1 : -1;
    }

    // 4. Experience score (higher is better)
    if (a.experience_score !== b.experience_score) {
      return b.experience_score - a.experience_score;
    }

    // 5. Age score (younger preferred, higher score is better)
    if (a.age_score !== b.age_score) {
      return b.age_score - a.age_score;
    }

    // If all equal, maintain original order
    return 0;
  }

  /**
   * Generate merit list for a specific post
   * @param {number} postId - Post ID
   * @param {number} districtId - District ID for local preference
   * @param {number} generatedBy - Admin ID who triggered generation
   * @returns {Promise<Object>} - Result with merit list entries
   */
  async generateMeritList(postId, districtId, generatedBy) {
    const transaction = await db.sequelize.transaction();

    try {
      // Get post details
      const post = await db.PostMaster.findByPk(postId);
      if (!post) {
        throw new Error('Post not found');
      }

      // Get all eligible applications for this post
      const applications = await db.Application.findAll({
        where: {
          post_id: postId,
          district_id: districtId,
          is_deleted: false,
          status: { [Op.in]: ['SUBMITTED', 'VERIFIED', 'ELIGIBLE'] },
          system_eligibility: true
        },
        include: [
          {
            model: db.ApplicantMaster,
            as: 'applicant',
            include: [
              { model: db.ApplicantPersonal, as: 'personal' },
              { model: db.ApplicantAddress, as: 'address' },
              {
                model: db.ApplicantEducation,
                as: 'education',
                include: [{ model: db.EducationLevel, as: 'educationLevel' }]
              },
              { model: db.ApplicantExperience, as: 'experience' }
            ]
          }
        ]
      });

      if (applications.length === 0) {
        await transaction.rollback();
        return { success: true, message: 'No eligible applications found', count: 0 };
      }

      // Calculate scores for each application
      const scoredApplications = applications.map(app => {
        const applicant = app.applicant;

        const educationScore = this.calculateEducationScore(applicant.education);
        const marksScore = this.calculateMarksScore(applicant.education);
        const experienceScore = this.calculateExperienceScore(applicant.experience);
        const ageScore = this.calculateAgeScore(applicant.personal);
        const localResult = this.calculateLocalPreferenceScore(applicant.address, districtId);

        const totalScore = educationScore + marksScore + experienceScore + ageScore + localResult.score;

        return {
          application_id: app.application_id,
          applicant_id: app.applicant_id,
          post_id: postId,
          district_id: districtId,
          education_score: parseFloat(educationScore.toFixed(2)),
          marks_score: parseFloat(marksScore.toFixed(2)),
          experience_score: parseFloat(experienceScore.toFixed(2)),
          age_score: parseFloat(ageScore.toFixed(2)),
          local_preference_score: parseFloat(localResult.score.toFixed(2)),
          is_local_candidate: localResult.isLocal,
          score: parseFloat(totalScore.toFixed(2)),
          selection_status: 'PENDING',
          generated_at: new Date(),
          generated_by: generatedBy
        };
      });

      // Sort using custom comparator (Education → Marks → District → Experience → Age)
      scoredApplications.sort((a, b) => this.compareApplications(a, b));

      // Assign ranks
      scoredApplications.forEach((app, index) => {
        app.rank = index + 1;
      });

      // Delete existing merit list entries for this post+district
      await db.MeritList.destroy({
        where: { post_id: postId, district_id: districtId },
        transaction
      });

      // Insert new merit list entries
      await db.MeritList.bulkCreate(scoredApplications, { transaction });

      // Update application merit_score
      for (const scored of scoredApplications) {
        await db.Application.update(
          { merit_score: scored.score },
          { where: { application_id: scored.application_id }, transaction }
        );
      }

      await transaction.commit();

      logger.info(`MERIT: Generated merit list for post ${postId}, district ${districtId}: ${scoredApplications.length} entries`);

      return {
        success: true,
        postId,
        districtId,
        count: scoredApplications.length,
        topRanked: scoredApplications.slice(0, 10).map(a => ({
          rank: a.rank,
          application_id: a.application_id,
          score: a.score,
          is_local: a.is_local_candidate
        }))
      };

    } catch (error) {
      await transaction.rollback();
      logger.error('MERIT: Error generating merit list:', error);
      throw error;
    }
  }

  /**
   * Get merit list for a post/district
   * @param {number} postId - Post ID
   * @param {number} districtId - District ID
   * @param {Object} options - Pagination options
   * @returns {Promise<Object>} - Merit list with pagination
   */
  async getMeritList(postId, districtId, options = {}) {
    const { page = 1, limit = 50 } = options;
    const offset = (page - 1) * limit;

    try {
      const { count, rows } = await db.MeritList.findAndCountAll({
        where: { post_id: postId, district_id: districtId },
        include: [
          {
            model: db.Application,
            as: 'application',
            include: [
              {
                model: db.ApplicantMaster,
                as: 'applicant',
                include: [{ model: db.ApplicantPersonal, as: 'personal' }]
              }
            ]
          }
        ],
        order: [['rank', 'ASC']],
        limit,
        offset
      });

      return {
        meritList: rows,
        pagination: {
          total: count,
          page,
          limit,
          totalPages: Math.ceil(count / limit)
        }
      };
    } catch (error) {
      logger.error('MERIT: Error fetching merit list:', error);
      throw error;
    }
  }
}

module.exports = new MeritListService();
