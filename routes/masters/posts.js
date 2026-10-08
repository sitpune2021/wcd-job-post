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
const postBulkImportService = require('../../services/masters/postBulkImportService');
const ApiResponse = require('../../utils/ApiResponse');
const { ApiError } = require('../../middleware/errorHandler');
const { validateBody, validateBodyAndParams } = require('../../middleware/validate');
const postSchemas = require('../../validators/masters/postSchemas');
const multer = require('multer');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    const allowedTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/octet-stream'
    ];
    const isXlsx = file.originalname.toLowerCase().endsWith('.xlsx');
    const isAllowed = isXlsx && allowedTypes.includes(file.mimetype);
    callback(isAllowed ? null : ApiError.badRequest('Only .xlsx Excel files are allowed for post import'), isAllowed);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const result = await postMasterService.getPosts(req.query);
    return ApiResponse.success(res, result, 'Posts retrieved successfully');
  } catch (error) {
    next(error);
  }
});

router.get('/bulk/template', authenticate, requirePermission('masters.posts.create'), async (req, res, next) => {
  try {
    const template = await postBulkImportService.downloadTemplate(req.query.recruitment_drive_id);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${template.fileName}"`,
      'Cache-Control': 'no-store'
    });
    return res.send(template.buffer);
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

router.post('/bulk/import',
  authenticate,
  requirePermission('masters.posts.create'),
  upload.single('file'),
  async (req, res, next) => {
    try {
      if (!req.file?.buffer) throw ApiError.badRequest('Choose a completed .xlsx post template to upload');
      const result = await postBulkImportService.uploadPosts({
        recruitmentDriveId: req.body.recruitment_drive_id,
        fileBuffer: req.file.buffer,
        adminId: req.user.admin_id
      });
      return ApiResponse.created(res, result, `${result.created_count} post${result.created_count === 1 ? '' : 's'} imported successfully`);
    } catch (error) {
      next(error);
    }
  }
);

router.post('/', authenticate, requirePermission('masters.posts.create'), validateBody(postSchemas.createPost),
  async (req, res, next) => {
    try {
      const post = await postMasterService.createPost(req.body, req.user.admin_id);
      return ApiResponse.created(res, post, 'Post created successfully');
    } catch (error) {
      next(error);
    }
  }
);

router.put('/:id', authenticate, requirePermission('masters.posts.edit'), validateBodyAndParams(postSchemas.updatePost, postSchemas.postIdParam),
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
