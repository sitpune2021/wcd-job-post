const express = require('express');
const { checkHRMEnabled } = require('../../hrm/middleware/hrmFeatureFlag');

const router = express.Router();

router.use(checkHRMEnabled);

router.use('/auth', require('./authRoutes'));
router.use('/home', require('./homeRoutes'));
router.use('/profile', require('./profileRoutes'));
router.use('/shift-types', require('./shiftTypeRoutes'));
router.use('/attendance', require('./attendanceRoutes'));
router.use('/leaves', require('./leaveRoutes'));
router.use('/weekly-off', require('./weeklyOffRoutes'));

module.exports = router;
