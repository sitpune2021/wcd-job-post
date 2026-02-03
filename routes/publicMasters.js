/**
 * Public Master Data Routes
 * These endpoints provide read-only access to master data for applicant portal
 * No authentication required for basic lookups
 */
const express = require('express');
const router = express.Router();
const db = require('../models');
const { ApiError } = require('../middleware/errorHandler');
const ApiResponse = require('../utils/ApiResponse');
const { Op } = require('sequelize');

// ==================== EDUCATION LEVELS ====================

/**
 * @route GET /api/v1/public/education-levels
 * @desc Get all education levels for dropdown
 * @access Public
 */
router.get('/education-levels', async (req, res, next) => {
  try {
    const levels = await db.EducationLevel.findAll({
      where: { is_active: true },
      attributes: ['level_id', 'doc_type_id', 'level_code', 'level_name', 'level_name_mr', 'level_category', 'display_order'],
      include: [
        {
          model: db.DocumentType,
          as: 'documentType',
          required: false,
          attributes: ['doc_type_id', 'doc_type_code', 'doc_type_name', 'doc_type_name_mr']
        }
      ],
      order: [['display_order', 'ASC']]
    });

    const result = levels.map((l) => {
      const row = l.toJSON();
      return {
        ...row,
        documentType: undefined,
        doc_type_code: row.documentType?.doc_type_code || null,
        doc_type_name: row.documentType?.doc_type_name || null,
        doc_type_name_mr: row.documentType?.doc_type_name_mr || null
      };
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/v1/public/education-levels/grouped
 * @desc Get education levels grouped by category
 * @access Public
 */
router.get('/education-levels/grouped', async (req, res, next) => {
  try {
    const levels = await db.EducationLevel.findAll({
      where: { is_active: true },
      attributes: ['level_id', 'doc_type_id', 'level_code', 'level_name', 'level_name_mr', 'level_category', 'display_order'],
      include: [
        {
          model: db.DocumentType,
          as: 'documentType',
          required: false,
          attributes: ['doc_type_id', 'doc_type_code', 'doc_type_name', 'doc_type_name_mr']
        }
      ],
      order: [['display_order', 'ASC']]
    });

    // Group by category
    const grouped = levels.reduce((acc, level) => {
      const row = level.toJSON();
      const category = row.level_category || 'Other';
      if (!acc[category]) {
        acc[category] = [];
      }
      acc[category].push({
        ...row,
        documentType: undefined,
        doc_type_code: row.documentType?.doc_type_code || null,
        doc_type_name: row.documentType?.doc_type_name || null,
        doc_type_name_mr: row.documentType?.doc_type_name_mr || null
      });
      return acc;
    }, {});

    res.status(200).json(grouped);
  } catch (error) {
    next(error);
  }
});

// ==================== EXPERIENCE DOMAINS ====================

/**
 * @route GET /api/v1/public/experience-domains
 * @desc Get all experience domains for dropdown
 * @access Public
 */
router.get('/experience-domains', async (req, res, next) => {
  try {
    const lang = (req.query.lang || 'en').toLowerCase();

    const domains = await db.ExperienceDomain.findAll({
      where: { is_active: true },
      attributes: [
        'id',
        'doc_type_id',
        'domain_code',
        'domain_name',
        'domain_name_mr',
        'description',
        'description_mr',
        'display_order'
      ],
      include: [
        {
          model: db.DocumentType,
          as: 'documentType',
          required: false,
          attributes: ['doc_type_id', 'doc_type_code', 'doc_type_name', 'doc_type_name_mr']
        }
      ],
      order: [['display_order', 'ASC']]
    });

    const result = domains.map((d) => {
      const row = d.toJSON();
      const localizedName = lang === 'mr' && row.domain_name_mr ? row.domain_name_mr : row.domain_name;
      const localizedDescription = lang === 'mr' && row.description_mr ? row.description_mr : row.description;

      const localizedDocTypeName =
        lang === 'mr' && row.documentType?.doc_type_name_mr
          ? row.documentType.doc_type_name_mr
          : row.documentType?.doc_type_name;

      return {
        ...row,
        documentType: undefined,
        domain_id: row.id,
        domain_name_localized: localizedName,
        description_localized: localizedDescription,
        doc_type_code: row.documentType?.doc_type_code || null,
        doc_type_name: row.documentType?.doc_type_name || null,
        doc_type_name_mr: row.documentType?.doc_type_name_mr || null,
        doc_type_name_localized: localizedDocTypeName || null
      };
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

// ==================== STREAM GROUPS ====================

/**
 * @route GET /api/v1/public/stream-groups
 * @desc Get all stream groups for dropdown
 * @access Public
 */
router.get('/stream-groups', async (req, res, next) => {
  try {
    const groups = await db.StreamGroup.findAll({
      where: { is_active: true },
      attributes: ['id', 'group_code', 'group_name', 'group_name_mr', 'streams', 'display_order'],
      order: [['display_order', 'ASC']]
    });
    res.status(200).json(groups);
  } catch (error) {
    next(error);
  }
});

// ==================== DISTRICTS & TALUKAS ====================

/**
 * @route GET /api/v1/public/districts
 * @desc Get all districts for dropdown
 * @access Public
 */
router.get('/districts', async (req, res, next) => {
  try {
    const districts = await db.DistrictMaster.findAll({
      where: { is_active: true },
      attributes: ['district_id', 'district_name', 'district_name_mr'],
      order: [['district_name', 'ASC']]
    });
    res.status(200).json(districts);
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/v1/public/districts/:districtId/talukas
 * @desc Get talukas for a district
 * @access Public
 */
router.get('/districts/:districtId/talukas', async (req, res, next) => {
  try {
    const talukas = await db.TalukaMaster.findAll({
      where: { 
        district_id: req.params.districtId,
        is_active: true 
      },
      attributes: ['taluka_id', 'taluka_name', 'taluka_name_mr'],
      order: [['taluka_name', 'ASC']]
    });
    res.status(200).json(talukas);
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/v1/public/district-posts
 * @desc Get all non-deleted districts with count of active posts in each district
 * @access Public
 */
router.get('/district-posts', async (req, res, next) => {
  try {
    const page = parseInt(req.query.page, 10) > 0 ? parseInt(req.query.page, 10) : 1;
    const limit = parseInt(req.query.limit, 10) > 0 ? parseInt(req.query.limit, 10) : 20;
    const offset = (page - 1) * limit;

    // Get post counts grouped by district
    const postCounts = await db.PostMaster.findAll({
      where: { is_active: true, is_deleted: false },
      attributes: [
        'district_id',
        [db.sequelize.fn('COUNT', db.sequelize.col('*')), 'post_count']
      ],
      group: ['district_id']
    });

    const countMap = postCounts.reduce((acc, row) => {
      const json = row.toJSON();
      acc[json.district_id || 0] = parseInt(json.post_count, 10);
      return acc;
    }, {});

    // Fetch districts (non-deleted, active)
    const districts = await db.DistrictMaster.findAll({
      where: { is_active: true, is_deleted: false },
      attributes: ['district_id', 'district_name', 'district_name_mr'],
      order: [['district_name', 'ASC']]
    });

    const result = districts.map((d) => {
      const row = d.toJSON();
      const districtId = row.district_id || 0;
      return {
        ...row,
        post_count: countMap[districtId] || 0
      };
    });

    // Filter districts with post_count > 0
    const filteredResult = result.filter(d => d.post_count > 0);

    // Apply pagination
    const total = filteredResult.length;
    const paginatedData = filteredResult.slice(offset, offset + limit);

    ApiResponse.paginated(res, paginatedData, {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    }, 'District post counts retrieved successfully');
  } catch (error) {
    next(error);
  }
});

// ==================== DOCUMENT TYPES ====================

/**
 * @route GET /api/v1/public/document-types
 * @desc Get all document types for upload
 * @access Public
 */
router.get('/document-types', async (req, res, next) => {
  try {
    const docTypes = await db.DocumentType.findAll({
      where: { is_active: true },
      attributes: [
        'doc_type_id', 'doc_code', 'doc_type_name', 'doc_type_name_mr', 
        'description', 'is_mandatory', 'allowed_file_types', 
        'max_file_size_mb', 'multiple_files_allowed', 'display_order'
      ],
      order: [['display_order', 'ASC']]
    });
    res.status(200).json(docTypes.map((d) => {
      const row = d.toJSON();
      return {
        ...row,
        is_mandatory_for_all: row.is_mandatory
      };
    }));
  } catch (error) {
    next(error);
  }
});

// ==================== COMPONENTS & POSTS ====================

/**
 * @route GET /api/v1/public/components
 * @desc Get all components
 * @access Public
 */
router.get('/components', async (req, res, next) => {
  try {
    const components = await db.Component.findAll({
      where: { is_active: true },
      attributes: ['component_id', 'component_code', 'component_name', 'component_name_mr', 'description'],
      order: [['component_id', 'ASC']]
    });
    res.status(200).json(components);
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/v1/public/posts
 * @desc Get all active posts with basic info
 * @access Public
 */
router.get('/posts', async (req, res, next) => {
  try {
    const { component_id, district_id, search } = req.query;
    const page = parseInt(req.query.page, 10) > 0 ? parseInt(req.query.page, 10) : 1;
    const limit = parseInt(req.query.limit, 10) > 0 ? parseInt(req.query.limit, 10) : 20;
    const offset = (page - 1) * limit;

    const where = { 
      is_active: true,
      is_deleted: false
    };
    
    if (component_id) {
      where.component_id = component_id;
    }
    if (district_id) {
      where.district_id = district_id;
    }

    const searchFilter = search
      ? {
          [Op.or]: [
            { post_name: { [Op.iLike]: `%${search}%` } },
            { post_name_mr: { [Op.iLike]: `%${search}%` } },
            { '$district.district_name$': { [Op.iLike]: `%${search}%` } },
            { '$district.district_name_mr$': { [Op.iLike]: `%${search}%` } },
            { '$component.component_name$': { [Op.iLike]: `%${search}%` } },
            { '$component.component_name_mr$': { [Op.iLike]: `%${search}%` } },
            { '$minEducationLevel.level_name$': { [Op.iLike]: `%${search}%` } },
            { '$minEducationLevel.level_name_mr$': { [Op.iLike]: `%${search}%` } },
            { '$maxEducationLevel.level_name$': { [Op.iLike]: `%${search}%` } },
            { '$maxEducationLevel.level_name_mr$': { [Op.iLike]: `%${search}%` } }
          ]
        }
      : {};

    const { rows: posts, count: total } = await db.PostMaster.findAndCountAll({
      where: { ...where, ...searchFilter },
      attributes: [
        'post_id', 'post_code', 'post_name', 'post_name_mr', 
        'description', 'description_mr',
        'min_age', 'max_age', 'female_only',
        'min_experience_months',
        'education_text', 'display_order',
        'opening_date', 'closing_date', 'total_positions', 'filled_positions',
        'district_specific', 'is_state_level', 'is_active', 'created_at', 'updated_at',
        'min_education_level_id', 'max_education_level_id',
        'component_id', 'district_id'
      ],
      include: [
        { 
          model: db.Component, 
          as: 'component',
          attributes: ['component_id', 'component_code', 'component_name', 'component_name_mr']
        },
        {
          model: db.DistrictMaster,
          as: 'district',
          attributes: ['district_id', 'district_name', 'district_name_mr']
        },
        {
          model: db.EducationLevel,
          as: 'minEducationLevel',
          attributes: ['level_id', 'level_code', 'level_name', 'level_name_mr']
        },
        {
          model: db.EducationLevel,
          as: 'maxEducationLevel',
          attributes: ['level_id', 'level_code', 'level_name', 'level_name_mr']
        }
      ],
      order: [['component_id', 'ASC'], ['display_order', 'ASC'], ['post_id', 'ASC']],
      limit,
      offset
    });

    const formatted = posts.map((p) => {
      const row = p.toJSON();
      const { experience_text, ...rest } = row;
      const minExperienceMonths = row.min_experience_months ?? 0;
      return {
        ...rest,
        min_experience_months: minExperienceMonths,
        post_name_en: row.post_name,
        post_name_mr: row.post_name_mr,
        description_en: row.description,
        description_mr: row.description_mr,
        component_id: row.component?.component_id || row.component_id || null,
        component_code: row.component?.component_code || null,
        component_name: row.component?.component_name || null,
        component_name_en: row.component?.component_name || null,
        component_name_mr: row.component?.component_name_mr || null,
        district_id: row.district?.district_id || row.district_id || null,
        district_name: row.district?.district_name || null,
        district_name_en: row.district?.district_name || null,
        district_name_mr: row.district?.district_name_mr || null,
        min_education: row.minEducationLevel
          ? {
              level_id: row.minEducationLevel.level_id,
              level_name: row.minEducationLevel.level_name,
              level_name_en: row.minEducationLevel.level_name,
              level_name_mr: row.minEducationLevel.level_name_mr
            }
          : null,
        max_education: row.maxEducationLevel
          ? {
              level_id: row.maxEducationLevel.level_id,
              level_name: row.maxEducationLevel.level_name,
              level_name_en: row.maxEducationLevel.level_name,
              level_name_mr: row.maxEducationLevel.level_name_mr
            }
          : null,
        available_positions: Math.max(
          0,
          (row.total_positions || 0) - (row.filled_positions || 0)
        ),
        district: row.district || null,
        component: row.component || null
      };
    });

    res.status(200).json({
      success: true,
      message: 'Posts retrieved successfully',
      data: {
        posts: formatted,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/v1/public/posts/:postId
 * @desc Get post details with requirements
 * @access Public
 */
router.get('/posts/:postId', async (req, res, next) => {
  try {
    const post = await db.PostMaster.findOne({
      where: { 
        post_id: req.params.postId,
        is_deleted: false
      },
      include: [
        { 
          model: db.Component, 
          as: 'component',
          attributes: ['component_id', 'component_code', 'component_name', 'component_name_mr'],
          required: false
        },
        {
          model: db.DistrictMaster,
          as: 'district',
          attributes: ['district_id', 'district_name', 'district_name_mr'],
          required: false
        },
        {
          model: db.EducationLevel,
          as: 'minEducationLevel',
          attributes: ['level_id', 'level_code', 'level_name', 'level_name_mr'],
          required: false
        },
        {
          model: db.EducationLevel,
          as: 'maxEducationLevel',
          attributes: ['level_id', 'level_code', 'level_name', 'level_name_mr'],
          required: false
        },
        {
          model: db.ExperienceDomain,
          as: 'experienceDomain',
          attributes: ['id', 'domain_code', 'domain_name', 'domain_name_mr'],
          required: false
        },
        {
          model: db.PostDocumentRequirement,
          as: 'documentRequirements',
          required: false,
          include: [{
            model: db.DocumentType,
            as: 'documentType',
            attributes: ['doc_type_id', 'doc_code', 'doc_type_name', 'doc_type_name_mr'],
            required: false
          }]
        }
      ]
    });

    if (!post) {
      throw new ApiError(404, 'Post not found');
    }

    const { component, district, ...rest } = post.toJSON();

    const formatted = {
      ...rest,
      available_positions: Math.max(
        0,
        (post.total_positions || 0) - (post.filled_positions || 0)
      ),
      component_code: component?.component_code || null,
      component_name: component?.component_name || null,
      component_name_en: component?.component_name || null,
      component_name_mr: component?.component_name_mr || null,
      district_name: district?.district_name || null,
      district_name_en: district?.district_name || null,
      district_name_mr: district?.district_name_mr || null,
      min_education: post.minEducationLevel ? {
        level_id: post.minEducationLevel.level_id,
        level_name: post.minEducationLevel.level_name,
        level_name_en: post.minEducationLevel.level_name,
        level_name_mr: post.minEducationLevel.level_name_mr
      } : null,
      max_education: post.maxEducationLevel ? {
        level_id: post.maxEducationLevel.level_id,
        level_name: post.maxEducationLevel.level_name,
        level_name_en: post.maxEducationLevel.level_name,
        level_name_mr: post.maxEducationLevel.level_name_mr
      } : null
    };

    res.status(200).json(formatted);
  } catch (error) {
    next(error);
  }
});

// ==================== CATEGORIES ====================

/**
 * @route GET /api/v1/public/categories
 * @desc Get all categories for dropdown (applicant personal info)
 * @access Public
 */
router.get('/categories', async (req, res, next) => {
  try {
    // const categories = await db.CategoryMaster.findAll({
    //   where: { is_active: true, is_deleted: false },
    //   attributes: ['category_id', 'category_code', 'category_name', 'category_name_mr', 'display_order'],
    //   order: [['display_order', 'ASC']]
    // });
    res.status(200).json([]);
  } catch (error) {
    next(error);
  }
});

/**
 * @route GET /api/v1/public/posts/:postId/categories
 * @desc Get allowed categories for a specific post
 * @access Public
 */
router.get('/posts/:postId/categories', async (req, res, next) => {
  try {
    // const postCategories = await db.PostCategory.findAll({
    //   where: { post_id: req.params.postId, is_active: true },
    //   include: [{
    //     model: db.CategoryMaster,
    //     as: 'category',
    //     where: { is_active: true, is_deleted: false },
    //     attributes: ['category_id', 'category_code', 'category_name', 'category_name_mr']
    //   }],
    //   order: [[{ model: db.CategoryMaster, as: 'category' }, 'display_order', 'ASC']]
    // });
    // const categories = postCategories.map(pc => pc.category);
    res.status(200).json([]);
  } catch (error) {
    next(error);
  }
});

// ==================== REJECTION REASONS ====================

/**
 * @route GET /api/v1/public/rejection-reasons
 * @desc Get all rejection reasons (for reference)
 * @access Public
 */
router.get('/rejection-reasons', async (req, res, next) => {
  try {
    const { category } = req.query;
    
    const where = { is_active: true };
    if (category) {
      where.category = category;
    }

    const reasons = await db.RejectionReason.findAll({
      where,
      attributes: ['id', 'reason_code', 'reason_text', 'reason_text_mr', 'category', 'display_order'],
      order: [['category', 'ASC'], ['display_order', 'ASC']]
    });
    res.status(200).json(reasons);
  } catch (error) {
    next(error);
  }
});

// ==================== SKILLS ====================

router.get('/skills', async (req, res, next) => {
  try {
    const { lang } = req.query;
    const language = (lang || 'en').toLowerCase();

    const skills = await db.SkillMaster.findAll({
      where: { is_active: true },
      attributes: ['skill_id', 'skill_name', 'skill_name_mr', 'description', 'description_mr'],
      order: [['skill_id', 'ASC']]
    });

    const result = skills.map((s) => {
      const row = s.toJSON();
      const localizedName = language === 'mr' && row.skill_name_mr ? row.skill_name_mr : row.skill_name;
      const localizedDescription = language === 'mr' && row.description_mr ? row.description_mr : row.description;

      return {
        ...row,
        skill_name_localized: localizedName,
        description_localized: localizedDescription
      };
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
});

// ==================== BANNERS ====================

/**
 * @route GET /api/v1/public/banners
 * @desc Get all active banners
 * @access Public
 */
router.get('/banners', async (req, res, next) => {
  try {
    const banners = await db.BannerMaster.scope('onlyActive').findAll({
      attributes: ['banner_id', 'banner_image_path', 'banner_image_path_mr', 'display_order'],
      order: [['display_order', 'ASC'], ['banner_id', 'DESC']]
    });
    res.status(200).json(banners);
  } catch (error) {
    next(error);
  }
});

// ==================== STATISTICS ====================

/**
 * @route GET /api/v1/public/stats
 * @desc Get public statistics (districts, posts, applicants, selected candidates)
 * @access Public
 */
router.get('/stats', async (req, res, next) => {
  try {
    const { lang } = req.query;
    const language = (lang || 'en').toLowerCase();

    // Count districts
    const districtCount = await db.DistrictMaster.count({
      where: { is_active: true, is_deleted: false }
    });

    // Count active posts
    const postCount = await db.PostMaster.count({
      where: { is_active: true, is_deleted: false }
    });

    // Count total applicants (unique applicants who have registered)
    const applicantCount = await db.ApplicantMaster.count({
      where: { is_deleted: false }
    });

    // Count active, non-deleted OSC components
    const componentCount = await db.Component.count({
      where: { is_active: true, is_deleted: false }
    });

    const stats = {
      total_districts: districtCount,
      total_posts: postCount,
      total_applicants: applicantCount,
      total_osc: componentCount,
      labels: {
        en: {
          districts: 'Districts',
          posts: 'Available Posts',
          applicants: 'Registered Applicants',
          osc: 'OSCs'
        },
        mr: {
          districts: 'जिल्हे',
          posts: 'उपलब्ध पदे',
          applicants: 'नोंदणीकृत अर्जदार',
          osc: 'ओएससी'
        }
      }
    };

    res.status(200).json(stats);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
