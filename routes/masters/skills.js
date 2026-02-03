const express = require('express');
const router = express.Router();
const { authenticate, requirePermission } = require('../../middleware/auth');
const { skillService } = require('../../services/masters');
const ApiResponse = require('../../utils/ApiResponse');
const { ApiError } = require('../../middleware/errorHandler');

router.get('/', async (req, res, next) => {
  try {
    const result = await skillService.getSkills(req.query);
    return ApiResponse.success(res, result, 'Skills retrieved successfully');
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const skill = await skillService.getSkillById(req.params.id, req.query.lang);
    if (!skill) throw ApiError.notFound('Skill not found');
    return ApiResponse.success(res, skill, 'Skill retrieved successfully');
  } catch (error) {
    next(error);
  }
});

router.post('/', authenticate, requirePermission('masters.skills.create'), async (req, res, next) => {
  try {
    const skill = await skillService.createSkill(req.body, req.user.admin_id);
    return ApiResponse.created(res, skill, 'Skill created successfully');
  } catch (error) {
    next(error);
  }
});

router.put('/:id', authenticate, requirePermission('masters.skills.edit'), async (req, res, next) => {
  try {
    const skill = await skillService.updateSkill(req.params.id, req.body, req.user.admin_id);
    if (!skill) throw ApiError.notFound('Skill not found');
    return ApiResponse.success(res, skill, 'Skill updated successfully');
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', authenticate, requirePermission('masters.skills.delete'), async (req, res, next) => {
  try {
    const deleted = await skillService.deleteSkill(req.params.id, req.user.admin_id);
    if (!deleted) throw ApiError.notFound('Skill not found');
    return ApiResponse.deleted(res, 'Skill deleted successfully');
  } catch (error) {
    next(error);
  }
});

module.exports = router;
