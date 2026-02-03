// ============================================================================
// APPLICATION STATUS CONSTANTS
// ============================================================================
// Purpose: Canonical application status codes and transitions
// ============================================================================

const APPLICATION_STATUS = {
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  UNDER_REVIEW: 'UNDER_REVIEW',
  DOCUMENTS_VERIFIED: 'DOCUMENTS_VERIFIED',
  ELIGIBLE: 'ELIGIBLE',
  NOT_ELIGIBLE: 'NOT_ELIGIBLE',
  ON_HOLD: 'ON_HOLD',
  PROVISIONAL_SELECTED: 'PROVISIONAL_SELECTED',
  SHORTLISTED: 'SHORTLISTED',
  SELECTED: 'SELECTED',
  SELECTED_IN_OTHER_POST: 'SELECTED_IN_OTHER_POST',
  REJECTED: 'REJECTED',
  WITHDRAWN: 'WITHDRAWN'
};

// Valid status transitions (from -> [allowed to statuses])
const STATUS_TRANSITIONS = {
  [APPLICATION_STATUS.DRAFT]: [
    APPLICATION_STATUS.SUBMITTED,
    APPLICATION_STATUS.WITHDRAWN
  ],
  [APPLICATION_STATUS.SUBMITTED]: [
    APPLICATION_STATUS.ELIGIBLE,
    APPLICATION_STATUS.NOT_ELIGIBLE,
    APPLICATION_STATUS.WITHDRAWN
  ],
  [APPLICATION_STATUS.ELIGIBLE]: [
    APPLICATION_STATUS.ON_HOLD,
    APPLICATION_STATUS.PROVISIONAL_SELECTED,
    APPLICATION_STATUS.SELECTED_IN_OTHER_POST,
    APPLICATION_STATUS.REJECTED
  ],
  [APPLICATION_STATUS.NOT_ELIGIBLE]: [
    APPLICATION_STATUS.REJECTED
  ],
  [APPLICATION_STATUS.ON_HOLD]: [
    APPLICATION_STATUS.ELIGIBLE,
    APPLICATION_STATUS.PROVISIONAL_SELECTED,
    APPLICATION_STATUS.SELECTED_IN_OTHER_POST,
    APPLICATION_STATUS.REJECTED
  ],
  [APPLICATION_STATUS.PROVISIONAL_SELECTED]: [
    APPLICATION_STATUS.SELECTED,
    APPLICATION_STATUS.SELECTED_IN_OTHER_POST,
    APPLICATION_STATUS.REJECTED
  ],
  [APPLICATION_STATUS.SELECTED_IN_OTHER_POST]: [],
  [APPLICATION_STATUS.SELECTED]: [],
  [APPLICATION_STATUS.REJECTED]: [],
  [APPLICATION_STATUS.WITHDRAWN]: []
};

// Statuses that are terminal (no further transitions allowed)
const TERMINAL_STATUSES = [
  APPLICATION_STATUS.SELECTED,
  APPLICATION_STATUS.SELECTED_IN_OTHER_POST,
  APPLICATION_STATUS.REJECTED,
  APPLICATION_STATUS.WITHDRAWN
];

// Statuses that lock the application (applicant cannot edit)
const LOCKED_STATUSES = [
  APPLICATION_STATUS.SUBMITTED,
  APPLICATION_STATUS.ELIGIBLE,
  APPLICATION_STATUS.NOT_ELIGIBLE,
  APPLICATION_STATUS.ON_HOLD,
  APPLICATION_STATUS.PROVISIONAL_SELECTED,
  APPLICATION_STATUS.SELECTED,
  APPLICATION_STATUS.SELECTED_IN_OTHER_POST,
  APPLICATION_STATUS.REJECTED,
  APPLICATION_STATUS.WITHDRAWN
];

// Statuses visible in admin merit/review screens
const REVIEWABLE_STATUSES = [
  APPLICATION_STATUS.ELIGIBLE,
  APPLICATION_STATUS.PROVISIONAL_SELECTED
];

// Actor types for status history
const ACTOR_TYPE = {
  SYSTEM: 'SYSTEM',
  ADMIN: 'ADMIN',
  APPLICANT: 'APPLICANT'
};

/**
 * Check if a status transition is valid
 * @param {string} fromStatus - Current status
 * @param {string} toStatus - Target status
 * @returns {boolean}
 */
const isValidTransition = (fromStatus, toStatus) => {
  const allowed = STATUS_TRANSITIONS[fromStatus];
  return allowed && allowed.includes(toStatus);
};

/**
 * Check if status is terminal
 * @param {string} status
 * @returns {boolean}
 */
const isTerminalStatus = (status) => {
  return TERMINAL_STATUSES.includes(status);
};

/**
 * Check if status locks the application
 * @param {string} status
 * @returns {boolean}
 */
const isLockedStatus = (status) => {
  return LOCKED_STATUSES.includes(status);
};

module.exports = {
  APPLICATION_STATUS,
  STATUS_TRANSITIONS,
  TERMINAL_STATUSES,
  LOCKED_STATUSES,
  REVIEWABLE_STATUSES,
  ACTOR_TYPE,
  isValidTransition,
  isTerminalStatus,
  isLockedStatus
};
