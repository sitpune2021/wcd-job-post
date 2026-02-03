// ============================================================================
// TALUKA SERVICE
// ============================================================================
// Purpose: CRUD operations for taluka master data
// Table: ms_taluka_master
// ============================================================================

const db = require('../../models');
const { TalukaMaster, DistrictMaster, sequelize } = db;
const { Op } = require('sequelize');
const logger = require('../../config/logger');
const { paginatedQuery } = require('../../utils/pagination');
const { localizeField } = require('./helpers');

// ==================== TRANSFORM FUNCTIONS ====================

/**
 * Transform taluka record for API response
 * @param {string} language - Language code ('en' or 'mr')
 * @returns {Function} Transform function
 */
const transformTaluka = (language = 'en') => (t) => ({
  taluka_id: t.taluka_id,
  taluka_name: localizeField(t, 'taluka_name', language),
  taluka_name_en: t.taluka_name,
  taluka_name_mr: t.taluka_name_mr,
  district_id: t.district_id,
  district_name: t.district ? localizeField(t.district, 'district_name', language) : null,
  district: t.district ? {
    district_id: t.district.district_id,
    district_name: localizeField(t.district, 'district_name', language),
    district_name_en: t.district.district_name,
    district_name_mr: t.district.district_name_mr
  } : null,
  is_active: t.is_active,
  created_at: t.created_at,
  updated_at: t.updated_at
});

// ==================== CRUD OPERATIONS ====================

/**
 * Get all talukas with optional pagination, search, and filters
 * @param {Object} query - Query params (page, limit, search, district_id, is_active, lang)
 * @returns {Promise<Array|Object>} Array if no pagination, Object with talukas + pagination if paginated
 */
const getTalukas = async (query = {}) => {
  try {
    const language = query.lang || 'en';
    const includeInactive = query.include_inactive === 'true';

    const baseWhere = {};
    if (!includeInactive) {
      baseWhere.is_active = true;
    }
    if (query.district_id) {
      baseWhere.district_id = parseInt(query.district_id, 10);
    }

    // Build custom where clause for district name search
    const where = { ...baseWhere };
    const searchTerm = query.search ? query.search.trim() : '';
    
    if (searchTerm) {
      // Search in taluka name OR district name
      where[Op.or] = [
        { taluka_name: { [Op.iLike]: `%${searchTerm}%` } },
        { taluka_name_mr: { [Op.iLike]: `%${searchTerm}%` } },
        { '$district.district_name$': { [Op.iLike]: `%${searchTerm}%` } },
        { '$district.district_name_mr$': { [Op.iLike]: `%${searchTerm}%` } }
      ];
    }

    return await paginatedQuery(TalukaMaster, {
      query: { ...query, search: '' }, // Clear search since we handle it manually
      searchFields: [], // Disable default search
      filterConfig: {
        is_active: { field: 'is_active', type: 'boolean' },
        district_id: { field: 'district_id', type: 'number' }
      },
      include: [{
        model: DistrictMaster,
        as: 'district',
        attributes: ['district_id', 'district_name', 'district_name_mr'],
        required: false
      }],
      baseWhere: where,
      order: [['taluka_id', 'DESC']],
      dataKey: 'talukas',
      transform: transformTaluka(language)
    });
  } catch (error) {
    logger.error('Error fetching talukas:', error);
    throw error;
  }
};

/**
 * Legacy function for backward compatibility
 */
const getAllTalukas = async (districtId = null, language = 'en', includeInactive = false) => {
  return getTalukas({
    district_id: districtId,
    lang: language,
    include_inactive: includeInactive ? 'true' : 'false'
  });
};

/**
 * Get taluka by ID
 * @param {number} talukaId - Taluka ID
 * @param {string} language - Language code
 * @returns {Promise<Object|null>} Taluka object or null
 */
const getTalukaById = async (talukaId, language = 'en') => {
  try {
    const taluka = await TalukaMaster.findByPk(talukaId, {
      include: [{
        model: DistrictMaster,
        as: 'district',
        attributes: ['district_id', 'district_name', 'district_name_mr']
      }]
    });

    if (!taluka) {
      return null;
    }

    return {
      taluka_id: taluka.taluka_id,
      taluka_name: localizeField(taluka, 'taluka_name', language),
      taluka_name_en: taluka.taluka_name,
      taluka_name_mr: taluka.taluka_name_mr,
      district_id: taluka.district_id,
      district_name: taluka.district ? localizeField(taluka.district, 'district_name', language) : null,
      is_active: taluka.is_active,
      created_at: taluka.created_at,
      updated_at: taluka.updated_at
    };
  } catch (error) {
    logger.error('Error fetching taluka:', error);
    throw error;
  }
};

/**
 * Create new taluka
 * @param {Object} data - Taluka data
 * @param {number} userId - User creating the taluka
 * @returns {Promise<Object>} Created taluka
 */
const createTaluka = async (data, userId) => {
  try {
    // Check for duplicate name within same district (case-insensitive)
    const existing = await TalukaMaster.findOne({
      where: {
        district_id: data.district_id,
        [sequelize.Op ? sequelize.Op.and : 'and']: sequelize.where(
          sequelize.fn('LOWER', sequelize.col('taluka_name')),
          sequelize.fn('LOWER', data.taluka_name)
        )
      }
    });

    if (existing) {
      const error = new Error('Taluka with this name already exists in the selected district');
      error.statusCode = 400;
      throw error;
    }

    const taluka = await TalukaMaster.create({
      taluka_name: data.taluka_name,
      taluka_name_mr: data.taluka_name_mr || null,
      district_id: data.district_id,
      is_active: data.is_active !== undefined ? data.is_active : true,
      created_by: userId
    });

    logger.info(`Taluka created: ${taluka.taluka_id} by user ${userId}`);
    return taluka;
  } catch (error) {
    logger.error('Error creating taluka:', error);
    throw error;
  }
};

/**
 * Update taluka
 * @param {number} talukaId - Taluka ID
 * @param {Object} data - Update data
 * @param {number} userId - User updating the taluka
 * @returns {Promise<Object|null>} Updated taluka or null
 */
const updateTaluka = async (talukaId, data, userId) => {
  try {
    const taluka = await TalukaMaster.findByPk(talukaId);

    if (!taluka) {
      return null;
    }

    const updateData = { updated_by: userId };
    if (data.taluka_name !== undefined) updateData.taluka_name = data.taluka_name;
    if (data.taluka_name_mr !== undefined) updateData.taluka_name_mr = data.taluka_name_mr;
    if (data.district_id !== undefined) updateData.district_id = data.district_id;
    if (data.is_active !== undefined) updateData.is_active = data.is_active;

    await taluka.update(updateData);

    logger.info(`Taluka updated: ${talukaId} by user ${userId}`);
    return taluka;
  } catch (error) {
    logger.error('Error updating taluka:', error);
    throw error;
  }
};

/**
 * Soft delete taluka
 * @param {number} talukaId - Taluka ID
 * @param {number} userId - User deleting the taluka
 * @returns {Promise<boolean>} Success status
 */
const deleteTaluka = async (talukaId, userId) => {
  try {
    const taluka = await TalukaMaster.findByPk(talukaId);

    if (!taluka) {
      return false;
    }

    await taluka.update({
      is_deleted: true,
      is_active: false,
      deleted_by: userId,
      deleted_at: new Date()
    });

    logger.info(`Taluka deleted: ${talukaId} by user ${userId}`);
    return true;
  } catch (error) {
    logger.error('Error deleting taluka:', error);
    throw error;
  }
};

module.exports = {
  getTalukas,
  getTalukaById,
  createTaluka,
  updateTaluka,
  deleteTaluka,
  getAllTalukas
};
