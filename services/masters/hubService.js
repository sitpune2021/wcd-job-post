const { Hub, DistrictMaster } = require('../../models');
const logger = require('../../config/logger');
const { paginatedQuery } = require('../../utils/pagination');

// ==================== HELPER FUNCTIONS ====================

/**
 * Localize field based on language
 */
const localizeField = (obj, fieldName, language = 'en') => {
  if (language === 'mr' && obj[`${fieldName}_mr`]) {
    return obj[`${fieldName}_mr`];
  }
  return obj[fieldName];
};

/**
 * Transform hub data for API response
 */
const transformHub = (language = 'en') => (h) => ({
  hub_id: h.hub_id,
  hub_code: h.hub_code,
  hub_name: localizeField(h, 'hub_name', language),
  hub_name_en: h.hub_name,
  hub_name_mr: h.hub_name_mr,
  description: language === 'mr' && h.description_mr ? h.description_mr : h.description,
  description_en: h.description,
  description_mr: h.description_mr,
  district_id: h.district_id,
  district: h.district ? {
    district_id: h.district.district_id,
    district_name: localizeField(h.district, 'district_name', language),
    district_name_mr: h.district.district_name_mr
  } : null,
  is_active: h.is_active,
  created_at: h.created_at,
  updated_at: h.updated_at
});

// ==================== CRUD OPERATIONS ====================

/**
 * Get all hubs with optional pagination, search, and filters
 * @param {Object} query - Query params (page, limit, search, is_active, district_id, lang)
 * @returns {Promise<Array|Object>} Array if no pagination, Object with hubs + pagination if paginated
 */
const getHubs = async (query = {}) => {
  try {
    const language = query.lang || 'en';
    const includeInactive = query.include_inactive === 'true';

    const baseWhere = { is_deleted: false };
    if (!includeInactive) {
      baseWhere.is_active = true;
    }

    return await paginatedQuery(Hub, {
      query,
      searchFields: ['hub_name', 'hub_name_mr', 'hub_code', 'description', 'description_mr'],
      filterConfig: {
        is_active: { field: 'is_active', type: 'boolean' },
        district_id: { field: 'district_id', type: 'number' }
      },
      baseWhere,
      include: [{
        model: DistrictMaster.scope('withDeleted'),
        as: 'district',
        attributes: ['district_id', 'district_name', 'district_name_mr'],
        required: false
      }],
      order: [['hub_id', 'DESC']],
      dataKey: 'hubs',
      transform: transformHub(language)
    });
  } catch (error) {
    logger.error('Error fetching hubs:', error);
    throw error;
  }
};

/**
 * Legacy function for backward compatibility
 */
const getAllHubs = async (language = 'en', includeInactive = false) => {
  return getHubs({ lang: language, include_inactive: includeInactive ? 'true' : 'false' });
};

/**
 * Get hub by ID
 * @param {number} hubId - Hub ID
 * @param {string} language - Language code
 * @returns {Promise<Object|null>} Hub object or null
 */
const getHubById = async (hubId, language = 'en') => {
  try {
    const hub = await Hub.findByPk(hubId, {
      include: [{
        model: DistrictMaster,
        as: 'district',
        attributes: ['district_id', 'district_name', 'district_name_mr'],
        required: false
      }]
    });

    if (!hub || hub.is_deleted) {
      return null;
    }

    return transformHub(language)(hub);
  } catch (error) {
    logger.error('Error fetching hub by ID:', error);
    throw error;
  }
};

/**
 * Create new hub
 * @param {Object} data - Hub data
 * @param {number} userId - User ID creating the hub
 * @returns {Promise<Object>} Created hub
 */
const createHub = async (data, userId) => {
  try {
    const hub = await Hub.create({
      hub_code: data.hub_code,
      hub_name: data.hub_name,
      hub_name_mr: data.hub_name_mr || null,
      district_id: data.district_id || null,
      description: data.description || null,
      description_mr: data.description_mr || null,
      is_active: data.is_active !== undefined ? data.is_active : true,
      created_by: userId
    });

    logger.info(`Hub created: ${hub.hub_id} by user ${userId}`);
    return await getHubById(hub.hub_id);
  } catch (error) {
    logger.error('Error creating hub:', error);
    throw error;
  }
};

/**
 * Update existing hub
 * @param {number} hubId - Hub ID
 * @param {Object} data - Updated hub data
 * @param {number} userId - User ID updating the hub
 * @returns {Promise<Object>} Updated hub
 */
const updateHub = async (hubId, data, userId) => {
  try {
    const hub = await Hub.findByPk(hubId);
    if (!hub || hub.is_deleted) {
      throw new Error('Hub not found');
    }

    const updateData = {
      updated_by: userId,
      updated_at: new Date()
    };

    const fields = [
      'hub_name', 'hub_name_mr', 'district_id', 
      'description', 'description_mr', 'is_active'
    ];

    fields.forEach(field => {
      if (data[field] !== undefined) {
        updateData[field] = data[field];
      }
    });

    await hub.update(updateData);
    logger.info(`Hub updated: ${hubId} by user ${userId}`);
    
    return await getHubById(hubId);
  } catch (error) {
    logger.error('Error updating hub:', error);
    throw error;
  }
};

/**
 * Soft delete hub
 * @param {number} hubId - Hub ID
 * @param {number} userId - User ID deleting the hub
 * @returns {Promise<boolean>} Success status
 */
const deleteHub = async (hubId, userId) => {
  try {
    const hub = await Hub.findByPk(hubId);
    if (!hub || hub.is_deleted) {
      throw new Error('Hub not found');
    }

    await hub.update({
      is_deleted: true,
      deleted_by: userId,
      deleted_at: new Date()
    });

    logger.info(`Hub soft deleted: ${hubId} by user ${userId}`);
    return true;
  } catch (error) {
    logger.error('Error deleting hub:', error);
    throw error;
  }
};

module.exports = {
  getHubs,
  getAllHubs,
  getHubById,
  createHub,
  updateHub,
  deleteHub
};
