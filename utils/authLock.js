const { APP_CONFIG } = require('../constants/appConfig');

const DEFAULT_MAX_ATTEMPTS = APP_CONFIG?.AUTH?.MAX_LOGIN_ATTEMPTS || 5;
const DEFAULT_LOCK_MINUTES = APP_CONFIG?.AUTH?.LOCKOUT_DURATION_MINUTES || 15;

const parsePositiveInt = (value) => {
  if (value === undefined || value === null) return null;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) || parsed <= 0 ? null : parsed;
};

const resolveEnv = (userType, adminKey, applicantKey) => {
  if (userType && String(userType).toUpperCase() === 'ADMIN') {
    return process.env[adminKey];
  }
  return process.env[applicantKey];
};

const getMaxLoginAttempts = (userType = 'APPLICANT') => {
  const envValue = resolveEnv(userType, 'ADMIN_LOGIN_MAX_ATTEMPTS', 'LOGIN_MAX_ATTEMPTS');
  return parsePositiveInt(envValue) || DEFAULT_MAX_ATTEMPTS;
};

const getLockDurationMinutes = (userType = 'APPLICANT') => {
  const envValue = resolveEnv(userType, 'ADMIN_LOGIN_LOCK_DURATION_MINUTES', 'LOGIN_LOCK_DURATION_MINUTES');
  return parsePositiveInt(envValue) || DEFAULT_LOCK_MINUTES;
};

const getLockDurationMs = (userType = 'APPLICANT') => getLockDurationMinutes(userType) * 60 * 1000;

const createLockUntilDate = (userType = 'APPLICANT') => new Date(Date.now() + getLockDurationMs(userType));

const formatLockDuration = (milliseconds) => {
  const totalSeconds = Math.max(1, Math.ceil(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts = [];
  if (hours) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
  if (minutes) parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`);

  // Show seconds only when duration is under an hour to avoid overly long strings
  if (!hours && seconds) {
    parts.push(`${seconds} second${seconds === 1 ? '' : 's'}`);
  }

  if (parts.length === 0) {
    return 'less than a minute';
  }

  if (parts.length === 1) {
    return parts[0];
  }

  const last = parts.pop();
  return `${parts.join(', ')} and ${last}`;
};

const getRemainingLockText = (lockedUntil) => {
  if (!lockedUntil) return null;
  const remainingMs = new Date(lockedUntil).getTime() - Date.now();
  if (remainingMs <= 0) return null;
  return formatLockDuration(remainingMs);
};

const buildLockoutMessage = (lockedUntil) => {
  const remainingText = getRemainingLockText(lockedUntil);
  if (!remainingText) {
    return 'Account is locked. Please try again later.';
  }

  return `Account is locked. Please try again in ${remainingText}.`;
};

module.exports = {
  createLockUntilDate,
  getLockDurationMinutes,
  getLockDurationMs,
  getMaxLoginAttempts,
  getRemainingLockText,
  buildLockoutMessage,
  formatLockDuration
};
