// ============================================================================
// ADMIN SERVICES INDEX
// ============================================================================
// Purpose: Central export for all admin services
// ============================================================================

const applicationReviewService = require('./applicationReviewService');

module.exports = {
  applicationReviewService,
  
  // Flat exports for convenience
  getActivePostsWithCounts: applicationReviewService.getActivePostsWithCounts,
  getApplicationsForPost: applicationReviewService.getApplicationsForPost,
  getAllApplications: applicationReviewService.getAllApplications,
  bulkUpdateStatus: applicationReviewService.bulkUpdateStatus,
  updateApplicationStatus: applicationReviewService.updateApplicationStatus,
  getApplicationDetail: applicationReviewService.getApplicationDetail,
  getApplicationHistory: applicationReviewService.getApplicationHistory
};
