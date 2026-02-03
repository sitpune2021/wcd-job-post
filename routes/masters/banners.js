// ============================================================================
// BANNER ROUTES
// ============================================================================
// Purpose: CRUD operations for banner master data
// Base path: /api/masters/banners
// ============================================================================

const express = require('express');
const path = require('path');
const router = express.Router();
const { authenticate, requirePermission } = require('../../middleware/auth');
const bannerService = require('../../services/masters/bannerService');
const ApiResponse = require('../../utils/ApiResponse');
const { ApiError } = require('../../middleware/errorHandler');
const { deleteFile, getRelativePath, getAbsolutePath } = require('../../utils/fileUpload');
const multer = require('multer');

// Configure multer for dual image upload
const uploadBannerImages = multer({
  storage: multer.diskStorage({
    destination: async (_req, _file, cb) => {
      const uploadPath = path.join(__dirname, '..', '..', 'uploads', 'banners');
      const fs = require('fs').promises;
      await fs.mkdir(uploadPath, { recursive: true });
      cb(null, uploadPath);
    },
    filename: (_req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      const ext = path.extname(file.originalname);
      const nameWithoutExt = path.basename(file.originalname, ext);
      cb(null, `${nameWithoutExt}_${uniqueSuffix}${ext}`);
    }
  }),
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.match(/^image\/(jpeg|png)$/)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG and PNG images are allowed'));
    }
  },
  limits: { fileSize: 2 * 1024 * 1024 }
}).fields([{ name: 'banner_image', maxCount: 1 }, { name: 'banner_image_mr', maxCount: 1 }]);

// ==================== PROTECTED ROUTES ====================

// GET /api/masters/banners - Get all banners (admin only)
router.get('/', 
  authenticate, 
  requirePermission('masters.banners.view'),
  async (req, res, next) => {
    try {
      const result = await bannerService.getBanners(req.query);
      return ApiResponse.success(res, result, 'Banners retrieved successfully');
    } catch (error) {
      next(error);
    }
  }
);

// GET /api/masters/banners/:id - Get banner by ID
router.get('/:id', 
  authenticate, 
  requirePermission('masters.banners.view'),
  async (req, res, next) => {
    try {
      const banner = await bannerService.getBannerById(req.params.id);
      if (!banner) {
        throw ApiError.notFound('Banner not found');
      }
      return ApiResponse.success(res, banner, 'Banner retrieved successfully');
    } catch (error) {
      next(error);
    }
  }
);

// POST /api/masters/banners - Create new banner
router.post('/', 
  authenticate, 
  requirePermission('masters.banners.create'),
  uploadBannerImages,
  async (req, res, next) => {
    try {
      if (!req.files || !req.files.banner_image) {
        throw ApiError.badRequest('English banner image is required');
      }

      const bannerData = {
        banner_image_path: getRelativePath(req.files.banner_image[0].path),
        display_order: req.body.display_order ? parseInt(req.body.display_order) : 0,
        is_active: req.body.is_active !== undefined ? req.body.is_active === 'true' : true
      };

      if (req.files.banner_image_mr) {
        bannerData.banner_image_path_mr = getRelativePath(req.files.banner_image_mr[0].path);
      }

      const banner = await bannerService.createBanner(bannerData, req.user.admin_id);
      return ApiResponse.created(res, banner, 'Banner created successfully');
    } catch (error) {
      if (req.files) {
        if (req.files.banner_image) await deleteFile(req.files.banner_image[0].path);
        if (req.files.banner_image_mr) await deleteFile(req.files.banner_image_mr[0].path);
      }
      next(error);
    }
  }
);

// PUT /api/masters/banners/:id - Update banner
router.put('/:id', 
  authenticate, 
  requirePermission('masters.banners.edit'),
  uploadBannerImages,
  async (req, res, next) => {
    try {
      const existingBanner = await bannerService.getBannerById(req.params.id);
      if (!existingBanner) {
        if (req.files) {
          if (req.files.banner_image) await deleteFile(req.files.banner_image[0].path);
          if (req.files.banner_image_mr) await deleteFile(req.files.banner_image_mr[0].path);
        }
        throw ApiError.notFound('Banner not found');
      }

      const updateData = {};
      
      if (req.files && req.files.banner_image) {
        updateData.banner_image_path = getRelativePath(req.files.banner_image[0].path);
        if (existingBanner.banner_image_path) {
          const oldPath = existingBanner.banner_image_path;
          const oldAbs = path.isAbsolute(oldPath) ? oldPath : getAbsolutePath(oldPath);
          await deleteFile(oldAbs);
        }
      }

      if (req.files && req.files.banner_image_mr) {
        updateData.banner_image_path_mr = getRelativePath(req.files.banner_image_mr[0].path);
        if (existingBanner.banner_image_path_mr) {
          const oldPath = existingBanner.banner_image_path_mr;
          const oldAbs = path.isAbsolute(oldPath) ? oldPath : getAbsolutePath(oldPath);
          await deleteFile(oldAbs);
        }
      }

      if (req.body.display_order !== undefined) {
        updateData.display_order = parseInt(req.body.display_order);
      }

      if (req.body.is_active !== undefined) {
        updateData.is_active = req.body.is_active === 'true' || req.body.is_active === true;
      }

      const banner = await bannerService.updateBanner(req.params.id, updateData, req.user.admin_id);
      return ApiResponse.success(res, banner, 'Banner updated successfully');
    } catch (error) {
      if (req.files) {
        if (req.files.banner_image) await deleteFile(req.files.banner_image[0].path);
        if (req.files.banner_image_mr) await deleteFile(req.files.banner_image_mr[0].path);
      }
      next(error);
    }
  }
);

// DELETE /api/masters/banners/:id - Delete banner (soft delete)
router.delete('/:id', 
  authenticate, 
  requirePermission('masters.banners.delete'),
  async (req, res, next) => {
    try {
      const banner = await bannerService.getBannerById(req.params.id);
      const deleted = await bannerService.deleteBanner(req.params.id, req.user.admin_id);
      if (!deleted) {
        throw ApiError.notFound('Banner not found');
      }
      if (banner?.banner_image_path) {
        const absPath = path.isAbsolute(banner.banner_image_path)
          ? banner.banner_image_path
          : getAbsolutePath(banner.banner_image_path);
        await deleteFile(absPath);
      }
      if (banner?.banner_image_path_mr) {
        const absPathMr = path.isAbsolute(banner.banner_image_path_mr)
          ? banner.banner_image_path_mr
          : getAbsolutePath(banner.banner_image_path_mr);
        await deleteFile(absPathMr);
      }
      return ApiResponse.deleted(res, 'Banner deleted successfully');
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
