// ============================================================================
// POST/JOB ROUTES
// ============================================================================
// Purpose: CRUD operations for post/job master data
// Base path: /api/masters/posts
// ============================================================================

const express = require('express');
const router = express.Router();
const { authenticate, requirePermission } = require('../../middleware/auth');
const { postMasterService } = require('../../services/masters');
const ApiResponse = require('../../utils/ApiResponse');
const { ApiError } = require('../../middleware/errorHandler');

router.get('/', async (req, res, next) => {
  try {
    const result = await postMasterService.getPosts(req.query);
    return ApiResponse.success(res, result, 'Posts retrieved successfully');
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const post = await postMasterService.getPostById(req.params.id, req.query.lang);
    if (!post) throw ApiError.notFound('Post not found');
    return ApiResponse.success(res, post, 'Post retrieved successfully');
  } catch (error) {
    next(error);
  }
});

router.post('/', authenticate, requirePermission('masters.posts.create'),
  async (req, res, next) => {
    try {
      const post = await postMasterService.createPost(req.body, req.user.admin_id);
      return ApiResponse.created(res, post, 'Post created successfully');
    } catch (error) {
      next(error);
    }
  }
);

router.put('/:id', authenticate, requirePermission('masters.posts.edit'),
  async (req, res, next) => {
    try {
      const post = await postMasterService.updatePost(req.params.id, req.body, req.user.admin_id);
      if (!post) throw ApiError.notFound('Post not found');
      return ApiResponse.success(res, post, 'Post updated successfully');
    } catch (error) {
      next(error);
    }
  }
);

router.delete('/:id', authenticate, requirePermission('masters.posts.delete'),
  async (req, res, next) => {
    try {
      const deleted = await postMasterService.deletePost(req.params.id, req.user.admin_id);
      if (!deleted) throw ApiError.notFound('Post not found');
      return ApiResponse.deleted(res, 'Post deleted successfully');
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
