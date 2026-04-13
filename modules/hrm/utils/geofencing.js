/**
 * Geofencing utilities for attendance location validation
 */

/**
 * Calculate distance between two coordinates using Haversine formula
 * @param {number} lat1 - Latitude of point 1
 * @param {number} lon1 - Longitude of point 1
 * @param {number} lat2 - Latitude of point 2
 * @param {number} lon2 - Longitude of point 2
 * @returns {number} Distance in meters
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in meters
}

/**
 * Detect device type from User-Agent header
 * @param {string} userAgent - User-Agent header string
 * @returns {string} 'mobile' or 'desktop'
 */
function detectDevice(userAgent) {
  if (!userAgent) return 'desktop';
  
  const ua = userAgent.toLowerCase();
  
  // Check for mobile devices
  const mobileKeywords = [
    'mobile', 'android', 'iphone', 'ipad', 'ipod', 
    'blackberry', 'windows phone', 'webos', 'opera mini'
  ];
  
  const isMobile = mobileKeywords.some(keyword => ua.includes(keyword));
  
  return isMobile ? 'mobile' : 'desktop';
}

/**
 * Get allowed radius based on device type
 * @param {string} deviceType - 'mobile' or 'desktop'
 * @param {number} baseRadius - Base radius from OSC/Hub settings (geofence_radius_meters)
 * @returns {number} Allowed radius in meters
 */
function getAllowedRadius(deviceType, baseRadius = 100) {
  // Get multipliers from environment or use defaults
  const mobileMultiplier = parseFloat(process.env.GEOFENCE_MOBILE_MULTIPLIER) || 2;
  const desktopMultiplier = parseFloat(process.env.GEOFENCE_DESKTOP_MULTIPLIER) || 1;
  
  // Apply device-specific multiplier to base radius
  const multiplier = deviceType === 'mobile' ? mobileMultiplier : desktopMultiplier;
  const calculatedRadius = Math.round(baseRadius * multiplier);
  
  // Add small buffer for GPS accuracy (5 meters minimum)
  const buffer = Math.max(5, Math.round(calculatedRadius * 0.05)); // 5% buffer, min 5m
  return calculatedRadius + buffer;
}

/**
 * Validate if user location is within allowed geofence
 * @param {Object} params - Validation parameters
 * @param {number} params.userLat - User's latitude
 * @param {number} params.userLon - User's longitude
 * @param {number} params.targetLat - Target location latitude (OSC/Hub)
 * @param {number} params.targetLon - Target location longitude (OSC/Hub)
 * @param {number} params.allowedRadius - Allowed radius in meters
 * @returns {Object} Validation result with distance and isWithinRange
 */
function validateGeofence({ userLat, userLon, targetLat, targetLon, allowedRadius }) {
  // Calculate distance
  const distance = calculateDistance(userLat, userLon, targetLat, targetLon);
  
  // Check if within range
  const isWithinRange = distance <= allowedRadius;
  
  return {
    distance: Math.round(distance),
    allowedRadius,
    isWithinRange,
    message: isWithinRange 
      ? `Within range (${Math.round(distance)}m from location)` 
      : `Outside range (${Math.round(distance)}m away, allowed: ${allowedRadius}m)`
  };
}

module.exports = {
  calculateDistance,
  detectDevice,
  getAllowedRadius,
  validateGeofence
};
