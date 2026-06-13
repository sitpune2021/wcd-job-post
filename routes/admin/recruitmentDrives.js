const express = require('express');
const router = express.Router();
const { authenticate, requirePermission, auditLog } = require('../../middleware/auth');
const ApiResponse = require('../../utils/ApiResponse');
const service = require('../../services/recruitmentDriveService');

router.use(authenticate);

router.get('/', requirePermission('posts.view'), async (_req, res, next) => {
  try {
    return ApiResponse.success(res, await service.listDrives(), 'Recruitment drives retrieved');
  } catch (error) { next(error); }
});

router.get('/current', requirePermission('posts.view'), async (_req, res, next) => {
  try {
    return ApiResponse.success(res, await service.getActiveDrive(), 'Active recruitment drive retrieved');
  } catch (error) { next(error); }
});

router.post('/', requirePermission('posts.create'), auditLog('CREATE_RECRUITMENT_DRIVE'), async (req, res, next) => {
  try {
    return ApiResponse.created(res, await service.createDrive(req.body, req.user.admin_id), 'Recruitment drive created');
  } catch (error) { next(error); }
});

router.put('/:id', requirePermission('posts.edit'), auditLog('UPDATE_RECRUITMENT_DRIVE'), async (req, res, next) => {
  try {
    return ApiResponse.success(res, await service.updateDrive(req.params.id, req.body, req.user.admin_id), 'Recruitment drive updated');
  } catch (error) { next(error); }
});

router.post('/:id/action', requirePermission('posts.edit'), auditLog('TRANSITION_RECRUITMENT_DRIVE'), async (req, res, next) => {
  try {
    const result = await service.transitionDrive(req.params.id, req.body.action, req.user.admin_id, req.body.remarks);
    return ApiResponse.success(res, result, 'Recruitment drive updated');
  } catch (error) { next(error); }
});

router.post('/:id/clone-posts', requirePermission('posts.create'), auditLog('CLONE_RECRUITMENT_POSTS'), async (req, res, next) => {
  try {
    const result = await service.clonePosts(req.params.id, req.body.post_ids, req.user.admin_id);
    return ApiResponse.created(res, result, `${result.length} posts cloned`);
  } catch (error) { next(error); }
});

module.exports = router;

