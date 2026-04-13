/**
 * Application Restriction Service
 * Handles validation for application limits based on post names and locations (OSC/Hub)
 * 
 * Rules:
 * 1. All applications must be in the same district
 * 2. Max 2 distinct post names across OSC + Hub combined
 * 3. For each post name, max 2 different locations (could be 2 OSCs, 2 Hubs, or 1 OSC + 1 Hub)
 * 4. Total max 4 applications (2 post names × 2 locations each)
 * 5. Location = component_id (for OSC posts) OR hub_id (for Hub posts)
 * 
 * Example valid 4 applications in same district:
 * - "Case Worker" at OSC-1
 * - "Case Worker" at Hub-3 (same post name, different location)
 * - "Centre Administrator" at OSC-2 (different post name)
 * - "Centre Administrator" at Hub-1 (same post name, different location)
 */

const db = require('../models');
const { Op } = require('sequelize');
const logger = require('../config/logger');

class ApplicationRestrictionService {

  constructor() {
    // Get limits from ENV with defaults
    // MAX_DISTINCT_POST_NAMES: Max different post names (e.g., Case Worker, Centre Administrator)
    // MAX_OSC_PER_POST_NAME: Max locations per post name (OSCs + Hubs combined, default 2)
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
      logger.info('[canApplyToPost] start', { applicantId, postId, districtId });
      // Get the post details
      const targetPost = await db.PostMaster.unscoped().findOne({
        where: { post_id: postId },
        include: [
          { model: db.Component, as: 'component', required: false, attributes: ['component_id', 'component_name', 'district_id'] },
          { model: db.DistrictMaster, as: 'district', required: false, attributes: ['district_id', 'district_name'] },
          { model: db.Hub, as: 'hub', required: false, attributes: ['hub_id'] }
        ]
      });

      if (!targetPost) {
        logger.warn('[canApplyToPost] post not found', { postId });
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
      const targetHubId = targetPost.hub_id;
      // Use component_id or hub_id as location identifier for restrictions
      const targetLocationId = targetComponentId || targetHubId;
      const targetLocationType = targetComponentId ? 'component' : 'hub';

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
          },
          {
            model: db.ApplicantMaster,
            as: 'applicant',
            required: false, // LEFT JOIN to keep applications even if applicant record missing
            include: [
              {
                model: db.ApplicantPersonal,
                as: 'personal',
                required: false,
                attributes: ['full_name']
              }
            ]
          }
        ]
      });

      // === EARLY BLOCK: If applicant is SELECTED in any post, block all new applications ===
      const selectedApplication = existingApplications.find(app => app.status === 'SELECTED');
      if (selectedApplication) {
        const selectedPostName = selectedApplication.post?.post_name || 'a post';
        logger.warn('[canApplyToPost] applicant already SELECTED', { 
          applicantId, 
          selectedApplicationId: selectedApplication.application_id,
          selectedPostId: selectedApplication.post_id,
          selectedPostName 
        });
        return {
          allowed: false,
          reason: `You have already been selected for "${selectedPostName}". Selected candidates cannot apply to additional posts.`,
          details: {
            selectedApplicationId: selectedApplication.application_id,
            selectedPostId: selectedApplication.post_id,
            selectedPostName,
            selectedAt: selectedApplication.selected_at
          }
        };
      }

      // Include pending/success payments as in-flight applications to prevent bypass
      const paymentRows = await db.Payment.findAll({
        where: {
          applicant_id: applicantId,
          is_deleted: false,
          payment_status: { [Op.in]: ['PENDING', 'SUCCESS'] }
        },
        include: [
          {
            model: db.PostMaster,
            as: 'post',
            required: false, // LEFT JOIN to keep payments even if post is null
            attributes: ['post_id', 'post_name', 'component_id', 'district_id'],
            include: [
              {
                model: db.Component,
                as: 'component',
                required: false,
                attributes: ['component_id', 'component_name', 'district_id']
              },
              {
                model: db.DistrictMaster,
                as: 'district',
                required: false,
                attributes: ['district_id', 'district_name']
              }
            ]
          }
        ]
      });

      // Normalize pending/success payments into application-like records
      const paymentApplications = paymentRows
        .filter(p => p.post)
        .map(p => ({
          application_id: `PAY-${p.payment_id}`,
          applicant_id: p.applicant_id,
          post_id: p.post_id,
          district_id: p.district_id,
          status: `PAYMENT_${p.payment_status}`,
          post: p.post
        }));

      // Combine actual applications + in-flight payments
      const combinedApplications = [...existingApplications, ...paymentApplications];

      // === EARLY BLOCK: If applicant is SELECTED in any post, block all new applications (already checked above, but keep for safety) ===
      const selectedInCombined = combinedApplications.find(app => app.status === 'SELECTED');
      if (selectedInCombined) {
        const selectedPostName = selectedInCombined.post?.post_name || 'a post';
        return {
          allowed: false,
          reason: `You have already been selected for "${selectedPostName}". Selected candidates cannot apply to additional posts.`,
          details: {
            selectedApplicationId: selectedInCombined.application_id,
            selectedPostId: selectedInCombined.post_id,
            selectedPostName,
            selectedAt: selectedInCombined.selected_at
          }
        };
      }

      logger.info('[canApplyToPost] existingApplications', {
        count: combinedApplications.length,
        applicationsCount: existingApplications.length,
        paymentCount: paymentApplications.length,
        targetDistrictId,
        targetPostName,
        targetComponentId
      });

      // Check if already applied to this exact post (exclude all payment records)
      const alreadyApplied = combinedApplications.some(app => 
        app.post_id === postId && 
        !app.status.startsWith('PAYMENT_')
      );
      
      // Debug logging
      logger.warn('[canApplyToPost] checking already applied', {
        applicantId,
        postId,
        combinedApplicationsCount: combinedApplications.length,
        matchingApps: combinedApplications.filter(app => app.post_id === postId).map(app => ({
          application_id: app.application_id,
          post_id: app.post_id,
          status: app.status,
          isPayment: app.status.startsWith('PAYMENT_')
        })),
        alreadyApplied
      });
      
      if (alreadyApplied) {
        logger.warn('[canApplyToPost] already applied to post', { postId });
        return {
          allowed: false,
          reason: 'You have already applied to this post',
          details: { alreadyApplied: true }
        };
      }

      // If no existing applications (ignore pending payments), allow
      const realApplications = combinedApplications.filter(app => !app.status.startsWith('PAYMENT_'));
      if (realApplications.length === 0) {
        logger.info('[canApplyToPost] no existing applications, allow');
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
      const firstApp = combinedApplications[0];
      const firstAppDistrictId = firstApp.district_id || firstApp.post?.district_id || firstApp.post?.component?.district_id;

      // Rule 1: All applications must be in same district
      if (targetDistrictId !== firstAppDistrictId) {
        logger.warn('[canApplyToPost] district mismatch', { firstAppDistrictId, targetDistrictId });
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

      // Group applications by post name (exclude payment records from location limits)
      const postNameGroups = this.groupApplicationsByPostName(combinedApplications.filter(app => !app.status.startsWith('PAYMENT_')));

      // Check if applying to existing post name
      const isExistingPostName = postNameGroups.hasOwnProperty(targetPostName);

      if (isExistingPostName) {
        // Rule 2: Check OSC limit for this post name
        const existingOSCsForPostName = postNameGroups[targetPostName];

        // Check if already applied to this location (OSC/Hub) for this post name
        const alreadyAppliedToThisLocation = existingOSCsForPostName.some(
          app => {
            const appLocationId = app.post.component_id || app.post.hub_id;
            return appLocationId === targetLocationId;
          }
        );

        if (alreadyAppliedToThisLocation) {
          const locationName = targetLocationType === 'component' ? 'OSC' : 'Hub';
          return {
            allowed: false,
            reason: `You have already applied to "${targetPostName}" in this ${locationName}`,
            details: {
              postName: targetPostName,
              locationId: targetLocationId,
              locationType: targetLocationType
            }
          };
        }

        // Check if location limit reached for this post name
        if (existingOSCsForPostName.length >= this.MAX_OSC_PER_POST_NAME) {
          return {
            allowed: false,
            reason: `You have reached the maximum limit of ${this.MAX_OSC_PER_POST_NAME} location applications for "${targetPostName}"`,
            details: {
              postName: targetPostName,
              currentLocationCount: existingOSCsForPostName.length,
              maxLocationAllowed: this.MAX_OSC_PER_POST_NAME,
              existingLocations: existingOSCsForPostName.map(app => ({
                locationName: app.post.component?.component_name || app.post.hub?.hub_name,
                locationType: app.post.component_id ? 'component' : 'hub',
                applicationNo: app.application_no
              }))
            }
          };
        }

        // Allow - applying to same post name, different location, within limit
        const locationName = targetLocationType === 'component' ? 'OSC' : 'Hub';
        return {
          allowed: true,
          reason: `Applying to "${targetPostName}" in a different ${locationName} (${existingOSCsForPostName.length + 1}/${this.MAX_OSC_PER_POST_NAME})`,
          details: {
            postName: targetPostName,
            isNewPostName: false,
            currentLocationCount: existingOSCsForPostName.length,
            maxLocationAllowed: this.MAX_OSC_PER_POST_NAME
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
