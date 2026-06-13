/**
 * Application restrictions for the active recruitment drive.
 *
 * Rules:
 * - Applicant may apply to any number of distinct posts.
 * - Every application in the active drive must use the district selected by
 *   the applicant's first active-drive application.
 * - The same post cannot be applied to twice in the same drive.
 * - Payment records do not participate in application restrictions.
 */
const db = require('../models');
const { Op } = require('sequelize');
const logger = require('../config/logger');
const recruitmentDriveService = require('./recruitmentDriveService');

class ApplicationRestrictionService {
  async canApplyToPost(applicantId, postId, districtId = null) {
    try {
      const drive = await recruitmentDriveService.assertApplicationsOpen();
      const targetPost = await db.PostMaster.findOne({
        where: {
          post_id: postId,
          recruitment_drive_id: drive.recruitment_drive_id,
          is_deleted: false
        },
        include: [
          { model: db.Scheme, as: 'scheme', required: true },
          { model: db.DistrictMaster, as: 'district', required: false }
        ]
      });

      if (!targetPost) {
        return { allowed: false, reason: 'Post is not part of the active recruitment drive', details: {} };
      }
      if (!targetPost.is_active || targetPost.is_closed) {
        return { allowed: false, reason: 'This post is closed for applications', details: {} };
      }

      const targetDistrictId = Number(targetPost.district_id || targetPost.scheme?.district_id);
      if (!targetDistrictId) {
        return { allowed: false, reason: 'Post district is not configured', details: {} };
      }
      if (districtId && Number(districtId) !== targetDistrictId) {
        return { allowed: false, reason: 'Selected district does not match the post district', details: {} };
      }

      const applications = await db.Application.findAll({
        where: {
          applicant_id: applicantId,
          recruitment_drive_id: drive.recruitment_drive_id,
          is_deleted: false,
          status: { [Op.notIn]: ['WITHDRAWN'] }
        },
        include: [{
          model: db.PostMaster,
          as: 'post',
          required: false,
          include: [{ model: db.DistrictMaster, as: 'district', required: false }]
        }],
        order: [['created_at', 'ASC'], ['application_id', 'ASC']]
      });

      if (applications.some((application) => Number(application.post_id) === Number(postId))) {
        return {
          allowed: false,
          reason: 'You have already applied to this post',
          details: { alreadyApplied: true, recruitmentDriveId: drive.recruitment_drive_id }
        };
      }

      const firstApplication = applications[0];
      const lockedDistrictId = firstApplication ? Number(firstApplication.district_id) : null;
      if (lockedDistrictId && lockedDistrictId !== targetDistrictId) {
        return {
          allowed: false,
          reason: `All applications in this recruitment must be in the same district`,
          details: {
            recruitmentDriveId: drive.recruitment_drive_id,
            existingDistrictId: lockedDistrictId,
            existingDistrictName: firstApplication.post?.district?.district_name || null,
            targetDistrictId
          }
        };
      }

      return {
        allowed: true,
        reason: firstApplication ? 'Application allowed in selected district' : 'First application selects district',
        details: {
          recruitmentDriveId: drive.recruitment_drive_id,
          targetDistrictId,
          restrictedToDistrict: lockedDistrictId || targetDistrictId,
          existingApplicationsCount: applications.length,
          unlimitedApplications: true
        }
      };
    } catch (error) {
      logger.error('Error checking application restrictions:', error);
      throw error;
    }
  }

  async getApplicationSummary(applicantId) {
    const drive = await recruitmentDriveService.requireActiveDrive();
    const applications = await db.Application.findAll({
      where: {
        applicant_id: applicantId,
        recruitment_drive_id: drive.recruitment_drive_id,
        is_deleted: false,
        status: { [Op.notIn]: ['WITHDRAWN'] }
      },
      include: [{
        model: db.PostMaster,
        as: 'post',
        include: [
          { model: db.Scheme, as: 'scheme', required: false },
          { model: db.DistrictMaster, as: 'district', required: false }
        ]
      }],
      order: [['created_at', 'ASC'], ['application_id', 'ASC']]
    });

    const first = applications[0];
    return {
      recruitmentDriveId: drive.recruitment_drive_id,
      recruitmentDriveName: drive.drive_name,
      applicationsOpen: drive.applications_open,
      totalApplications: applications.length,
      unlimitedApplications: true,
      maxDistinctPostNames: null,
      maxSchemesPerPostName: null,
      canApplyToNewPostName: drive.applications_open,
      restrictedToDistrict: first?.district_id || null,
      restrictedToDistrictName: first?.post?.district?.district_name || null,
      applications: applications.map((application) => ({
        applicationId: application.application_id,
        applicationNo: application.application_no,
        status: application.status,
        postId: application.post_id,
        postName: application.post?.post_name,
        schemeName: application.post?.scheme?.scheme_name
      }))
    };
  }

  async getAvailablePostsForApplicant(applicantId) {
    const summary = await this.getApplicationSummary(applicantId);
    return {
      canApplyToAnyDistrict: summary.totalApplications === 0,
      canApplyToAnyPost: summary.applicationsOpen,
      restrictions: {
        districtId: summary.restrictedToDistrict,
        districtName: summary.restrictedToDistrictName,
        unlimitedApplications: true
      },
      summary
    };
  }
}

module.exports = new ApplicationRestrictionService();
