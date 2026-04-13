/**
 * HRM Standard Filter Builder
 * 
 * Provides standardized filtering, sorting, and pagination for all HRM APIs
 * Features:
 * - Search across multiple fields
 * - Date range filtering
 * - Year/month filtering  
 * - ASC/DESC sorting
 * - Pagination
 * - Reusable across all HRM APIs
 */

const { Op } = require('sequelize');
const logger = require('../../../config/logger');

/**
 * Build standardized where clause for HRM APIs
 * @param {Object} query - Query parameters
 * @param {Object} options - Configuration options
 * @returns {Object} Sequelize where clause
 */
const buildWhereClause = (query, options = {}) => {
  const where = {};
  
  // Add base where clause if provided
  if (options.baseWhere) {
    Object.assign(where, options.baseWhere);
  }

  // Date filtering
  if (query.from_date && query.to_date) {
    // Custom date range
    const startDate = new Date(query.from_date);
    const endDate = new Date(query.to_date);
    
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      throw new Error('Invalid date format. Use YYYY-MM-DD format.');
    }
    
    if (startDate > endDate) {
      throw new Error('From date cannot be after to date.');
    }
    
    if (options.dateField) {
      where[options.dateField] = {
        [Op.between]: [startDate.toISOString().split('T')[0], endDate.toISOString().split('T')[0]]
      };
    }
  } else if (query.year && query.month) {
    // Year/Month filtering
    const year = parseInt(query.year);
    const month = parseInt(query.month);
    
    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
      throw new Error('Invalid year or month. Year must be numeric, month must be 1-12.');
    }
    
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0);
    
    if (options.dateField) {
      where[options.dateField] = {
        [Op.between]: [startDate.toISOString().split('T')[0], endDate.toISOString().split('T')[0]]
      };
    }
  } else if (query.year) {
    // Year only filtering
    const year = parseInt(query.year);
    
    if (isNaN(year)) {
      throw new Error('Invalid year. Must be numeric.');
    }
    
    const startDate = new Date(year, 0, 1);
    const endDate = new Date(year, 11, 31);
    
    if (options.dateField) {
      where[options.dateField] = {
        [Op.between]: [startDate.toISOString().split('T')[0], endDate.toISOString().split('T')[0]]
      };
    }
  }

  // Search functionality
  if (query.search && options.searchFields) {
    const searchTerm = query.search.trim();
    if (searchTerm) {
      const searchConditions = options.searchFields.map(field => ({
        [field]: { [Op.iLike]: `%${searchTerm}%` }
      }));
      
      where[Op.or] = searchConditions;
    }
  }

  // Specific field filters
  if (options.filterableFields) {
    Object.keys(options.filterableFields).forEach(field => {
      if (query[field]) {
        const filterConfig = options.filterableFields[field];
        let value = query[field];
        
        // Apply transformations
        if (filterConfig.transform) {
          value = filterConfig.transform(value);
        }
        
        // Apply validation
        if (filterConfig.validate && !filterConfig.validate(value)) {
          throw new Error(`Invalid value for ${field}: ${value}`);
        }
        
        where[field] = value;
      }
    });
  }

  return where;
};

/**
 * Build standardized order clause for HRM APIs
 * @param {Object} query - Query parameters
 * @param {Object} options - Configuration options
 * @returns {Array} Sequelize order clause
 */
const buildOrderClause = (query, options = {}) => {
  const defaultSort = options.defaultSort || [['created_at', 'DESC']];
  const sortableFields = options.sortableFields || ['created_at'];
  
  if (query.sort_by && query.sort_order) {
    const sortBy = query.sort_by;
    const sortOrder = query.sort_order.toUpperCase();
    
    // Validate sortable field
    if (!sortableFields.includes(sortBy)) {
      logger.warn(`Invalid sort field: ${sortBy}. Using default sort.`);
      return defaultSort;
    }
    
    // Validate sort order
    if (!['ASC', 'DESC'].includes(sortOrder)) {
      logger.warn(`Invalid sort order: ${sortOrder}. Using DESC.`);
      return [[sortBy, 'DESC']];
    }
    
    return [[sortBy, sortOrder]];
  }
  
  return defaultSort;
};

/**
 * Build standardized query options for HRM APIs
 * @param {Object} query - Query parameters
 * @param {Object} options - Configuration options
 * @returns {Object} Sequelize query options
 */
const buildQueryOptions = (query, options = {}) => {
  const where = buildWhereClause(query, options);
  const order = buildOrderClause(query, options);
  
  const queryOptions = {
    where,
    order
  };

  // Add includes if provided
  if (options.include) {
    queryOptions.include = options.include;
  }

  // Add attributes if provided
  if (options.attributes) {
    queryOptions.attributes = options.attributes;
  }

  // Add pagination if enabled
  if (options.paginate !== false) {
    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 10;
    const offset = (page - 1) * limit;
    
    queryOptions.limit = limit;
    queryOptions.offset = offset;
  }

  return queryOptions;
};

/**
 * Standard HRM API response builder
 * @param {Object} data - Query result data
 * @param {Object} query - Query parameters
 * @param {Object} options - Configuration options
 * @returns {Object} Standardized response
 */
const buildResponse = (data, query, options = {}) => {
  const response = {
    success: true,
    message: options.message || 'Data retrieved successfully',
    data: {}
  };

  // Handle paginated response
  if (data.rows && data.count !== undefined) {
    response.data.records = data.rows;
    response.data.pagination = {
      page: parseInt(query.page) || 1,
      limit: parseInt(query.limit) || 10,
      total: data.count,
      totalPages: Math.ceil(data.count / (parseInt(query.limit) || 10))
    };
  } else {
    response.data.records = data;
  }

  // Add summary if provided
  if (options.summary) {
    response.data.summary = options.summary;
  }

  // Add filters info
  response.data.filters = {
    search: query.search || null,
    from_date: query.from_date || null,
    to_date: query.to_date || null,
    year: query.year || null,
    month: query.month || null,
    sort_by: query.sort_by || null,
    sort_order: query.sort_order || null
  };

  return response;
};

/**
 * Common field configurations for reuse
 */
const COMMON_FIELDS = {
  // Attendance fields
  ATTENDANCE: {
    searchFields: ['status', 'remarks', 'geo_address', 'ip_address', 'device_type'],
    sortableFields: ['attendance_date', 'check_in_time', 'status', 'created_at'],
    filterableFields: {
      status: {
        validate: (value) => ['PRESENT', 'ABSENT', 'HALF_DAY', 'ON_LEAVE'].includes(value.toUpperCase()),
        transform: (value) => value.toUpperCase()
      },
      device_type: {
        validate: (value) => ['mobile', 'desktop'].includes(value.toLowerCase()),
        transform: (value) => value.toLowerCase()
      },
      employee_id: {
        validate: (value) => !isNaN(parseInt(value)),
        transform: (value) => parseInt(value)
      }
    }
  },

  // Employee fields
  EMPLOYEE: {
    searchFields: ['employee_code', 'full_name', 'email', 'mobile_no'],
    sortableFields: ['employee_code', 'full_name', 'created_at', 'employment_status'],
    filterableFields: {
      employment_status: {
        validate: (value) => ['ACTIVE', 'INACTIVE', 'TERMINATED'].includes(value.toUpperCase()),
        transform: (value) => value.toUpperCase()
      },
      onboarding_status: {
        validate: (value) => ['PENDING', 'IN_PROGRESS', 'COMPLETED'].includes(value.toUpperCase()),
        transform: (value) => value.toUpperCase()
      }
    }
  },

  // Leave fields
  LEAVE: {
    searchFields: ['leave_type', 'reason', 'status'],
    sortableFields: ['from_date', 'to_date', 'status', 'created_at'],
    filterableFields: {
      status: {
        validate: (value) => ['PENDING', 'APPROVED', 'REJECTED'].includes(value.toUpperCase()),
        transform: (value) => value.toUpperCase()
      },
      leave_type: {
        validate: (value) => ['CASUAL', 'SICK', 'EARNED', 'MATERNITY', 'PATERNITY'].includes(value.toUpperCase()),
        transform: (value) => value.toUpperCase()
      }
    }
  }
};

module.exports = {
  buildWhereClause,
  buildOrderClause,
  buildQueryOptions,
  buildResponse,
  COMMON_FIELDS
};
