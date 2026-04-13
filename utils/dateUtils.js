/**
 * Date formatting utilities with proper timezone handling
 */

/**
 * Format date/time to IST with AM/PM
 * @param {Date|string} date - Date object or ISO string
 * @returns {Object} { date: 'DD/MM/YYYY', time: 'HH:MM am/pm' }
 */
function formatDateTimeIST(date) {
  if (!date) return { date: '-', time: '-' };
  
  const d = new Date(date);
  if (isNaN(d.getTime())) return { date: '-', time: '-' };
  
  // Convert to IST (UTC+5:30) using UTC epoch math (avoid double-offset)
  const istOffset = 5.5 * 60 * 60 * 1000; // 5.5 hours in milliseconds
  const istTime = new Date(d.getTime() + istOffset);
  
  // Format date
  const day = String(istTime.getUTCDate()).padStart(2, '0');
  const month = String(istTime.getUTCMonth() + 1).padStart(2, '0');
  const year = istTime.getUTCFullYear();
  
  // Format time with AM/PM
  let hours = istTime.getUTCHours();
  const minutes = String(istTime.getUTCMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'pm' : 'am';
  hours = hours % 12 || 12; // Convert 0 to 12
  
  return {
    date: `${day}/${month}/${year}`,
    time: `${String(hours).padStart(2, '0')}:${minutes} ${ampm}`
  };
}

/**
 * Format date to DD/MM/YYYY
 * @param {Date|string} date 
 * @returns {string}
 */
function formatDateIST(date) {
  return formatDateTimeIST(date).date;
}

/**
 * Format time to HH:MM am/pm
 * @param {Date|string} date 
 * @returns {string}
 */
function formatTimeIST(date) {
  return formatDateTimeIST(date).time;
}

module.exports = {
  formatDateTimeIST,
  formatDateIST,
  formatTimeIST
};
