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
router.put('/payment-distribution/:schemeTypeId', authenticate, requireHRMAdminPermission(['hrm.settings.edit', 'hrm.*']), async (req, res, next) => {
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

    return ApiResponse.success(res, {
      setting_id: setting.setting_id,
      scheme_type_id: setting.scheme_type_id,
      scheme_code: schemeType.scheme_code,
      scheme_name: schemeType.scheme_name,
      center_share_percent: centerShare,
      state_share_percent: stateShare
    }, existingSetting ? 'Payment distribution updated' : 'Payment distribution created');
  } catch (error) {
    next(error);
  }
});

/**
 * @route DELETE /api/hrm/admin/settings/payment-distribution/:schemeTypeId
 * @desc Remove payment distribution setting for a scheme type
 */
router.delete('/payment-distribution/:schemeTypeId', authenticate, requireHRMAdminPermission(['hrm.settings.edit', 'hrm.*']), async (req, res, next) => {
  try {
    const { schemeTypeId } = req.params;

    const deleted = await db.PaymentDistributionSetting.destroy({
      where: { scheme_type_id: parseInt(schemeTypeId) }
    });

    if (!deleted) {
      throw new ApiError(404, 'Payment distribution setting not found');
    }

    logger.info(`Payment distribution deleted for scheme type ${schemeTypeId} by admin ${req.user.admin_id}`);
    return ApiResponse.success(res, null, 'Payment distribution setting deleted');
  } catch (error) {
    next(error);
  }
});

module.exports = router;
