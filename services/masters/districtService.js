// ============================================================================
// DISTRICT SERVICE
// ============================================================================
// Purpose: CRUD operations for district master data
// Table: ms_district_master
// ============================================================================

const db = require('../../models');
const { DistrictMaster, sequelize } = db;
const logger = require('../../config/logger');
const { paginatedQuery } = require('../../utils/pagination');
const { localizeField } = require('./helpers');

// ==================== TRANSFORM FUNCTIONS ====================

/**
 * Transform district record for API response
 * @param {string} language - Language code ('en' or 'mr')
 * @returns {Function} Transform function
 */
const transformDistrict = (language = 'en') => (d) => ({
  district_id: d.district_id,
  district_name: localizeField(d, 'district_name', language),
  district_name_en: d.district_name,
  district_name_mr: d.district_name_mr,
  is_active: d.is_active,
  created_at: d.created_at,
  updated_at: d.updated_at
});

// ==================== CRUD OPERATIONS ====================

/**
 * Get all districts with optional pagination, search, and filters
 * @param {Object} query - Query params (page, limit, search, is_active, lang)
 * @returns {Promise<Array|Object>} Array if no pagination, Object with districts + pagination if paginated
 */
const getDistricts = async (query = {}) => {
  try {
    const language = query.lang || 'en';
    const includeInactive = query.include_inactive === 'true';

    const baseWhere = {};
    if (!includeInactive) {
      baseWhere.is_active = true;
    }

    return await paginatedQuery(DistrictMaster, {
      query,
      searchFields: ['district_name', 'district_name_mr'],
      filterConfig: {
        is_active: { field: 'is_active', type: 'boolean' }
      },
      baseWhere,
      order: [['district_id', 'DESC']],
      dataKey: 'districts',
      transform: transformDistrict(language)
    });
  } catch (error) {
    logger.error('Error fetching districts:', error);
    throw error;
  }
};

/**
 * Legacy function for backward compatibility
 */
const getAllDistricts = async (language = 'en', includeInactive = false) => {
  return getDistricts({ lang: language, include_inactive: includeInactive ? 'true' : 'false' });
};

/**
 * Get district by ID
 * @param {number} districtId - District ID
 * @param {string} language - Language code
 * @returns {Promise<Object|null>} District object or null
 */
const getDistrictById = async (districtId, language = 'en') => {
  try {
    const district = await DistrictMaster.findByPk(districtId);

    if (!district) {
      return null;
    }

    return transformDistrict(language)(district);
  } catch (error) {
    logger.error('Error fetching district:', error);
    throw error;
  }
};

/**
 * Create new district
 * @param {Object} data - District data
 * @param {number} userId - User creating the district
 * @returns {Promise<Object>} Created district
 */
const createDistrict = async (data, userId) => {
  try {
    // Check for duplicate name (case-insensitive) among non-deleted records
    const existing = await DistrictMaster.findOne({
      where: sequelize.where(
        sequelize.fn('LOWER', sequelize.col('district_name')),
        sequelize.fn('LOWER', data.district_name)
      )
    });

    if (existing) {
      const error = new Error('District with this name already exists');
      error.statusCode = 400;
      throw error;
    }

    const district = await DistrictMaster.create({
      district_name: data.district_name,
      district_name_mr: data.district_name_mr || null,
      is_active: data.is_active !== undefined ? data.is_active : true,
      created_by: userId
    });

    logger.info(`District created: ${district.district_id} by user ${userId}`);
    return district;
  } catch (error) {
    logger.error('Error creating district:', error);
    throw error;
  }
};

/**
 * Update district
 * @param {number} districtId - District ID
 * @param {Object} data - Update data
 * @param {number} userId - User updating the district
 * @returns {Promise<Object|null>} Updated district or null
 */
const updateDistrict = async (districtId, data, userId) => {
  try {
    const district = await DistrictMaster.findByPk(districtId);

    if (!district) {
      return null;
    }

    const updateData = { updated_by: userId };
    if (data.district_name !== undefined) updateData.district_name = data.district_name;
    if (data.district_name_mr !== undefined) updateData.district_name_mr = data.district_name_mr;
    if (data.is_active !== undefined) updateData.is_active = data.is_active;

    await district.update(updateData);

    logger.info(`District updated: ${districtId} by user ${userId}`);
    return district;
  } catch (error) {
    logger.error('Error updating district:', error);
    throw error;
  }
};

/**
 * Soft delete district
 * @param {number} districtId - District ID
 * @param {number} userId - User deleting the district
 * @returns {Promise<boolean>} Success status
 */
const deleteDistrict = async (districtId, userId) => {
  try {
    const district = await DistrictMaster.findByPk(districtId);

    if (!district) {
      return false;
    }

    await district.update({
      is_deleted: true,
      is_active: false,
      deleted_by: userId,
      deleted_at: new Date()
    });

    logger.info(`District deleted: ${districtId} by user ${userId}`);
    return true;
  } catch (error) {
    logger.error('Error deleting district:', error);
    throw error;
  }
};

module.exports = {
  getDistricts,
  getDistrictById,
  createDistrict,
  updateDistrict,
  deleteDistrict,
  getAllDistricts
};
