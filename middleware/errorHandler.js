const logger = require('../config/logger');
const { HTTP_STATUS } = require('../constants');

/**
 * Custom API Error Class
 * 
 * Use this to throw consistent errors throughout the application.
 * All errors thrown with ApiError will be caught by errorHandler
 * and formatted consistently for the frontend.
 * 
 * Usage:
 *   throw new ApiError(400, 'Validation failed', [{ field: 'email', message: 'Invalid email' }]);
 *   throw new ApiError(404, 'User not found');
 *   throw new ApiError(401, 'Invalid credentials');
 */
class ApiError extends Error {
  constructor(statusCode, message, errors = null, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.errors = errors;
    Error.captureStackTrace(this, this.constructor);
  }

  // Static factory methods for common errors
  static badRequest(message = 'Bad request', errors = null) {
    return new ApiError(HTTP_STATUS.BAD_REQUEST, message, errors);
  }

  static unauthorized(message = 'Unauthorized') {
    return new ApiError(HTTP_STATUS.UNAUTHORIZED, message);
  }

  static forbidden(message = 'Access forbidden') {
    return new ApiError(HTTP_STATUS.FORBIDDEN, message);
  }

  static notFound(message = 'Resource not found') {
    return new ApiError(HTTP_STATUS.NOT_FOUND, message);
  }

  static conflict(message = 'Resource conflict') {
    return new ApiError(HTTP_STATUS.CONFLICT, message);
  }

  static internal(message = 'Internal server error') {
    return new ApiError(HTTP_STATUS.INTERNAL_SERVER_ERROR, message, null, false);
  }

  static validation(errors, message = 'Validation failed') {
    return new ApiError(HTTP_STATUS.BAD_REQUEST, message, errors);
  }
}

/**
 * Global Error Handler Middleware
 * 
 * This middleware catches all errors and formats them consistently.
 * 
 * ERROR RESPONSE FORMAT:
 * {
 *   "success": false,
 *   "message": "Human-readable error message",
 *   "errors": [ { "field": "fieldName", "message": "Field-specific error" } ] // optional
 *   "stack": "..." // only in development
 * }
 * 
 * HTTP Status Codes:
 * - 400: Bad Request / Validation Error
 * - 401: Unauthorized (invalid/expired token, bad credentials)
 * - 403: Forbidden (no permission)
 * - 404: Not Found
 * - 409: Conflict (duplicate resource)
 * - 500: Internal Server Error
 */
const errorHandler = (err, req, res, next) => {
  // Default error values
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal Server Error';
  let errors = err.errors || null;

  // Handle specific error types
  switch (err.name) {
    case 'SequelizeValidationError':
      statusCode = 400;
      errors = err.errors?.map(e => ({ field: e.path, message: e.message })) || null;
      message = 'Validation failed';
      break;

    case 'SequelizeUniqueConstraintError':
      statusCode = 409;
      errors = err.errors?.map(e => ({ field: e.path, message: `${e.path} already exists` })) || null;
      message = 'Resource already exists';
      break;

    case 'SequelizeForeignKeyConstraintError':
      statusCode = 400;
      message = 'Invalid reference. Related resource does not exist.';
      break;

    case 'SequelizeDatabaseError':
      statusCode = 500;
      message = 'Database error occurred';
      break;

    case 'JsonWebTokenError':
      statusCode = 401;
      message = 'Invalid token';
      break;

    case 'TokenExpiredError':
      statusCode = 401;
      message = 'Token has expired';
      break;

    case 'ValidationError':
      statusCode = 400;
      // Keep the original message for Joi/express-validator errors
      break;

    case 'MulterError':
      statusCode = 400;
      message = err.code === 'LIMIT_FILE_SIZE' 
        ? 'File too large' 
        : 'File upload error';
      break;

    default:
      // For unknown errors in production, hide details
      if (statusCode === 500 && process.env.NODE_ENV === 'production') {
        message = 'An unexpected error occurred';
      }
  }

  // Log the error
  const logData = {
    statusCode,
    message,
    path: req.path,
    method: req.method,
    ip: req.ip,
    userId: req.user?.id || req.user?.admin_id || null
  };

  if (statusCode >= 500) {
    logger.error('Server Error', { ...logData, stack: err.stack });
  } else if (statusCode >= 400) {
    logger.warn('Client Error', logData);
  }

  // Build response
  const responseBody = {
    success: false,
    message
  };

  // Include field errors if present
  if (errors && errors.length > 0) {
    responseBody.errors = errors;
  }

  // Include stack trace in development only
  if (process.env.NODE_ENV === 'development') {
    responseBody.stack = err.stack;
  }

  res.status(statusCode).json(responseBody);
};

/**
 * 404 Not Found Handler
 * Use this as middleware for undefined routes
 */
const notFoundHandler = (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.originalUrl} not found`
  });
};

module.exports = {
  ApiError,
  errorHandler,
  notFoundHandler
};
