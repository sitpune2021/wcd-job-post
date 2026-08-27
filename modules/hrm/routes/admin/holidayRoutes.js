const express = require('express');
const router = express.Router();
const { authenticate } = require('../../../../middleware/auth');
const { hrmFeatureFlag, hrmHierarchy } = require('../../middleware');
const { requireHRMAdminPermission } = require('../../middleware/permissionGuard');
const calendarService = require('../../services/calendarService');
const ApiResponse = require('../../../../utils/ApiResponse');
const adminActionAudit = require('../../services/adminActionAuditService');
const Joi = require('joi');

router.use(hrmFeatureFlag.checkHRMEnabled);
router.use(authenticate);
router.use(hrmHierarchy.applyHRMHierarchyFilter);
router.use(requireHRMAdminPermission('hrm.calendar.manage'));

/**
 * Get holidays for a specific year/month
 * GET /api/hrm/admin/holidays?year=2026&month=4
 */
router.get('/', async (req, res, next) => {
  try {
    const schema = Joi.object({
      year: Joi.number().integer().min(2020).max(2100).default(new Date().getFullYear()),
      month: Joi.number().integer().min(1).max(12).optional(),
      district_id: Joi.number().integer().positive().optional(),
      scheme_type_id: Joi.number().integer().positive().optional(),
      scheme_id: Joi.number().integer().positive().optional()
    });

    const { error, value } = schema.validate(req.query);
    if (error) {
      return res.status(400).json({ success: false, message: error.details[0].message });
    }

    const holidays = await calendarService.getHolidaysByYear(value.year, value.month, value, req.user);
    return ApiResponse.success(res, holidays, 'Holidays retrieved successfully');
  } catch (err) {
    next(err);
  }
});

/**
 * Set holidays for a year (add/update/remove)
 * POST /api/hrm/admin/holidays
 * Body: {
 *   year: 2026,
 *   holidays: [
 *     { date: "2026-01-26", name: "Republic Day", type: "NATIONAL" },
 *     { date: "2026-08-15", name: "Independence Day", type: "NATIONAL" }
 *   ]
 * }
 */
router.post('/', adminActionAudit.requireAuditRemark, async (req, res, next) => {
  try {
    const schema = Joi.object({
      year: Joi.number().integer().min(2020).max(2100).required(),
      admin_remark: Joi.string().allow('', null).optional(),
      audit_remark: Joi.string().allow('', null).optional(),
      holidays: Joi.array().items(
        Joi.object({
          date: Joi.date().iso().required(),
          name: Joi.string().max(100).required(),
          type: Joi.string().valid('NATIONAL', 'STATE', 'OPTIONAL').default('NATIONAL'),
          description: Joi.string().allow('', null).optional(),
          district_id: Joi.number().integer().positive().allow(null).optional(),
          scheme_type_id: Joi.number().integer().positive().required(),
          scheme_id: Joi.number().integer().positive().allow(null).optional()
        })
      ).min(1).required()
    });

    const { error, value } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({ success: false, message: error.details[0].message });
    }

    const result = await calendarService.manageHolidays(req.user, value);
    await adminActionAudit.recordAction(req, {
      entityType: 'HRM_HOLIDAY_CALENDAR',
      entityId: String(value.year),
      oldData: null,
      newData: { request: value, result }
    });
    return ApiResponse.success(res, result, 'Holidays set successfully');
  } catch (err) {
    next(err);
  }
});

/**
 * Delete a holiday (requires year parameter)
 * DELETE /api/hrm/admin/holidays/:holidayId?year=2026
 */
router.delete('/:holidayId', adminActionAudit.requireAuditRemark, async (req, res, next) => {
  try {
    const holidayId = parseInt(req.params.holidayId);
    const schema = Joi.object({
      year: Joi.number().integer().min(2020).max(2100).required()
    });

    const { error, value } = schema.validate(req.query);
    if (error || isNaN(holidayId)) {
      return res.status(400).json({ success: false, message: 'Invalid holiday ID or year parameter required' });
    }

    const result = await calendarService.deleteHoliday(req.user, holidayId, value.year);
    await adminActionAudit.recordAction(req, {
      entityType: 'HRM_HOLIDAY_CALENDAR',
      entityId: holidayId,
      oldData: null,
      newData: { deleted: true, year: value.year }
    });
    return ApiResponse.success(res, result, 'Holiday deleted successfully');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
