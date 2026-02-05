// ============================================================================
// COMPONENT SERVICE
// ============================================================================
// Purpose: CRUD operations for component master data
// Table: ms_component_master
// ============================================================================

const db = require('../../models');
const { Component, DistrictMaster, sequelize } = db;
const logger = require('../../config/logger');
const { paginatedQuery } = require('../../utils/pagination');
const { localizeField } = require('./helpers');
const { Op } = require('sequelize');

// ==================== TRANSFORM FUNCTIONS ====================

/**
 * Transform component record for API response
 * @param {string} language - Language code ('en' or 'mr')
 * @returns {Function} Transform function
 */
const transformComponent = (language = 'en') => (c) => ({
  component_id: c.component_id,
  component_code: c.component_code,
  component_name: localizeField(c, 'component_name', language),
  component_name_en: c.component_name,
  component_name_mr: c.component_name_mr,
  description: c.description,
  description_mr: c.description_mr,
  district_id: c.district_id || null,
  district: c.district ? {
    district_id: c.district.district_id,
    district_name: localizeField(c.district, 'district_name', language),
    district_name_mr: c.district.district_name_mr
  } : null,
  is_active: c.is_active,
  created_at: c.created_at,
  updated_at: c.updated_at
});

// ==================== CRUD OPERATIONS ====================

/**
 * Get all components with optional pagination, search, and filters
 * @param {Object} query - Query params (page, limit, search, is_active, lang)
 * @returns {Promise<Array|Object>} Array if no pagination, Object with components + pagination if paginated
 */
const getComponents = async (query = {}) => {
  try {
    const language = query.lang || 'en';
    const includeInactive = query.include_inactive === 'true';

    const baseWhere = { is_deleted: false };
    if (!includeInactive) {
      baseWhere.is_active = true;
    }

    return await paginatedQuery(Component, {
      query,
      searchFields: ['component_name', 'component_name_mr', 'component_code', 'description', 'description_mr'],
      filterConfig: {
        is_active: { field: 'is_active', type: 'boolean' },
        district_id: { field: 'district_id', type: 'number' }
      },
      baseWhere,
      include: [{
        model: DistrictMaster.scope('withDeleted'), // Include deleted districts
        as: 'district',
        attributes: ['district_id', 'district_name', 'district_name_mr'],
        required: false // LEFT JOIN instead of INNER JOIN
      }],
      order: [['component_id', 'DESC']],
      dataKey: 'components',
      transform: transformComponent(language)
    });
  } catch (error) {
    logger.error('Error fetching components:', error);
    throw error;
  }
};

/**
 * Legacy function for backward compatibility
 */
const getAllComponents = async (language = 'en', includeInactive = false) => {
  return getComponents({ lang: language, include_inactive: includeInactive ? 'true' : 'false' });
};

/**
 * Get component by ID
 * @param {number} componentId - Component ID
 * @param {string} language - Language code
 * @returns {Promise<Object|null>} Component object or null
 */
const getComponentById = async (componentId, language = 'en') => {
  try {
    const component = await Component.findByPk(componentId, {
      include: [{
        model: DistrictMaster,
        as: 'district',
        attributes: ['district_id', 'district_name', 'district_name_mr']
      }]
    });

    if (!component) {
      return null;
    }

    return transformComponent(language)(component);
  } catch (error) {
    logger.error('Error fetching component:', error);
    throw error;
  }
};

/**
 * Create new component
 * @param {Object} data - Component data
 * @param {number} userId - User creating the component
 * @returns {Promise<Object>} Created component
 */
const createComponent = async (data, userId) => {
  try {
    const existing = await Component.scope('withDeleted').findOne({
      where: sequelize.where(
        sequelize.fn('LOWER', sequelize.col('component_code')),
        sequelize.fn('LOWER', data.component_code)
      )
    });

    if (existing) {
      if (existing.is_deleted) {
        await existing.update({
          component_code: data.component_code,
          component_name: data.component_name,
          component_name_mr: data.component_name_mr || null,
          description: data.description || null,
          is_active: data.is_active !== undefined ? data.is_active : true,
          is_deleted: false,
          deleted_by: null,
          deleted_at: null,
          updated_by: userId,
          updated_at: new Date()
        });

        logger.info(`Component restored: ${existing.component_id} by user ${userId}`);
        return existing;
      }

      const error = new Error('Component with this code already exists');
      error.statusCode = 400;
      throw error;
    }

    const component = await Component.create({
      component_code: data.component_code,
      component_name: data.component_name,
      component_name_mr: data.component_name_mr || null,
      description: data.description || null,
      description_mr: data.description_mr || null,
      district_id: data.district_id || null,
      is_active: data.is_active !== undefined ? data.is_active : true,
      created_by: userId
    });

    logger.info(`Component created: ${component.component_id} by user ${userId}`);
    return component;
  } catch (error) {
    logger.error('Error creating component:', error);
    throw error;
  }
};

/**
 * Update component
 * @param {number} componentId - Component ID
 * @param {Object} data - Update data
 * @param {number} userId - User updating the component
 * @returns {Promise<Object|null>} Updated component or null
 */
const updateComponent = async (componentId, data, userId) => {
  try {
    const component = await Component.findByPk(componentId);

    if (!component) {
      return null;
    }

    if (data.component_code !== undefined) {
      const existing = await Component.scope('withDeleted').findOne({
        where: {
          [Op.and]: [
            sequelize.where(
              sequelize.fn('LOWER', sequelize.col('component_code')),
              sequelize.fn('LOWER', data.component_code)
            ),
            { component_id: { [Op.ne]: componentId } }
          ]
        }
      });

      if (existing) {
        const error = new Error(existing.is_deleted
          ? 'Component code is used by a deleted record. Restore it instead of creating/updating.'
          : 'Component with this code already exists'
        );
        error.statusCode = 400;
        throw error;
      }
    }

    const updateData = { updated_by: userId, updated_at: new Date() };
    if (data.component_code !== undefined) updateData.component_code = data.component_code;
    if (data.component_name !== undefined) updateData.component_name = data.component_name;
    if (data.component_name_mr !== undefined) updateData.component_name_mr = data.component_name_mr;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.description_mr !== undefined) updateData.description_mr = data.description_mr;
    if (data.district_id !== undefined) updateData.district_id = data.district_id || null;
    if (data.is_active !== undefined) updateData.is_active = data.is_active;

    await component.update(updateData);

    logger.info(`Component updated: ${componentId} by user ${userId}`);
    return component;
  } catch (error) {
    logger.error('Error updating component:', error);
    throw error;
  }
};

/**
 * Delete component (soft delete by deactivating)
 * @param {number} componentId - Component ID
 * @param {number} userId - User deleting the component
 * @returns {Promise<boolean>} Success status
 */
const deleteComponent = async (componentId, userId) => {
  try {
    const component = await Component.findByPk(componentId);

    if (!component) {
      return false;
    }

    await component.update({
      is_deleted: true,
      is_active: false,
      deleted_by: userId,
      deleted_at: new Date()
    });

    logger.info(`Component deleted: ${componentId} by user ${userId}`);
    return true;
  } catch (error) {
    logger.error('Error deleting component:', error);
    throw error;
  }
};

module.exports = {
  getComponents,
  getComponentById,
  createComponent,
  updateComponent,
  deleteComponent,
  getAllComponents
};
