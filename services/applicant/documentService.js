// ============================================================================
// APPLICANT DOCUMENT SERVICE
// ============================================================================
// Purpose: Document upload and management for applicants
// Table: ms_applicant_documents
// ============================================================================

const db = require('../../models');
const { ApplicantDocument, DocumentType, ApplicantPersonal, PostDocumentRequirement, EducationLevel, ExperienceDomain } = db;
const logger = require('../../config/logger');
const { ApiError } = require('../../middleware/errorHandler');
const { Op } = require('sequelize');
const path = require('path');
const fs = require('fs');
const { getRelativePath, getAbsolutePath } = require('../../utils/fileUpload');

// ==================== HELPER FUNCTIONS ====================

const toPublicUploadPath = (filePath) => {
  if (!filePath) return null;
  const rel = getRelativePath(filePath).replace(/\\/g, '/');
  return '/' + rel.replace(/^\/+/, '');
};

// ==================== DOCUMENT CRUD OPERATIONS ====================

/**
 * Save document record
 * @param {number} applicantId - Applicant ID
 * @param {Object} fileData - File data from multer
 * @param {Object} docTypeInfo - Document type info { doc_type_id, doc_type }
 * @returns {Promise<Object>} - Saved document
 */
const saveDocument = async (applicantId, fileData, docTypeInfo) => {
  try {
    const { doc_type_id, doc_type } = docTypeInfo;

    // If only doc_type_id is provided, resolve doc_type from DocumentType
    let finalDocType = doc_type;
    if (doc_type_id && !finalDocType) {
      const docTypeRow = await DocumentType.findByPk(doc_type_id);
      if (!docTypeRow) {
        throw new ApiError(400, 'Invalid document type ID');
      }
      finalDocType = docTypeRow.doc_type_code || docTypeRow.doc_type_name || `DOC_${doc_type_id}`;
    }

    // Build where clause for checking existing
    const whereClause = { applicant_id: applicantId };
    if (doc_type_id) {
      whereClause.doc_type_id = doc_type_id;
    } else {
      whereClause.doc_type = finalDocType;
    }

    // Check if document of this type already exists
    const existing = await ApplicantDocument.findOne({ where: whereClause });

    // Compute a DB-safe relative path for the new upload
    const relativePath = getRelativePath(fileData.path).replace(/\\/g, '/');

    if (existing) {
      // Delete old file
      if (existing.file_path) {
        const oldFsPath = path.isAbsolute(existing.file_path)
          ? existing.file_path
          : getAbsolutePath(existing.file_path);

        if (fs.existsSync(oldFsPath)) {
          fs.unlinkSync(oldFsPath);
        }
      }
      
      // Update record
      await existing.update({
        doc_type: finalDocType || existing.doc_type,
        file_name: fileData.filename,
        file_path: relativePath,
        file_size: fileData.size,
        mime_type: fileData.mimetype,
        verification_status: 'PENDING'
      });

      // Fetch with document type details
      const updated = await ApplicantDocument.findByPk(existing.document_id, {
        include: [{ model: DocumentType, as: 'documentType' }]
      });

      const json = (updated || existing).toJSON();
      json.file_path = toPublicUploadPath(json.file_path);

      logger.info(`Document updated for applicant: ${applicantId}, type_id: ${doc_type_id || doc_type}`);
      return json;
    }

    // Create new document record
    const document = await ApplicantDocument.create({
      applicant_id: applicantId,
      doc_type_id: doc_type_id,
      doc_type: finalDocType,
      file_name: fileData.filename,
      file_path: relativePath,
      file_size: fileData.size,
      mime_type: fileData.mimetype,
      verification_status: 'PENDING'
    });

    // Fetch with document type details
    const created = await ApplicantDocument.findByPk(document.document_id, {
      include: [{ model: DocumentType, as: 'documentType' }]
    });

    const json = (created || document).toJSON();
    json.file_path = toPublicUploadPath(json.file_path);

    logger.info(`Document saved for applicant: ${applicantId}, type_id: ${doc_type_id || doc_type}`);
    return json;
  } catch (error) {
    logger.error('Save document error:', error);
    throw error;
  }
};

/**
 * Get all documents for applicant
 * @param {number} applicantId - Applicant ID
 * @returns {Promise<Array>} - List of documents
 */
const getDocuments = async (applicantId) => {
  try {
    const documents = await ApplicantDocument.findAll({
      where: { applicant_id: applicantId, is_deleted: false },
      include: [{
        model: DocumentType,
        as: 'documentType',
        attributes: ['doc_type_id', 'doc_code', 'doc_type_name', 'doc_type_name_mr']
      }],
      order: [['created_at', 'DESC']]
    });

    return documents.map(doc => {
      const json = doc.toJSON();
      json.file_path = toPublicUploadPath(json.file_path);
      return json;
    });
  } catch (error) {
    logger.error('Get documents error:', error);
    throw error;
  }
};

/**
 * Delete document
 * @param {number} applicantId - Applicant ID
 * @param {number} documentId - Document ID
 * @returns {Promise<Object>} - Result
 */
const deleteDocument = async (applicantId, documentId) => {
  try {
    const document = await ApplicantDocument.findOne({
      where: { document_id: documentId, applicant_id: applicantId }
    });

    if (!document) {
      throw new ApiError(404, 'Document not found');
    }

    // Delete file from disk
    if (document.file_path) {
      const fsPath = path.isAbsolute(document.file_path)
        ? document.file_path
        : getAbsolutePath(document.file_path);

      if (fs.existsSync(fsPath)) {
        fs.unlinkSync(fsPath);
      }
    }

    await document.destroy();
    logger.info(`Document deleted for applicant: ${applicantId}`);
    return { message: 'Document deleted successfully' };
  } catch (error) {
    logger.error('Delete document error:', error);
    throw error;
  }
};

module.exports = {
  saveDocument,
  getDocuments,
  deleteDocument,
  /**
   * Get required document types for applicant
   * Rules:
   * - Always include doc types where is_mandatory_for_all = true
   * - If applicant personal.domicile_maharashtra = true, also include doc types that match 'domicile/domacile'
   * Returns flat list of document type objects
   */
  getRequiredDocumentTypes: async (applicantId, options = {}) => {
    try {
      const includeSectionDocs = options?.include_section_docs === true;
      const includeCorePersonal = options?.include_core_personal === true;

      logger.info('getRequiredDocumentTypes request', {
        applicantId,
        includeSectionDocs,
        includeCorePersonal,
        post_id: options?.post_id || null
      });
      const personal = await ApplicantPersonal.findOne({
        where: { applicant_id: applicantId, is_deleted: false },
        attributes: ['domicile_maharashtra']
      });

      const isDomicile = !!personal?.domicile_maharashtra;
      const postId = options?.post_id ? parseInt(options.post_id, 10) : null;
      const includePostRequirements = Number.isFinite(postId) && postId > 0;

      const domicileTerms = ['%domicile%', '%domacile%'];

      const corePersonalCodes = ['PHOTO', 'SIGNATURE', 'AADHAAR', 'PAN', 'RESUME', 'DOMICILE'];

      const educationDocTypeRows = await EducationLevel.findAll({
        where: { doc_type_id: { [Op.ne]: null } },
        attributes: ['doc_type_id'],
        raw: true
      });
      const experienceDocTypeRows = await ExperienceDomain.findAll({
        where: { doc_type_id: { [Op.ne]: null } },
        attributes: ['doc_type_id'],
        raw: true
      });

      const excludedDocTypeIds = Array.from(new Set([
        ...educationDocTypeRows.map(r => r.doc_type_id).filter(Boolean),
        ...experienceDocTypeRows.map(r => r.doc_type_id).filter(Boolean)
      ]));

      logger.info('getRequiredDocumentTypes exclusions', {
        applicantId,
        excluded_edu_doc_type_ids: educationDocTypeRows.length,
        excluded_exp_doc_type_ids: experienceDocTypeRows.length,
        excluded_total_unique: excludedDocTypeIds.length
      });
      const domicileWhere = {
        [Op.or]: [
          ...domicileTerms.map((t) => ({ doc_code: { [Op.iLike]: t } })),
          ...domicileTerms.map((t) => ({ doc_type_code: { [Op.iLike]: t } })),
          ...domicileTerms.map((t) => ({ doc_type_name: { [Op.iLike]: t } })),
          ...domicileTerms.map((t) => ({ doc_type_name_mr: { [Op.iLike]: t } }))
        ]
      };

      const where = {
        is_active: true,
        ...(!includeSectionDocs && excludedDocTypeIds.length
          ? { doc_type_id: { [Op.notIn]: excludedDocTypeIds } }
          : {}),
        ...(!includeCorePersonal
          ? {
              // NULL-safe exclusion: SQL three-valued logic can cause NOT (NULL OR false) => NULL (filtered out).
              // We want to include rows where codes are NULL or not in the core set.
              [Op.and]: [
                {
                  [Op.or]: [
                    { doc_code: { [Op.is]: null } },
                    { doc_code: { [Op.notIn]: corePersonalCodes } }
                  ]
                },
                {
                  [Op.or]: [
                    { doc_type_code: { [Op.is]: null } },
                    { doc_type_code: { [Op.notIn]: corePersonalCodes } }
                  ]
                }
              ]
            }
          : {}),
        [Op.or]: [
          { is_mandatory: true },
          ...(isDomicile ? [domicileWhere] : [])
        ]
      };

      const rows = await DocumentType.findAll({
        where,
        attributes: [
          'doc_type_id',
          'doc_code',
          'doc_type_code',
          'doc_type_name',
          'doc_type_name_mr',
          'description',
          'description_mr',
          'is_mandatory',
          'allowed_file_types',
          'allowed_formats',
          'max_file_size_mb',
          'max_size_mb',
          'multiple_files_allowed',
          'display_order'
        ],
        order: [['display_order', 'ASC']]
      });

      logger.info('getRequiredDocumentTypes base rows', {
        applicantId,
        count: rows.length,
        doc_type_ids: rows.slice(0, 50).map(r => r.doc_type_id)
      });

      const postRequirementRows = includePostRequirements ? await PostDocumentRequirement.findAll({
        where: {
          post_id: postId,
          is_active: true,
          requirement_type: 'M',
          mandatory_at_application: true
        },
        include: [{
          model: DocumentType,
          as: 'documentType',
          required: true,
          where: { is_active: true },
          attributes: [
            'doc_type_id',
            'doc_code',
            'doc_type_code',
            'doc_type_name',
            'doc_type_name_mr',
            'description',
            'description_mr',
            'is_mandatory',
            'allowed_file_types',
            'allowed_formats',
            'max_file_size_mb',
            'max_size_mb',
            'multiple_files_allowed',
            'display_order'
          ]
        }],
        order: [['id', 'ASC']]
      }) : [];

      // De-dupe by doc_type_id and flatten to required payload
      const seen = new Set();
      const result = [];
      const pushDocType = (d, extra = {}) => {
        if (!d || !d.doc_type_id) return;
        if (seen.has(d.doc_type_id)) return;
        seen.add(d.doc_type_id);

        result.push({
          doc_type_id: d.doc_type_id,
          doc_code: d.doc_code || d.doc_type_code || null,
          doc_type_name: d.doc_type_name,
          doc_type_name_mr: d.doc_type_name_mr,
          description: d.description,
          is_mandatory: !!d.is_mandatory,
          is_mandatory_for_all: !!d.is_mandatory,
          allowed_file_types: d.allowed_file_types || d.allowed_formats || null,
          max_file_size_mb: d.max_file_size_mb || d.max_size_mb || null,
          multiple_files_allowed: !!d.multiple_files_allowed,
          display_order: d.display_order || 0,
          ...extra
        });
      };

      rows.forEach((r) => {
        const d = r.toJSON();
        pushDocType(d, { required_for_post: false });
      });

      postRequirementRows.forEach((r) => {
        const d = r.documentType?.toJSON?.() ? r.documentType.toJSON() : r.documentType;
        pushDocType(d, {
          required_for_post: true,
          post_id: postId
        });
      });

      result.sort((a, b) => (a.display_order || 0) - (b.display_order || 0));

      return result;
    } catch (error) {
      logger.error('Get required document types error:', error);
      throw error;
    }
  }
};
