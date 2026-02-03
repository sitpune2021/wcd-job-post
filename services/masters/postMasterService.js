// ============================================================================
// POST MASTER SERVICE
// ============================================================================
// Purpose: CRUD operations for post/job master data and post-category relationships
// Tables: ms_post_master, ms_post_categories
// ============================================================================

const db = require('../../models');
const { PostMaster, Component, CategoryMaster, PostCategory, ExperienceDomain } = db;
const { Op } = require('sequelize');
const logger = require('../../config/logger');
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
  post_code: p.post_code,
  post_name: localizeField(p, 'post_name', language),
  post_name_en: p.post_name,
  post_name_mr: p.post_name_mr,
  description: language === 'mr' && p.description_mr ? p.description_mr : p.description,
  description_en: p.description,
  description_mr: p.description_mr,
  component_id: p.component_id,
  component: p.component ? {
    component_id: p.component.component_id,
    component_code: p.component.component_code,
    component_name: localizeField(p.component, 'component_name', language)
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
  is_active: p.is_active,
  created_at: p.created_at,
  updated_at: p.updated_at,
  min_education_level_id: p.min_education_level_id,
  max_education_level_id: p.max_education_level_id
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

    const baseWhere = {};
    baseWhere.is_deleted = false;
    if (!includeInactive) {
      baseWhere.is_active = true;
    }

    const result = await paginatedQuery(PostMaster, {
      query,
      searchFields: ['post_name', 'post_name_mr', 'post_code', 'description'],
      filterConfig: {
        component_id: { field: 'component_id', type: 'number' },
        district_specific: { field: 'district_specific', type: 'boolean' },
        district_id: { field: 'district_id', type: 'number' }
      },
      include: [{
        model: Component,
        as: 'component',
        attributes: ['component_id', 'component_code', 'component_name', 'component_name_mr']
      }, {
        model: ExperienceDomain,
        as: 'experienceDomain',
        required: false,
        attributes: ['id', 'domain_code', 'domain_name', 'domain_name_mr']
      }],
      baseWhere,
      order: [['updated_at', 'DESC'], ['created_at', 'DESC'], ['post_id', 'DESC']],
      dataKey: 'posts',
      transform: transformPost(language)
    });

    const enrichWithCategories = async (postsArray) => {
      return Promise.all(postsArray.map(async (p) => {
        const categories = await getPostCategories(p.post_id, language);
        return {
          ...p,
          allowed_categories: categories,
          allowed_category_ids: categories.map(c => c.category_id)
        };
      }));
    };

    if (isPaginatedResponse(result)) {
      const enrichedPosts = await enrichWithCategories(result.posts || []);
      return {
        ...result,
        posts: enrichedPosts
      };
    }

    const postsArray = Array.isArray(result) ? result : [];
    return enrichWithCategories(postsArray);
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
      include: [{
        model: Component,
        as: 'component',
        attributes: ['component_id', 'component_code', 'component_name', 'component_name_mr']
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
      }]
    });

    if (!post) {
      return null;
    }

    if (post.is_deleted) {
      return null;
    }

    const categories = await getPostCategories(postId, language);

    return {
      post_id: post.post_id,
      post_code: post.post_code,
      post_name: localizeField(post, 'post_name', language),
      post_name_en: post.post_name,
      post_name_mr: post.post_name_mr,
      description: language === 'mr' && post.description_mr ? post.description_mr : post.description,
      description_en: post.description,
      description_mr: post.description_mr,
      component_id: post.component_id,
      component: post.component ? {
        component_id: post.component.component_id,
        component_code: post.component.component_code,
        component_name: localizeField(post.component, 'component_name', language)
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
      is_active: post.is_active,
      created_at: post.created_at,
      updated_at: post.updated_at,
      min_education_level_id: post.min_education_level_id,
      max_education_level_id: post.max_education_level_id,
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
    const minEducationLevelId = parseOptionalInt(data.min_education_level_id);
    const maxEducationLevelId = parseOptionalInt(data.max_education_level_id);
    const componentId = parseOptionalInt(data.component_id);
    const experienceDomainId = parseOptionalInt(data.experience_domain_id);
    const districtId = parseOptionalInt(data.district_id);

    const post = await PostMaster.create({
      post_code: data.post_code,
      post_name: data.post_name,
      post_name_mr: data.post_name_mr || null,
      description: data.description || null,
      description_mr: data.description_mr || null,
      component_id: componentId,
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
      opening_date: data.opening_date || null,
      closing_date: data.closing_date || null,
      total_positions: parseOptionalInt(data.total_positions) || 1,
      filled_positions: parseOptionalInt(data.filled_positions) || 0,
      display_order: parseOptionalInt(data.display_order) || 0,
      is_active: data.is_active !== undefined ? data.is_active : true,
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
      'component_id', 'min_qualification', 'min_experience_months', 'min_age', 'max_age',
      'district_specific', 'required_domains', 'eligibility_criteria',
      'opening_date', 'closing_date', 'total_positions', 'filled_positions', 'is_active'
    ];
    
    fields.forEach(field => {
      if (data[field] === undefined) return;

      if (['component_id', 'min_experience_months', 'min_age', 'max_age', 'total_positions', 'filled_positions'].includes(field)) {
        updateData[field] = parseOptionalInt(data[field]);
        return;
      }

      if (field === 'district_specific') {
        updateData[field] = parseOptionalBool(data[field]) || false;
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
