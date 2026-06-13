const db = require('../models');
const { Op, QueryTypes } = require('sequelize');
const { ApiError } = require('../middleware/errorHandler');
const logger = require('../config/logger');

const ACTIVE_STATUSES = ['OPEN', 'APPLICATION_CLOSED', 'MERIT_GENERATED', 'SELECTION'];
const followsRegistrationWindow = async () =>
  (await require('./portalSettingService').getRegistrationMode()) === 'DRIVE_SCHEDULE';

const getActiveDrive = async (options = {}) => {
  return db.RecruitmentDrive.findOne({
    where: { is_active: true },
    transaction: options.transaction,
    lock: options.lock
  });
};

const getDriveForRead = async (driveId = null, options = {}) => {
  if (driveId) {
    return db.RecruitmentDrive.findByPk(driveId, {
      transaction: options.transaction
    });
  }

  const active = await getActiveDrive(options);
  if (active) return active;

  return db.RecruitmentDrive.findOne({
    order: [['created_at', 'DESC'], ['recruitment_drive_id', 'DESC']],
    transaction: options.transaction
  });
};

const requireActiveDrive = async (options = {}) => {
  const drive = await getActiveDrive(options);
  if (!drive) throw new ApiError(409, 'No active recruitment drive is configured');
  return drive;
};

const assertRegistrationOpen = async () => {
  if (!(await followsRegistrationWindow())) return getActiveDrive();
  const drive = await requireActiveDrive();
  const now = new Date();
  if (!drive.registration_open || drive.status !== 'OPEN') {
    throw new ApiError(403, 'Applicant registration is currently closed');
  }
  if (drive.registration_start_at && now < new Date(drive.registration_start_at)) {
    throw new ApiError(403, 'Applicant registration has not opened yet');
  }
  if (drive.registration_end_at && now > new Date(drive.registration_end_at)) {
    throw new ApiError(403, 'Applicant registration is closed');
  }
  return drive;
};

const assertApplicationsOpen = async () => {
  const drive = await requireActiveDrive();
  const now = new Date();
  if (!drive.applications_open || drive.status !== 'OPEN') {
    throw new ApiError(403, 'Applications are currently closed');
  }
  if (drive.application_start_at && now < new Date(drive.application_start_at)) {
    throw new ApiError(403, 'Applications have not opened yet');
  }
  if (drive.application_end_at && now > new Date(drive.application_end_at)) {
    throw new ApiError(403, 'Applications are closed');
  }
  return drive;
};

const recordHistory = async (drive, action, adminId, oldStatus, remarks, metadata, transaction) => {
  await db.RecruitmentDriveHistory.create({
    recruitment_drive_id: drive.recruitment_drive_id,
    action,
    old_status: oldStatus,
    new_status: drive.status,
    remarks: remarks || null,
    metadata: metadata || null,
    performed_by: adminId || null,
    performed_at: new Date()
  }, { transaction });
};

const listDrives = async () => {
  return db.sequelize.query(`
    SELECT
      rd.*,
      COALESCE(posts.total_posts, 0)::integer AS total_posts,
      COALESCE(posts.open_posts, 0)::integer AS open_posts,
      COALESCE(posts.closed_posts, 0)::integer AS closed_posts,
      COALESCE(posts.total_positions, 0)::integer AS total_positions,
      COALESCE(posts.filled_positions, 0)::integer AS filled_positions,
      GREATEST(
        COALESCE(posts.total_positions, 0) - COALESCE(posts.filled_positions, 0),
        0
      )::integer AS vacant_positions,
      COALESCE(applications.total_applications, 0)::integer AS total_applications,
      COALESCE(applications.submitted_applications, 0)::integer AS submitted_applications,
      COALESCE(applications.selected_applications, 0)::integer AS selected_applications,
      COALESCE(merit.total_merit_runs, 0)::integer AS total_merit_runs,
      COALESCE(merit.published_merit_runs, 0)::integer AS published_merit_runs
    FROM ms_recruitment_drives rd
    LEFT JOIN (
      SELECT
        recruitment_drive_id,
        COUNT(*) AS total_posts,
        COUNT(*) FILTER (
          WHERE is_active IS TRUE AND is_closed IS NOT TRUE
        ) AS open_posts,
        COUNT(*) FILTER (WHERE is_closed IS TRUE) AS closed_posts,
        SUM(COALESCE(total_positions, 0)) AS total_positions,
        SUM(COALESCE(filled_positions, 0)) AS filled_positions
      FROM ms_post_master
      WHERE is_deleted IS NOT TRUE
      GROUP BY recruitment_drive_id
    ) posts ON posts.recruitment_drive_id = rd.recruitment_drive_id
    LEFT JOIN (
      SELECT
        recruitment_drive_id,
        COUNT(*) AS total_applications,
        COUNT(*) FILTER (WHERE submitted_at IS NOT NULL) AS submitted_applications,
        COUNT(*) FILTER (WHERE selection_status = 'SELECTED') AS selected_applications
      FROM ms_applications
      WHERE is_deleted IS NOT TRUE
      GROUP BY recruitment_drive_id
    ) applications ON applications.recruitment_drive_id = rd.recruitment_drive_id
    LEFT JOIN (
      SELECT
        recruitment_drive_id,
        COUNT(*) AS total_merit_runs,
        COUNT(*) FILTER (WHERE published_at IS NOT NULL) AS published_merit_runs
      FROM ms_merit_generation_runs
      GROUP BY recruitment_drive_id
    ) merit ON merit.recruitment_drive_id = rd.recruitment_drive_id
    ORDER BY rd.created_at DESC, rd.recruitment_drive_id DESC
  `, { type: QueryTypes.SELECT });
};

const createDrive = async (data, adminId) => {
  const transaction = await db.sequelize.transaction();
  try {
    const requestedActive = data.is_active === true;
    if (
      data.application_start_at &&
      data.application_end_at &&
      new Date(data.application_end_at) <= new Date(data.application_start_at)
    ) {
      throw new ApiError(400, 'Application end time must be after application start time');
    }
    if (
      data.registration_start_at &&
      data.registration_end_at &&
      new Date(data.registration_end_at) <= new Date(data.registration_start_at)
    ) {
      throw new ApiError(400, 'Registration end time must be after registration start time');
    }
    if (requestedActive) {
      const active = await getActiveDrive({ transaction, lock: transaction.LOCK.UPDATE });
      if (active) throw new ApiError(409, `Recruitment drive "${active.drive_name}" is already active`);
    }

    const drive = await db.RecruitmentDrive.create({
      drive_code: String(data.drive_code || '').trim(),
      drive_name: String(data.drive_name || '').trim(),
      status: requestedActive ? 'OPEN' : 'DRAFT',
      is_active: requestedActive,
      registration_open: requestedActive && data.registration_open === true,
      applications_open: requestedActive && data.applications_open === true,
      registration_start_at: data.registration_start_at || null,
      registration_end_at: data.registration_end_at || null,
      application_start_at: data.application_start_at || null,
      application_end_at: data.application_end_at || null,
      created_by: adminId,
      updated_by: adminId,
      created_at: new Date(),
      updated_at: new Date()
    }, { transaction });

    if (!drive.drive_code || !drive.drive_name) {
      throw new ApiError(400, 'Drive code and drive name are required');
    }

    if (requestedActive) {
      await db.ApplicantMaster.update({
        profile_edit_override: false,
        profile_edit_override_reason: null,
        profile_edit_override_by: null,
        profile_edit_override_at: null
      }, {
        where: { profile_edit_override: true },
        transaction
      });
    }

    await recordHistory(drive, 'CREATED', adminId, null, data.remarks, null, transaction);
    await transaction.commit();
    return drive;
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};

const updateDrive = async (driveId, data, adminId) => {
  const transaction = await db.sequelize.transaction();
  try {
    const drive = await db.RecruitmentDrive.findByPk(driveId, { transaction });
    if (!drive) throw new ApiError(404, 'Recruitment drive not found');
    const scheduleFields = [
      'registration_start_at', 'registration_end_at',
      'application_start_at', 'application_end_at'
    ];
    if (
      scheduleFields.some((field) => data[field] !== undefined) &&
      drive.status !== 'DRAFT'
    ) {
      throw new ApiError(409, 'Schedule is locked after the recruitment drive is activated');
    }
    const nextApplicationStart = data.application_start_at !== undefined
      ? data.application_start_at
      : drive.application_start_at;
    const nextApplicationEnd = data.application_end_at !== undefined
      ? data.application_end_at
      : drive.application_end_at;
    const nextRegistrationStart = data.registration_start_at !== undefined
      ? data.registration_start_at
      : drive.registration_start_at;
    const nextRegistrationEnd = data.registration_end_at !== undefined
      ? data.registration_end_at
      : drive.registration_end_at;
    if (
      nextApplicationStart &&
      nextApplicationEnd &&
      new Date(nextApplicationEnd) <= new Date(nextApplicationStart)
    ) {
      throw new ApiError(400, 'Application end time must be after application start time');
    }
    if (
      nextRegistrationStart &&
      nextRegistrationEnd &&
      new Date(nextRegistrationEnd) <= new Date(nextRegistrationStart)
    ) {
      throw new ApiError(400, 'Registration end time must be after registration start time');
    }

    const allowed = [
      'drive_name', 'registration_start_at', 'registration_end_at',
      'application_start_at', 'application_end_at'
    ];
    const changes = { updated_by: adminId, updated_at: new Date() };
    allowed.forEach((field) => {
      if (data[field] !== undefined) changes[field] = data[field] || null;
    });
    await drive.update(changes, { transaction });

    if (
      drive.status === 'DRAFT' && (
        data.application_start_at !== undefined || data.application_end_at !== undefined
      )
    ) {
      const postChanges = { updated_by: adminId, updated_at: new Date() };
      if (data.application_start_at !== undefined) {
        postChanges.opening_date = data.application_start_at
          ? new Date(data.application_start_at).toISOString().slice(0, 10)
          : null;
      }
      if (data.application_end_at !== undefined) {
        postChanges.closing_date = data.application_end_at
          ? new Date(data.application_end_at).toISOString().slice(0, 10)
          : null;
      }
      await db.PostMaster.update(postChanges, {
        where: { recruitment_drive_id: drive.recruitment_drive_id, is_deleted: false },
        transaction
      });
    }

    await recordHistory(drive, 'SCHEDULE_UPDATED', adminId, drive.status, data.remarks, changes, transaction);
    await transaction.commit();
    return drive;
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};

const transitionDrive = async (driveId, action, adminId, remarks = null) => {
  const transaction = await db.sequelize.transaction();
  try {
    const drive = await db.RecruitmentDrive.findByPk(driveId, {
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    if (!drive) throw new ApiError(404, 'Recruitment drive not found');

    const oldStatus = drive.status;
    const now = new Date();
    const changes = { updated_by: adminId, updated_at: now };

    switch (action) {
      case 'ACTIVATE': {
        if (drive.status !== 'DRAFT') {
          throw new ApiError(409, 'Only a draft recruitment drive can be activated');
        }
        const postCount = await db.PostMaster.count({
          where: { recruitment_drive_id: drive.recruitment_drive_id, is_deleted: false },
          transaction
        });
        if (postCount === 0) {
          throw new ApiError(409, 'Add at least one post and position before activating the recruitment drive');
        }
        if (!drive.application_start_at || !drive.application_end_at) {
          throw new ApiError(409, 'Set the application start and end time before activating the recruitment drive');
        }
        const invalidPositionCount = await db.PostMaster.count({
          where: {
            recruitment_drive_id: drive.recruitment_drive_id,
            is_deleted: false,
            total_positions: { [Op.lte]: 0 }
          },
          transaction
        });
        if (invalidPositionCount > 0) {
          throw new ApiError(409, `${invalidPositionCount} post(s) have no positions configured`);
        }
        const active = await getActiveDrive({ transaction, lock: transaction.LOCK.UPDATE });
        if (active && active.recruitment_drive_id !== drive.recruitment_drive_id) {
          throw new ApiError(409, `Recruitment drive "${active.drive_name}" is already active`);
        }
        const applicationWindowOpen = new Date(drive.application_start_at) <= now
          && new Date(drive.application_end_at) > now;
        Object.assign(changes, {
          is_active: true,
          status: 'OPEN',
          applications_open: applicationWindowOpen
        });
        await db.PostMaster.update({
          is_active: applicationWindowOpen,
          is_closed: false,
          closed_at: null,
          closed_by: null,
          opening_date: new Date(drive.application_start_at).toISOString().slice(0, 10),
          closing_date: new Date(drive.application_end_at).toISOString().slice(0, 10),
          updated_by: adminId,
          updated_at: now
        }, {
          where: { recruitment_drive_id: drive.recruitment_drive_id, is_deleted: false },
          transaction
        });
        await db.ApplicantMaster.update({
          profile_edit_override: false,
          profile_edit_override_reason: null,
          profile_edit_override_by: null,
          profile_edit_override_at: null
        }, {
          where: { profile_edit_override: true },
          transaction
        });
        break;
      }
      case 'OPEN_REGISTRATION':
        if (!drive.is_active || drive.status !== 'OPEN') throw new ApiError(409, 'Only an open active drive can accept registrations');
        if (drive.registration_end_at && new Date(drive.registration_end_at) <= now) {
          throw new ApiError(409, 'Extend the registration end time before opening registration');
        }
        changes.registration_open = true;
        if (!drive.registration_start_at || new Date(drive.registration_start_at) > now) {
          changes.registration_start_at = now;
        }
        break;
      case 'CLOSE_REGISTRATION':
        changes.registration_open = false;
        break;
      case 'OPEN_APPLICATIONS':
        if (!drive.is_active || drive.status !== 'OPEN') throw new ApiError(409, 'Only an open active drive can accept applications');
        if (drive.application_end_at && new Date(drive.application_end_at) <= now) {
          throw new ApiError(409, 'Extend the application end time before opening applications');
        }
        changes.applications_open = true;
        if (adminId) changes.application_start_at = now;
        await db.PostMaster.update({
          is_active: true,
          is_closed: false,
          closed_at: null,
          closed_by: null,
          opening_date: adminId
            ? now.toISOString().slice(0, 10)
            : new Date(drive.application_start_at).toISOString().slice(0, 10),
          updated_by: adminId,
          updated_at: now
        }, {
          where: { recruitment_drive_id: drive.recruitment_drive_id, is_deleted: false },
          transaction
        });
        break;
      case 'CLOSE_APPLICATIONS':
        if (!drive.is_active || drive.status !== 'OPEN') {
          throw new ApiError(409, 'Only an open active drive can close applications');
        }
        Object.assign(changes, {
          applications_open: false,
          registration_open: false,
          status: 'APPLICATION_CLOSED',
          applications_closed_at: now
        });
        await db.PostMaster.update({
          is_active: false,
          is_closed: true,
          closed_at: now,
          closed_by: adminId ? `ADMIN_${adminId}` : 'SYSTEM'
        }, {
          where: { recruitment_drive_id: drive.recruitment_drive_id, is_deleted: false },
          transaction
        });
        break;
      case 'START_SELECTION':
        // Backward-compatible no-op for older clients. Selection is available
        // immediately after official merit generation.
        if (!['APPLICATION_CLOSED', 'MERIT_GENERATED', 'SELECTION'].includes(drive.status)) {
          throw new ApiError(409, 'Applications must be closed before selection starts');
        }
        changes.status = drive.status === 'APPLICATION_CLOSED' ? 'APPLICATION_CLOSED' : 'MERIT_GENERATED';
        break;
      case 'CLOSE':
        if (!['MERIT_GENERATED', 'SELECTION'].includes(drive.status)) {
          throw new ApiError(409, 'Official merit must be generated before the recruitment drive can be completed');
        }
        Object.assign(changes, {
          is_active: false,
          registration_open: false,
          applications_open: false,
          status: 'CLOSED',
          closed_at: now,
          closed_by: adminId
        });
        break;
      default:
        throw new ApiError(400, 'Unsupported recruitment drive action');
    }

    await drive.update(changes, { transaction });
    await recordHistory(drive, action, adminId, oldStatus, remarks, changes, transaction);
    await transaction.commit();

    if (action === 'CLOSE_APPLICATIONS') {
      let summary;
      try {
        summary = await generateOfficialMeritForDrive(drive.recruitment_drive_id, adminId);
      } catch (error) {
        logger.error(`Drive ${drive.recruitment_drive_id} closed but merit generation could not start`, error);
        summary = {
          total_posts: null,
          successful_posts: 0,
          failed_posts: null,
          system_error: error.message
        };
      }
      drive.setDataValue('merit_generation_summary', summary);
    }

    const driveNotification = {
        title: 'Recruitment drive updated',
        message: `${drive.drive_name}: ${action.replaceAll('_', ' ').toLowerCase()}.`,
        notification_type: 'RECRUITMENT',
        event_code: `DRIVE_${action}`,
        action_url: '/recruitment-drives',
        recruitment_drive_id: drive.recruitment_drive_id,
        metadata: { old_status: oldStatus, new_status: drive.status }
    };
    if (adminId) await require('./notificationService').notifyAdmin(adminId, driveNotification);
    else await require('./notificationService').notifyAllAdmins(driveNotification);

    return drive;
  } catch (error) {
    if (!transaction.finished) await transaction.rollback();
    throw error;
  }
};

const generateOfficialMeritForDrive = async (driveId, adminId) => {
  const posts = await db.PostMaster.findAll({
    where: { recruitment_drive_id: driveId, is_deleted: false },
    attributes: ['post_id']
  });
  const meritListService = require('./meritListService');
  const results = [];

  for (const post of posts) {
    try {
      const result = await meritListService.generateMeritList(post.post_id, null, adminId);
      results.push({ post_id: post.post_id, success: true, count: result.count });
    } catch (error) {
      logger.error(`Official merit generation failed for post ${post.post_id}`, error);
      results.push({ post_id: post.post_id, success: false, error: error.message });
    }
  }

  const failed = results.filter((result) => !result.success);
  if (failed.length === 0) {
    await db.RecruitmentDrive.update({
      status: 'MERIT_GENERATED',
      merit_generated_at: new Date(),
      updated_by: adminId,
      updated_at: new Date()
    }, { where: { recruitment_drive_id: driveId } });
  }

  return {
    total_posts: results.length,
    successful_posts: results.length - failed.length,
    failed_posts: failed.length,
    results
  };
};

const clonePosts = async (driveId, sourcePostIds, adminId) => {
  const transaction = await db.sequelize.transaction();
  try {
    const drive = await db.RecruitmentDrive.findByPk(driveId, { transaction });
    if (!drive) throw new ApiError(404, 'Recruitment drive not found');
    if (drive.status !== 'DRAFT') {
      throw new ApiError(409, 'Posts can only be copied into a draft recruitment drive');
    }
    if (!Array.isArray(sourcePostIds) || sourcePostIds.length === 0) {
      throw new ApiError(400, 'At least one source post is required');
    }

    const sourcePosts = await db.PostMaster.findAll({
      where: { post_id: { [Op.in]: sourcePostIds }, is_deleted: false },
      transaction
    });
    const existingClones = await db.PostMaster.findAll({
      where: {
        recruitment_drive_id: drive.recruitment_drive_id,
        source_post_id: { [Op.in]: sourcePostIds },
        is_deleted: false
      },
      attributes: ['source_post_id'],
      transaction
    });
    const existingSourceIds = new Set(existingClones.map((post) => post.source_post_id));
    const created = [];

    for (const source of sourcePosts) {
      if (existingSourceIds.has(source.post_id)) continue;
      const values = source.toJSON();
      delete values.post_id;
      delete values.created_at;
      delete values.updated_at;
      delete values.deleted_at;
      delete values.deleted_by;
      values.recruitment_drive_id = drive.recruitment_drive_id;
      values.source_post_id = source.post_id;
      values.post_code = source.post_code
        ? `${String(source.post_code).slice(0, 30)}-${String(drive.drive_code).slice(0, 10)}-${source.post_id}`.slice(0, 50)
        : null;
      values.filled_positions = 0;
      values.is_active = false;
      values.is_closed = false;
      values.opening_date = drive.application_start_at
        ? new Date(drive.application_start_at).toISOString().slice(0, 10)
        : values.opening_date;
      values.closing_date = drive.application_end_at
        ? new Date(drive.application_end_at).toISOString().slice(0, 10)
        : values.closing_date;
      values.closed_at = null;
      values.closed_by = null;
      values.merit_status = 'NOT_GENERATED';
      values.merit_published_at = null;
      values.merit_published_by = null;
      values.created_by = adminId;
      values.updated_by = adminId;

      const post = await db.PostMaster.create(values, { transaction });

      const categories = await db.PostCategory.findAll({
        where: { post_id: source.post_id, is_active: true },
        transaction
      });
      if (categories.length) {
        await db.PostCategory.bulkCreate(categories.map((item) => ({
          post_id: post.post_id,
          category_id: item.category_id,
          is_active: true,
          created_by: adminId,
          updated_by: adminId
        })), { transaction });
      }

      const documents = await db.PostDocumentRequirement.findAll({
        where: { post_id: source.post_id, is_active: true },
        transaction
      });
      if (documents.length) {
        await db.PostDocumentRequirement.bulkCreate(documents.map((item) => {
          const doc = item.toJSON();
          delete doc.id;
          doc.post_id = post.post_id;
          doc.created_by = adminId;
          doc.updated_by = adminId;
          return doc;
        }), { transaction });
      }

      created.push(post);
    }

    await recordHistory(drive, 'POSTS_CLONED', adminId, drive.status, null, {
      source_post_ids: sourcePostIds,
      created_post_ids: created.map((post) => post.post_id)
    }, transaction);
    await transaction.commit();
    return created;
  } catch (error) {
    await transaction.rollback();
    logger.error('Clone recruitment drive posts failed', error);
    throw error;
  }
};

module.exports = {
  ACTIVE_STATUSES,
  getActiveDrive,
  getDriveForRead,
  requireActiveDrive,
  assertRegistrationOpen,
  followsRegistrationWindow,
  assertApplicationsOpen,
  listDrives,
  createDrive,
  updateDrive,
  transitionDrive,
  clonePosts,
  generateOfficialMeritForDrive
};
