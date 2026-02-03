/**
 * Pagination Helper Utility
 * Provides reusable pagination, search, and filtering utilities for Sequelize models
 */

const { Op } = require('sequelize');

/**
 * Parse pagination parameters from query
 * @param {Object} query - Request query object
 * @param {Object} defaults - Default values
 * @returns {Object} Parsed pagination params
 */
const parsePaginationParams = (query, defaults = {}) => {
  const {
    page = defaults.page || 1,
    limit = defaults.limit || 20,
    search = '',
    sort_by = defaults.sortBy || 'created_at',
    sort_order = defaults.sortOrder || 'DESC'
  } = query;

  // Check if pagination is requested (page or limit provided)
  const usePagination = query.page !== undefined || query.limit !== undefined;

  return {
    page: Math.max(parseInt(page, 10) || 1, 1),
    limit: Math.max(parseInt(limit, 10) || 20, 1),
    offset: (Math.max(parseInt(page, 10) || 1, 1) - 1) * Math.max(parseInt(limit, 10) || 20, 1),
    search: search.trim(),
    sortBy: sort_by,
    sortOrder: sort_order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC',
    usePagination
  };
};

/**
 * Build search condition for multiple fields
 * @param {string} search - Search term
 * @param {Array<string>} searchFields - Fields to search in
 * @returns {Object|null} Sequelize where condition or null
 */
const buildSearchCondition = (search, searchFields = []) => {
  if (!search || searchFields.length === 0) {
    return null;
  }

  return {
    [Op.or]: searchFields.map(field => ({
      [field]: { [Op.iLike]: `%${search}%` }
    }))
  };
};

/**
 * Build filter conditions from query params
 * @param {Object} query - Request query object
 * @param {Object} filterConfig - Configuration for allowed filters
 * @returns {Object} Sequelize where conditions
 */
const buildFilterConditions = (query, filterConfig = {}) => {
  const conditions = {};

  Object.entries(filterConfig).forEach(([queryKey, config]) => {
    const value = query[queryKey];
    if (value === undefined || value === '') return;

    const { field = queryKey, type = 'exact' } = config;

    switch (type) {
      case 'exact':
        conditions[field] = value;
        break;
      case 'boolean':
        conditions[field] = value === 'true' || value === true;
        break;
      case 'number':
        conditions[field] = parseInt(value, 10);
        break;
      case 'like':
        conditions[field] = { [Op.iLike]: `%${value}%` };
        break;
      default:
        conditions[field] = value;
    }
  });

  return conditions;
};

/**
 * Format pagination response
 * @param {Array} rows - Data rows
 * @param {number} count - Total count
 * @param {Object} params - Pagination params
 * @param {string} dataKey - Key name for data array (e.g., 'districts', 'talukas')
 * @returns {Object} Formatted response with data and pagination
 */
const formatPaginatedResponse = (rows, count, params, dataKey = 'data') => {
  const { page, limit } = params;
  return {
    [dataKey]: rows,
    pagination: {
      total: count,
      page,
      limit,
      totalPages: Math.ceil(count / limit) || 1
    }
  };
};

/**
 * Execute paginated query on a Sequelize model
 * @param {Object} model - Sequelize model
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Paginated results or full array
 */
const paginatedQuery = async (model, options = {}) => {
  const {
    query = {},
    searchFields = [],
    filterConfig = {},
    include = [],
    order = [['created_at', 'DESC']],
    dataKey = 'data',
    baseWhere = {},
    scope = null,
    attributes = undefined,
    transform = null // Optional transform function for each row
  } = options;

  // Parse pagination params
  const params = parsePaginationParams(query);
  const { page, limit, offset, search, usePagination } = params;

  // Build where clause
  const where = { ...baseWhere };

  // Add search conditions
  const searchCondition = buildSearchCondition(search, searchFields);
  if (searchCondition) {
    Object.assign(where, searchCondition);
  }

  // Add filter conditions
  const filterConditions = buildFilterConditions(query, filterConfig);
  Object.assign(where, filterConditions);

  // Get model instance (with scope if provided)
  const modelInstance = scope ? model.scope(scope) : model;

  // If no pagination requested, return full list
  if (!usePagination) {
    const rows = await modelInstance.findAll({
      where,
      include,
      order,
      attributes
    });

    const transformedRows = transform ? rows.map(transform) : rows;
    return transformedRows;
  }

  // Execute paginated query
  const { count, rows } = await modelInstance.findAndCountAll({
    where,
    include,
    order,
    limit,
    offset,
    attributes,
    distinct: true // Important for accurate count with includes
  });

  const transformedRows = transform ? rows.map(transform) : rows;
  return formatPaginatedResponse(transformedRows, count, params, dataKey);
};

/**
 * Check if response is paginated
 * @param {Object|Array} response - Response from paginatedQuery
 * @returns {boolean} True if paginated
 */
const isPaginatedResponse = (response) => {
  return response && typeof response === 'object' && 'pagination' in response;
};

module.exports = {
  parsePaginationParams,
  buildSearchCondition,
  buildFilterConditions,
  formatPaginatedResponse,
  paginatedQuery,
  isPaginatedResponse
};
