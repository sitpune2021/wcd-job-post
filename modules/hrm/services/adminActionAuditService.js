const db = require('../../../models');
const logger = require('../../../config/logger');
const { ApiError } = require('../../../middleware/errorHandler');

const AUDIT_ENABLED_KEY = 'chrms_admin_audit_enabled';
const REMARK_REQUIRED_KEY = 'chrms_admin_audit_remark_required';

const settingCache = {
  value: null,
  expiresAt: 0
};

const toPlain = (value) => {
  if (!value) return null;
  if (typeof value.get === 'function') return value.get({ plain: true });
  return value;
};

const cleanRequestData = (body = {}) => {
  if (!body || typeof body !== 'object') return body;

  const clone = { ...body };
  delete clone.password;
  delete clone.confirm_password;
  delete clone.token;
  delete clone.access_token;
  delete clone.refresh_token;
  delete clone.admin_remark;
  delete clone.audit_remark;
  return clone;
};

const getBooleanSetting = async (key, fallback = false) => {
  const setting = await db.PortalSetting.findOne({
    where: { setting_key: key },
    attributes: ['setting_value']
  });

  if (setting?.setting_value === true || setting?.setting_value === false) {
    return setting.setting_value;
  }
  return fallback;
};

const getSettings = async ({ forceRefresh = false } = {}) => {
  const now = Date.now();
  if (!forceRefresh && settingCache.value && settingCache.expiresAt > now) {
    return settingCache.value;
  }

  const value = {
    enabled: await getBooleanSetting(AUDIT_ENABLED_KEY, false),
    remarkRequired: await getBooleanSetting(REMARK_REQUIRED_KEY, false)
  };

  settingCache.value = value;
  settingCache.expiresAt = now + 30000;
  return value;
};

const updateSettings = async ({ enabled, remarkRequired }, adminId) => {
  if (typeof enabled !== 'boolean' || typeof remarkRequired !== 'boolean') {
    throw new ApiError(400, 'Audit enabled and remark required must be true or false');
  }

  const upsertSetting = async (key, value, description) => {
    const [setting] = await db.PortalSetting.findOrCreate({
      where: { setting_key: key },
      defaults: {
        setting_value: value,
        description,
        created_by: adminId,
        updated_by: adminId
      }
    });

    await setting.update({
      setting_value: value,
      description,
      updated_by: adminId,
      updated_at: new Date()
    });
  };

  await upsertSetting(AUDIT_ENABLED_KEY, enabled, 'Enable CHRMS admin action audit logging.');
  await upsertSetting(REMARK_REQUIRED_KEY, remarkRequired, 'Require admin remark before CHRMS mutating actions.');

  settingCache.value = null;
  return getSettings({ forceRefresh: true });
};

const extractRemark = (req) => {
  const body = req.body || {};
  return (
    body.admin_remark ||
    body.audit_remark ||
    req.get?.('x-admin-remark') ||
    ''
  ).toString().trim();
};

const getAdminId = (req) => req.user?.admin_id || req.user?.id || null;

const getAdminName = (req) => (
  req.user?.username ||
  req.user?.email ||
  req.user?.full_name ||
  req.user?.name ||
  null
);

const requireAuditRemark = async (req, _res, next) => {
  try {
    const settings = await getSettings();
    if (!settings.enabled || !settings.remarkRequired) {
      return next();
    }

    if (!extractRemark(req)) {
      throw new ApiError(400, 'Admin remark is required for this CHRMS action');
    }

    return next();
  } catch (error) {
    return next(error);
  }
};

const recordAction = async (req, options = {}) => {
  try {
    const settings = await getSettings();
    if (!settings.enabled) return null;

    const sql = `
      INSERT INTO ms_hrms_admin_action_audit_logs (
        admin_id, admin_name, action_method, action_url, module_name,
        entity_type, entity_id, remark, request_data, old_data, new_data,
        ip_address, user_agent
      )
      VALUES (
        :adminId, :adminName, :actionMethod, :actionUrl, :moduleName,
        :entityType, :entityId, :remark, CAST(:requestData AS JSONB),
        CAST(:oldData AS JSONB), CAST(:newData AS JSONB),
        CAST(:ipAddress AS INET), :userAgent
      )
      RETURNING audit_id
    `;

    const [rows] = await db.sequelize.query(sql, {
      replacements: {
        adminId: getAdminId(req),
        adminName: getAdminName(req),
        actionMethod: req.method,
        actionUrl: req.originalUrl || req.url,
        moduleName: options.moduleName || 'CHRMS',
        entityType: options.entityType || null,
        entityId: options.entityId !== undefined && options.entityId !== null ? String(options.entityId) : null,
        remark: options.remark || extractRemark(req) || null,
        requestData: JSON.stringify(cleanRequestData(options.requestData || req.body || {})),
        oldData: JSON.stringify(toPlain(options.oldData)),
        newData: JSON.stringify(toPlain(options.newData)),
        ipAddress: null,
        userAgent: req.get?.('user-agent') || null
      }
    });

    return rows?.[0] || null;
  } catch (error) {
    logger.error('CHRMS admin audit log insert failed:', {
      message: error.message,
      path: req.originalUrl || req.url,
      method: req.method
    });
    return null;
  }
};

module.exports = {
  getSettings,
  updateSettings,
  extractRemark,
  requireAuditRemark,
  recordAction
};
