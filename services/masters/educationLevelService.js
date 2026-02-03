// ============================================================================
// EDUCATION LEVEL SERVICE
// ============================================================================
// Purpose: CRUD operations for education level master data
// Table: ms_education_levels
// ============================================================================

const db = require('../../models');
const { EducationLevel, DocumentType } = db;
const logger = require('../../config/logger');
const { paginatedQuery, isPaginatedResponse } = require('../../utils/pagination');
const { localizeField } = require('./helpers');
const { Op } = require('sequelize');

// ==================== TRANSFORM FUNCTIONS ====================

/**
 * Transform education level record for API response
 * @param {string} language - Language code ('en' or 'mr')
 * @returns {Function} Transform function
 */
const transformEducationLevel = (language = 'en') => (e) => ({
  level_id: e.level_id,
  doc_type_id: e.doc_type_id || null,
  doc_type: e.documentType ? {
    doc_type_id: e.documentType.doc_type_id,
    doc_type_code: e.documentType.doc_type_code,
    doc_code: e.documentType.doc_code,
    doc_type_name: localizeField(e.documentType, 'doc_type_name', language),
    doc_type_name_en: e.documentType.doc_type_name,
    doc_type_name_mr: e.documentType.doc_type_name_mr
  } : null,
  level_code: e.level_code,
  level_name: localizeField(e, 'level_name', language),
  level_name_en: e.level_name,
  level_name_mr: e.level_name_mr,
  description: localizeField(e, 'description', language),
  description_en: e.description,
  description_mr: e.description_mr,
  level_category: e.level_category || null,
  display_order: e.display_order,
  is_active: e.is_active,
  created_at: e.created_at,
  updated_at: e.updated_at
});

// ==================== CRUD OPERATIONS ====================

/**
 * Get all education levels with optional pagination, search, and filters
 * @param {Object} query - Query params (page, limit, search, is_active, lang)
 * @returns {Promise<Array|Object>} Array if no pagination, Object with educationLevels + pagination if paginated
 */
const getEducationLevels = async (query = {}) => {
  try {
    const language = query.lang || 'en';
    const includeInactive = query.include_inactive === 'true';

    const baseWhere = {};
    if (!includeInactive) {
      baseWhere.is_active = true;
    }

    const result = await paginatedQuery(EducationLevel, {
      query,
      searchFields: ['level_name', 'level_name_mr', 'level_code', 'description', 'description_mr', 'level_category'],
      filterConfig: {
        is_active: { field: 'is_active', type: 'boolean' }
      },
      baseWhere,
      include: [
        {
          model: DocumentType,
          as: 'documentType',
          required: false,
          attributes: ['doc_type_id', 'doc_type_code', 'doc_code', 'doc_type_name', 'doc_type_name_mr']
        }
      ],
      order: [['level_id', 'DESC']],
      dataKey: 'educationLevels',
      transform: transformEducationLevel(language)
    });

    if (isPaginatedResponse(result)) {
      return result;
    }

    const total = Array.isArray(result) ? result.length : 0;
    return {
      educationLevels: result,
      pagination: {
        total,
        page: 1,
        limit: total || result.length || 0,
        totalPages: 1
      }
    };
  } catch (error) {
    logger.error('Error fetching education levels:', error);
    throw error;
  }
};

/**
 * Get education level by ID
 * @param {number} levelId - Level ID
 * @param {string} language - Language code
 * @returns {Promise<Object|null>} Education level object or null
 */
const getEducationLevelById = async (levelId, language = 'en') => {
  try {
    const level = await EducationLevel.findByPk(levelId, {
      include: [
        {
          model: DocumentType,
          as: 'documentType',
          required: false,
          attributes: ['doc_type_id', 'doc_type_code', 'doc_code', 'doc_type_name', 'doc_type_name_mr']
        }
      ]
    });
    if (!level) return null;
    return transformEducationLevel(language)(level);
  } catch (error) {
    logger.error('Error fetching education level:', error);
    throw error;
  }
};

/**
 * Create new education level
 * @param {Object} data - Education level data
 * @param {number} userId - User creating the level
 * @returns {Promise<Object>} Created education level
 */
const createEducationLevel = async (data, userId) => {
  try {
    const existing = await EducationLevel.scope('withDeleted').findOne({
      where: {
        [Op.and]: [
          db.sequelize.where(
            db.sequelize.fn('LOWER', db.sequelize.col('level_code')),
            db.sequelize.fn('LOWER', data.level_code)
          )
        ]
      }
    });

    if (existing) {
      if (existing.is_deleted) {
        await existing.update({
          doc_type_id: data.doc_type_id || null,
          level_code: data.level_code,
          level_name: data.level_name,
          level_name_mr: data.level_name_mr || null,
          description: data.description || null,
          description_mr: data.description_mr || null,
          level_category: data.level_category || null,
          display_order: data.display_order || 0,
          is_active: data.is_active !== undefined ? data.is_active : true,
          is_deleted: false,
          deleted_by: null,
          deleted_at: null,
          updated_by: userId,
          updated_at: new Date()
        });

        logger.info(`Education level restored: ${existing.level_id}`);
        return existing;
      }

      const error = new Error('Education level with this code already exists');
      error.statusCode = 400;
      throw error;
    }

    const level = await EducationLevel.create({
      doc_type_id: data.doc_type_id || null,
      level_code: data.level_code,
      level_name: data.level_name,
      level_name_mr: data.level_name_mr || null,
      description: data.description || null,
      description_mr: data.description_mr || null,
      level_category: data.level_category || null,
      display_order: data.display_order || 0,
      is_active: data.is_active !== undefined ? data.is_active : true,
      created_by: userId
    });

    logger.info(`Education level created: ${level.level_id}`);
    return level;
  } catch (error) {
    logger.error('Error creating education level:', error);
    throw error;
  }
};

/**
 * Update education level
 * @param {number} levelId - Level ID
 * @param {Object} data - Update data
 * @param {number} userId - User updating the level
 * @returns {Promise<Object|null>} Updated education level or null
 */
const updateEducationLevel = async (levelId, data, userId) => {
  try {
    const level = await EducationLevel.findByPk(levelId);
    if (!level) return null;

    if (data.level_code !== undefined) {
      const existing = await EducationLevel.scope('withDeleted').findOne({
        where: {
          [Op.and]: [
            db.sequelize.where(
              db.sequelize.fn('LOWER', db.sequelize.col('level_code')),
              db.sequelize.fn('LOWER', data.level_code)
            ),
            { level_id: { [Op.ne]: levelId } }
          ]
        }
      });

      if (existing) {
        const error = new Error(existing.is_deleted
          ? 'Education level code is used by a deleted record. Restore it instead of creating/updating.'
          : 'Education level with this code already exists'
        );
        error.statusCode = 400;
        throw error;
      }
    }

    const updateData = { updated_at: new Date(), updated_by: userId };
    const fields = [
      'doc_type_id',
      'level_code',
      'level_name',
      'level_name_mr',
      'description',
      'description_mr',
      'level_category',
      'display_order',
      'is_active'
    ];
    fields.forEach(field => {
      if (data[field] !== undefined) updateData[field] = data[field];
    });

    await level.update(updateData);
    logger.info(`Education level updated: ${levelId}`);
    return level;
  } catch (error) {
    logger.error('Error updating education level:', error);
    throw error;
  }
};

/**
 * Delete education level (soft delete)
 * @param {number} levelId - Level ID
 * @param {number} userId - User deleting the level
 * @returns {Promise<boolean>} Success status
 */
const deleteEducationLevel = async (levelId, userId) => {
  try {
    const level = await EducationLevel.findByPk(levelId);
    if (!level) return false;

    await level.update({ 
      is_deleted: true,
      is_active: false, 
      deleted_by: userId,
      deleted_at: new Date() 
    });
    logger.info(`Education level deleted (deactivated): ${levelId}`);
    return true;
  } catch (error) {
    logger.error('Error deleting education level:', error);
    throw error;
  }
};

module.exports = {
  getEducationLevels,
  getEducationLevelById,
  createEducationLevel,
  updateEducationLevel,
  deleteEducationLevel
};
