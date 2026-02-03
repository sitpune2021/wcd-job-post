// ============================================================================
// BANNER SERVICE
// ============================================================================
// Purpose: CRUD operations for banner master data
// Table: ms_banner_master
// ============================================================================

const db = require('../../models');
const { BannerMaster, sequelize } = db;
const logger = require('../../config/logger');
const { paginatedQuery } = require('../../utils/pagination');

// ==================== TRANSFORM FUNCTIONS ====================

/**
 * Transform banner record for API response
 * @returns {Function} Transform function
 */
const transformBanner = () => (b) => ({
  banner_id: b.banner_id,
  banner_image_path: b.banner_image_path,
  banner_image_path_mr: b.banner_image_path_mr,
  display_order: b.display_order,
  is_active: b.is_active,
  created_at: b.created_at,
  updated_at: b.updated_at
});

// ==================== CRUD OPERATIONS ====================

/**
 * Get all banners with optional pagination, search, and filters
 * @param {Object} query - Query params (page, limit, search, is_active)
 * @returns {Promise<Array|Object>} Array if no pagination, Object with banners + pagination if paginated
 */
const getBanners = async (query = {}) => {
  try {
    const includeInactive = query.include_inactive === 'true';

    const baseWhere = {};
    if (!includeInactive) {
      baseWhere.is_active = true;
    }

    return await paginatedQuery(BannerMaster, {
      query,
      searchFields: [],
      filterConfig: {
        is_active: { field: 'is_active', type: 'boolean' }
      },
      baseWhere,
      order: [['display_order', 'ASC'], ['banner_id', 'DESC']],
      dataKey: 'banners',
      transform: transformBanner()
    });
  } catch (error) {
    logger.error('Error fetching banners:', error);
    throw error;
  }
};

/**
 * Get active banners only (for public API)
 * @returns {Promise<Array>} Array of active banners
 */
const getActiveBanners = async () => {
  try {
    const banners = await BannerMaster.scope('onlyActive').findAll({
      order: [['display_order', 'ASC'], ['banner_id', 'DESC']]
    });

    return banners.map(transformBanner());
  } catch (error) {
    logger.error('Error fetching active banners:', error);
    throw error;
  }
};

/**
 * Get banner by ID
 * @param {number} bannerId - Banner ID
 * @returns {Promise<Object|null>} Banner object or null
 */
const getBannerById = async (bannerId) => {
  try {
    const banner = await BannerMaster.findByPk(bannerId);

    if (!banner) {
      return null;
    }

    return transformBanner()(banner);
  } catch (error) {
    logger.error('Error fetching banner:', error);
    throw error;
  }
};

/**
 * Create new banner
 * @param {Object} data - Banner data
 * @param {number} userId - User creating the banner
 * @returns {Promise<Object>} Created banner
 */
const createBanner = async (data, userId) => {
  try {
    const banner = await BannerMaster.create({
      banner_image_path: data.banner_image_path,
      banner_image_path_mr: data.banner_image_path_mr || null,
      display_order: data.display_order || 0,
      is_active: data.is_active !== undefined ? data.is_active : true,
      created_by: userId
    });

    logger.info(`Banner created: ${banner.banner_id} by user ${userId}`);
    return banner;
  } catch (error) {
    logger.error('Error creating banner:', error);
    throw error;
  }
};

/**
 * Update banner
 * @param {number} bannerId - Banner ID
 * @param {Object} data - Update data
 * @param {number} userId - User updating the banner
 * @returns {Promise<Object|null>} Updated banner or null
 */
const updateBanner = async (bannerId, data, userId) => {
  try {
    const banner = await BannerMaster.findByPk(bannerId);

    if (!banner) {
      return null;
    }

    const updateData = { updated_by: userId };
    if (data.banner_image_path !== undefined) updateData.banner_image_path = data.banner_image_path;
    if (data.banner_image_path_mr !== undefined) updateData.banner_image_path_mr = data.banner_image_path_mr;
    if (data.display_order !== undefined) updateData.display_order = data.display_order;
    if (data.is_active !== undefined) updateData.is_active = data.is_active;

    await banner.update(updateData);

    logger.info(`Banner updated: ${bannerId} by user ${userId}`);
    return banner;
  } catch (error) {
    logger.error('Error updating banner:', error);
    throw error;
  }
};

/**
 * Soft delete banner
 * @param {number} bannerId - Banner ID
 * @param {number} userId - User deleting the banner
 * @returns {Promise<boolean>} Success status
 */
const deleteBanner = async (bannerId, userId) => {
  try {
    const banner = await BannerMaster.findByPk(bannerId);

    if (!banner) {
      return false;
    }

    await banner.update({
      is_deleted: true,
      is_active: false,
      deleted_by: userId,
      deleted_at: new Date()
    });

    logger.info(`Banner deleted: ${bannerId} by user ${userId}`);
    return true;
  } catch (error) {
    logger.error('Error deleting banner:', error);
    throw error;
  }
};

module.exports = {
  getBanners,
  getActiveBanners,
  getBannerById,
  createBanner,
  updateBanner,
  deleteBanner
};
