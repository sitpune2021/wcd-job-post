/**
 * Attendance Configuration
 * Centralized settings for attendance calculations and thresholds
 */

module.exports = {
  // Work hour thresholds (in hours)
  FULL_DAY_MIN_HOURS: 8,       // Reference only (not used for status)
  HALF_DAY_MIN_HOURS: 4,       // >= 4h = PRESENT, < 4h = HALF_DAY
  
  // Double shift detection
  DOUBLE_SHIFT_HOURS: 16,      // >= 16h total = double shift flag
  
  // Permission settings
  ALLOW_SUNDAY: true,          // Remove Sunday restriction
  ALLOW_HOLIDAY_WORK: true,    // Remove holiday block, any hours = PRESENT
  
  // Cron behavior
  CRON_ABSENT_AFTER_HOURS: 24, // Mark absent only after 24h no record
  
  // Status messages for frontend
  getStatusMessage: function(totalHours, isHoliday = false) {
    const hours = parseFloat(totalHours) || 0;
    
    if (isHoliday && hours > 0) {
      return {
        status: 'PRESENT',
        message: 'Holiday work: Marked PRESENT'
      };
    }
    
    // New logic: 4h+ = PRESENT, 0-4h = HALF_DAY
    if (hours >= this.HALF_DAY_MIN_HOURS) {
      return {
        status: 'PRESENT',
        message: 'Check-out successful. Status: PRESENT (4+ hours)'
      };
    }
    
    if (hours > 0) {
      const needed = this.HALF_DAY_MIN_HOURS - hours;
      return {
        status: 'HALF_DAY',
        message: `Check-out successful. Status: HALF_DAY (need ${needed.toFixed(1)} more hours for PRESENT)`
      };
    }
    
    return {
      status: null,
      message: 'No sessions recorded'
    };
  }
};
