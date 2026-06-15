// ============================================================================
// POST MASTER SERVICE
// ============================================================================
// Purpose: CRUD operations for post/job master data and post-category relationships
// Tables: ms_post_master, ms_post_categories
// ============================================================================

const db = require('../../models');
const { PostMaster, Scheme, CategoryMaster, PostCategory, ExperienceDomain } = db;
const { Op } = require('sequelize');
const logger = require('../../config/logger');
const { ApiError } = require('../../middleware/errorHandler');
const { paginatedQuery, isPaginatedResponse } = require('../../utils/pagination');
const { localizeField } = require('./helpers');

 const parseOptionalInt = (value) => {
   if (value === undefined) return undefined;
   if (value === null || value === '') return null;
   const n = parseInt(value, 10);
   return Number.isNaN(n) ? null : n;
 };

 const parseOptionalBool = (value) => {
   if (value === undefined) return undefined;
   if (value === null) return null;
   if (typeof value === 'boolean') return value;
   if (value === 'true') return true;
   if (value === 'false') return false;
   return !!value;
 };

 const parseIntArray = (arr) => {
   if (!Array.isArray(arr)) return [];
   return arr
     .map((v) => parseInt(v, 10))
     .filter((n) => !Number.isNaN(n));
 };

 const parseOptionalDate = (value) => {
   if (value === undefined) return undefined;
   if (value === null || value === '') return null;
   // Validate it's a valid date string
   const d = new Date(value);
   return isNaN(d.getTime()) ? null : value;
 };

// ==================== TRANSFORM FUNCTIONS ====================

/**
 * Transform post record for API response
 * @param {string} language - Language code ('en' or 'mr')
 * @returns {Function} Transform function
 */
const transformPost = (language = 'en') => (p) => ({
  post_id: p.post_id,
  recruitment_drive_id: p.recruitment_drive_id,
  recruitment_drive: p.recruitmentDrive ? {
    recruitment_drive_id: p.recruitmentDrive.recruitment_drive_id,
    drive_code: p.recruitmentDrive.drive_code,
    drive_name: p.recruitmentDrive.drive_name,
    status: p.recruitmentDrive.status,
    is_active: p.recruitmentDrive.is_active
  } : null,
  source_post_id: p.source_post_id || null,
  post_code: p.post_code,
  post_name: localizeField(p, 'post_name', language),
  post_name_en: p.post_name,
  post_name_mr: p.post_name_mr,
  description: language === 'mr' && p.description_mr ? p.description_mr : p.description,
  description_en: p.description,
  description_mr: p.description_mr,
  scheme_id: p.scheme_id,
  scheme: p.scheme ? {
    scheme_id: p.scheme.scheme_id,
    scheme_code: p.scheme.scheme_code,
    scheme_name: localizeField(p.scheme, 'scheme_name', language),
    scheme_type: p.scheme.schemeType ? p.scheme.schemeType.scheme_code : null
  } : null,
  experience_domain_id: p.experience_domain_id || null,
  min_qualification: p.min_qualification,
  min_experience_months: p.min_experience_months,
  min_age: p.min_age,
  max_age: p.max_age,
  district_specific: p.district_specific,
  district_id: p.district_id || null,
  district: p.district ? {
    district_id: p.district.district_id,
    district_name: localizeField(p.district, 'district_name', language),
    district_name_mr: p.district.district_name_mr
  } : null,
  required_domains: p.required_domains,
  eligibility_criteria: p.eligibility_criteria,
  opening_date: p.opening_date,
  closing_date: p.closing_date,
  total_positions: p.total_positions,
  filled_positions: p.filled_positions,
  female_only: p.female_only,
  male_only: p.male_only,
  is_active: p.is_active,
  created_at: p.created_at,
  updated_at: p.updated_at,
  min_education_level_id: p.min_education_level_id,
  max_education_level_id: p.max_education_level_id,
  amount: p.amount ? parseFloat(p.amount) : null
});

// ==================== POST CATEGORY OPERATIONS ====================

/**
 * Get categories for a specific post
 * @param {number} postId - Post ID
 * @param {string} language - Language code (en/mr)
 * @returns {Promise<Array>} List of categories allowed for the post
 */
const getPostCategories = async (postId, language = 'en') => {
  try {
    const postCategories = await PostCategory.findAll({
      where: { post_id: postId, is_active: true },
      include: [{
        model: CategoryMaster,
        as: 'category',
        where: { is_deleted: false, is_active: true },
        attributes: ['category_id', 'category_code', 'category_name', 'category_name_mr']
      }],
      order: [[{ model: CategoryMaster, as: 'category' }, 'display_order', 'ASC']]
    });

    return postCategories.map(pc => ({
      category_id: pc.category.category_id,
      category_code: pc.category.category_code,
      category_name: language === 'mr' && pc.category.category_name_mr 
        ? pc.category.category_name_mr 
        : pc.category.category_name,
      category_name_en: pc.category.category_name,
      category_name_mr: pc.category.category_name_mr
    }));
  } catch (error) {
    logger.error('Error fetching post categories:', error);
    throw error;
  }
};

/**
 * Set categories for a post (bulk replace)
 * @param {number} postId - Post ID
 * @param {Array<number>} categoryIds - Array of category IDs
 * @param {number} userId - User performing the action
 * @returns {Promise<Array>} Updated list of categories
 */
const setPostCategories = async (postId, categoryIds, userId) => {
  try {
    // Deactivate existing categories
    await PostCategory.update(
      { is_active: false, updated_at: new Date() },
      { where: { post_id: postId } }
    );

    // Insert/update new categories
    for (const categoryId of categoryIds) {
      await PostCategory.upsert({
        post_id: postId,
        category_id: categoryId,
        is_active: true,
        updated_at: new Date()
      });
    }

    logger.info(`Post categories updated for post ${postId} by user ${userId}`);
    return getPostCategories(postId);
  } catch (error) {
    logger.error('Error setting post categories:', error);
    throw error;
  }
};

/**
 * Add a single category to a post
 * @param {number} postId - Post ID
 * @param {number} categoryId - Category ID
 * @returns {Promise<Object>} Created/updated record
 */
const addPostCategory = async (postId, categoryId) => {
  try {
    const [record, created] = await PostCategory.upsert({
      post_id: postId,
      category_id: categoryId,
      is_active: true,
      updated_at: new Date()
    });

    logger.info(`Category ${categoryId} added to post ${postId}`);
    return record;
  } catch (error) {
    logger.error('Error adding post category:', error);
    throw error;
  }
};

/**
 * Remove a category from a post
 * @param {number} postId - Post ID
 * @param {number} categoryId - Category ID
 * @returns {Promise<boolean>} Success status
 */
const removePostCategory = async (postId, categoryId) => {
  try {
    const result = await PostCategory.update(
      { is_active: false, updated_at: new Date() },
      { where: { post_id: postId, category_id: categoryId } }
    );

    logger.info(`Category ${categoryId} removed from post ${postId}`);
    return result[0] > 0;
  } catch (error) {
    logger.error('Error removing post category:', error);
    throw error;
  }
};

// ==================== POST CRUD OPERATIONS ====================

/**
 * Get all posts with optional pagination, search, and filters
 * @param {Object} query - Query params
 * @returns {Promise<Array|Object>} Posts with optional pagination
 */
const getPosts = async (query = {}) => {
  try {
    const language = query.lang || 'en';
    const includeInactive = query.include_inactive === 'true';
    const defaultDrive = await require('../recruitmentDriveService').getDriveForRead();
    const requestedDriveId = parseOptionalInt(query.recruitment_drive_id);
    
    const baseWhere = {};
    baseWhere.is_deleted = false;
    if (Number.isInteger(requestedDriveId)) {
      baseWhere.recruitment_drive_id = requestedDriveId;
    } else if (defaultDrive && query.include_all_drives !== 'true') {
      baseWhere.recruitment_drive_id = defaultDrive.recruitment_drive_id;
    }
    if (!includeInactive) {
      baseWhere.is_active = true;
    }

    const result = await paginatedQuery(PostMaster, {
      query,
      searchFields: ['post_name', 'post_name_mr', 'post_code', 'description'],
      filterConfig: {
        scheme_id: { field: 'scheme_id', type: 'number' },
        district_specific: { field: 'district_specific', type: 'boolean' },
        district_id: { field: 'district_id', type: 'number' }
      },
      attributes: [
        'post_id', 'recruitment_drive_id', 'source_post_id', 'post_code', 'post_name', 'post_name_mr', 'description', 'description_mr',
        'scheme_id', 'experience_domain_id', 'min_qualification', 'min_experience_months',
        'min_age', 'max_age', 'district_specific', 'district_id', 'required_domains', 'eligibility_criteria',
        'opening_date', 'closing_date', 'total_positions', 'filled_positions', 'female_only', 'male_only',
        'is_active', 'created_at', 'updated_at', 'min_education_level_id', 'max_education_level_id', 'amount'
      ],
      include: [{
        model: Scheme,
        as: 'scheme',
        required: false,
        include: [{
          model: db.SchemeType,
          as: 'schemeType',
          attributes: ['scheme_type_id', 'scheme_code', 'scheme_name'],
          required: false
        }],
        attributes: ['scheme_id', 'scheme_code', 'scheme_name', 'scheme_name_mr']
      }, {
        model: ExperienceDomain,
        as: 'experienceDomain',
        required: false,
        attributes: ['id', 'domain_code', 'domain_name', 'domain_name_mr']
      }, {
        model: db.DistrictMaster,
        as: 'district',
        required: false,
        attributes: ['district_id', 'district_name', 'district_name_mr']
      }, {
        model: db.RecruitmentDrive,
        as: 'recruitmentDrive',
        required: false,
        attributes: ['recruitment_drive_id', 'drive_code', 'drive_name', 'status', 'is_active']
      }],
      baseWhere,
      order: [['updated_at', 'DESC'], ['created_at', 'DESC'], ['post_id', 'DESC']],
      dataKey: 'posts',
      transform: transformPost(language)
    });

    const enrichWithCategories = async (postsArray) => {
      // Get all post IDs at once
      const postIds = postsArray.map(p => p.post_id);
      
      // Fetch all categories in one query
      const postCategories = await PostCategory.findAll({
        where: { post_id: postIds },
        include: [{
          model: CategoryMaster,
          as: 'category',
          attributes: ['category_id', 'category_name', 'category_name_mr']
        }]
      });
      
      // Group by post_id
      const categoriesMap = {};
      postCategories.forEach(pc => {
        if (!categoriesMap[pc.post_id]) {
          categoriesMap[pc.post_id] = [];
        }
        categoriesMap[pc.post_id].push({
          category_id: pc.category_id,
          category_name: language === 'mr' && pc.category.category_name_mr ? 
            pc.category.category_name_mr : pc.category.category_name
        });
      });
      
      // Map back to posts
      return postsArray.map(p => ({
        ...p,
        allowed_categories: categoriesMap[p.post_id] || [],
        allowed_category_ids: (categoriesMap[p.post_id] || []).map(c => c.category_id)
      }));
    };

    if (isPaginatedResponse(result)) {
      const enrichedPosts = await enrichWithCategories(result.posts || []);
      const finalResult = {
        ...result,
        posts: enrichedPosts
      };
      
      return finalResult;
    }

    const postsArray = Array.isArray(result) ? result : [];
    const finalResult = await enrichWithCategories(postsArray);
    
    return finalResult;
  } catch (error) {
    logger.error('Error fetching posts:', error);
    throw error;
  }
};

/**
 * Get post by ID
 * @param {number} postId - Post ID
 * @param {string} language - Language code
 * @returns {Promise<Object|null>} Post object or null
 */
const getPostById = async (postId, language = 'en') => {
  try {
    const post = await PostMaster.findByPk(postId, {
      attributes: [
        'post_id', 'recruitment_drive_id', 'post_code', 'post_name', 'post_name_mr', 'description', 'description_mr',
        'scheme_id', 'experience_domain_id', 'min_qualification', 'min_experience_months',
        'min_age', 'max_age', 'district_specific', 'district_id', 'required_domains', 'eligibility_criteria',
        'opening_date', 'closing_date', 'total_positions', 'filled_positions', 'female_only', 'male_only',
        'is_active', 'created_at', 'updated_at', 'min_education_level_id', 'max_education_level_id', 'amount'
      ],
      include: [{
        model: Scheme,
        as: 'scheme',
        required: false,
        include: [{
          model: db.SchemeType,
          as: 'schemeType',
          attributes: ['scheme_type_id', 'scheme_code', 'scheme_name'],
          required: false
        }],
        attributes: ['scheme_id', 'scheme_code', 'scheme_name', 'scheme_name_mr']
      }, {
        model: ExperienceDomain,
        as: 'experienceDomain',
        required: false,
        attributes: ['id', 'domain_code', 'domain_name', 'domain_name_mr']
      }, {
        model: db.DistrictMaster,
        as: 'district',
        required: false,
        attributes: ['district_id', 'district_name', 'district_name_mr']
      }, {
        model: db.RecruitmentDrive,
        as: 'recruitmentDrive',
        required: false,
        attributes: ['recruitment_drive_id', 'drive_code', 'drive_name', 'status', 'is_active']
      }]
    });

    if (!post) {
      return null;
    }

    if (post.is_deleted) {
      return null;
    }
    const drive = await db.RecruitmentDrive.findByPk(post.recruitment_drive_id);
    if (drive?.status === 'CLOSED') {
      throw new ApiError(409, 'Posts in a closed recruitment drive cannot be edited');
    }

    const categories = await getPostCategories(postId, language);

    return {
      post_id: post.post_id,
      recruitment_drive_id: post.recruitment_drive_id,
      recruitment_drive: post.recruitmentDrive ? {
        recruitment_drive_id: post.recruitmentDrive.recruitment_drive_id,
        drive_code: post.recruitmentDrive.drive_code,
        drive_name: post.recruitmentDrive.drive_name,
        status: post.recruitmentDrive.status,
        is_active: post.recruitmentDrive.is_active
      } : null,
      post_code: post.post_code,
      post_name: localizeField(post, 'post_name', language),
      post_name_en: post.post_name,
      post_name_mr: post.post_name_mr,
      description: language === 'mr' && post.description_mr ? post.description_mr : post.description,
      description_en: post.description,
      description_mr: post.description_mr,
      scheme_id: post.scheme_id,
      scheme: post.scheme ? {
        scheme_id: post.scheme.scheme_id,
        scheme_code: post.scheme.scheme_code,
        scheme_name: localizeField(post.scheme, 'scheme_name', language),
        scheme_type: post.scheme.schemeType ? post.scheme.schemeType.scheme_code : null
      } : null,
      experience_domain_id: post.experience_domain_id || null,
      min_qualification: post.min_qualification,
      min_experience_months: post.min_experience_months,
      min_age: post.min_age,
      max_age: post.max_age,
      district_specific: post.district_specific,
      district_id: post.district_id || null,
      district: post.district ? {
        district_id: post.district.district_id,
        district_name: localizeField(post.district, 'district_name', language),
        district_name_mr: post.district.district_name_mr
      } : null,
      required_domains: post.required_domains,
      eligibility_criteria: post.eligibility_criteria,
      opening_date: post.opening_date,
      closing_date: post.closing_date,
      total_positions: post.total_positions,
      filled_positions: post.filled_positions,
      female_only: post.female_only,
      male_only: post.male_only,
      is_active: post.is_active,
      created_at: post.created_at,
      updated_at: post.updated_at,
      min_education_level_id: post.min_education_level_id,
      max_education_level_id: post.max_education_level_id,
      amount: post.amount ? parseFloat(post.amount) : null,
      allowed_categories: categories,
      allowed_category_ids: categories.map(c => c.category_id)
    };
  } catch (error) {
    logger.error('Error fetching post:', error);
    throw error;
  }
};

/**
 * Create new post
 * @param {Object} data - Post data
 * @param {number} userId - User creating the post
 * @returns {Promise<Object>} Created post
 */
const createPost = async (data, userId) => {
  try {
    const requestedDriveId = parseOptionalInt(data.recruitment_drive_id);
    if (!Number.isInteger(requestedDriveId)) {
      throw new ApiError(400, 'Select a recruitment drive before creating the post');
    }
    const targetDrive = await db.RecruitmentDrive.findByPk(requestedDriveId);
    if (!targetDrive) {
      throw new ApiError(404, 'Recruitment drive not found');
    }
    if (targetDrive.status === 'CLOSED') {
      throw new ApiError(409, 'Posts cannot be added to a closed recruitment drive');
    }
    const minEducationLevelId = parseOptionalInt(data.min_education_level_id);
    const maxEducationLevelId = parseOptionalInt(data.max_education_level_id);
    const schemeId = parseOptionalInt(data.scheme_id);
    const experienceDomainId = parseOptionalInt(data.experience_domain_id);
    const districtId = parseOptionalInt(data.district_id);

    // Validate dates
    const driveOpeningDate = targetDrive.application_start_at
      ? new Date(targetDrive.application_start_at).toISOString().slice(0, 10)
      : null;
    const driveClosingDate = targetDrive.application_end_at
      ? new Date(targetDrive.application_end_at).toISOString().slice(0, 10)
      : null;
    const openingDate = driveOpeningDate ?? parseOptionalDate(data.opening_date);
    const closingDate = driveClosingDate ?? parseOptionalDate(data.closing_date);
    
    if (openingDate && closingDate) {
      const opening = new Date(openingDate);
      const closing = new Date(closingDate);
      
      if (closing <= opening) {
        const error = new Error('Closing date must be after opening date');
        error.statusCode = 400;
        throw error;
      }
    }

    const post = await PostMaster.create({
      recruitment_drive_id: targetDrive.recruitment_drive_id,
      source_post_id: parseOptionalInt(data.source_post_id),
      post_code: data.post_code,
      post_name: data.post_name,
      post_name_mr: data.post_name_mr || null,
      description: data.description || null,
      description_mr: data.description_mr || null,
      scheme_id: schemeId,
      min_qualification: data.min_qualification || null,
      min_experience_months: parseOptionalInt(data.min_experience_months) || 0,
      min_education_level_id: minEducationLevelId,
      max_education_level_id: maxEducationLevelId,
      experience_domain_id: experienceDomainId,
      district_id: districtId,
      min_age: parseOptionalInt(data.min_age),
      max_age: parseOptionalInt(data.max_age),
      district_specific: parseOptionalBool(data.district_specific) || false,
      required_domains: data.required_domains || null,
      eligibility_criteria: data.eligibility_criteria || null,
      opening_date: openingDate,
      closing_date: closingDate,
      total_positions: parseOptionalInt(data.total_positions) || 1,
      filled_positions: parseOptionalInt(data.filled_positions) || 0,
      female_only: parseOptionalBool(data.female_only) || false,
      male_only: parseOptionalBool(data.male_only) || false,
      display_order: parseOptionalInt(data.display_order) || 0,
      amount: parseFloat(data.amount) || null,
      is_active: targetDrive.is_active && targetDrive.applications_open,
      is_deleted: parseOptionalBool(data.is_deleted) || false,
      created_by: userId
    });

    if (Object.prototype.hasOwnProperty.call(data, 'allowed_category_ids')) {
      await setPostCategories(post.post_id, parseIntArray(data.allowed_category_ids), userId);
    }

    logger.info(`Post created: ${post.post_id} by user ${userId}`);
    return post;
  } catch (error) {
    logger.error('Error creating post:', error);
    throw error;
  }
};

/**
 * Update post
 * @param {number} postId - Post ID
 * @param {Object} data - Update data
 * @param {number} userId - User updating the post
 * @returns {Promise<Object|null>} Updated post or null
 */
const updatePost = async (postId, data, userId) => {
  try {
    const post = await PostMaster.findByPk(postId);

    if (!post) {
      return null;
    }

    if (post.is_deleted) {
      return null;
    }

    const updateData = { updated_by: userId, updated_at: new Date() };
    const fields = [
      'post_code', 'post_name', 'post_name_mr', 'description', 'description_mr',
      'scheme_id', 'min_qualification', 'min_experience_months', 'min_age', 'max_age',
      'district_specific', 'required_domains', 'eligibility_criteria',
      'opening_date', 'closing_date', 'total_positions', 'filled_positions', 'female_only', 'male_only', 'is_active', 'amount'
    ];
    
    fields.forEach(field => {
      if (data[field] === undefined) return;

      if (['scheme_id', 'min_experience_months', 'min_age', 'max_age', 'total_positions', 'filled_positions'].includes(field)) {
        updateData[field] = parseOptionalInt(data[field]);
        return;
      }

      if (['district_specific', 'female_only', 'male_only'].includes(field)) {
        updateData[field] = parseOptionalBool(data[field]) || false;
        return;
      }

      // Handle amount field specifically
      if (field === 'amount') {
        updateData[field] = data.amount === '' || data.amount === null ? null : parseFloat(data.amount);
        return;
      }

      // Handle date fields - convert empty strings to null
      if (['opening_date', 'closing_date'].includes(field)) {
        updateData[field] = parseOptionalDate(data[field]);
        return;
      }

      // Handle text fields - convert empty strings to null for optional fields
      if (['description', 'description_mr', 'min_qualification', 'required_domains', 'eligibility_criteria'].includes(field)) {
        updateData[field] = data[field] === '' ? null : data[field];
        return;
      }

      updateData[field] = data[field];
    });

    if (Object.prototype.hasOwnProperty.call(data, 'min_education_level_id')) {
      updateData.min_education_level_id = parseOptionalInt(data.min_education_level_id);
    }
    if (Object.prototype.hasOwnProperty.call(data, 'max_education_level_id')) {
      updateData.max_education_level_id = parseOptionalInt(data.max_education_level_id);
    }
    if (Object.prototype.hasOwnProperty.call(data, 'experience_domain_id')) {
      updateData.experience_domain_id = parseOptionalInt(data.experience_domain_id);
    }
    if (Object.prototype.hasOwnProperty.call(data, 'district_id')) {
      updateData.district_id = parseOptionalInt(data.district_id);
    }
    if (Object.prototype.hasOwnProperty.call(data, 'display_order')) {
      updateData.display_order = parseOptionalInt(data.display_order) || 0;
    }
    if (Object.prototype.hasOwnProperty.call(data, 'recruitment_drive_id')) {
      const targetDriveId = parseOptionalInt(data.recruitment_drive_id);
      if (!Number.isInteger(targetDriveId)) {
        throw new ApiError(400, 'Select a recruitment drive for the post');
      }
      if (targetDriveId !== post.recruitment_drive_id) {
        const [targetDrive, applicationCount] = await Promise.all([
          db.RecruitmentDrive.findByPk(targetDriveId),
          db.Application.count({ where: { post_id: post.post_id, is_deleted: { [Op.ne]: true } } })
        ]);
        if (!targetDrive) throw new ApiError(404, 'Recruitment drive not found');
        if (targetDrive.status === 'CLOSED') {
          throw new ApiError(409, 'Posts cannot be moved into a closed recruitment drive');
        }
        if (applicationCount > 0) {
          throw new ApiError(409, 'A post with applications cannot be moved to another recruitment drive');
        }
        updateData.recruitment_drive_id = targetDriveId;
        updateData.is_active = targetDrive.is_active && targetDrive.applications_open;
        if (targetDrive.application_start_at) {
          updateData.opening_date = new Date(targetDrive.application_start_at).toISOString().slice(0, 10);
        }
        if (targetDrive.application_end_at) {
          updateData.closing_date = new Date(targetDrive.application_end_at).toISOString().slice(0, 10);
        }
      }
    }

    // Validate dates after all updates are prepared
    const finalOpeningDate = updateData.opening_date !== undefined ? updateData.opening_date : post.opening_date;
    const finalClosingDate = updateData.closing_date !== undefined ? updateData.closing_date : post.closing_date;
    
    if (finalOpeningDate && finalClosingDate) {
      const opening = new Date(finalOpeningDate);
      const closing = new Date(finalClosingDate);
      
      if (closing <= opening) {
        const error = new Error('Closing date must be after opening date');
        error.statusCode = 400;
        throw error;
      }
    }
    const finalTotalPositions = updateData.total_positions !== undefined
      ? updateData.total_positions
      : post.total_positions;
    const finalFilledPositions = updateData.filled_positions !== undefined
      ? updateData.filled_positions
      : post.filled_positions;
    if (finalTotalPositions < finalFilledPositions) {
      throw new ApiError(409, `Total positions cannot be lower than filled positions (${finalFilledPositions})`);
    }

    await post.update(updateData);

    if (Object.prototype.hasOwnProperty.call(data, 'allowed_category_ids')) {
      await setPostCategories(postId, parseIntArray(data.allowed_category_ids), userId);
    }

    logger.info(`Post updated: ${postId} by user ${userId}`);
    return post;
  } catch (error) {
    logger.error('Error updating post:', error);
    throw error;
  }
};

/**
 * Bulk update posts for selected master fields
 * @param {Array<number>} postIds - Array of post IDs
 * @param {Object} updates - Update data
 * @param {number} userId - User performing the update
 * @returns {Promise<Object>} Update result
 */
const bulkUpdatePosts = async (postIds, updates, userId) => {
  try {
    const uniqueIds = Array.from(new Set(
      (postIds || []).map(id => parseInt(id, 10)).filter(id => !Number.isNaN(id))
    ));

    if (uniqueIds.length === 0) {
      return { updatedCount: 0 };
    }

    const existingPosts = await PostMaster.findAll({
      where: { post_id: { [Op.in]: uniqueIds }, is_deleted: false },
      attributes: ['post_id']
    });

    const validIds = existingPosts.map(p => p.post_id);

    if (validIds.length === 0) {
      return { updatedCount: 0 };
    }

    const updateData = {
      updated_by: userId,
      updated_at: new Date()
    };

    if (Object.prototype.hasOwnProperty.call(updates, 'min_education_level_id')) {
      updateData.min_education_level_id = updates.min_education_level_id;
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'max_education_level_id')) {
      updateData.max_education_level_id = updates.max_education_level_id;
    }

    if (Object.keys(updateData).length > 2) {
      await PostMaster.update(updateData, {
        where: { post_id: { [Op.in]: validIds }, is_deleted: false }
      });
    }

    if (Object.prototype.hasOwnProperty.call(updates, 'allowed_category_ids') &&
        Array.isArray(updates.allowed_category_ids)) {
      for (const postId of validIds) {
        await setPostCategories(postId, updates.allowed_category_ids, userId);
      }
    }

    logger.info(`Bulk updated posts: ${validIds.join(', ')} by user ${userId}`);
    return { updatedCount: validIds.length };
  } catch (error) {
    logger.error('Error bulk updating posts:', error);
    throw error;
  }
};

/**
 * Delete post (soft delete)
 * @param {number} postId - Post ID
 * @param {number} userId - User deleting the post
 * @returns {Promise<boolean>} Success status
 */
const deletePost = async (postId, userId) => {
  try {
    const post = await PostMaster.findByPk(postId);

    if (!post) {
      return false;
    }

    if (post.is_deleted) {
      return false;
    }

    const now = new Date();

    await post.update({
      is_active: false,
      is_deleted: true,
      deleted_by: userId,
      deleted_at: now,
      updated_by: userId,
      updated_at: now
    });

    logger.info(`Post deleted: ${postId} by user ${userId}`);
    return true;
  } catch (error) {
    logger.error('Error deleting post:', error);
    throw error;
  }
};

module.exports = {
  // Post CRUD
  getPosts,
  getPostById,
  createPost,
  updatePost,
  deletePost,
  bulkUpdatePosts,
  // Post Categories
  getPostCategories,
  setPostCategories,
  addPostCategory,
  removePostCategory
};
