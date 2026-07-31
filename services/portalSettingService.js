const db = require('../models');

const REGISTRATION_KEY = 'applicant_registration_mode';
const NOTIFICATIONS_KEY = 'notifications_enabled';
const OCR_KEY = 'ocr_enabled';
const MODES = ['DRIVE_SCHEDULE', 'ALWAYS_OPEN'];

const getRegistrationMode = async () => {
  const setting = await db.PortalSetting.findOne({ where: { setting_key: REGISTRATION_KEY } });
  return MODES.includes(setting?.setting_value) ? setting.setting_value : 'DRIVE_SCHEDULE';
};

const getSettings = async () => ({
  applicant_registration_mode: await getRegistrationMode(),
  notifications_enabled: await areNotificationsEnabled(),
  ocr_enabled: await isOcrEnabled()
});

const areNotificationsEnabled = async () => {
  const setting = await db.PortalSetting.findOne({ where: { setting_key: NOTIFICATIONS_KEY } });
  return setting?.setting_value !== false;
};

const isOcrEnabled = async () => {
  const setting = await db.PortalSetting.findOne({ where: { setting_key: OCR_KEY } });
  if (setting?.setting_value === undefined || setting?.setting_value === null) {
    return null;
  }
  return setting.setting_value === true;
};

const updateRegistrationMode = async (mode, adminId) => {
  if (!MODES.includes(mode)) {
    const error = new Error('Registration mode must be DRIVE_SCHEDULE or ALWAYS_OPEN');
    error.statusCode = 400;
    throw error;
  }
  const [setting] = await db.PortalSetting.findOrCreate({
    where: { setting_key: REGISTRATION_KEY },
    defaults: { setting_value: mode, created_by: adminId, updated_by: adminId }
  });
  await setting.update({ setting_value: mode, updated_by: adminId, updated_at: new Date() });
  return getSettings();
};

const updateNotificationsEnabled = async (enabled, adminId) => {
  if (typeof enabled !== 'boolean') {
    const error = new Error('notifications_enabled must be true or false');
    error.statusCode = 400;
    throw error;
  }
  const [setting] = await db.PortalSetting.findOrCreate({
    where: { setting_key: NOTIFICATIONS_KEY },
    defaults: { setting_value: enabled, created_by: adminId, updated_by: adminId }
  });
  await setting.update({ setting_value: enabled, updated_by: adminId, updated_at: new Date() });
  return getSettings();
};

const updateOcrEnabled = async (enabled, adminId) => {
  if (typeof enabled !== 'boolean') {
    const error = new Error('ocr_enabled must be true or false');
    error.statusCode = 400;
    throw error;
  }
  const [setting] = await db.PortalSetting.findOrCreate({
    where: { setting_key: OCR_KEY },
    defaults: { setting_value: enabled, created_by: adminId, updated_by: adminId }
  });
  await setting.update({ setting_value: enabled, updated_by: adminId, updated_at: new Date() });
  return getSettings();
};

module.exports = {
  getRegistrationMode,
  areNotificationsEnabled,
  isOcrEnabled,
  getSettings,
  updateRegistrationMode,
  updateNotificationsEnabled,
  updateOcrEnabled
};
