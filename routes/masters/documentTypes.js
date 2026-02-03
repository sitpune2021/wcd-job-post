// ============================================================================
// DOCUMENT TYPE ROUTES
// ============================================================================
// Purpose: CRUD operations for document type master data
// Base path: /api/masters/document-types
// ============================================================================

const express = require('express');
const router = express.Router();
const { authenticate, requirePermission } = require('../../middleware/auth');
const { documentTypeService } = require('../../services/masters');
const ApiResponse = require('../../utils/ApiResponse');
const { ApiError } = require('../../middleware/errorHandler');

router.get('/', async (req, res, next) => {
  try {
    const result = await documentTypeService.getDocumentTypes(req.query);
    return ApiResponse.success(res, result, 'Document types retrieved successfully');
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const docType = await documentTypeService.getDocumentTypeById(req.params.id, req.query.lang);
    if (!docType) throw ApiError.notFound('Document type not found');
    return ApiResponse.success(res, docType, 'Document type retrieved successfully');
  } catch (error) {
    next(error);
  }
});

router.post('/', authenticate, requirePermission('masters.document_types.create'),
  async (req, res, next) => {
    try {
      const docType = await documentTypeService.createDocumentType(req.body, req.user.admin_id);
      return ApiResponse.created(res, docType, 'Document type created successfully');
    } catch (error) {
      next(error);
    }
  }
);

router.put('/:id', authenticate, requirePermission('masters.document_types.edit'),
  async (req, res, next) => {
    try {
      const docType = await documentTypeService.updateDocumentType(req.params.id, req.body, req.user.admin_id);
      if (!docType) throw ApiError.notFound('Document type not found');
      return ApiResponse.success(res, docType, 'Document type updated successfully');
    } catch (error) {
      next(error);
    }
  }
);

router.delete('/:id', authenticate, requirePermission('masters.document_types.delete'),
  async (req, res, next) => {
    try {
      const deleted = await documentTypeService.deleteDocumentType(req.params.id, req.user.admin_id);
      if (!deleted) throw ApiError.notFound('Document type not found');
      return ApiResponse.deleted(res, 'Document type deleted successfully');
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
