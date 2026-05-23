// ============================================================================
// SCHEME TYPE SERVICE
// ============================================================================
// Purpose: CRUD operations for scheme type master data
// Table: ms_scheme_types
// ============================================================================

const db = require('../../models');
const { SchemeType, sequelize } = db;
const logger = require('../../config/logger');
const { paginatedQuery } = require('../../utils/pagination');
const { Op } = require('sequelize');

// ==================== TRANSFORM FUNCTIONS ====================

const transformSchemeType = (s) => ({
  scheme_type_id: s.scheme_type_id,
  scheme_code: s.scheme_code,
  scheme_name: s.scheme_name,
  description: s.description,
  is_active: s.is_active,
  created_at: s.created_at,
  updated_at: s.updated_at
});

// ==================== CRUD OPERATIONS ====================

/**
 * Get all scheme types with optional pagination, search, and filters
 */
const getSchemeTypes = async (query = {}) => {
  try {
    const includeInactive = query.include_inactive === 'true';

    const baseWhere = { is_deleted: false };
    if (!includeInactive) {
      baseWhere.is_active = true;
    }

    return await paginatedQuery(SchemeType, {
      query,
      searchFields: ['scheme_name', 'scheme_code', 'description'],
      filterConfig: {
        is_active: { field: 'is_active', type: 'boolean' }
      },
      baseWhere,
      order: [['scheme_type_id', 'DESC']],
      dataKey: 'schemeTypes',
      transform: transformSchemeType
    });
  } catch (error) {
    logger.error('Error fetching scheme types:', error);
    throw error;
  }
};

/**
 * Get scheme type by ID
 */
const getSchemeTypeById = async (schemeTypeId) => {
  try {
    const schemeType = await SchemeType.findByPk(schemeTypeId);

    if (!schemeType) {
      return null;
    }

    return transformSchemeType(schemeType);
  } catch (error) {
    logger.error('Error fetching scheme type:', error);
    throw error;
  }
};

/**
 * Create new scheme type
 */
const createSchemeType = async (data, userId) => {
  try {
    const existing = await SchemeType.scope('withDeleted').findOne({
      where: sequelize.where(
        sequelize.fn('LOWER', sequelize.col('scheme_code')),
        sequelize.fn('LOWER', data.scheme_code)
      )
    });

    if (existing) {
      if (existing.is_deleted) {
        await existing.update({
          scheme_code: data.scheme_code,
          scheme_name: data.scheme_name,
          description: data.description || null,
          is_active: data.is_active !== undefined ? data.is_active : true,
          is_deleted: false,
          deleted_by: null,
          deleted_at: null,
          updated_by: userId,
          updated_at: new Date()
        });

        logger.info(`Scheme type restored: ${existing.scheme_type_id} by user ${userId}`);
        return transformSchemeType(existing);
      }

      const error = new Error('Scheme type with this code already exists');
      error.statusCode = 400;
      throw error;
    }

    const schemeType = await SchemeType.create({
      scheme_code: data.scheme_code,
      scheme_name: data.scheme_name,
      description: data.description || null,
      is_active: data.is_active !== undefined ? data.is_active : true,
      created_by: userId
    });

    logger.info(`Scheme type created: ${schemeType.scheme_type_id} by user ${userId}`);
    return transformSchemeType(schemeType);
  } catch (error) {
    logger.error('Error creating scheme type:', error);
    throw error;
  }
};

/**
 * Update scheme type
 */
const updateSchemeType = async (schemeTypeId, data, userId) => {
  try {
    const schemeType = await SchemeType.findByPk(schemeTypeId);

    if (!schemeType) {
      return null;
    }

    if (data.scheme_code !== undefined) {
      const existing = await SchemeType.scope('withDeleted').findOne({
        where: {
          [Op.and]: [
            sequelize.where(
              sequelize.fn('LOWER', sequelize.col('scheme_code')),
              sequelize.fn('LOWER', data.scheme_code)
            ),
            { scheme_type_id: { [Op.ne]: schemeTypeId } }
          ]
        }
      });

      if (existing) {
        const error = new Error(existing.is_deleted
          ? 'Scheme code is used by a deleted record. Restore it instead.'
          : 'Scheme type with this code already exists'
        );
        error.statusCode = 400;
        throw error;
      }
    }

    const updateData = { updated_by: userId, updated_at: new Date() };
    if (data.scheme_code !== undefined) updateData.scheme_code = data.scheme_code;
    if (data.scheme_name !== undefined) updateData.scheme_name = data.scheme_name;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.is_active !== undefined) updateData.is_active = data.is_active;

    await schemeType.update(updateData);

    logger.info(`Scheme type updated: ${schemeTypeId} by user ${userId}`);
    return transformSchemeType(schemeType);
  } catch (error) {
    logger.error('Error updating scheme type:', error);
    throw error;
  }
};

/**
 * Soft delete scheme type
 */
const deleteSchemeType = async (schemeTypeId, userId) => {
  try {
    const schemeType = await SchemeType.findByPk(schemeTypeId);
    if (!schemeType) {
      return null;
    }

    await schemeType.update({
      is_deleted: true,
      deleted_by: userId,
      deleted_at: new Date()
    });

    logger.info(`Scheme type soft deleted: ${schemeTypeId} by user ${userId}`);
    return true;
  } catch (error) {
    logger.error('Error deleting scheme type:', error);
    throw error;
  }
};

module.exports = {
  getSchemeTypes,
  getSchemeTypeById,
  createSchemeType,
  updateSchemeType,
  deleteSchemeType
};
