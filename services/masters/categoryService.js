// ============================================================================
// CATEGORY SERVICE
// ============================================================================
// Purpose: CRUD operations for category master data
// Table: ms_category_master
// ============================================================================

const db = require('../../models');
const { CategoryMaster } = db;
const logger = require('../../config/logger');
const { paginatedQuery, isPaginatedResponse } = require('../../utils/pagination');
const { localizeField } = require('./helpers');
const { Op } = require('sequelize');

// ==================== TRANSFORM FUNCTIONS ====================

/**
 * Transform category record for API response
 * @param {string} language - Language code ('en' or 'mr')
 * @returns {Function} Transform function
 */
const transformCategory = (language = 'en') => (c) => ({
  category_id: c.category_id,
  category_code: c.category_code,
  category_name: localizeField(c, 'category_name', language),
  category_name_en: c.category_name,
  category_name_mr: c.category_name_mr,
  description: language === 'mr' && c.description_mr ? c.description_mr : c.description,
  description_en: c.description,
  description_mr: c.description_mr,
  display_order: c.display_order,
  is_active: c.is_active,
  created_at: c.created_at,
  updated_at: c.updated_at
});

// ==================== CRUD OPERATIONS ====================

/**
 * Get all categories with optional pagination, search, and filters
 * @param {Object} query - Query params (page, limit, search, is_active, lang)
 * @returns {Promise<Array|Object>} Array if no pagination, Object with categories + pagination if paginated
 */
const getCategories = async (query = {}) => {
  try {
    const language = query.lang || 'en';
    const includeInactive = query.include_inactive === 'true';

    const baseWhere = { is_deleted: false };
    if (!includeInactive) {
      baseWhere.is_active = true;
    }

    const result = await paginatedQuery(CategoryMaster, {
      query,
      searchFields: ['category_name', 'category_name_mr', 'category_code'],
      filterConfig: {
        is_active: { field: 'is_active', type: 'boolean' }
      },
      baseWhere,
      order: [['category_id', 'DESC']],
      dataKey: 'categories',
      transform: transformCategory(language)
    });

    if (isPaginatedResponse(result)) {
      return result;
    }

    const total = Array.isArray(result) ? result.length : 0;
    return {
      categories: result,
      pagination: {
        total,
        page: 1,
        limit: total || result.length || 0,
        totalPages: 1
      }
    };
  } catch (error) {
    logger.error('Error fetching categories:', error);
    throw error;
  }
};

/**
 * Legacy function for backward compatibility
 */
const getAllCategories = async (language = 'en', includeInactive = false) => {
  return getCategories({ lang: language, include_inactive: includeInactive ? 'true' : 'false' });
};

/**
 * Get category by ID
 * @param {number} categoryId - Category ID
 * @param {string} language - Language code
 * @returns {Promise<Object|null>} Category object or null
 */
const getCategoryById = async (categoryId, language = 'en') => {
  try {
    const category = await CategoryMaster.findOne({
      where: { category_id: categoryId, is_deleted: false }
    });
    if (!category) return null;
    return transformCategory(language)(category);
  } catch (error) {
    logger.error('Error fetching category:', error);
    throw error;
  }
};

/**
 * Get category by code
 * @param {string} categoryCode - Category code
 * @param {string} language - Language code
 * @returns {Promise<Object|null>} Category object or null
 */
const getCategoryByCode = async (categoryCode, language = 'en') => {
  try {
    const category = await CategoryMaster.findOne({
      where: { category_code: categoryCode.toUpperCase(), is_deleted: false }
    });
    if (!category) return null;
    return transformCategory(language)(category);
  } catch (error) {
    logger.error('Error fetching category by code:', error);
    throw error;
  }
};

/**
 * Create new category
 * @param {Object} data - Category data
 * @param {number} userId - User creating the category
 * @returns {Promise<Object>} Created category
 */
const createCategory = async (data, userId) => {
  try {
    const categoryCode = data.category_code.toUpperCase();

    const existing = await CategoryMaster.scope('withDeleted').findOne({
      where: { category_code: categoryCode }
    });

    if (existing) {
      if (existing.is_deleted) {
        await existing.update({
          category_name: data.category_name,
          category_name_mr: data.category_name_mr || null,
          description: data.description || null,
          description_mr: data.description_mr || null,
          display_order: data.display_order || 0,
          is_active: data.is_active !== undefined ? data.is_active : true,
          is_deleted: false,
          deleted_by: null,
          deleted_at: null,
          updated_by: userId,
          updated_at: new Date()
        });

        logger.info(`Category restored: ${existing.category_id} by user ${userId}`);
        return existing;
      }

      const error = new Error('Category with this code already exists');
      error.statusCode = 400;
      throw error;
    }

    const category = await CategoryMaster.create({
      category_code: categoryCode,
      category_name: data.category_name,
      category_name_mr: data.category_name_mr || null,
      description: data.description || null,
      description_mr: data.description_mr || null,
      display_order: data.display_order || 0,
      is_active: data.is_active !== undefined ? data.is_active : true,
      created_by: userId
    });

    logger.info(`Category created: ${category.category_id} by user ${userId}`);
    return category;
  } catch (error) {
    logger.error('Error creating category:', error);
    throw error;
  }
};

/**
 * Update category
 * @param {number} categoryId - Category ID
 * @param {Object} data - Update data
 * @param {number} userId - User updating the category
 * @returns {Promise<Object|null>} Updated category or null
 */
const updateCategory = async (categoryId, data, userId) => {
  try {
    const category = await CategoryMaster.findOne({
      where: { category_id: categoryId, is_deleted: false }
    });
    if (!category) return null;

    if (data.category_code !== undefined) {
      const nextCode = data.category_code.toUpperCase();
      const existing = await CategoryMaster.scope('withDeleted').findOne({
        where: {
          category_code: nextCode,
          category_id: { [Op.ne]: categoryId }
        }
      });

      if (existing) {
        const error = new Error(existing.is_deleted
          ? 'Category code is used by a deleted record. Restore it instead of creating/updating.'
          : 'Category with this code already exists'
        );
        error.statusCode = 400;
        throw error;
      }
    }

    const updateData = { updated_by: userId, updated_at: new Date() };
    const fields = ['category_code', 'category_name', 'category_name_mr', 'description', 'description_mr', 'display_order', 'is_active'];
    fields.forEach(field => {
      if (data[field] !== undefined) {
        updateData[field] = field === 'category_code' ? data[field].toUpperCase() : data[field];
      }
    });

    await category.update(updateData);
    logger.info(`Category updated: ${categoryId} by user ${userId}`);
    return category;
  } catch (error) {
    logger.error('Error updating category:', error);
    throw error;
  }
};

/**
 * Delete category (soft delete)
 * @param {number} categoryId - Category ID
 * @param {number} userId - User deleting the category
 * @returns {Promise<boolean>} Success status
 */
const deleteCategory = async (categoryId, userId) => {
  try {
    const category = await CategoryMaster.findOne({
      where: { category_id: categoryId, is_deleted: false }
    });
    if (!category) return false;

    await category.update({
      is_deleted: true,
      is_active: false,
      deleted_by: userId,
      deleted_at: new Date(),
      updated_at: new Date()
    });
    logger.info(`Category deleted: ${categoryId} by user ${userId}`);
    return true;
  } catch (error) {
    logger.error('Error deleting category:', error);
    throw error;
  }
};

module.exports = {
  getCategories,
  getCategoryById,
  getCategoryByCode,
  createCategory,
  updateCategory,
  deleteCategory,
  getAllCategories
};
