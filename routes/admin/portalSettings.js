const express = require('express');
const router = express.Router();
const { authenticate, requirePermission, auditLog } = require('../../middleware/auth');
const ApiResponse = require('../../utils/ApiResponse');
const service = require('../../services/portalSettingService');

router.use(authenticate);

router.get('/', requirePermission(['portal.settings.view', 'portal.settings.edit']), async (_req, res, next) => {
  try {
    return ApiResponse.success(res, await service.getSettings(), 'Portal settings retrieved');
  } catch (error) { next(error); }
});

router.put('/applicant-registration-mode', requirePermission('portal.settings.edit'), auditLog('UPDATE_PORTAL_REGISTRATION_MODE'), async (req, res, next) => {
  try {
    return ApiResponse.success(
      res,
      await service.updateRegistrationMode(req.body.mode, req.user.admin_id),
      'Applicant registration mode updated'
    );
  } catch (error) { next(error); }
});

router.put('/notifications-enabled', requirePermission('portal.settings.edit'), auditLog('UPDATE_PORTAL_NOTIFICATIONS'), async (req, res, next) => {
  try {
    return ApiResponse.success(
      res,
      await service.updateNotificationsEnabled(req.body.enabled, req.user.admin_id),
      'Notification setting updated'
    );
  } catch (error) { next(error); }
});

router.put('/ocr-enabled', requirePermission('portal.settings.edit'), auditLog('UPDATE_PORTAL_OCR'), async (req, res, next) => {
  try {
    return ApiResponse.success(
      res,
      await service.updateOcrEnabled(req.body.enabled, req.user.admin_id),
      'OCR setting updated'
    );
  } catch (error) { next(error); }
});

module.exports = router;
