/**
 * Provisional Selection Service
 * Handles provisional selection workflow and stage transitions
 */
const db = require('../models');
const { Op } = require('sequelize');
const logger = require('../config/logger');
const { ApiError } = require('../middleware/errorHandler');
const { APPLICATION_STATUS, ACTOR_TYPE, isValidTransition } = require('../constants/applicationStatus');
const cronService = require('./cronService');
const documentVerificationService = require('./documentVerificationService');

class ProvisionalSelectionService {
  
  /**
   * Record stage entry in ApplicationStageHistory
   * @param {number} applicationId - Application ID
   * @param {string} stage - Stage name
   * @param {number} enteredBy - Admin ID
   * @param {string} enteredByType - ADMIN or SYSTEM
   * @param {Object} metadata - Additional metadata
   * @param {Object} transaction - Sequelize transaction
   */
  async recordStageEntry(applicationId, stage, enteredBy, enteredByType, metadata = {}, transaction) {
    // Exit previous stage if exists
    await db.ApplicationStageHistory.update(
      {
        exited_at: new Date(),
        exited_by: enteredBy,
        exited_by_type: enteredByType
      },
      {
        where: {
          application_id: applicationId,
          exited_at: null
        },
        transaction
      }
    );

    // Create new stage entry
    await db.ApplicationStageHistory.create({
      application_id: applicationId,
      stage: stage,
      entered_at: new Date(),
      entered_by: enteredBy,
      entered_by_type: enteredByType,
      metadata: metadata
    }, { transaction });
  }

  /**
   * Move application to provisional selected
   * Requires all documents to be verified
   * @param {number} applicationId - Application ID
   * @param {number} adminId - Admin ID performing action
   * @param {string} action - PROVISIONAL_SELECT, HOLD, or REJECT
   * @param {string} remarks - Optional remarks
   * @returns {Promise<Object>} - Result
   */
  async moveToProvisionalSelected(applicationId, adminId, action, remarks = null) {
    const transaction = await db.sequelize.transaction();

    try {
      const application = await db.Application.findByPk(applicationId, {
        include: [
          { model: db.PostMaster, as: 'post' },
          { model: db.ApplicantMaster, as: 'applicant' }
        ],
        transaction
      });

      if (!application) {
        throw new ApiError(404, 'Application not found');
      }

      // Validate current status
      const currentStatus = application.status;
      if (!['ELIGIBLE', 'ON_HOLD'].includes(currentStatus)) {
        throw new ApiError(400, `Cannot move to provisional selected from status: ${currentStatus}`);
      }

      // Check if documents are verified (required for provisional selection)
      if (action === 'PROVISIONAL_SELECT') {
        const summary = await documentVerificationService.getVerificationSummary(applicationId);
        if (summary.total === 0) {
          // No documents to verify; mark as verified to allow progression
          await application.update({ document_verified: true }, { transaction });
        } else if (!summary.allVerified) {
          throw new ApiError(400, 'All documents must be verified before provisional selection');
        } else if (!application.document_verified) {
          // Ensure flag is persisted if all docs are verified
          await application.update({ document_verified: true }, { transaction });
        }
      }

      // Determine new status based on action
      let newStatus;
      let stageToRecord = null;

      switch (action) {
        case 'PROVISIONAL_SELECT':
          newStatus = APPLICATION_STATUS.PROVISIONAL_SELECTED;
          stageToRecord = 'PROVISIONAL_SELECTED';
          break;
        case 'HOLD':
          newStatus = APPLICATION_STATUS.ON_HOLD;
          break;
        case 'REJECT':
          newStatus = APPLICATION_STATUS.REJECTED;
          break;
        default:
          throw new ApiError(400, 'Invalid action. Must be PROVISIONAL_SELECT, HOLD, or REJECT');
      }

      // Validate transition
      if (!isValidTransition(currentStatus, newStatus)) {
        throw new ApiError(400, `Invalid status transition from ${currentStatus} to ${newStatus}`);
      }

      const previousStatus = application.status;

      // Update application status
      const actionTimestamp = new Date();
      
      await application.update({
        status: newStatus,
        verified_by: adminId,
        verified_at: actionTimestamp,
        verification_remarks: remarks
      }, { transaction });

      // Record status history
      await db.ApplicationStatusHistory.create({
        application_id: applicationId,
        old_status: previousStatus,
        new_status: newStatus,
        changed_by: adminId,
        changed_by_type: ACTOR_TYPE.ADMIN,
        remarks: remarks || `Moved to ${newStatus} by admin`,
        created_at: actionTimestamp
      }, { transaction });

      // Record stage history if moving to provisional selected
      if (stageToRecord) {
        await this.recordStageEntry(
          applicationId,
          stageToRecord,
          adminId,
          ACTOR_TYPE.ADMIN,
          { action, remarks },
          transaction
        );
      }

      // Update merit list if exists
      await db.MeritList.update(
        { selection_status: newStatus },
        { where: { application_id: applicationId }, transaction }
      );

      await transaction.commit();

      logger.info(`Application ${applicationId} moved to ${newStatus} by admin ${adminId}`);

      return {
        success: true,
        applicationId,
        previousStatus,
        newStatus,
        action
      };
    } catch (error) {
      await transaction.rollback();
      logger.error('Error moving to provisional selected:', error);
      throw error;
    }
  }

  /**
   * Final selection from provisional selected
   * @param {number} applicationId - Application ID
   * @param {number} adminId - Admin ID performing action
   * @param {string} action - SELECT or REJECT
   * @param {string} remarks - Optional remarks
   * @returns {Promise<Object>} - Result
   */
  async finalSelection(applicationId, adminId, action, remarks = null) {
    const transaction = await db.sequelize.transaction();

    try {
      const application = await db.Application.findByPk(applicationId, {
        include: [{ model: db.PostMaster, as: 'post' }],
        transaction
      });

      if (!application) {
        throw new ApiError(404, 'Application not found');
      }

      // Allow idempotent SELECT: if already selected, just ensure linked updates happen
      if (action === 'SELECT' && application.status === APPLICATION_STATUS.SELECTED) {
        await transaction.rollback();
        await cronService.autoRejectOtherApplications(
          application.applicant_id,
          applicationId,
          application.post_id
        );
        logger.info(`Final selection retried for already selected application ${applicationId}. Ensured auto-reject executed.`);
        return {
          success: true,
          applicationId,
          previousStatus: APPLICATION_STATUS.SELECTED,
          newStatus: APPLICATION_STATUS.SELECTED,
          action,
          alreadySelected: true
        };
      }

      // Validate current status
      if (application.status !== APPLICATION_STATUS.PROVISIONAL_SELECTED) {
        throw new ApiError(400, `Can only perform final selection from PROVISIONAL_SELECTED status. Current: ${application.status}`);
      }

      // Determine new status
      let newStatus;
      let stageToRecord = null;

      if (action === 'SELECT') {
        newStatus = APPLICATION_STATUS.SELECTED;
        stageToRecord = 'SELECTED';

        // Check post availability
        const post = await db.PostMaster.findByPk(application.post_id, {
          transaction,
          lock: transaction.LOCK.UPDATE
        });

        if (!post || post.is_deleted) {
          throw new ApiError(404, 'Post not found');
        }

        if (post.is_closed || !post.is_active) {
          throw new ApiError(400, 'Post is closed for applications');
        }

        const selectedApplications = await db.Application.findAll({
          where: {
            post_id: application.post_id,
            selection_status: APPLICATION_STATUS.SELECTED,
            is_deleted: false
          },
          attributes: ['application_id'],
          transaction,
          lock: transaction.LOCK.UPDATE,
          skipLocked: true
        });

        const selectedCount = selectedApplications.length;

        const totalPositions = post.total_positions || 0;
        const available = totalPositions - selectedCount;
        
        if (available <= 0) {
          throw new ApiError(400, `Cannot select candidate. All ${totalPositions} positions for this post are already filled. Please check the merit list.`);
        }

        // Update post filled positions
        const newFilled = selectedCount + 1;
        const shouldClose = newFilled >= (post.total_positions || 0);

        await post.update({
          filled_positions: newFilled,
          is_active: shouldClose ? false : post.is_active,
          is_closed: shouldClose ? true : post.is_closed,
          closed_at: shouldClose ? new Date() : post.closed_at,
          closed_by: shouldClose ? `ADMIN_${adminId}` : post.closed_by,
          updated_by: adminId,
          updated_at: new Date()
        }, { transaction });

      } else if (action === 'REJECT') {
        newStatus = APPLICATION_STATUS.REJECTED;
      } else {
        throw new ApiError(400, 'Invalid action. Must be SELECT or REJECT');
      }

      const previousStatus = application.status;

      const actionTimestamp = new Date();
      
      // Update application
      await application.update({
        status: newStatus,
        selection_status: newStatus,
        selected_at: action === 'SELECT' ? actionTimestamp : null,
        verified_by: adminId,
        rejection_reason: action === 'REJECT' ? remarks : null
      }, { transaction });

      // Record status history
      await db.ApplicationStatusHistory.create({
        application_id: applicationId,
        old_status: previousStatus,
        new_status: newStatus,
        changed_by: adminId,
        changed_by_type: ACTOR_TYPE.ADMIN,
        remarks: remarks || `${action === 'SELECT' ? 'Selected' : 'Rejected'} by admin`,
        created_at: actionTimestamp
      }, { transaction });

      // Record stage history if selected
      if (stageToRecord) {
        await this.recordStageEntry(
          applicationId,
          stageToRecord,
          adminId,
          ACTOR_TYPE.ADMIN,
          { action, remarks },
          transaction
        );
      }

      // Update merit list
      await db.MeritList.update(
        { selection_status: newStatus },
        { where: { application_id: applicationId }, transaction }
      );

      await transaction.commit();

      // Auto-reject other applications if selected
      if (action === 'SELECT') {
        await cronService.autoRejectOtherApplications(
          application.applicant_id,
          applicationId,
          application.post_id
        );
      }

      logger.info(`Application ${applicationId} ${action === 'SELECT' ? 'selected' : 'rejected'} by admin ${adminId}`);

      return {
        success: true,
        applicationId,
        previousStatus,
        newStatus,
        action
      };
    } catch (error) {
      await transaction.rollback();
      logger.error('Error in final selection:', error);
      throw error;
    }
  }

  /**
   * Get applications by stage for reporting
   * @param {number} postId - Post ID
   * @param {number} districtId - District ID
   * @param {string} stage - ELIGIBLE, PROVISIONAL_SELECTED, SELECTED
   * @returns {Promise<Array>} - Applications that were in this stage
   */
  async getApplicationsByStage(postId, districtId, stage) {
    try {
      const districtFilter = Number.isInteger(districtId) ? { district_id: districtId } : {};
      const getMeritScore = (application = {}) => {
        const meritScore = application?.merit?.score ?? application?.merit_score;
        const parsed = parseFloat(meritScore);
        return Number.isNaN(parsed) ? 0 : parsed;
      };
      const sortByMerit = (a, b) => {
        const scoreDiff = getMeritScore(b.application) - getMeritScore(a.application);
        if (scoreDiff !== 0) return scoreDiff;
        const enteredDiff = new Date(a.entered_at || 0) - new Date(b.entered_at || 0);
        if (enteredDiff !== 0) return enteredDiff;
        return (a.application?.application_no || '').localeCompare(b.application?.application_no || '');
      };

      // For ELIGIBLE stage, check Application table directly if no history exists
      if (stage === 'ELIGIBLE') {
        const applications = await db.Application.findAll({
          where: {
            status: 'ELIGIBLE',
            post_id: postId,
            is_deleted: false,
            ...districtFilter
          },
          include: [
            {
              model: db.ApplicantMaster,
              as: 'applicant',
              include: [
                {
                  model: db.ApplicantPersonal,
                  as: 'personal',
                  /* include: [{ model: db.CategoryMaster, as: 'categoryMaster' }] */
                }
              ]
            },
            { model: db.MeritList, as: 'merit' },
            { model: db.DistrictMaster, as: 'district' },
            { model: db.PostMaster, as: 'post' }
          ],
          order: [
            [db.sequelize.literal('COALESCE("Application"."merit_score", 0)'), 'DESC'],
            ['submitted_at', 'ASC'],
            ['application_no', 'ASC']
          ]
        });

        // Convert to format expected by frontend
        return applications.map(app => ({
          application_id: app.application_id,
          application: app,
          stage: 'ELIGIBLE',
          entered_at: app.submitted_at,
          entered_by: null,
          entered_by_type: null,
          metadata: null
        }));
      }

      // For other stages, check ApplicationStageHistory
      const stageHistory = await db.ApplicationStageHistory.findAll({
        where: { 
          stage,
          exited_at: null  // Only get active/current stage entries
        },
        include: [
          {
            model: db.Application,
            as: 'application',
            where: {
              post_id: postId,
              is_deleted: false,
              ...districtFilter
            },
            include: [
              {
                model: db.ApplicantMaster,
                as: 'applicant',
                include: [
                  {
                    model: db.ApplicantPersonal,
                    as: 'personal',
                    /* include: [{ model: db.CategoryMaster, as: 'categoryMaster' }] */
                  }
                ]
              },
              { model: db.MeritList, as: 'merit' },
              { model: db.DistrictMaster, as: 'district' },
              { model: db.PostMaster, as: 'post' }
            ]
          },
          { model: db.AdminUser, as: 'enteredByUser', attributes: ['admin_id', 'full_name'] }
        ],
        order: [['entered_at', 'ASC']]
      });

      return stageHistory.sort(sortByMerit);
    } catch (error) {
      logger.error('Error getting applications by stage:', error);
      throw error;
    }
  }
}

module.exports = new ProvisionalSelectionService();
