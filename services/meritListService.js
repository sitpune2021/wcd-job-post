/**
 * Persisted merit-list service.
 *
 * Uses the same score formula as admin review, stores every generation as a
 * versioned run, and returns only the latest completed run.
 */
const db = require('../models');
const { Op } = require('sequelize');
const logger = require('../config/logger');
const { ApiError } = require('../middleware/errorHandler');
const { calculateMeritScore } = require('./applicationWorkflowService');

class MeritListService {
  async generateMeritList(postId, districtId, generatedBy) {
    const transaction = await db.sequelize.transaction();
    try {
      const post = await db.PostMaster.findOne({
        where: { post_id: postId, is_deleted: false },
        transaction
      });
      if (!post) throw new ApiError(404, 'Post not found');
      const drive = await db.RecruitmentDrive.findByPk(post.recruitment_drive_id, { transaction });
      if (!drive) throw new ApiError(409, 'Post is not linked to a recruitment drive');
      if (drive.status === 'DRAFT') {
        throw new ApiError(409, 'Activate the recruitment drive before generating merit');
      }
      if (drive.status === 'OPEN' && !drive.is_active) {
        throw new ApiError(409, 'Merit cannot be generated for a non-active open recruitment drive');
      }

      const finalDistrictId = parseInt(districtId, 10) || post.district_id;
      if (!finalDistrictId) throw new ApiError(400, 'District is required to generate merit');

      const previousRun = await db.MeritGenerationRun.max('run_number', {
        where: {
          recruitment_drive_id: drive.recruitment_drive_id,
          post_id: postId,
          district_id: finalDistrictId
        },
        transaction
      });
      const runNumber = (parseInt(previousRun, 10) || 0) + 1;
      const isOfficial = post.is_closed || !post.is_active || drive.status !== 'OPEN';
      const run = await db.MeritGenerationRun.create({
        recruitment_drive_id: drive.recruitment_drive_id,
        post_id: postId,
        district_id: finalDistrictId,
        run_number: runNumber,
        run_type: isOfficial ? (runNumber > 1 ? 'REGENERATION' : 'OFFICIAL') : 'PREVIEW',
        status: 'PROCESSING',
        is_official: isOfficial,
        formula_snapshot: {
          formula: 'applicationWorkflowService.calculateMeritScore',
          tie_breakers: ['submitted_at ASC', 'application_no ASC']
        },
        generated_by: generatedBy,
        started_at: new Date()
      }, { transaction });

      const applications = await db.Application.findAll({
        where: {
          post_id: postId,
          district_id: finalDistrictId,
          recruitment_drive_id: drive.recruitment_drive_id,
          is_deleted: { [Op.ne]: true },
          declaration_accepted: true,
          submitted_at: { [Op.ne]: null },
          system_eligibility: true
        },
        include: [
          { model: db.PostMaster, as: 'post', attributes: ['post_id', 'district_id'] },
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
        ],
        transaction
      });

      const preferences = applications.length
        ? await db.ApplicationPreference.findAll({
          where: {
            recruitment_drive_id: drive.recruitment_drive_id,
            application_id: { [Op.in]: applications.map((application) => application.application_id) }
          },
          transaction
        })
        : [];
      const preferenceMap = new Map(preferences.map((item) => [item.application_id, item.preference_rank]));

      const scored = [];
      for (const application of applications) {
        const score = await calculateMeritScore(application, transaction);
        scored.push({
          application_id: application.application_id,
          post_id: postId,
          district_id: finalDistrictId,
          recruitment_drive_id: drive.recruitment_drive_id,
          merit_run_id: run.merit_run_id,
          generation_version: runNumber,
          preference_rank: preferenceMap.get(application.application_id) || null,
          score,
          score_snapshot: {
            submitted_at: application.submitted_at,
            application_no: application.application_no,
            calculated_at: new Date()
          },
          is_official: isOfficial,
          selection_status: application.selection_status || 'PENDING',
          generated_at: new Date(),
          generated_by: generatedBy
        });
      }

      scored.sort((a, b) => {
        const scoreDifference = Number(b.score) - Number(a.score);
        if (scoreDifference !== 0) return scoreDifference;
        const aApp = applications.find((item) => item.application_id === a.application_id);
        const bApp = applications.find((item) => item.application_id === b.application_id);
        const submittedDifference = new Date(aApp?.submitted_at || 0) - new Date(bApp?.submitted_at || 0);
        if (submittedDifference !== 0) return submittedDifference;
        return String(aApp?.application_no || '').localeCompare(String(bApp?.application_no || ''));
      });
      scored.forEach((entry, index) => { entry.rank = index + 1; });

      if (scored.length) {
        await db.MeritList.bulkCreate(scored, { transaction });
        for (const entry of scored) {
          await db.Application.update(
            { merit_score: entry.score },
            { where: { application_id: entry.application_id }, transaction }
          );
        }
      }

      await run.update({
        status: 'COMPLETED',
        total_applications: scored.length,
        completed_at: new Date()
      }, { transaction });
      await post.update({
        merit_status: isOfficial ? 'OFFICIAL_GENERATED' : 'PREVIEW_GENERATED'
      }, { transaction });
      await transaction.commit();

      return {
        success: true,
        postId,
        districtId: finalDistrictId,
        count: scored.length,
        meritRunId: run.merit_run_id,
        runNumber,
        isOfficial
      };
    } catch (error) {
      if (transaction && !transaction.finished) await transaction.rollback();
      logger.error('MERIT: Error generating merit list:', error);
      throw error;
    }
  }

  async getMeritList(postId, districtId, options = {}) {
    const { page = 1, limit = 50, adminUser } = options;
    const offset = (page - 1) * limit;
    const post = await db.PostMaster.findByPk(postId);
    const finalDistrictId = parseInt(districtId, 10) || post?.district_id;

    const latestRun = await db.MeritGenerationRun.findOne({
      where: {
        post_id: postId,
        district_id: finalDistrictId,
        status: { [Op.in]: ['COMPLETED', 'PUBLISHED'] }
      },
      order: [['run_number', 'DESC']]
    });
    if (!latestRun) {
      return {
        meritList: [],
        generationRun: null,
        batchInfo: null,
        pagination: { total: 0, page, limit, totalPages: 0 }
      };
    }

    const where = { merit_run_id: latestRun.merit_run_id };
    let batchInfo = null;
    if (adminUser?.review_batch_start && adminUser?.review_batch_end) {
      where.rank = { [Op.between]: [adminUser.review_batch_start, adminUser.review_batch_end] };
      batchInfo = {
        batch_start: adminUser.review_batch_start,
        batch_end: adminUser.review_batch_end,
        is_filtered: true
      };
    }

    const { count, rows } = await db.MeritList.findAndCountAll({
      where,
      include: [{
        model: db.Application,
        as: 'application',
        include: [{
          model: db.ApplicantMaster,
          as: 'applicant',
          include: [{ model: db.ApplicantPersonal, as: 'personal' }]
        }]
      }],
      order: [['rank', 'ASC']],
      limit,
      offset
    });

    return {
      meritList: rows,
      generationRun: latestRun,
      batchInfo,
      pagination: { total: count, page, limit, totalPages: Math.ceil(count / limit) }
    };
  }

  async publishLatestMeritList(postId, districtId, adminId) {
    const post = await db.PostMaster.findByPk(postId);
    if (!post) throw new ApiError(404, 'Post not found');
    const finalDistrictId = parseInt(districtId, 10) || post.district_id;
    const run = await db.MeritGenerationRun.findOne({
      where: {
        post_id: postId,
        district_id: finalDistrictId,
        is_official: true,
        status: { [Op.in]: ['COMPLETED', 'PUBLISHED'] }
      },
      order: [['run_number', 'DESC']]
    });
    if (!run) throw new ApiError(409, 'Generate an official merit list before publishing');
    if (run.status === 'PUBLISHED') {
      return { post_id: postId, merit_run_id: run.merit_run_id, published_at: run.published_at };
    }

    const transaction = await db.sequelize.transaction();
    try {
      const publishedAt = new Date();
      await db.MeritGenerationRun.update({
        status: 'PUBLISHED',
        published_at: publishedAt,
        published_by: adminId
      }, { where: { merit_run_id: run.merit_run_id }, transaction });
      await db.MeritList.update({
        published_at: publishedAt,
        published_by: adminId
      }, { where: { merit_run_id: run.merit_run_id }, transaction });
      await db.PostMaster.update({
        merit_status: 'PUBLISHED',
        merit_published_at: publishedAt,
        merit_published_by: adminId
      }, { where: { post_id: postId }, transaction });
      await transaction.commit();
      const applications = await db.Application.findAll({
        where: { post_id: postId, is_deleted: false, submitted_at: { [Op.ne]: null } },
        attributes: ['applicant_id', 'application_id', 'recruitment_drive_id']
      });
      await Promise.all(applications.map((application) =>
        require('./notificationService').notifyApplicant(application.applicant_id, {
          title: 'Merit list published',
          message: `The merit list for ${post.post_name || 'your applied post'} has been published.`,
          title_mr: 'गुणवत्ता यादी प्रकाशित झाली',
          message_mr: `${post.post_name_mr || post.post_name || 'आपण अर्ज केलेल्या पदाची'} गुणवत्ता यादी प्रकाशित झाली आहे.`,
          notification_type: 'MERIT',
          event_code: 'MERIT_LIST_PUBLISHED',
          action_url: '/dashboard/applied-posts',
          recruitment_drive_id: application.recruitment_drive_id,
          application_id: application.application_id,
          post_id: postId
        })
      ));
      await require('./notificationService').notifyAdmin(adminId, {
        title: 'Merit list published',
        message: `Published merit list for ${post.post_name || postId}.`,
        notification_type: 'MERIT',
        event_code: 'MERIT_LIST_PUBLISHED',
        action_url: `/merit?recruitment_drive_id=${post.recruitment_drive_id}`,
        recruitment_drive_id: post.recruitment_drive_id,
        post_id: postId
      });
      return { post_id: postId, merit_run_id: run.merit_run_id, published_at: publishedAt };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async getPublishedMeritList(postId) {
    const run = await db.MeritGenerationRun.findOne({
      where: { post_id: postId, status: 'PUBLISHED' },
      order: [['published_at', 'DESC'], ['run_number', 'DESC']]
    });
    if (!run) throw new ApiError(404, 'No published merit list is available for this post');

    const [post, rows] = await Promise.all([
      db.PostMaster.findByPk(postId, {
        attributes: ['post_id', 'post_code', 'post_name', 'post_name_mr']
      }),
      db.MeritList.findAll({
        where: { merit_run_id: run.merit_run_id },
        attributes: ['rank'],
        include: [{
          model: db.Application,
          as: 'application',
          attributes: ['application_no', 'submitted_at'],
          include: [{
            model: db.ApplicantMaster,
            as: 'applicant',
            attributes: ['applicant_id'],
            include: [{
              model: db.ApplicantPersonal,
              as: 'personal',
              attributes: ['full_name']
            }]
          }]
        }],
        order: [['rank', 'ASC']]
      })
    ]);
    return { post, generationRun: run, meritList: rows };
  }
}

module.exports = new MeritListService();
