// ============================================================================
// DOCUMENT TYPE SERVICE
// ============================================================================
// Purpose: CRUD operations for document type master data
// Table: ms_document_types
// ============================================================================

const db = require('../../models');
const { DocumentType } = db;
const { sequelize } = require('../../config/db');
const logger = require('../../config/logger');
const { paginatedQuery, isPaginatedResponse } = require('../../utils/pagination');
const { localizeField } = require('./helpers');
const { Op } = require('sequelize');

// ==================== TRANSFORM FUNCTIONS ====================

/**
 * Transform document type record for API response
 * @param {string} language - Language code ('en' or 'mr')
 * @returns {Function} Transform function
 */
const transformDocumentType = (language = 'en') => (d) => ({
  doc_type_id: d.doc_type_id,
  doc_type_code: d.doc_type_code,
  doc_code: d.doc_code,
  doc_type_name: localizeField(d, 'doc_type_name', language),
  doc_type_name_en: d.doc_type_name,
  doc_type_name_mr: d.doc_type_name_mr,
  description: localizeField(d, 'description', language),
  description_en: d.description,
  description_mr: d.description_mr,
  // Backward-compatible: treat is_mandatory as "mandatory for all" (global)
  is_mandatory: d.is_mandatory,
  is_mandatory_for_all: d.is_mandatory,
  allowed_formats: d.allowed_formats,
  max_size_mb: d.max_size_mb,
  is_active: d.is_active,
  created_at: d.created_at,
  updated_at: d.updated_at
});

// ==================== CRUD OPERATIONS ====================

/**
 * Get all document types with optional pagination, search, and filters
 * @param {Object} query - Query params (page, limit, search, is_active, lang)
 * @returns {Promise<Object>} Object with documentTypes + pagination
 */
const getDocumentTypes = async (query = {}) => {
  try {
    const language = query.lang || 'en';
    const includeInactive = query.include_inactive === 'true';

    const baseWhere = {};
    if (!includeInactive) {
      baseWhere.is_active = true;
    }

    const result = await paginatedQuery(DocumentType, {
      query,
      searchFields: ['doc_type_name', 'doc_type_name_mr', 'doc_type_code', 'doc_code', 'description', 'description_mr'],
      filterConfig: {
        is_active: { field: 'is_active', type: 'boolean' },
        // Support both query params; both map to the DB column used by required-doc API
        is_mandatory: { field: 'is_mandatory', type: 'boolean' },
        is_mandatory_for_all: { field: 'is_mandatory', type: 'boolean' }
      },
      baseWhere,
      order: [['doc_type_id', 'DESC']],
      dataKey: 'documentTypes',
      transform: transformDocumentType(language)
    });

    if (isPaginatedResponse(result)) {
      return result;
    }

    const total = Array.isArray(result) ? result.length : 0;
    return {
      documentTypes: result,
      pagination: {
        total,
        page: 1,
        limit: total || result.length || 0,
        totalPages: 1
      }
    };
  } catch (error) {
    logger.error('Error fetching document types:', error);
    throw error;
  }
};

/**
 * Legacy function for backward compatibility
 */
const getAllDocumentTypes = async (language = 'en') => {
  try {
    const [docTypes] = await sequelize.query(
      `SELECT * FROM ms_document_types WHERE is_active = true ORDER BY doc_type_name`
    );

    return docTypes.map(dt => ({
      doc_type_id: dt.doc_type_id,
      doc_type_code: dt.doc_type_code,
      doc_code: dt.doc_code,
      doc_type_name: language === 'mr' && dt.doc_type_name_mr ? dt.doc_type_name_mr : dt.doc_type_name,
      doc_type_name_en: dt.doc_type_name,
      doc_type_name_mr: dt.doc_type_name_mr,
      description: dt.description,
      is_mandatory: dt.is_mandatory,
      is_mandatory_for_all: dt.is_mandatory,
      allowed_formats: dt.allowed_formats,
      max_size_mb: dt.max_size_mb
    }));
  } catch (error) {
    logger.error('Error fetching document types:', error);
    throw error;
  }
};

/**
 * Get document type by ID
 * @param {number} docTypeId - Document type ID
 * @param {string} language - Language code
 * @returns {Promise<Object|null>} Document type object or null
 */
const getDocumentTypeById = async (docTypeId, language = 'en') => {
  try {
    const docType = await DocumentType.findByPk(docTypeId);
    if (!docType) return null;
    return transformDocumentType(language)(docType);
  } catch (error) {
    logger.error('Error fetching document type:', error);
    throw error;
  }
};

/**
 * Create new document type
 * @param {Object} data - Document type data
 * @param {number} userId - User creating the document type
 * @returns {Promise<Object>} Created document type
 */
const createDocumentType = async (data, userId) => {
  try {
    const existingByTypeCode = await DocumentType.scope('withDeleted').findOne({
      where: sequelize.where(
        sequelize.fn('LOWER', sequelize.col('doc_type_code')),
        sequelize.fn('LOWER', data.doc_type_code)
      )
    });

    if (existingByTypeCode) {
      if (existingByTypeCode.is_deleted) {
        await existingByTypeCode.update({
          doc_type_code: data.doc_type_code,
          doc_code: data.doc_code || null,
          doc_type_name: data.doc_type_name,
          doc_type_name_mr: data.doc_type_name_mr || null,
          description: data.description || null,
          description_mr: data.description_mr || null,
          is_mandatory: data.is_mandatory !== undefined ? data.is_mandatory : (data.is_mandatory_for_all || false),
          allowed_formats: data.allowed_formats || 'pdf,jpg,jpeg,png',
          max_size_mb: data.max_size_mb || 2,
          is_active: data.is_active !== undefined ? data.is_active : true,
          is_deleted: false,
          deleted_by: null,
          deleted_at: null,
          updated_by: userId,
          updated_at: new Date()
        });

        logger.info(`Document type restored: ${existingByTypeCode.doc_type_id}`);
        return existingByTypeCode;
      }

      const error = new Error('Document type with this code already exists');
      error.statusCode = 400;
      throw error;
    }

    if (data.doc_code) {
      const existingByDocCode = await DocumentType.scope('withDeleted').findOne({
        where: sequelize.where(
          sequelize.fn('LOWER', sequelize.col('doc_code')),
          sequelize.fn('LOWER', data.doc_code)
        )
      });

      if (existingByDocCode) {
        const error = new Error(existingByDocCode.is_deleted
          ? 'Document code is used by a deleted record. Restore it instead of creating a new one.'
          : 'Document code already exists'
        );
        error.statusCode = 400;
        throw error;
      }
    }

    const docType = await DocumentType.create({
      doc_type_code: data.doc_type_code,
      doc_code: data.doc_code || null,
      doc_type_name: data.doc_type_name,
      doc_type_name_mr: data.doc_type_name_mr || null,
      description: data.description || null,
      description_mr: data.description_mr || null,
      // Backward-compatible: is_mandatory controls is_mandatory_for_all
      is_mandatory: data.is_mandatory !== undefined ? data.is_mandatory : (data.is_mandatory_for_all || false),
      allowed_formats: data.allowed_formats || 'pdf,jpg,jpeg,png',
      max_size_mb: data.max_size_mb || 2,
      is_active: data.is_active !== undefined ? data.is_active : true
    });

    logger.info(`Document type created: ${docType.doc_type_id}`);
    return docType;
  } catch (error) {
    logger.error('Error creating document type:', error);
    throw error;
  }
};

/**
 * Update document type
 * @param {number} docTypeId - Document type ID
 * @param {Object} data - Update data
 * @param {number} userId - User updating the document type
 * @returns {Promise<Object|null>} Updated document type or null
 */
const updateDocumentType = async (docTypeId, data, userId) => {
  try {
    const docType = await DocumentType.findByPk(docTypeId);
    if (!docType) return null;

    if (data.doc_type_code !== undefined) {
      const existingByTypeCode = await DocumentType.scope('withDeleted').findOne({
        where: {
          [Op.and]: [
            sequelize.where(
              sequelize.fn('LOWER', sequelize.col('doc_type_code')),
              sequelize.fn('LOWER', data.doc_type_code)
            ),
            { doc_type_id: { [Op.ne]: docTypeId } }
          ]
        }
      });

      if (existingByTypeCode) {
        const error = new Error(existingByTypeCode.is_deleted
          ? 'Document type code is used by a deleted record. Restore it instead of creating/updating.'
          : 'Document type with this code already exists'
        );
        error.statusCode = 400;
        throw error;
      }
    }

    if (data.doc_code !== undefined && data.doc_code !== null && data.doc_code !== '') {
      const existingByDocCode = await DocumentType.scope('withDeleted').findOne({
        where: {
          [Op.and]: [
            sequelize.where(
              sequelize.fn('LOWER', sequelize.col('doc_code')),
              sequelize.fn('LOWER', data.doc_code)
            ),
            { doc_type_id: { [Op.ne]: docTypeId } }
          ]
        }
      });

      if (existingByDocCode) {
        const error = new Error(existingByDocCode.is_deleted
          ? 'Document code is used by a deleted record. Restore it instead of creating/updating.'
          : 'Document code already exists'
        );
        error.statusCode = 400;
        throw error;
      }
    }

    const updateData = { updated_at: new Date(), updated_by: userId };
    const fields = ['doc_type_code', 'doc_code', 'doc_type_name', 'doc_type_name_mr', 'description', 'description_mr',
                  'is_mandatory', 'allowed_formats', 'max_size_mb', 'is_active'];
  fields.forEach(field => {
    if (data[field] !== undefined) updateData[field] = data[field];
  });

  // Backward-compatible: if client sends is_mandatory_for_all, treat it as is_mandatory
  if (data.is_mandatory_for_all !== undefined && data.is_mandatory === undefined) {
    updateData.is_mandatory = data.is_mandatory_for_all;
  }

    await docType.update(updateData);
    logger.info(`Document type updated: ${docTypeId}`);
    return docType;
  } catch (error) {
    logger.error('Error updating document type:', error);
    throw error;
  }
};

/**
 * Delete document type (soft delete)
 * @param {number} docTypeId - Document type ID
 * @param {number} userId - User deleting the document type
 * @returns {Promise<boolean>} Success status
 */
const deleteDocumentType = async (docTypeId, userId) => {
  try {
    const docType = await DocumentType.findByPk(docTypeId);
    if (!docType) return false;

    await docType.update({ 
      is_deleted: true,
      is_active: false, 
      deleted_by: userId,
      deleted_at: new Date() 
    });
    logger.info(`Document type deleted (deactivated): ${docTypeId}`);
    return true;
  } catch (error) {
    logger.error('Error deleting document type:', error);
    throw error;
  }
};

module.exports = {
  getDocumentTypes,
  getDocumentTypeById,
  createDocumentType,
  updateDocumentType,
  deleteDocumentType,
  getAllDocumentTypes
};
