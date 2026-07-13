// ============================================================================
// HRM SETTINGS ROUTES
// ============================================================================
// Purpose: HRM settings management (payment distribution, etc.)
// Base path: /api/hrm/admin/settings
// ============================================================================

const express = require('express');
const router = express.Router();
const db = require('../../../../models');
const ApiResponse = require('../../../../utils/ApiResponse');
const { ApiError } = require('../../../../middleware/errorHandler');
const { requireHRMAdminPermission } = require('../../middleware/permissionGuard');
const { authenticate } = require('../../../../middleware/auth');
const logger = require('../../../../config/logger');
const adminActionAudit = require('../../services/adminActionAuditService');

// ==================== CHRMS ADMIN AUDIT SETTINGS ====================

router.get('/admin-audit', authenticate, requireHRMAdminPermission(['hrm.settings.view', 'hrm.*']), async (req, res, next) => {
  try {
    const settings = await adminActionAudit.getSettings();
    return ApiResponse.success(res, {
      enabled: settings.enabled,
      remark_required: settings.remarkRequired
    }, 'CHRMS admin audit settings retrieved');
  } catch (error) {
    next(error);
  }
});

router.put('/admin-audit',
  authenticate,
  requireHRMAdminPermission(['hrm.settings.edit', 'hrm.*']),
  adminActionAudit.requireAuditRemark,
  async (req, res, next) => {
    try {
      const before = await adminActionAudit.getSettings({ forceRefresh: true });
      const enabled = req.body.enabled;
      const remarkRequired = req.body.remark_required ?? req.body.remarkRequired;

      const settings = await adminActionAudit.updateSettings({
        enabled,
        remarkRequired
      }, req.user.admin_id);

      await adminActionAudit.recordAction(req, {
        entityType: 'HRM_ADMIN_AUDIT_SETTINGS',
        entityId: 'CHRMS',
        oldData: before,
        newData: settings
      });

      return ApiResponse.success(res, {
        enabled: settings.enabled,
        remark_required: settings.remarkRequired
      }, 'CHRMS admin audit settings updated');
    } catch (error) {
      next(error);
    }
  }
);

// ==================== PAYMENT DISTRIBUTION SETTINGS ====================

/**
 * @route GET /api/hrm/admin/settings/payment-distribution
 * @desc Get all payment distribution settings (with scheme type info)
 */
router.get('/payment-distribution', requireHRMAdminPermission(['hrm.settings.view', 'hrm.*']), async (req, res, next) => {
  try {
    const settings = await db.PaymentDistributionSetting.findAll({
      include: [{
        model: db.SchemeType,
        as: 'schemeType',
        attributes: ['scheme_type_id', 'scheme_code', 'scheme_name'],
        where: { is_deleted: false }
      }],
      order: [['setting_id', 'ASC']]
    });

    const result = settings.map(s => ({
      setting_id: s.setting_id,
      scheme_type_id: s.scheme_type_id,
      scheme_code: s.schemeType?.scheme_code,
      scheme_name: s.schemeType?.scheme_name,
      center_share_percent: parseFloat(s.center_share_percent),
      state_share_percent: parseFloat(s.state_share_percent),
      created_at: s.created_at,
      updated_at: s.updated_at
    }));

    return ApiResponse.success(res, result, 'Payment distribution settings retrieved');
  } catch (error) {
    next(error);
  }
});

/**
 * @route PUT /api/hrm/admin/settings/payment-distribution/:schemeTypeId
 * @desc Create or update payment distribution for a scheme type
 */
router.put('/payment-distribution/:schemeTypeId',
  authenticate,
  requireHRMAdminPermission(['hrm.settings.edit', 'hrm.*']),
  adminActionAudit.requireAuditRemark,
  async (req, res, next) => {
  try {
    const { schemeTypeId } = req.params;
    const { center_share_percent, state_share_percent } = req.body;

    // Validate percentages
    if (center_share_percent === undefined || state_share_percent === undefined) {
      throw new ApiError(400, 'Both center_share_percent and state_share_percent are required');
    }

    const centerShare = parseFloat(center_share_percent);
    const stateShare = parseFloat(state_share_percent);

    if (isNaN(centerShare) || isNaN(stateShare)) {
      throw new ApiError(400, 'Invalid percentage values');
    }

    if (centerShare < 0 || centerShare > 100 || stateShare < 0 || stateShare > 100) {
      throw new ApiError(400, 'Percentages must be between 0 and 100');
    }

    if (Math.abs(centerShare + stateShare - 100) > 0.01) {
      throw new ApiError(400, 'Center share + State share must equal 100');
    }

    // Check scheme type exists
    const schemeType = await db.SchemeType.findByPk(schemeTypeId);
    if (!schemeType) {
      throw new ApiError(404, 'Scheme type not found');
    }

    // Check if setting already exists
    const existingSetting = await db.PaymentDistributionSetting.findOne({
      where: { scheme_type_id: parseInt(schemeTypeId) }
    });
    const before = existingSetting ? existingSetting.get({ plain: true }) : null;

    let setting;
    if (existingSetting) {
      // Update existing setting
      setting = await existingSetting.update({
        center_share_percent: centerShare,
        state_share_percent: stateShare,
        updated_by: req.user.admin_id,
        updated_at: new Date()
      });
    } else {
      // Create new setting
      setting = await db.PaymentDistributionSetting.create({
        scheme_type_id: parseInt(schemeTypeId),
        center_share_percent: centerShare,
        state_share_percent: stateShare,
        created_by: req.user.admin_id
      });
    }

    logger.info(`Payment distribution ${existingSetting ? 'updated' : 'created'} for scheme type ${schemeTypeId} by admin ${req.user.admin_id}`, {
      schemeTypeId,
      centerShare,
      stateShare
    });

    const responseData = {
      setting_id: setting.setting_id,
      scheme_type_id: setting.scheme_type_id,
      scheme_code: schemeType.scheme_code,
      scheme_name: schemeType.scheme_name,
      center_share_percent: centerShare,
      state_share_percent: stateShare
    };

    await adminActionAudit.recordAction(req, {
      entityType: 'HRM_PAYMENT_DISTRIBUTION',
      entityId: schemeTypeId,
      oldData: before,
      newData: responseData
    });

    return ApiResponse.success(res, responseData, existingSetting ? 'Payment distribution updated' : 'Payment distribution created');
  } catch (error) {
    next(error);
  }
});

/**
 * @route DELETE /api/hrm/admin/settings/payment-distribution/:schemeTypeId
 * @desc Remove payment distribution setting for a scheme type
 */
router.delete('/payment-distribution/:schemeTypeId',
  authenticate,
  requireHRMAdminPermission(['hrm.settings.edit', 'hrm.*']),
  adminActionAudit.requireAuditRemark,
  async (req, res, next) => {
  try {
    const { schemeTypeId } = req.params;

    const beforeSetting = await db.PaymentDistributionSetting.findOne({
      where: { scheme_type_id: parseInt(schemeTypeId) },
      raw: true
    });

    const deleted = await db.PaymentDistributionSetting.destroy({
      where: { scheme_type_id: parseInt(schemeTypeId) }
    });

    if (!deleted) {
      throw new ApiError(404, 'Payment distribution setting not found');
    }

    logger.info(`Payment distribution deleted for scheme type ${schemeTypeId} by admin ${req.user.admin_id}`);
    await adminActionAudit.recordAction(req, {
      entityType: 'HRM_PAYMENT_DISTRIBUTION',
      entityId: schemeTypeId,
      oldData: beforeSetting,
      newData: { deleted: true }
    });
    return ApiResponse.success(res, null, 'Payment distribution setting deleted');
  } catch (error) {
    next(error);
  }
});

// ==================== WEEKLY OFF QUOTA SETTINGS ====================

/**
 * @route GET /api/hrm/admin/settings/weekly-off-quota
 * @desc Get all weekly off quota settings (with scheme type info)
 */
router.get('/weekly-off-quota', requireHRMAdminPermission(['hrm.settings.view', 'hrm.*']), async (req, res, next) => {
  try {
    const settings = await db.WeeklyOffSetting.findAll({
      include: [{
        model: db.SchemeType,
        as: 'schemeType',
        attributes: ['scheme_type_id', 'scheme_code', 'scheme_name'],
        where: { is_deleted: false }
      }],
      order: [['setting_id', 'ASC']]
    });

    const result = settings.map(s => ({
      setting_id: s.setting_id,
      scheme_type_id: s.scheme_type_id,
      scheme_code: s.schemeType?.scheme_code,
      scheme_name: s.schemeType?.scheme_name,
      monthly_quota: parseInt(s.monthly_quota, 10),
      created_at: s.created_at,
      updated_at: s.updated_at
    }));

    return ApiResponse.success(res, result, 'Weekly off quota settings retrieved');
  } catch (error) {
    next(error);
  }
});

/**
 * @route PUT /api/hrm/admin/settings/weekly-off-quota/:schemeTypeId
 * @desc Create or update weekly off quota for a scheme type
 */
router.put('/weekly-off-quota/:schemeTypeId',
  authenticate,
  requireHRMAdminPermission(['hrm.settings.edit', 'hrm.*']),
  adminActionAudit.requireAuditRemark,
  async (req, res, next) => {
  try {
    const { schemeTypeId } = req.params;
    const { monthly_quota } = req.body;

    if (monthly_quota === undefined || monthly_quota === null || monthly_quota === '') {
      throw new ApiError(400, 'monthly_quota is required');
    }

    const monthlyQuota = Number(monthly_quota);
    if (!Number.isInteger(monthlyQuota) || monthlyQuota < 0 || monthlyQuota > 10) {
      throw new ApiError(400, 'Monthly quota must be a whole number between 0 and 10');
    }

    const schemeType = await db.SchemeType.findByPk(schemeTypeId);
    if (!schemeType || schemeType.is_deleted) {
      throw new ApiError(404, 'Scheme type not found');
    }

    const existingSetting = await db.WeeklyOffSetting.findOne({
      where: { scheme_type_id: parseInt(schemeTypeId, 10) }
    });
    const before = existingSetting ? existingSetting.get({ plain: true }) : null;

    let setting;
    if (existingSetting) {
      setting = await existingSetting.update({
        monthly_quota: monthlyQuota,
        updated_by: req.user.admin_id,
        updated_at: new Date()
      });
    } else {
      setting = await db.WeeklyOffSetting.create({
        scheme_type_id: parseInt(schemeTypeId, 10),
        monthly_quota: monthlyQuota,
        created_by: req.user.admin_id
      });
    }

    logger.info(`Weekly off quota ${existingSetting ? 'updated' : 'created'} for scheme type ${schemeTypeId} by admin ${req.user.admin_id}`, {
      schemeTypeId,
      monthlyQuota
    });

    const responseData = {
      setting_id: setting.setting_id,
      scheme_type_id: setting.scheme_type_id,
      scheme_code: schemeType.scheme_code,
      scheme_name: schemeType.scheme_name,
      monthly_quota: monthlyQuota
    };

    await adminActionAudit.recordAction(req, {
      entityType: 'HRM_WEEKLY_OFF_QUOTA',
      entityId: schemeTypeId,
      oldData: before,
      newData: responseData
    });

    return ApiResponse.success(res, responseData, existingSetting ? 'Weekly off quota updated' : 'Weekly off quota created');
  } catch (error) {
    next(error);
  }
});

/**
 * @route DELETE /api/hrm/admin/settings/weekly-off-quota/:schemeTypeId
 * @desc Remove weekly off quota setting for a scheme type; service falls back to default quota 4
 */
router.delete('/weekly-off-quota/:schemeTypeId',
  authenticate,
  requireHRMAdminPermission(['hrm.settings.edit', 'hrm.*']),
  adminActionAudit.requireAuditRemark,
  async (req, res, next) => {
  try {
    const { schemeTypeId } = req.params;

    const beforeSetting = await db.WeeklyOffSetting.findOne({
      where: { scheme_type_id: parseInt(schemeTypeId, 10) },
      raw: true
    });

    const deleted = await db.WeeklyOffSetting.destroy({
      where: { scheme_type_id: parseInt(schemeTypeId, 10) }
    });

    if (!deleted) {
      throw new ApiError(404, 'Weekly off quota setting not found');
    }

    logger.info(`Weekly off quota deleted for scheme type ${schemeTypeId} by admin ${req.user.admin_id}`);
    await adminActionAudit.recordAction(req, {
      entityType: 'HRM_WEEKLY_OFF_QUOTA',
      entityId: schemeTypeId,
      oldData: beforeSetting,
      newData: { deleted: true }
    });
    return ApiResponse.success(res, null, 'Weekly off quota setting deleted');
  } catch (error) {
    next(error);
  }
});

module.exports = router;
