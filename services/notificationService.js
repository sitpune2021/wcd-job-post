const db = require('../models');
const logger = require('../config/logger');
const { Op } = require('sequelize');

const create = async (data, options = {}) => {
  try {
    if (!await require('./portalSettingService').areNotificationsEnabled()) return null;
    return await db.NotificationLog.create({
      channel: 'SYSTEM',
      status: 'SENT',
      sent_at: new Date(),
      created_at: new Date(),
      is_read: false,
      is_deleted: false,
      ...data
    }, options);
  } catch (error) {
    logger.error('System notification could not be recorded', { error: error.message, event_code: data.event_code });
    return null;
  }
};

const notifyApplicant = (applicantId, data, options) => create({ applicant_id: applicantId, ...data }, options);
const notifyAdmin = (adminId, data, options) => create({ admin_id: adminId, ...data }, options);

const notifyRelevantAdmins = async ({ districtId, schemeId }, data, options = {}) => {
  try {
    const scopes = [];
    if (districtId) scopes.push({ district_id: districtId });
    if (schemeId) scopes.push({ scheme_id: schemeId });
    if (scopes.length === 0) return [];
    const admins = await db.AdminUser.findAll({
      where: { is_active: true, is_deleted: false, [Op.or]: scopes },
      attributes: ['admin_id'],
      ...options
    });
    return Promise.all(admins.map((admin) => notifyAdmin(admin.admin_id, data, options)));
  } catch (error) {
    logger.error('Relevant admin notifications could not be recorded', { error: error.message });
    return [];
  }
};

const notifyAllAdmins = async (data) => {
  const admins = await db.AdminUser.findAll({
    where: { is_active: true, is_deleted: false },
    attributes: ['admin_id']
  });
  return Promise.all(admins.map((admin) => notifyAdmin(admin.admin_id, data)));
};

const list = async (where, query = {}) => {
  if (!await require('./portalSettingService').areNotificationsEnabled()) return [];
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 30, 1), 100);
  const rows = await db.NotificationLog.findAll({
    where: { ...where, is_deleted: false, channel: 'SYSTEM' },
    order: [['created_at', 'DESC']],
    limit
  });
  return rows;
};

const unreadCount = async (where) => {
  if (!await require('./portalSettingService').areNotificationsEnabled()) return 0;
  return db.NotificationLog.count({
    where: { ...where, is_deleted: false, channel: 'SYSTEM', is_read: false }
  });
};

const markRead = async (where, notificationId = null) => {
  const finalWhere = { ...where, is_deleted: false, channel: 'SYSTEM', is_read: false };
  if (notificationId) finalWhere.notification_id = notificationId;
  await db.NotificationLog.update(
    { is_read: true, read_at: new Date(), updated_at: new Date() },
    { where: finalWhere }
  );
};

module.exports = { notifyApplicant, notifyAdmin, notifyRelevantAdmins, notifyAllAdmins, list, unreadCount, markRead };
