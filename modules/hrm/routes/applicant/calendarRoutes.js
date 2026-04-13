const express = require('express');
const router = express.Router();
const { authenticate } = require('../../../../middleware/auth');
const { hrmFeatureFlag } = require('../../middleware');
const calendarService = require('../../services/calendarService');
const ApiResponse = require('../../../../utils/ApiResponse');
const Joi = require('joi');

router.use(hrmFeatureFlag.checkHRMEnabled);
router.use(authenticate);

/**
 * Get employee's full calendar for month/year
 * Shows all days: PRESENT, ABSENT, SUNDAY, HOLIDAY, ON_LEAVE
 * GET /api/hrm/applicant/calendar?month=4&year=2026
 */
router.get('/', async (req, res, next) => {
  try {
    const schema = Joi.object({
      month: Joi.number().integer().min(1).max(12).default(new Date().getMonth() + 1),
      year: Joi.number().integer().min(2020).max(2100).default(new Date().getFullYear())
    });

    const { error, value } = schema.validate(req.query);
    if (error) {
      return res.status(400).json({ success: false, message: error.details[0].message });
    }

    const calendar = await calendarService.getEmployeeCalendar(req.user, value);
    return ApiResponse.success(res, calendar, 'Calendar retrieved successfully');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
