/**
 * Standardized API Response Utilities
 * 
 * This module provides consistent response formatting across all API endpoints.
 * All success responses follow the same structure for easy frontend integration.
 * 
 * SUCCESS RESPONSE FORMAT:
 * {
 *   "success": true,
 *   "message": "Human-readable success message",
 *   "data": { ... } or [ ... ] or null
 * }
 * 
 * PAGINATED RESPONSE FORMAT:
 * {
 *   "success": true,
 *   "message": "Human-readable success message",
 *   "data": [ ... ],
 *   "pagination": {
 *     "total": 100,
 *     "page": 1,
 *     "limit": 10,
 *     "totalPages": 10
 *   }
 * }
 * 
 * ERROR RESPONSE FORMAT (handled by errorHandler.js):
 * {
 *   "success": false,
 *   "message": "Human-readable error message",
 *   "errors": [ { "field": "fieldName", "message": "Field error" } ] // optional
 * }
 */

const { HTTP_STATUS } = require('../constants');

class ApiResponse {
  /**
   * Standard success response
   * @param {Object} res - Express response object
   * @param {*} data - Response data (object, array, or null)
   * @param {String} message - Success message
   * @param {Number} statusCode - HTTP status code (default: 200)
   * @returns {Object} Express response
   */
  static success(res, data = null, message = 'Success', statusCode = 200) {
    return res.status(statusCode).json({
      success: true,
      message,
      data
    });
  }

  /**
   * Created response (201)
   * @param {Object} res - Express response object
   * @param {*} data - Created resource data
   * @param {String} message - Success message
   * @returns {Object} Express response
   */
  static created(res, data = null, message = 'Created successfully') {
    return res.status(201).json({
      success: true,
      message,
      data
    });
  }

  /**
   * Paginated list response
   * @param {Object} res - Express response object
   * @param {Array} data - Array of items
   * @param {Object} pagination - Pagination metadata { total, page, limit, totalPages }
   * @param {String} message - Success message
   * @returns {Object} Express response
   */
  static paginated(res, data, pagination, message = 'Data retrieved successfully') {
    return res.status(200).json({
      success: true,
      message,
      data,
      pagination: {
        total: pagination.total || 0,
        page: parseInt(pagination.page) || 1,
        limit: parseInt(pagination.limit) || 10,
        totalPages: pagination.totalPages || Math.ceil((pagination.total || 0) / (pagination.limit || 10))
      }
    });
  }

  /**
   * No content response (for delete operations)
   * @param {Object} res - Express response object
   * @param {String} message - Success message
   * @returns {Object} Express response
   */
  static deleted(res, message = 'Deleted successfully') {
    return res.status(200).json({
      success: true,
      message,
      data: null
    });
  }

  /**
   * Auth response (login/register with tokens)
   * @param {Object} res - Express response object
   * @param {Object} user - User data
   * @param {Object} tokens - Token data { access_token, refresh_token, expires_at }
   * @param {String} message - Success message
   * @param {Number} statusCode - HTTP status code
   * @returns {Object} Express response
   */
  static auth(res, user, tokens, message = 'Authentication successful', statusCode = 200) {
    return res.status(statusCode).json({
      success: true,
      message,
      data: {
        user,
        tokens
      }
    });
  }
}

module.exports = ApiResponse;
