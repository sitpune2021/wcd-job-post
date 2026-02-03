/**
 * Application Restriction Service
 * Handles validation for application limits based on post names and OSC
 * 
 * Rules:
 * 1. Applicant can apply to max X distinct post names (configurable via ENV)
 * 2. All applications must be in the same district
 * 3. For same post name in same district, can apply to max Y different OSCs (configurable)
 * 4. Same post_name + same district + different OSC = counts as 1 post name
 */

const db = require('../models');
const { Op } = require('sequelize');
const logger = require('../config/logger');

class ApplicationRestrictionService {

  constructor() {
    // Get limits from ENV with defaults
    this.MAX_DISTINCT_POST_NAMES = parseInt(process.env.MAX_DISTINCT_POST_NAMES) || 2;
    this.MAX_OSC_PER_POST_NAME = parseInt(process.env.MAX_OSC_PER_POST_NAME) || 2;
  }

  /**
   * Check if applicant can apply to a specific post
   * @param {number} applicantId - Applicant ID
   * @param {number} postId - Post ID to apply for
   * @param {number} districtId - District ID from request body (for accurate comparison)
   * @returns {Promise<Object>} - { allowed: boolean, reason: string, details: object }
   */
  async canApplyToPost(applicantId, postId, districtId = null) {
    try {
      // Get the post details
      const targetPost = await db.PostMaster.findByPk(postId, {
        include: [
          { model: db.Component, as: 'component', attributes: ['component_id', 'component_name', 'district_id'] },
          { model: db.DistrictMaster, as: 'district', attributes: ['district_id', 'district_name'] }
        ]
      });

      if (!targetPost) {
        return {
          allowed: false,
          reason: 'Post not found',
          details: {}
        };
      }

      // For district comparison, use the district_id from request body when provided
      // This ensures consistency with existing applications
      const targetDistrictId = districtId !== null ? districtId : targetPost.district_id;
      const targetPostName = targetPost.post_name;
      const targetComponentId = targetPost.component_id;

      // Get all existing applications for this applicant
      const existingApplications = await db.Application.findAll({
        where: {
          applicant_id: applicantId,
          is_deleted: false,
          status: { [Op.notIn]: ['WITHDRAWN', 'REJECTED'] } // Don't count withdrawn/rejected
        },
        include: [
          {
            model: db.PostMaster,
            as: 'post',
            attributes: ['post_id', 'post_name', 'component_id', 'district_id'],
            include: [
              {
                model: db.Component,
                as: 'component',
                attributes: ['component_id', 'component_name', 'district_id']
              },
              {
                model: db.DistrictMaster,
                as: 'district',
                attributes: ['district_id', 'district_name']
              }
            ]
          }
        ]
      });

      // Check if already applied to this exact post
      const alreadyApplied = existingApplications.some(app => app.post_id === postId);
      if (alreadyApplied) {
        return {
          allowed: false,
          reason: 'You have already applied to this post',
          details: { alreadyApplied: true }
        };
      }

      // If no existing applications, allow
      if (existingApplications.length === 0) {
        return {
          allowed: true,
          reason: 'First application',
          details: {
            existingApplicationsCount: 0,
            distinctPostNames: 0,
            targetPostName,
            targetDistrictId
          }
        };
      }

      // Get district from first application (prefer stored application district, fallback to component/post)
      const firstApp = existingApplications[0];
      const firstAppDistrictId = firstApp.district_id || firstApp.post?.district_id || firstApp.post?.component?.district_id;

      // Rule 1: All applications must be in same district
      if (targetDistrictId !== firstAppDistrictId) {
        return {
          allowed: false,
          reason: `All applications must be in the same district. You have already applied in ${firstApp.post?.district?.district_name || 'another district'}`,
          details: {
            existingDistrictId: firstAppDistrictId,
            targetDistrictId,
            existingDistrictName: firstApp.post?.district?.district_name || firstApp.post?.component?.district?.district_name,
            targetDistrictName: targetPost.district?.district_name || targetPost.component?.district?.district_name
          }
        };
      }

      // Group applications by post name
      const postNameGroups = this.groupApplicationsByPostName(existingApplications);

      // Check if applying to existing post name
      const isExistingPostName = postNameGroups.hasOwnProperty(targetPostName);

      if (isExistingPostName) {
        // Rule 2: Check OSC limit for this post name
        const existingOSCsForPostName = postNameGroups[targetPostName];

        // Check if already applied to this OSC for this post name
        const alreadyAppliedToThisOSC = existingOSCsForPostName.some(
          app => app.post.component_id === targetComponentId
        );

        if (alreadyAppliedToThisOSC) {
          return {
            allowed: false,
            reason: `You have already applied to "${targetPostName}" in this OSC`,
            details: {
              postName: targetPostName,
              componentId: targetComponentId
            }
          };
        }

        // Check if OSC limit reached for this post name
        if (existingOSCsForPostName.length >= this.MAX_OSC_PER_POST_NAME) {
          return {
            allowed: false,
            reason: `You have reached the maximum limit of ${this.MAX_OSC_PER_POST_NAME} OSC applications for "${targetPostName}"`,
            details: {
              postName: targetPostName,
              currentOSCCount: existingOSCsForPostName.length,
              maxOSCAllowed: this.MAX_OSC_PER_POST_NAME,
              existingOSCs: existingOSCsForPostName.map(app => ({
                componentName: app.post.component?.component_name,
                applicationNo: app.application_no
              }))
            }
          };
        }

        // Allow - applying to same post name, different OSC, within limit
        return {
          allowed: true,
          reason: `Applying to "${targetPostName}" in a different OSC (${existingOSCsForPostName.length + 1}/${this.MAX_OSC_PER_POST_NAME})`,
          details: {
            postName: targetPostName,
            isNewPostName: false,
            currentOSCCount: existingOSCsForPostName.length,
            maxOSCAllowed: this.MAX_OSC_PER_POST_NAME
          }
        };
      } else {
        // Rule 3: Check distinct post name limit
        const distinctPostNameCount = Object.keys(postNameGroups).length;

        if (distinctPostNameCount >= this.MAX_DISTINCT_POST_NAMES) {
          return {
            allowed: false,
            reason: `You have reached the maximum limit of ${this.MAX_DISTINCT_POST_NAMES} distinct post names. You have already applied to: ${Object.keys(postNameGroups).join(', ')}`,
            details: {
              currentDistinctPostNames: distinctPostNameCount,
              maxDistinctPostNames: this.MAX_DISTINCT_POST_NAMES,
              existingPostNames: Object.keys(postNameGroups)
            }
          };
        }

        // Allow - new post name, within limit
        return {
          allowed: true,
          reason: `Applying to new post name "${targetPostName}" (${distinctPostNameCount + 1}/${this.MAX_DISTINCT_POST_NAMES})`,
          details: {
            postName: targetPostName,
            isNewPostName: true,
            currentDistinctPostNames: distinctPostNameCount,
            maxDistinctPostNames: this.MAX_DISTINCT_POST_NAMES
          }
        };
      }

    } catch (error) {
      logger.error('Error checking application restrictions:', error);
      throw error;
    }
  }

  /**
   * Group applications by post name
   * @param {Array} applications - Array of application records with post details
   * @returns {Object} - { postName: [applications] }
   */
  groupApplicationsByPostName(applications) {
    const groups = {};

    for (const app of applications) {
      const postName = app.post?.post_name;
      if (!postName) continue;

      if (!groups[postName]) {
        groups[postName] = [];
      }
      groups[postName].push(app);
    }

    return groups;
  }

  /**
   * Get application summary for an applicant
   * @param {number} applicantId - Applicant ID
   * @returns {Promise<Object>} - Summary of applications and limits
   */
  async getApplicationSummary(applicantId) {
    try {
      const existingApplications = await db.Application.findAll({
        where: {
          applicant_id: applicantId,
          is_deleted: false,
          status: { [Op.notIn]: ['WITHDRAWN', 'REJECTED'] }
        },
        include: [
          {
            model: db.PostMaster,
            as: 'post',
            attributes: ['post_id', 'post_name', 'component_id', 'district_id'],
            include: [
              {
                model: db.Component,
                as: 'component',
                attributes: ['component_id', 'component_name', 'district_id']
              },
              {
                model: db.DistrictMaster,
                as: 'district',
                attributes: ['district_id', 'district_name']
              }
            ]
          }
        ]
      });

      const postNameGroups = this.groupApplicationsByPostName(existingApplications);
      const distinctPostNameCount = Object.keys(postNameGroups).length;

      // Get district from first application
      let districtId = null;
      let districtName = null;
      if (existingApplications.length > 0) {
        const firstApp = existingApplications[0];
        districtId = firstApp.post?.component?.district_id || firstApp.post?.district_id;
        districtName = firstApp.post?.district?.district_name || firstApp.post?.component?.district?.district_name;
      }

      return {
        totalApplications: existingApplications.length,
        distinctPostNames: distinctPostNameCount,
        maxDistinctPostNames: this.MAX_DISTINCT_POST_NAMES,
        maxOSCPerPostName: this.MAX_OSC_PER_POST_NAME,
        canApplyToNewPostName: distinctPostNameCount < this.MAX_DISTINCT_POST_NAMES,
        restrictedToDistrict: districtId,
        restrictedToDistrictName: districtName,
        postNameBreakdown: Object.keys(postNameGroups).map(postName => ({
          postName,
          applicationCount: postNameGroups[postName].length,
          canApplyToMoreOSC: postNameGroups[postName].length < this.MAX_OSC_PER_POST_NAME,
          applications: postNameGroups[postName].map(app => ({
            applicationNo: app.application_no,
            status: app.status,
            componentName: app.post?.component?.component_name,
            postId: app.post_id
          }))
        }))
      };

    } catch (error) {
      logger.error('Error getting application summary:', error);
      throw error;
    }
  }

  /**
   * Get available posts for an applicant based on restrictions
   * @param {number} applicantId - Applicant ID
   * @returns {Promise<Object>} - Available posts and restrictions
   */
  async getAvailablePostsForApplicant(applicantId) {
    try {
      const summary = await this.getApplicationSummary(applicantId);

      // If no applications yet, all open posts are available
      if (summary.totalApplications === 0) {
        return {
          canApplyToAnyDistrict: true,
          canApplyToAnyPost: true,
          restrictions: {
            districtId: null,
            existingPostNames: []
          }
        };
      }

      // Build restrictions
      const restrictions = {
        districtId: summary.restrictedToDistrict,
        districtName: summary.restrictedToDistrictName,
        existingPostNames: summary.postNameBreakdown.map(p => p.postName),
        canApplyToNewPostName: summary.canApplyToNewPostName,
        postNamesWithOSCAvailable: summary.postNameBreakdown
          .filter(p => p.canApplyToMoreOSC)
          .map(p => p.postName)
      };

      return {
        canApplyToAnyDistrict: false,
        canApplyToAnyPost: false,
        restrictions,
        summary
      };

    } catch (error) {
      logger.error('Error getting available posts:', error);
      throw error;
    }
  }
}

module.exports = new ApplicationRestrictionService();
