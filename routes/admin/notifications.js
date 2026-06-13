const express = require('express');
const router = express.Router();
const { authenticate } = require('../../middleware/auth');
const ApiResponse = require('../../utils/ApiResponse');
const { ApiError } = require('../../middleware/errorHandler');
const service = require('../../services/notificationService');

router.use(authenticate);
router.use((req, _res, next) => req.user.admin_id
  ? next()
  : next(new ApiError(403, 'Admin access required')));

router.get('/', async (req, res, next) => {
  try {
    const admin_id = req.user.admin_id;
    const [notifications, unread_count] = await Promise.all([
      service.list({ admin_id, is_read: false }, req.query),
      service.unreadCount({ admin_id })
    ]);
    return ApiResponse.success(res, { notifications, unread_count }, 'Admin notifications retrieved');
  } catch (error) { next(error); }
});

router.patch('/read-all', async (req, res, next) => {
  try {
    await service.markRead({ admin_id: req.user.admin_id });
    return ApiResponse.success(res, null, 'Notifications marked as read');
  } catch (error) { next(error); }
});

router.patch('/:id/read', async (req, res, next) => {
  try {
    await service.markRead({ admin_id: req.user.admin_id }, req.params.id);
    return ApiResponse.success(res, null, 'Notification marked as read');
  } catch (error) { next(error); }
});

module.exports = router;
