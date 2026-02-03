const express = require('express');
const router = express.Router();
const postService = require('../services/postService');
const { authenticate, requirePermission } = require('../middleware/auth');
const { ApiError } = require('../middleware/errorHandler');
const ApiResponse = require('../utils/ApiResponse');

/**
 * Post Management Routes
 * Public routes for viewing posts
 * Admin routes for managing posts
 */

// ==================== PUBLIC ROUTES ====================

// Get all active posts
router.get('/', async (req, res, next) => {
  try {
    const filters = {
      is_open: req.query.is_open === 'true',
      district_specific: req.query.district_specific
    };
    const language = req.query.lang || 'en';
    const posts = await postService.getAllPosts(filters, language);
    return ApiResponse.success(res, posts, 'Posts retrieved successfully');
  } catch (error) {
    next(error);
  }
});

// Get post by ID
router.get('/:id', async (req, res, next) => {
  try {
    const language = req.query.lang || 'en';
    const post = await postService.getPostById(req.params.id, language);
    if (!post) {
      return next(ApiError.notFound('Post not found'));
    }
    return ApiResponse.success(res, post, 'Post retrieved successfully');
  } catch (error) {
    next(error);
  }
});

// ==================== ADMIN ROUTES ====================

// Get all posts (including inactive)
router.get('/admin/all', authenticate, requirePermission(['posts.view']), async (req, res, next) => {
  try {
    const filters = { includeInactive: true };
    const language = req.query.lang || 'en';
    const posts = await postService.getAllPosts(filters, language);
    return ApiResponse.success(res, posts, 'Posts retrieved successfully');
  } catch (error) {
    next(error);
  }
});

// Create post
router.post('/', authenticate, requirePermission(['posts.create']), async (req, res, next) => {
  try {
    const post = await postService.createPost(req.body, req.user.admin_id);
    return ApiResponse.created(res, post, 'Post created successfully');
  } catch (error) {
    next(error);
  }
});

// Update post
router.put('/:id', authenticate, requirePermission(['posts.edit']), async (req, res, next) => {
  try {
    const post = await postService.updatePost(req.params.id, req.body, req.user.admin_id);
    if (!post) {
      return next(ApiError.notFound('Post not found'));
    }
    return ApiResponse.success(res, post, 'Post updated successfully');
  } catch (error) {
    next(error);
  }
});

// Delete post
router.delete('/:id', authenticate, requirePermission(['posts.delete']), async (req, res, next) => {
  try {
    const deleted = await postService.deletePost(req.params.id, req.user.admin_id);
    if (!deleted) {
      return next(ApiError.notFound('Post not found'));
    }
    return ApiResponse.deleted(res, 'Post deleted successfully');
  } catch (error) {
    next(error);
  }
});

// Publish post
router.post('/:id/publish', authenticate, requirePermission(['posts.publish']), async (req, res, next) => {
  try {
    const post = await postService.publishPost(req.params.id, req.user.admin_id);
    if (!post) {
      return next(ApiError.notFound('Post not found'));
    }
    return ApiResponse.success(res, post, 'Post published successfully');
  } catch (error) {
    next(error);
  }
});

// Close post
router.post('/:id/close', authenticate, requirePermission(['posts.close']), async (req, res, next) => {
  try {
    const post = await postService.closePost(req.params.id, req.user.admin_id);
    if (!post) {
      return next(ApiError.notFound('Post not found'));
    }
    return ApiResponse.success(res, post, 'Post closed successfully');
  } catch (error) {
    next(error);
  }
});

// ==================== POST DOCUMENT REQUIREMENTS ====================

// Get document requirements for a post
router.get('/:id/documents', authenticate, requirePermission(['posts.view']), async (req, res, next) => {
  try {
    const requirements = await postService.getDocumentRequirements(req.params.id);
    return ApiResponse.success(res, requirements, 'Document requirements retrieved successfully');
  } catch (error) {
    next(error);
  }
});

// Set/update document requirements for a post (bulk)
router.put('/:id/documents', authenticate, requirePermission(['posts.edit']), async (req, res, next) => {
  try {
    // req.body.requirements = [{ doc_type_id, requirement_type, mandatory_at_application, mandatory_before_engagement, remarks }]
    const requirements = await postService.setDocumentRequirements(req.params.id, req.body.requirements, req.user.admin_id);
    return ApiResponse.success(res, requirements, 'Document requirements updated successfully');
  } catch (error) {
    next(error);
  }
});

// Add single document requirement
router.post('/:id/documents', authenticate, requirePermission(['posts.edit']), async (req, res, next) => {
  try {
    const requirement = await postService.addDocumentRequirement(req.params.id, req.body, req.user.admin_id);
    return ApiResponse.created(res, requirement, 'Document requirement added successfully');
  } catch (error) {
    next(error);
  }
});

// Remove document requirement
router.delete('/:id/documents/:docTypeId', authenticate, requirePermission(['posts.edit']), async (req, res, next) => {
  try {
    await postService.removeDocumentRequirement(req.params.id, req.params.docTypeId, req.user.admin_id);
    return ApiResponse.deleted(res, 'Document requirement removed successfully');
  } catch (error) {
    next(error);
  }
});

module.exports = router;
