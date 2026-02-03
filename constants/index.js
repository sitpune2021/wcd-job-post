// ============================================================================
// CONSTANTS INDEX
// ============================================================================
// Purpose: Central export for all application constants
// Import from here: const { HTTP_STATUS, ERROR_CODES } = require('../constants');
// ============================================================================

const httpStatus = require('./httpStatus');
const errorCodes = require('./errorCodes');
const permissions = require('./permissions');
const appConfig = require('./appConfig');

module.exports = {
  ...httpStatus,
  ...errorCodes,
  ...permissions,
  ...appConfig
};
