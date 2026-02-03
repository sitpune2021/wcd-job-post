// ============================================================================
// APPLICATION STATUS SERVICE
// ============================================================================
// Purpose: CRUD operations for application status master data
// Table: ms_application_statuses
// ============================================================================

const db = require('../../models');
const { ApplicationStatus } = db;
const { sequelize } = require('../../config/db');
const logger = require('../../config/logger');
const { paginatedQuery, isPaginatedResponse } = require('../../utils/pagination');
const { localizeField } = require('./helpers');

// ==================== TRANSFORM FUNCTIONS ====================

/**
 * Transform application status record for API response
 * @param {string} language - Language code ('en' or 'mr')
 * @returns {Function} Transform function
 */
const transformApplicationStatus = (language = 'en') => (s) => ({
  status_id: s.status_id,
  status_code: s.status_code,
  status_name: localizeField(s, 'status_name', language),
  status_name_en: s.status_name,
  status_name_mr: s.status_name_mr,
  description: localizeField(s, 'description', language),
  description_en: s.description,
  description_mr: s.description_mr,
  display_order: s.display_order,
  is_active: s.is_active,
  created_at: s.created_at
});

// ==================== CRUD OPERATIONS ====================

/**
 * Get all application statuses with optional pagination, search, and filters
 * @param {Object} query - Query params (page, limit, search, is_active, lang)
 * @returns {Promise<Object>} Object with statuses + pagination
 */
const getApplicationStatuses = async (query = {}) => {
  try {
    const language = query.lang || 'en';
    const includeInactive = query.include_inactive === 'true';

    const baseWhere = {};
    if (!includeInactive) {
      baseWhere.is_active = true;
    }

    const result = await paginatedQuery(ApplicationStatus, {
      query,
      searchFields: ['status_name', 'status_name_mr', 'status_code', 'description', 'description_mr'],
      filterConfig: {
        is_active: { field: 'is_active', type: 'boolean' }
      },
      baseWhere,
      order: [['display_order', 'ASC']],
      dataKey: 'statuses',
      transform: transformApplicationStatus(language)
    });

    if (isPaginatedResponse(result)) {
      return result;
    }

    const total = Array.isArray(result) ? result.length : 0;
    return {
      statuses: result,
      pagination: {
        total,
        page: 1,
        limit: total || result.length || 0,
        totalPages: 1
      }
    };
  } catch (error) {
    logger.error('Error fetching application statuses:', error);
    throw error;
  }
};

/**
 * Legacy function for backward compatibility
 */
const getAllApplicationStatuses = async (language = 'en') => {
  try {
    const [statuses] = await sequelize.query(
      `SELECT * FROM ms_application_statuses WHERE is_active = true ORDER BY display_order`
    );

    return statuses.map(s => ({
      status_id: s.status_id,
      status_code: s.status_code,
      status_name: language === 'mr' && s.status_name_mr ? s.status_name_mr : s.status_name,
      status_name_en: s.status_name,
      status_name_mr: s.status_name_mr,
      description: language === 'mr' && s.description_mr ? s.description_mr : s.description,
      description_en: s.description,
      description_mr: s.description_mr,
      display_order: s.display_order
    }));
  } catch (error) {
    logger.error('Error fetching application statuses:', error);
    throw error;
  }
};

/**
 * Get application status by ID
 * @param {number} statusId - Status ID
 * @param {string} language - Language code
 * @returns {Promise<Object|null>} Application status object or null
 */
const getApplicationStatusById = async (statusId, language = 'en') => {
  try {
    const status = await ApplicationStatus.findByPk(statusId);
    if (!status) return null;
    return transformApplicationStatus(language)(status);
  } catch (error) {
    logger.error('Error fetching application status:', error);
    throw error;
  }
};

/**
 * Create new application status
 * @param {Object} data - Application status data
 * @param {number} userId - User creating the status
 * @returns {Promise<Object>} Created application status
 */
const createApplicationStatus = async (data, userId) => {
  try {
    const status = await ApplicationStatus.create({
      status_code: data.status_code,
      status_name: data.status_name,
      status_name_mr: data.status_name_mr || null,
      description: data.description || null,
      description_mr: data.description_mr || null,
      display_order: data.display_order || 0,
      is_active: data.is_active !== undefined ? data.is_active : true
    });

    logger.info(`Application status created: ${status.status_id}`);
    return status;
  } catch (error) {
    logger.error('Error creating application status:', error);
    throw error;
  }
};

/**
 * Update application status
 * @param {number} statusId - Status ID
 * @param {Object} data - Update data
 * @param {number} userId - User updating the status
 * @returns {Promise<Object|null>} Updated application status or null
 */
const updateApplicationStatus = async (statusId, data, userId) => {
  try {
    const status = await ApplicationStatus.findByPk(statusId);
    if (!status) return null;

    const updateData = {};
    const fields = ['status_code', 'status_name', 'status_name_mr', 'description', 'description_mr', 'display_order', 'is_active'];
    fields.forEach(field => {
      if (data[field] !== undefined) updateData[field] = data[field];
    });

    await status.update(updateData);
    logger.info(`Application status updated: ${statusId}`);
    return status;
  } catch (error) {
    logger.error('Error updating application status:', error);
    throw error;
  }
};

/**
 * Delete application status (soft delete)
 * @param {number} statusId - Status ID
 * @param {number} userId - User deleting the status
 * @returns {Promise<boolean>} Success status
 */
const deleteApplicationStatus = async (statusId, userId) => {
  try {
    const status = await ApplicationStatus.findByPk(statusId);
    if (!status) return false;

    await status.update({ is_active: false });
    logger.info(`Application status deleted (deactivated): ${statusId}`);
    return true;
  } catch (error) {
    logger.error('Error deleting application status:', error);
    throw error;
  }
};

module.exports = {
  getApplicationStatuses,
  getApplicationStatusById,
  createApplicationStatus,
  updateApplicationStatus,
  deleteApplicationStatus,
  getAllApplicationStatuses
};
