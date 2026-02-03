// ============================================================================
// EXPERIENCE DOMAIN ROUTES
// ============================================================================
// Purpose: CRUD operations for experience domain master data
// Base path: /api/masters/experience-domains
// ============================================================================

const express = require('express');
const router = express.Router();
const { authenticate, requirePermission } = require('../../middleware/auth');
const { experienceDomainService } = require('../../services/masters');
const ApiResponse = require('../../utils/ApiResponse');
const { ApiError } = require('../../middleware/errorHandler');

router.get('/', async (req, res, next) => {
  try {
    const result = await experienceDomainService.getExperienceDomains(req.query);
    return ApiResponse.success(res, result, 'Experience domains retrieved successfully');
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const domain = await experienceDomainService.getExperienceDomainById(req.params.id, req.query.lang);
    if (!domain) throw ApiError.notFound('Experience domain not found');
    return ApiResponse.success(res, domain, 'Experience domain retrieved successfully');
  } catch (error) {
    next(error);
  }
});

router.post('/', authenticate, requirePermission([
  'masters.experience-domains.create',
  'masters.experience_domains.create'
]),
  async (req, res, next) => {
    try {
      const domain = await experienceDomainService.createExperienceDomain(req.body, req.user.admin_id);
      return ApiResponse.created(res, domain, 'Experience domain created successfully');
    } catch (error) {
      next(error);
    }
  }
);

router.put('/:id', authenticate, requirePermission([
  'masters.experience-domains.update',
  'masters.experience-domains.edit',
  'masters.experience_domains.update',
  'masters.experience_domains.edit'
]),
  async (req, res, next) => {
    try {
      const domain = await experienceDomainService.updateExperienceDomain(req.params.id, req.body, req.user.admin_id);
      if (!domain) throw ApiError.notFound('Experience domain not found');
      return ApiResponse.success(res, domain, 'Experience domain updated successfully');
    } catch (error) {
      next(error);
    }
  }
);

router.delete('/:id', authenticate, requirePermission([
  'masters.experience-domains.delete',
  'masters.experience_domains.delete'
]),
  async (req, res, next) => {
    try {
      const deleted = await experienceDomainService.deleteExperienceDomain(req.params.id, req.user.admin_id);
      if (!deleted) throw ApiError.notFound('Experience domain not found');
      return ApiResponse.deleted(res, 'Experience domain deleted successfully');
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
