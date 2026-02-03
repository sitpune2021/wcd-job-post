const db = require('../../models');
const emailService = require('../emailService');
const logger = require('../../config/logger');
const { Op } = require('sequelize');
const path = require('path');
const fs = require('fs').promises;

/**
 * Allotment Email Service
 * Handles scheduling and sending allotment PDFs to selected candidates
 * Prevents duplicate sends using tracking table
 */
class AllotmentEmailService {
  
  /**
   * Schedule email distribution for a post
   * @param {number} postId - Post ID
   * @param {number} uploadId - Upload ID of the allotment PDF
   * @param {Date} scheduledDate - When to send emails
   * @param {number} adminId - Admin who scheduled
   * @returns {Promise<Object>} Schedule details with recipient counts
   */
  async scheduleEmail(postId, uploadId, scheduledDate, adminId) {
    const transaction = await db.sequelize.transaction();
    
    try {
      // Validate post and upload exist
      const post = await db.PostMaster.findByPk(postId);
      if (!post) {
        throw new Error('Post not found');
      }

      const upload = await db.PostAllotmentUpload.findByPk(uploadId);
      if (!upload || upload.post_id !== postId) {
        throw new Error('Invalid upload for this post');
      }

      // Get all SELECTED candidates for this post
      const selectedApplications = await db.Application.findAll({
        where: {
          post_id: postId,
          status: 'SELECTED',
          is_deleted: false
        },
        include: [
          {
            model: db.ApplicantMaster,
            as: 'applicant',
            attributes: ['applicant_id', 'email'],
            required: true,
            where: {
              email: { [Op.ne]: null }
            },
            include: [
              {
                model: db.ApplicantPersonal,
                as: 'personal',
                attributes: ['full_name']
              }
            ]
          }
        ]
      });

      if (selectedApplications.length === 0) {
        throw new Error('No selected candidates with valid email addresses found for this post');
      }

      // Check who already received the email (to prevent duplicates)
      // Only check for SENT status, not FAILED (allows resending after cancellation)
      const alreadySent = await db.AllotmentEmailTracking.findAll({
        where: {
          post_id: postId,
          status: 'SENT'
        },
        attributes: ['applicant_id'],
        transaction
      });

      const sentApplicantIds = new Set(alreadySent.map(t => t.applicant_id));
      
      // Also check for any active SCHEDULED batch to prevent duplicates
      const activeSchedule = await db.AllotmentEmailSchedule.findOne({
        where: {
          post_id: postId,
          status: 'SCHEDULED',
          is_deleted: false
        },
        transaction
      });
      
      if (activeSchedule) {
        await transaction.rollback();
        throw new Error('An email schedule is already active for this post. Please cancel the existing schedule first.');
      }

      // Filter to only new recipients
      const newRecipients = selectedApplications.filter(
        app => !sentApplicantIds.has(app.applicant_id)
      );

      if (newRecipients.length === 0) {
        await transaction.rollback();
        return {
          success: false,
          message: 'All selected candidates have already received the allotment email. No new emails to schedule.',
          newRecipients: 0,
          alreadySent: sentApplicantIds.size,
          totalSelected: selectedApplications.length
        };
      }

      // Create schedule - Convert IST to UTC for storage
      // scheduledDate comes as local time, we need to store it properly
      const schedule = await db.AllotmentEmailSchedule.create({
        post_id: postId,
        upload_id: uploadId,
        scheduled_date: scheduledDate,
        status: 'SCHEDULED',
        total_recipients: newRecipients.length,
        created_by: adminId
      }, { transaction });

      // Create or update tracking records for new recipients
      for (const app of newRecipients) {
        // Check if tracking record already exists (might be FAILED from cancelled schedule)
        const existingTracking = await db.AllotmentEmailTracking.findOne({
          where: {
            post_id: postId,
            applicant_id: app.applicant_id
          },
          transaction
        });

        if (existingTracking) {
          // Update existing FAILED record to PENDING for new schedule
          await existingTracking.update({
            schedule_id: schedule.schedule_id,
            application_id: app.application_id,
            email: app.applicant.email,
            status: 'PENDING',
            error_message: null,
            retry_count: 0,
            sent_at: null
          }, { transaction });
        } else {
          // Create new tracking record
          await db.AllotmentEmailTracking.create({
            schedule_id: schedule.schedule_id,
            post_id: postId,
            applicant_id: app.applicant_id,
            application_id: app.application_id,
            email: app.applicant.email,
            status: 'PENDING'
          }, { transaction });
        }
      }

      await transaction.commit();

      logger.info('Allotment email scheduled', {
        schedule_id: schedule.schedule_id,
        post_id: postId,
        new_recipients: newRecipients.length,
        already_sent: sentApplicantIds.size,
        scheduled_date: scheduledDate
      });

      return {
        success: true,
        schedule,
        newRecipients: newRecipients.length,
        alreadySent: sentApplicantIds.size,
        totalSelected: selectedApplications.length,
        scheduledDate: scheduledDate
      };
    } catch (error) {
      await transaction.rollback();
      logger.error('Failed to schedule allotment email', { error: error.message, postId });
      throw error;
    }
  }

  /**
   * Process all scheduled emails that are due
   * Called by cron job every 5 minutes
   * Uses IST timezone (Asia/Kolkata) for comparison
   */
  async processScheduledEmails() {
    // Get current server time
    const now = new Date();
    const nowIst = new Date(now.getTime() + (330 * 60 * 1000)); // shift to IST for comparison since DB stores naive timestamps
    
    // Log current time in IST for debugging
    const istTimeStr = now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour12: false });
    logger.info(`CRON EMAIL: Checking scheduled emails at ${istTimeStr} IST (Server: ${now.toISOString()})`);
    
    // Query schedules - compare against IST time because scheduled_date stored as IST-like naive timestamp
    logger.info('CRON EMAIL: Querying schedules where scheduled_date <=', nowIst.toISOString());
    
    const schedules = await db.AllotmentEmailSchedule.findAll({
      where: {
        status: 'SCHEDULED',
        scheduled_date: { [Op.lte]: nowIst },
        is_deleted: false
      },
      include: [
        { model: db.PostMaster, as: 'post', attributes: ['post_id', 'post_name', 'post_code'] },
        { model: db.PostAllotmentUpload, as: 'upload', attributes: ['upload_id', 'file_path', 'original_name'] }
      ]
    });

    // Log all SCHEDULED emails for debugging
    const allScheduled = await db.AllotmentEmailSchedule.findAll({
      where: {
        status: 'SCHEDULED',
        is_deleted: false
      },
      attributes: ['schedule_id', 'scheduled_date'],
      order: [['scheduled_date', 'ASC']]
    });
    
    if (allScheduled.length > 0) {
      logger.info('CRON EMAIL: All scheduled emails:', allScheduled.map(s => ({
        id: s.schedule_id,
        scheduled: s.scheduled_date,
        isDue: new Date(s.scheduled_date) <= nowIst
      })));
    }

    if (schedules.length === 0) {
      logger.info('CRON EMAIL: No scheduled emails due at this time');
      return { processed: 0 };
    }

    logger.info(`CRON EMAIL: Processing ${schedules.length} scheduled email batch(es)`);

    for (const schedule of schedules) {
      try {
        const scheduledIST = new Date(schedule.scheduled_date).toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
        logger.info(`CRON EMAIL: Processing schedule ${schedule.schedule_id} for post ${schedule.post?.post_name} (scheduled: ${scheduledIST} IST)`);
        await this.sendScheduledEmails(schedule);
      } catch (error) {
        logger.error('CRON EMAIL: Failed to process schedule', {
          schedule_id: schedule.schedule_id,
          post_id: schedule.post_id,
          error: error.message,
          stack: error.stack
        });
      }
    }

    logger.info(`CRON EMAIL: Completed processing ${schedules.length} batch(es)`);
    return { processed: schedules.length };
  }

  /**
   * Send emails for a specific schedule
   * @param {Object} schedule - Schedule record
   */
  async sendScheduledEmails(schedule) {
    await schedule.update({
      status: 'PROCESSING',
      started_at: new Date()
    });

    const trackings = await db.AllotmentEmailTracking.findAll({
      where: {
        schedule_id: schedule.schedule_id,
        status: 'PENDING'
      },
      include: [
        {
          model: db.ApplicantMaster,
          as: 'applicant',
          include: [
            { model: db.ApplicantPersonal, as: 'personal', attributes: ['full_name'] }
          ]
        }
      ]
    });

    let sent = 0;
    let failed = 0;

    logger.info(`CRON EMAIL: Sending to ${trackings.length} recipient(s) for schedule ${schedule.schedule_id}`);

    for (const tracking of trackings) {
      try {
        // Verify file exists
        const filePath = schedule.upload?.file_path;
        if (!filePath) {
          throw new Error('Allotment file path not found');
        }

        const fullPath = path.join(process.cwd(), filePath);
        await fs.access(fullPath); // Check file exists

        // Send email with PDF attachment
        await emailService.sendAllotmentEmail({
          to: tracking.email,
          name: tracking.applicant?.personal?.full_name || 'Candidate',
          postName: schedule.post?.post_name || 'Post',
          postCode: schedule.post?.post_code || '',
          pdfPath: fullPath,
          pdfFileName: schedule.upload?.original_name || 'allotment_letter.pdf'
        });

        const sentTime = new Date();
        await tracking.update({
          status: 'SENT',
          sent_at: sentTime
        });

        sent++;
        const sentIST = sentTime.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
        logger.info(`CRON EMAIL: ✓ Sent to ${tracking.email} at ${sentIST} IST`, {
          schedule_id: schedule.schedule_id,
          tracking_id: tracking.tracking_id,
          applicant_id: tracking.applicant_id,
          post_id: schedule.post_id
        });

      } catch (error) {
        logger.error(`CRON EMAIL: ✗ Failed to send to ${tracking.email}`, {
          schedule_id: schedule.schedule_id,
          tracking_id: tracking.tracking_id,
          applicant_id: tracking.applicant_id,
          error: error.message,
          stack: error.stack
        });

        await tracking.update({
          status: 'FAILED',
          error_message: error.message,
          retry_count: tracking.retry_count + 1
        });

        failed++;
      }
    }

    logger.info(`CRON EMAIL: Schedule ${schedule.schedule_id} completed - Sent: ${sent}, Failed: ${failed}`);

    await schedule.update({
      status: sent > 0 ? 'COMPLETED' : 'FAILED',
      emails_sent: sent,
      emails_failed: failed,
      completed_at: new Date(),
      error_message: failed > 0 ? `${failed} emails failed to send` : null
    });

    logger.info('Schedule processing completed', {
      schedule_id: schedule.schedule_id,
      sent,
      failed
    });

    return { sent, failed };
  }

  /**
   * Get email distribution status for a post
   * @param {number} postId - Post ID
   * @returns {Promise<Object>} Email status with schedules, tracking, candidates, and summary
   */
  async getEmailStatus(postId) {
    try {
      logger.info(`Getting email status for post ${postId}`);
      
      // Check if models exist
      if (!db.AllotmentEmailSchedule) {
        throw new Error('AllotmentEmailSchedule model not found');
      }
      
      const schedules = await db.AllotmentEmailSchedule.findAll({
        where: {
          post_id: postId,
          is_deleted: false
        },
        order: [['created_at', 'DESC']]
      });

      const tracking = await db.AllotmentEmailTracking.findAll({
        where: { post_id: postId },
        include: [
          {
            model: db.ApplicantMaster,
            as: 'applicant',
            attributes: ['applicant_id', 'email'],
            required: false,
            include: [
              { model: db.ApplicantPersonal, as: 'personal', attributes: ['full_name'], required: false }
            ]
          }
        ],
        order: [['created_at', 'DESC']]
      });

      // Get all selected candidates for this post
      const selectedApplications = await db.Application.findAll({
        where: {
          post_id: postId,
          status: 'SELECTED',
          is_deleted: false
        },
        include: [
          {
            model: db.ApplicantMaster,
            as: 'applicant',
            attributes: ['applicant_id', 'email'],
            required: false,
            include: [
              { model: db.ApplicantPersonal, as: 'personal', attributes: ['full_name'], required: false }
            ]
          }
        ]
      });

      // Build candidate status map
      const candidateStatus = selectedApplications.map(app => {
        const applicantId = app.applicant_id;
        const trackingRecord = tracking.find(t => t.applicant_id === applicantId);
        
        return {
          applicant_id: applicantId,
          application_id: app.application_id,
          full_name: app.applicant?.personal?.full_name || 'Unknown',
          email: app.applicant?.email || 'No email',
          email_status: trackingRecord?.status || 'NOT_SCHEDULED',
          sent_at: trackingRecord?.sent_at || null,
          error_message: trackingRecord?.error_message || null,
          schedule_id: trackingRecord?.schedule_id || null
        };
      });

      // Calculate summary statistics
      const summary = {
        totalSelected: selectedApplications.length,
        totalSent: tracking.filter(t => t.status === 'SENT').length,
        totalFailed: tracking.filter(t => t.status === 'FAILED').length,
        totalPending: tracking.filter(t => t.status === 'PENDING').length,
        totalNotScheduled: selectedApplications.length - tracking.length,
        lastScheduled: schedules.length > 0 ? schedules[0].scheduled_date : null,
        lastCompleted: schedules.find(s => s.status === 'COMPLETED')?.completed_at || null
      };

      return {
        schedules,
        tracking,
        candidates: candidateStatus,
        summary
      };
    } catch (error) {
      logger.error('Error in getEmailStatus:', {
        postId,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Cancel a scheduled email batch
   * @param {number} scheduleId - Schedule ID
   * @param {number} adminId - Admin cancelling
   */
  async cancelSchedule(scheduleId, adminId) {
    const schedule = await db.AllotmentEmailSchedule.findByPk(scheduleId);
    
    if (!schedule) {
      throw new Error('Schedule not found');
    }

    if (schedule.status !== 'SCHEDULED') {
      throw new Error(`Cannot cancel schedule with status: ${schedule.status}`);
    }

    await schedule.update({
      status: 'CANCELLED',
      updated_by: adminId
    });

    // Update all pending tracking records
    await db.AllotmentEmailTracking.update(
      { status: 'FAILED', error_message: 'Schedule cancelled by admin' },
      {
        where: {
          schedule_id: scheduleId,
          status: 'PENDING'
        }
      }
    );

    logger.info('Schedule cancelled', { schedule_id: scheduleId, admin_id: adminId });

    return { success: true, message: 'Schedule cancelled successfully' };
  }

  /**
   * Retry failed emails for a schedule
   * @param {number} scheduleId - Schedule ID
   */
  async retryFailedEmails(scheduleId) {
    const schedule = await db.AllotmentEmailSchedule.findByPk(scheduleId, {
      include: [
        { model: db.PostMaster, as: 'post' },
        { model: db.PostAllotmentUpload, as: 'upload' }
      ]
    });

    if (!schedule) {
      throw new Error('Schedule not found');
    }

    // Reset failed trackings to pending
    await db.AllotmentEmailTracking.update(
      { status: 'PENDING', error_message: null },
      {
        where: {
          schedule_id: scheduleId,
          status: 'FAILED',
          retry_count: { [Op.lt]: 3 } // Max 3 retries
        }
      }
    );

    // Update schedule status
    await schedule.update({
      status: 'SCHEDULED',
      scheduled_date: new Date() // Send immediately
    });

    logger.info('Retrying failed emails', { schedule_id: scheduleId });

    return { success: true, message: 'Failed emails queued for retry' };
  }
}

module.exports = new AllotmentEmailService();
