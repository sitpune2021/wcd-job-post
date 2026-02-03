// ============================================================================
// EXPERIENCE DOMAIN SERVICE
// ============================================================================
// Purpose: CRUD operations for experience domain master data
// Table: ms_experience_domains
// ============================================================================

const db = require('../../models');
const { ExperienceDomain, DocumentType } = db;
const logger = require('../../config/logger');
const { paginatedQuery, isPaginatedResponse } = require('../../utils/pagination');
const { localizeField } = require('./helpers');
const { Op } = require('sequelize');

// ==================== TRANSFORM FUNCTIONS ====================

/**
 * Transform experience domain record for API response
 * @param {string} language - Language code ('en' or 'mr')
 * @returns {Function} Transform function
 */
const transformExperienceDomain = (language = 'en') => (d) => ({
  domain_id: d.id,
  domain_code: d.domain_code,
  domain_name: localizeField(d, 'domain_name', language),
  domain_name_en: d.domain_name,
  domain_name_mr: d.domain_name_mr,
  description: localizeField(d, 'description', language),
  description_en: d.description,
  description_mr: d.description_mr,
  doc_type_id: d.doc_type_id || null,
  doc_type: d.documentType ? {
    doc_type_id: d.documentType.doc_type_id,
    doc_type_code: d.documentType.doc_type_code,
    doc_code: d.documentType.doc_code,
    doc_type_name: localizeField(d.documentType, 'doc_type_name', language),
    doc_type_name_en: d.documentType.doc_type_name,
    doc_type_name_mr: d.documentType.doc_type_name_mr
  } : null,
  is_active: d.is_active,
  created_at: d.created_at,
  updated_at: d.updated_at
});

// ==================== CRUD OPERATIONS ====================

/**
 * Get all experience domains with optional pagination, search, and filters
 * @param {Object} query - Query params (page, limit, search, is_active, lang)
 * @returns {Promise<Object>} Object with domains + pagination
 */
const getExperienceDomains = async (query = {}) => {
  try {
    const language = query.lang || 'en';
    const includeInactive = query.include_inactive === 'true';

    const baseWhere = {};
    if (!includeInactive) {
      baseWhere.is_active = true;
    }

    const result = await paginatedQuery(ExperienceDomain, {
      query,
      searchFields: ['domain_name', 'domain_name_mr', 'domain_code', 'description', 'description_mr'],
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
      order: [['id', 'DESC']],
      dataKey: 'domains',
      transform: transformExperienceDomain(language)
    });

    if (isPaginatedResponse(result)) {
      return result;
    }

    const total = Array.isArray(result) ? result.length : 0;
    return {
      domains: result,
      pagination: {
        total,
        page: 1,
        limit: total || result.length || 0,
        totalPages: 1
      }
    };
  } catch (error) {
    logger.error('Error fetching experience domains:', error);
    throw error;
  }
};

/**
 * Legacy function for backward compatibility
 */
const getAllExperienceDomains = async (language = 'en') => {
  return getExperienceDomains({ lang: language });
};

/**
 * Get experience domain by ID
 * @param {number} domainId - Domain ID
 * @param {string} language - Language code
 * @returns {Promise<Object|null>} Experience domain object or null
 */
const getExperienceDomainById = async (domainId, language = 'en') => {
  try {
    const domain = await ExperienceDomain.findByPk(domainId, {
      include: [
        {
          model: DocumentType,
          as: 'documentType',
          required: false,
          attributes: ['doc_type_id', 'doc_type_code', 'doc_code', 'doc_type_name', 'doc_type_name_mr']
        }
      ]
    });
    if (!domain) return null;
    return transformExperienceDomain(language)(domain);
  } catch (error) {
    logger.error('Error fetching experience domain:', error);
    throw error;
  }
};

/**
 * Create new experience domain
 * @param {Object} data - Experience domain data
 * @param {number} userId - User creating the domain
 * @returns {Promise<Object>} Created experience domain
 */
const createExperienceDomain = async (data, userId) => {
  try {
    const existing = await ExperienceDomain.scope('withDeleted').findOne({
      where: {
        [Op.and]: [
          db.sequelize.where(
            db.sequelize.fn('LOWER', db.sequelize.col('domain_code')),
            db.sequelize.fn('LOWER', data.domain_code)
          )
        ]
      }
    });

    if (existing) {
      if (existing.is_deleted) {
        await existing.update({
          doc_type_id: data.doc_type_id || null,
          domain_code: data.domain_code,
          domain_name: data.domain_name,
          domain_name_mr: data.domain_name_mr || null,
          description: data.description || null,
          description_mr: data.description_mr || null,
          is_active: data.is_active !== undefined ? data.is_active : true,
          is_deleted: false,
          deleted_by: null,
          deleted_at: null,
          updated_by: userId,
          updated_at: new Date()
        });

        logger.info(`Experience domain restored: ${existing.id}`);
        return existing;
      }

      const error = new Error('Experience domain with this code already exists');
      error.statusCode = 400;
      throw error;
    }

    const domain = await ExperienceDomain.create({
      doc_type_id: data.doc_type_id || null,
      domain_code: data.domain_code,
      domain_name: data.domain_name,
      domain_name_mr: data.domain_name_mr || null,
      description: data.description || null,
      description_mr: data.description_mr || null,
      is_active: data.is_active !== undefined ? data.is_active : true,
      created_by: userId
    });

    logger.info(`Experience domain created: ${domain.id}`);
    return domain;
  } catch (error) {
    logger.error('Error creating experience domain:', error);
    throw error;
  }
};

/**
 * Update experience domain
 * @param {number} domainId - Domain ID
 * @param {Object} data - Update data
 * @param {number} userId - User updating the domain
 * @returns {Promise<Object|null>} Updated experience domain or null
 */
const updateExperienceDomain = async (domainId, data, userId) => {
  try {
    const domain = await ExperienceDomain.findByPk(domainId);
    if (!domain) return null;

    if (data.domain_code !== undefined) {
      const existing = await ExperienceDomain.scope('withDeleted').findOne({
        where: {
          [Op.and]: [
            db.sequelize.where(
              db.sequelize.fn('LOWER', db.sequelize.col('domain_code')),
              db.sequelize.fn('LOWER', data.domain_code)
            ),
            { id: { [Op.ne]: domainId } }
          ]
        }
      });

      if (existing) {
        const error = new Error(existing.is_deleted
          ? 'Experience domain code is used by a deleted record. Restore it instead of creating/updating.'
          : 'Experience domain with this code already exists'
        );
        error.statusCode = 400;
        throw error;
      }
    }

    const updateData = { updated_by: userId, updated_at: new Date() };
    const fields = ['doc_type_id', 'domain_code', 'domain_name', 'domain_name_mr', 'description', 'description_mr', 'is_active'];
    fields.forEach(field => {
      if (data[field] !== undefined) updateData[field] = data[field];
    });

    await domain.update(updateData);
    logger.info(`Experience domain updated: ${domainId}`);
    return domain;
  } catch (error) {
    logger.error('Error updating experience domain:', error);
    throw error;
  }
};

/**
 * Delete experience domain (soft delete)
 * @param {number} domainId - Domain ID
 * @param {number} userId - User deleting the domain
 * @returns {Promise<boolean>} Success status
 */
const deleteExperienceDomain = async (domainId, userId) => {
  try {
    const domain = await ExperienceDomain.findByPk(domainId);
    if (!domain) return false;

    await domain.update({ 
      is_deleted: true,
      is_active: false, 
      deleted_by: userId,
      deleted_at: new Date() 
    });
    logger.info(`Experience domain deleted (deactivated): ${domainId}`);
    return true;
  } catch (error) {
    logger.error('Error deleting experience domain:', error);
    throw error;
  }
};

module.exports = {
  getExperienceDomains,
  getExperienceDomainById,
  createExperienceDomain,
  updateExperienceDomain,
  deleteExperienceDomain,
  getAllExperienceDomains
};
