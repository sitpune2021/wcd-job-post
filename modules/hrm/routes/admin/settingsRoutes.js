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
const { hrmFeatureFlag, hrmHierarchy } = require('../../middleware');
const logger = require('../../../../config/logger');
const adminActionAudit = require('../../services/adminActionAuditService');
const { Op } = db.Sequelize;

router.use(hrmFeatureFlag.checkHRMEnabled);
router.use(authenticate);
router.use(hrmHierarchy.applyHRMHierarchyFilter);

const normalizeIds = (values) => Array.from(new Set(
  (Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0)
));

const buildScopedSchemeWhere = (adminUser, extraWhere = {}) => {
  const filters = adminUser?.hrm_scope_filters || adminUser?.dataValues?.hrm_scope_filters || {};
  const where = { is_deleted: false, ...extraWhere };

  if (filters.block_all) {
    where.scheme_id = { [Op.in]: [] };
    return where;
  }

  if (Array.isArray(filters.scheme_ids) && filters.scheme_ids.length > 0) {
    where.scheme_id = { [Op.in]: filters.scheme_ids };
  }

  if (Array.isArray(filters.district_ids) && filters.district_ids.length > 0) {
    where.district_id = { [Op.in]: filters.district_ids };
  } else if (filters.district_id) {
    where.district_id = filters.district_id;
  }

  if (Array.isArray(filters.scheme_type_ids) && filters.scheme_type_ids.length > 0) {
    where.scheme_type_id = { [Op.in]: filters.scheme_type_ids };
  } else if (filters.scheme_type_id) {
    where.scheme_type_id = filters.scheme_type_id;
  }

  return where;
};

const getScopedSchemes = async (adminUser, extraWhere = {}) => db.Scheme.findAll({
  where: buildScopedSchemeWhere(adminUser, extraWhere),
  attributes: ['scheme_id', 'scheme_code', 'scheme_name', 'district_id', 'scheme_type_id'],
  include: [
    {
      model: db.DistrictMaster,
      as: 'district',
      attributes: ['district_id', 'district_name'],
      required: false
    },
    {
      model: db.SchemeType,
      as: 'schemeType',
      attributes: ['scheme_type_id', 'scheme_code', 'scheme_name'],
      required: false
    }
  ],
  order: [['scheme_name', 'ASC']]
});

const getScopeOptions = async (adminUser) => {
  const schemes = await getScopedSchemes(adminUser, { is_active: true });
  const districtMap = new Map();
  const schemeTypeMap = new Map();

  schemes.forEach((scheme) => {
    if (scheme.district) {
      districtMap.set(scheme.district.district_id, {
        district_id: scheme.district.district_id,
        district_name: scheme.district.district_name
      });
    }
    if (scheme.schemeType) {
      schemeTypeMap.set(scheme.schemeType.scheme_type_id, {
        scheme_type_id: scheme.schemeType.scheme_type_id,
        scheme_code: scheme.schemeType.scheme_code,
        scheme_name: scheme.schemeType.scheme_name
      });
    }
  });

  return {
    districts: Array.from(districtMap.values()).sort((a, b) => String(a.district_name).localeCompare(String(b.district_name))),
    scheme_types: Array.from(schemeTypeMap.values()).sort((a, b) => String(a.scheme_name).localeCompare(String(b.scheme_name))),
    schemes: schemes.map((scheme) => ({
      scheme_id: scheme.scheme_id,
      scheme_code: scheme.scheme_code,
      scheme_name: scheme.scheme_name,
      district_id: scheme.district_id,
      district_name: scheme.district?.district_name || null,
      scheme_type_id: scheme.scheme_type_id,
      scheme_type_code: scheme.schemeType?.scheme_code || null,
      scheme_type_name: scheme.schemeType?.scheme_name || null
    }))
  };
};

const getVisibleSchemeTypeIds = async (adminUser) => {
  const filters = adminUser?.hrm_scope_filters || adminUser?.dataValues?.hrm_scope_filters || {};

  if (filters.block_all) {
    return [];
  }

  if (Array.isArray(filters.scheme_type_ids) && filters.scheme_type_ids.length > 0) {
    return normalizeIds(filters.scheme_type_ids);
  }

  if (filters.scheme_type_id) {
    return normalizeIds([filters.scheme_type_id]);
  }

  const options = await getScopeOptions(adminUser);
  return normalizeIds(options.scheme_types.map((type) => type.scheme_type_id));
};

const canManageGlobalSettings = (req) => {
  const scopeLevel = req.hrmScope?.level;
  return ['STATE', 'ALL'].includes(scopeLevel);
};

const assertGlobalSettingScope = (req) => {
  if (!canManageGlobalSettings(req)) {
    throw new ApiError(403, 'Only unrestricted CHRMS admins can manage global audit settings');
  }
};

const assertSchemeTypeInScope = async (adminUser, schemeTypeId) => {
  const visibleSchemeTypeIds = await getVisibleSchemeTypeIds(adminUser);
  if (!visibleSchemeTypeIds.includes(Number(schemeTypeId))) {
    throw new ApiError(403, 'Selected scheme type is outside your CHRMS access scope');
  }
};

const assertSchemeInScope = async (adminUser, schemeId) => {
  const scheme = await db.Scheme.findOne({
    where: buildScopedSchemeWhere(adminUser, {
      scheme_id: Number(schemeId),
      is_active: true
    }),
    attributes: ['scheme_id']
  });

  if (!scheme) {
    throw new ApiError(403, 'Selected scheme is outside your CHRMS access scope');
  }
};

const PAYROLL_ROUNDING_BASIS = ['NET_PAYABLE', 'PER_DAY_RATE', 'BOTH'];
const PAYROLL_ROUNDING_METHOD = ['NONE', 'NEAREST', 'UP', 'DOWN', 'HALF_UP', 'HALF_DOWN'];

// ==================== CHRMS ADMIN AUDIT SETTINGS ====================

router.get('/admin-audit', authenticate, requireHRMAdminPermission(['hrm.settings.view', 'hrm.*']), async (req, res, next) => {
  try {
    assertGlobalSettingScope(req);
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
      assertGlobalSettingScope(req);
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

router.get('/scope-options', authenticate, requireHRMAdminPermission(['hrm.settings.view', 'hrm.*']), async (req, res, next) => {
  try {
    const options = await getScopeOptions(req.user);
    return ApiResponse.success(res, {
      ...options,
      can_manage_global_settings: canManageGlobalSettings(req)
    }, 'CHRMS settings scope options retrieved');
  } catch (error) {
    next(error);
  }
});

// ==================== PAYMENT DISTRIBUTION SETTINGS ====================

/**
 * @route GET /api/hrm/admin/settings/payment-distribution
 * @desc Get all payment distribution settings (with scheme type info)
 */
router.get('/payment-distribution', requireHRMAdminPermission(['hrm.settings.view', 'hrm.*']), async (req, res, next) => {
  try {
    const visibleSchemeTypeIds = await getVisibleSchemeTypeIds(req.user);
    const settings = await db.PaymentDistributionSetting.findAll({
      where: visibleSchemeTypeIds.length > 0
        ? { scheme_type_id: { [Op.in]: visibleSchemeTypeIds } }
        : { scheme_type_id: { [Op.in]: [] } },
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

// ==================== PAYROLL CALCULATION SETTINGS ====================

router.get('/payroll-calculation-rules', authenticate, requireHRMAdminPermission(['hrm.settings.view', 'hrm.*']), async (req, res, next) => {
  try {
    const visibleSchemeTypeIds = await getVisibleSchemeTypeIds(req.user);

    const settings = visibleSchemeTypeIds.length > 0
      ? await db.PayrollCalculationSetting.findAll({
        where: {
          scheme_type_id: { [Op.in]: visibleSchemeTypeIds },
          is_active: true
        },
        include: [{
          model: db.SchemeType,
          as: 'schemeType',
          attributes: ['scheme_type_id', 'scheme_code', 'scheme_name'],
          required: true
        }],
        order: [['scheme_type_id', 'ASC']]
      })
      : [];

    const result = settings.map((setting) => ({
      setting_id: setting.setting_id,
      scheme_type_id: setting.scheme_type_id,
      scheme_type_code: setting.schemeType?.scheme_code || null,
      scheme_type_name: setting.schemeType?.scheme_name || null,
      rounding_basis: setting.rounding_basis,
      rounding_method: setting.rounding_method,
      created_at: setting.created_at,
      updated_at: setting.updated_at
    }));

    return ApiResponse.success(res, {
      rules: result,
      options: {
        rounding_basis: PAYROLL_ROUNDING_BASIS,
        rounding_method: PAYROLL_ROUNDING_METHOD
      }
    }, 'Payroll calculation rules retrieved');
  } catch (error) {
    next(error);
  }
});

router.put('/payroll-calculation-rules/:schemeTypeId',
  authenticate,
  requireHRMAdminPermission(['hrm.settings.edit', 'hrm.*']),
  adminActionAudit.requireAuditRemark,
  async (req, res, next) => {
    try {
      const schemeTypeId = Number(req.params.schemeTypeId);
      const roundingBasis = String(req.body.rounding_basis || '').trim().toUpperCase();
      const roundingMethod = String(req.body.rounding_method || '').trim().toUpperCase();

      if (!Number.isInteger(schemeTypeId) || schemeTypeId <= 0) {
        throw new ApiError(400, 'Valid scheme type is required');
      }
      if (!PAYROLL_ROUNDING_BASIS.includes(roundingBasis)) {
        throw new ApiError(400, 'Invalid rounding basis');
      }
      if (!PAYROLL_ROUNDING_METHOD.includes(roundingMethod)) {
        throw new ApiError(400, 'Invalid rounding method');
      }

      await assertSchemeTypeInScope(req.user, schemeTypeId);

      const before = await db.PayrollCalculationSetting.findOne({
        where: { scheme_type_id: schemeTypeId, is_active: true },
        raw: true
      });

      const setting = before
        ? await db.PayrollCalculationSetting.findByPk(before.setting_id)
        : null;

      const savedSetting = setting
        ? await setting.update({
          rounding_basis: roundingBasis,
          rounding_method: roundingMethod,
          updated_by: req.user.admin_id,
          updated_at: new Date()
        })
        : await db.PayrollCalculationSetting.create({
          scheme_type_id: schemeTypeId,
          rounding_basis: roundingBasis,
          rounding_method: roundingMethod,
          is_active: true,
          created_by: req.user.admin_id,
          updated_by: req.user.admin_id
        });

      const responseData = {
        setting_id: savedSetting.setting_id,
        scheme_type_id: savedSetting.scheme_type_id,
        rounding_basis: savedSetting.rounding_basis,
        rounding_method: savedSetting.rounding_method
      };

      await adminActionAudit.recordAction(req, {
        entityType: 'HRM_PAYROLL_CALCULATION_RULE',
        entityId: schemeTypeId,
        oldData: before,
        newData: responseData
      });

      return ApiResponse.success(res, responseData, before ? 'Payroll calculation rule updated' : 'Payroll calculation rule created');
    } catch (error) {
      next(error);
    }
  }
);

router.delete('/payroll-calculation-rules/:schemeTypeId',
  authenticate,
  requireHRMAdminPermission(['hrm.settings.edit', 'hrm.*']),
  adminActionAudit.requireAuditRemark,
  async (req, res, next) => {
    try {
      const schemeTypeId = Number(req.params.schemeTypeId);
      if (!Number.isInteger(schemeTypeId) || schemeTypeId <= 0) {
        throw new ApiError(400, 'Valid scheme type is required');
      }

      await assertSchemeTypeInScope(req.user, schemeTypeId);

      const before = await db.PayrollCalculationSetting.findOne({
        where: { scheme_type_id: schemeTypeId, is_active: true },
        raw: true
      });

      const deleted = await db.PayrollCalculationSetting.update({
        is_active: false,
        updated_by: req.user.admin_id,
        updated_at: new Date()
      }, {
        where: { scheme_type_id: schemeTypeId, is_active: true }
      });

      if (!deleted[0]) {
        throw new ApiError(404, 'Payroll calculation rule not found');
      }

      await adminActionAudit.recordAction(req, {
        entityType: 'HRM_PAYROLL_CALCULATION_RULE',
        entityId: schemeTypeId,
        oldData: before,
        newData: { is_active: false }
      });

      return ApiResponse.success(res, null, 'Payroll calculation rule removed');
    } catch (error) {
      next(error);
    }
  }
);

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
    await assertSchemeTypeInScope(req.user, schemeTypeId);

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
    await assertSchemeTypeInScope(req.user, schemeTypeId);

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
    const visibleSchemeTypeIds = await getVisibleSchemeTypeIds(req.user);
    const settings = await db.WeeklyOffSetting.findAll({
      where: visibleSchemeTypeIds.length > 0
        ? { scheme_type_id: { [Op.in]: visibleSchemeTypeIds } }
        : { scheme_type_id: { [Op.in]: [] } },
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
    await assertSchemeTypeInScope(req.user, schemeTypeId);

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
    await assertSchemeTypeInScope(req.user, schemeTypeId);

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
