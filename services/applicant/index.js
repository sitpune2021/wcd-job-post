// ============================================================================
// APPLICANT SERVICES INDEX
// ============================================================================
// Purpose: Central export for all applicant services
// Usage: const applicantService = require('./services/applicant');
//        or: const { profileService, documentService } = require('./services/applicant');
// ============================================================================

const profileService = require('./profileService');
const educationService = require('./educationService');
const experienceService = require('./experienceService');
const skillService = require('./skillService');
const documentService = require('./documentService');
const applicationService = require('./applicationService');

// Re-export individual services for granular imports
module.exports = {
  profileService,
  educationService,
  experienceService,
  skillService,
  documentService,
  applicationService,
  
  // Flat exports for backward compatibility with old applicantService
  // Dashboard & Profile
  getDashboard: profileService.getDashboard,
  getProfile: profileService.getProfile,
  savePersonalProfile: profileService.savePersonalProfile,
  saveAddressProfile: profileService.saveAddressProfile,
  saveDomicileCertificate: profileService.saveDomicileCertificate,
  savePhoto: profileService.savePhoto,
  saveSignature: profileService.saveSignature,
  saveAadhaar: profileService.saveAadhaar,
  // PAN disabled intentionally
  // savePan: profileService.savePan,
  saveResume: profileService.saveResume,
  setExperiencePreference: profileService.setExperiencePreference,
  
  // Education
  addEducation: educationService.addEducation,
  updateEducation: educationService.updateEducation,
  deleteEducation: educationService.deleteEducation,
  
  // Experience
  addExperience: experienceService.addExperience,
  updateExperience: experienceService.updateExperience,
  deleteExperience: experienceService.deleteExperience,

  // Skills
  addSkill: skillService.addSkill,
  getSkills: skillService.getSkills,
  deleteSkill: skillService.deleteSkill,
  
  // Documents
  saveDocument: documentService.saveDocument,
  getDocuments: documentService.getDocuments,
  deleteDocument: documentService.deleteDocument,
  getRequiredDocumentTypes: documentService.getRequiredDocumentTypes,
  
  // Applications
  getEligiblePosts: applicationService.getEligiblePosts,
  createApplication: applicationService.createApplication,
  finalSubmitApplication: applicationService.finalSubmitApplication,
  getApplications: applicationService.getApplications,
  getApplicationById: applicationService.getApplicationById,
  getStatistics: applicationService.getStatistics
};
