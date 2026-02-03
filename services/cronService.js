/**
 * Cron Service
 * Handles scheduled tasks like auto-closing posts and other automated operations
 */
const db = require('../models');
const { Op } = require('sequelize');
const logger = require('../config/logger');
const { APPLICATION_STATUS, ACTOR_TYPE } = require('../constants/applicationStatus');

class CronService {
  
  /**
   * Close posts that have passed their closing date
   * Should be run daily via cron job
   * @returns {Promise<Object>} - Result with count of closed posts
   */
  async closeExpiredPosts() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    try {
      const result = await db.PostMaster.update(
        {
          is_active: false,
          is_closed: true,
          closed_at: new Date(),
          closed_by: 'CRON_JOB'
        },
        {
          where: {
            closing_date: { [Op.lt]: today },
            is_active: true,
            is_closed: false,
            is_deleted: false
          }
        }
      );
      
      const closedCount = result[0];
      
      if (closedCount > 0) {
        logger.info(`CRON: Closed ${closedCount} expired posts`);
      }
      
      return { success: true, closedCount };
    } catch (error) {
      logger.error('CRON: Error closing expired posts:', error);
      throw error;
    }
  }
  
  /**
   * Auto-reject applications when applicant is selected in another post
   * Called when an applicant is marked as SELECTED
   * @param {number} applicantId - Applicant ID
   * @param {number} selectedApplicationId - The application that was selected
   * @param {number} selectedPostId - The post for which applicant was selected
   * @returns {Promise<Object>} - Result with count of auto-rejected applications
   */
  async autoRejectOtherApplications(applicantId, selectedApplicationId, selectedPostId) {
    try {
      // Find all other pending/submitted applications for this applicant
      const otherApplications = await db.Application.findAll({
        where: {
          applicant_id: applicantId,
          application_id: { [Op.ne]: selectedApplicationId },
          is_deleted: false,
          selection_status: { [Op.or]: [null, 'PENDING'] }
        },
        attributes: ['application_id', 'post_id', 'status']
      });
      
      if (otherApplications.length === 0) {
        return { success: true, rejectedCount: 0 };
      }
      
      // Get selected post name for the rejection reason
      const selectedPost = await db.PostMaster.findByPk(selectedPostId, {
        attributes: ['post_name', 'post_code']
      });
      
      const rejectionReason = `Applicant was selected for post: ${selectedPost?.post_name || selectedPostId} (${selectedPost?.post_code || ''})`;
      
      // Update all other applications
      const result = await db.Application.update(
        {
          selection_status: APPLICATION_STATUS.SELECTED_IN_OTHER_POST,
          status: APPLICATION_STATUS.SELECTED_IN_OTHER_POST,
          auto_rejected_reason: rejectionReason,
          updated_at: new Date()
        },
        {
          where: {
            application_id: { [Op.in]: otherApplications.map(a => a.application_id) }
          }
        }
      );

      // Record status history for each affected application
      const historyRows = otherApplications.map((a) => ({
        application_id: a.application_id,
        old_status: a.status,
        new_status: APPLICATION_STATUS.SELECTED_IN_OTHER_POST,
        changed_by_type: ACTOR_TYPE.SYSTEM,
        remarks: rejectionReason,
        metadata: { selected_application_id: selectedApplicationId, selected_post_id: selectedPostId }
      }));
      if (historyRows.length > 0) {
        await db.ApplicationStatusHistory.bulkCreate(historyRows);
      }
      
      // Also update merit list entries if any
      await db.MeritList.update(
        {
          selection_status: APPLICATION_STATUS.SELECTED_IN_OTHER_POST
        },
        {
          where: {
            application_id: { [Op.in]: otherApplications.map(a => a.application_id) }
          }
        }
      );
      
      const rejectedCount = result[0];
      logger.info(`AUTO-REJECT: Rejected ${rejectedCount} applications for applicant ${applicantId} (selected in post ${selectedPostId})`);
      
      return { success: true, rejectedCount, rejectedApplicationIds: otherApplications.map(a => a.application_id) };
    } catch (error) {
      logger.error('AUTO-REJECT: Error rejecting other applications:', error);
      throw error;
    }
  }
  
  /**
   * Check if applicant can apply to more posts (max 2 rule)
   * @param {number} applicantId - Applicant ID
   * @returns {Promise<Object>} - { canApply: boolean, currentCount: number, maxAllowed: number }
   */
  async checkApplicationLimit(applicantId) {
    const MAX_APPLICATIONS = 2;
    
    try {
      // Count active applications (not deleted, not auto-rejected due to selection in other post)
      const count = await db.Application.count({
        where: {
          applicant_id: applicantId,
          is_deleted: false,
          [Op.and]: [
            {
              [Op.or]: [
                { selection_status: null },
                { selection_status: { [Op.notIn]: [APPLICATION_STATUS.SELECTED_IN_OTHER_POST] } }
              ]
            }
          ]
        }
      });
      
      return {
        canApply: count < MAX_APPLICATIONS,
        currentCount: count,
        maxAllowed: MAX_APPLICATIONS,
        remainingSlots: Math.max(0, MAX_APPLICATIONS - count)
      };
    } catch (error) {
      logger.error('Error checking application limit:', error);
      throw error;
    }
  }
  
  /**
   * Mark applicant as selected and trigger auto-rejection of other applications
   * @param {number} applicationId - Application ID to mark as selected
   * @param {number} adminId - Admin who made the selection
   * @returns {Promise<Object>} - Result
   */
  async markAsSelected(applicationId, adminId) {
    const transaction = await db.sequelize.transaction();
    
    try {
      const application = await db.Application.findByPk(applicationId, {
        include: [{ model: db.PostMaster, as: 'post' }],
        transaction
      });
      
      if (!application) {
        throw new Error('Application not found');
      }

      if (application.selection_status === 'SELECTED') {
        throw new Error('Application is already marked as SELECTED');
      }

      const post = await db.PostMaster.findByPk(application.post_id, {
        transaction,
        lock: transaction.LOCK.UPDATE
      });

      if (!post || post.is_deleted) {
        throw new Error('Post not found');
      }

      if (post.is_closed || !post.is_active) {
        throw new Error('Post is closed for applications');
      }

      const totalPositions = post.total_positions || 0;
      const filledPositions = post.filled_positions || 0;
      const available = totalPositions - filledPositions;
      
      if (available <= 0) {
        throw new Error(`Cannot select candidate. All ${totalPositions} positions for this post are already filled (${filledPositions}/${totalPositions}). Please check the merit list.`);
      }
      
      const previousStatus = application.status;

      // Update the application as selected
      await application.update({
        selection_status: APPLICATION_STATUS.SELECTED,
        status: APPLICATION_STATUS.SELECTED,
        selected_at: new Date(),
        verified_by: adminId
      }, { transaction });

      const newFilled = (post.filled_positions || 0) + 1;
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
      
      // Update merit list entry if exists
      await db.MeritList.update(
        { selection_status: APPLICATION_STATUS.SELECTED },
        { 
          where: { application_id: applicationId },
          transaction 
        }
      );

      const actionTimestamp = new Date();
      
      // Record status history for this application
      await db.ApplicationStatusHistory.create({
        application_id: applicationId,
        old_status: previousStatus,
        new_status: APPLICATION_STATUS.SELECTED,
        changed_by: adminId,
        changed_by_type: ACTOR_TYPE.ADMIN,
        remarks: 'Marked as selected by admin',
        created_at: actionTimestamp
      }, { transaction });
      
      // Auto-reject other applications
      const autoRejectResult = await this.autoRejectOtherApplications(
        application.applicant_id,
        applicationId,
        application.post_id
      );
      
      await transaction.commit();
      
      logger.info(`SELECTION: Application ${applicationId} marked as SELECTED by admin ${adminId}`);
      
      return {
        success: true,
        applicationId,
        applicantId: application.applicant_id,
        postId: application.post_id,
        autoRejectedCount: autoRejectResult.rejectedCount,
        post: {
          total_positions: post.total_positions,
          filled_positions: newFilled,
          available_positions: Math.max(0, (post.total_positions || 0) - newFilled),
          is_closed: shouldClose
        }
      };
    } catch (error) {
      await transaction.rollback();
      logger.error('SELECTION: Error marking as selected:', error);
      throw error;
    }
  }
  
  /**
   * Run all scheduled cron tasks
   * This should be called by the cron scheduler
   */
  async runScheduledTasks() {
    logger.info('CRON: Starting scheduled tasks...');
    
    const results = {
      timestamp: new Date().toISOString(),
      tasks: {}
    };
    
    try {
      // Task 1: Close expired posts
      results.tasks.closeExpiredPosts = await this.closeExpiredPosts();
    } catch (error) {
      results.tasks.closeExpiredPosts = { success: false, error: error.message };
    }
    
    logger.info('CRON: Scheduled tasks completed', results);
    return results;
  }
}

module.exports = new CronService();
