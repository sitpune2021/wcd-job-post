// ============================================================================
// MASTER SERVICES INDEX
// ============================================================================
// Purpose: Central export for all master data services
// Usage: const masterService = require('./services/masters');
//        or: const { districtService, talukaService } = require('./services/masters');
// ============================================================================

const districtService = require('./districtService');
const talukaService = require('./talukaService');
const departmentService = require('./departmentService');
const categoryService = require('./categoryService');
const educationLevelService = require('./educationLevelService');
const schemeService = require('./schemeService');
const schemeTypeService = require('./schemeTypeService');
const documentTypeService = require('./documentTypeService');
const applicationStatusService = require('./applicationStatusService');
const postMasterService = require('./postMasterService');
const experienceDomainService = require('./experienceDomainService');
const skillService = require('./skillService');

// Re-export individual services for granular imports
module.exports = {
  districtService,
  talukaService,
  departmentService,
  categoryService,
  educationLevelService,
  schemeService,
  schemeTypeService,
  documentTypeService,
  applicationStatusService,
  postMasterService,
  experienceDomainService,
  skillService,
  
  // Flat exports for backward compatibility with old masterService
  // Districts
  getDistricts: districtService.getDistricts,
  getDistrictById: districtService.getDistrictById,
  createDistrict: districtService.createDistrict,
  updateDistrict: districtService.updateDistrict,
  deleteDistrict: districtService.deleteDistrict,
  getAllDistricts: districtService.getAllDistricts,
  
  // Talukas
  getTalukas: talukaService.getTalukas,
  getTalukaById: talukaService.getTalukaById,
  createTaluka: talukaService.createTaluka,
  updateTaluka: talukaService.updateTaluka,
  deleteTaluka: talukaService.deleteTaluka,
  getAllTalukas: talukaService.getAllTalukas,
  
  // Schemes
  getSchemes: schemeService.getAllSchemes,
  getSchemeById: schemeService.getSchemeById,
  createScheme: schemeService.createScheme,
  updateScheme: schemeService.updateScheme,
  deleteScheme: schemeService.deleteScheme,
  getSchemesByType: schemeService.getSchemesByType,
  getSchemeOptions: schemeService.getSchemeOptions,
  validateSchemeCode: schemeService.validateSchemeCode,
  
  // Scheme Types
  getSchemeTypes: schemeTypeService.getAllSchemeTypes,
  getSchemeTypeById: schemeTypeService.getSchemeTypeById,
  createSchemeType: schemeTypeService.createSchemeType,
  updateSchemeType: schemeTypeService.updateSchemeType,
  deleteSchemeType: schemeTypeService.deleteSchemeType,
  
  // Departments
  getDepartments: departmentService.getDepartments,
  getDepartmentById: departmentService.getDepartmentById,
  createDepartment: departmentService.createDepartment,
  updateDepartment: departmentService.updateDepartment,
  deleteDepartment: departmentService.deleteDepartment,
  
  // Categories
  getCategories: categoryService.getCategories,
  getCategoryById: categoryService.getCategoryById,
  getCategoryByCode: categoryService.getCategoryByCode,
  createCategory: categoryService.createCategory,
  updateCategory: categoryService.updateCategory,
  deleteCategory: categoryService.deleteCategory,
  getAllCategories: categoryService.getAllCategories,
  
  // Education Levels
  getEducationLevels: educationLevelService.getEducationLevels,
  getEducationLevelById: educationLevelService.getEducationLevelById,
  createEducationLevel: educationLevelService.createEducationLevel,
  updateEducationLevel: educationLevelService.updateEducationLevel,
  deleteEducationLevel: educationLevelService.deleteEducationLevel,
  
  // Document Types
  getDocumentTypes: documentTypeService.getDocumentTypes,
  getDocumentTypeById: documentTypeService.getDocumentTypeById,
  createDocumentType: documentTypeService.createDocumentType,
  updateDocumentType: documentTypeService.updateDocumentType,
  deleteDocumentType: documentTypeService.deleteDocumentType,
  getAllDocumentTypes: documentTypeService.getAllDocumentTypes,
  
  // Application Statuses
  getApplicationStatuses: applicationStatusService.getApplicationStatuses,
  getApplicationStatusById: applicationStatusService.getApplicationStatusById,
  createApplicationStatus: applicationStatusService.createApplicationStatus,
  updateApplicationStatus: applicationStatusService.updateApplicationStatus,
  deleteApplicationStatus: applicationStatusService.deleteApplicationStatus,
  getAllApplicationStatuses: applicationStatusService.getAllApplicationStatuses,
  
  // Posts
  getPosts: postMasterService.getPosts,
  getPostById: postMasterService.getPostById,
  createPost: postMasterService.createPost,
  updatePost: postMasterService.updatePost,
  deletePost: postMasterService.deletePost,
  bulkUpdatePosts: postMasterService.bulkUpdatePosts,
  
  // Post Categories
  getPostCategories: postMasterService.getPostCategories,
  setPostCategories: postMasterService.setPostCategories,
  addPostCategory: postMasterService.addPostCategory,
  removePostCategory: postMasterService.removePostCategory,
  
  // Experience Domains
  getExperienceDomains: experienceDomainService.getExperienceDomains,
  getExperienceDomainById: experienceDomainService.getExperienceDomainById,
  createExperienceDomain: experienceDomainService.createExperienceDomain,
  updateExperienceDomain: experienceDomainService.updateExperienceDomain,
  deleteExperienceDomain: experienceDomainService.deleteExperienceDomain,
  getAllExperienceDomains: experienceDomainService.getAllExperienceDomains,

  // Skills
  getSkills: skillService.getSkills,
  getSkillById: skillService.getSkillById,
  createSkill: skillService.createSkill,
  updateSkill: skillService.updateSkill,
  deleteSkill: skillService.deleteSkill,

  // Scheme Types
  schemeTypeService,
  getSchemeTypes: schemeTypeService.getSchemeTypes,
  getSchemeTypeById: schemeTypeService.getSchemeTypeById,
  createSchemeType: schemeTypeService.createSchemeType,
  updateSchemeType: schemeTypeService.updateSchemeType,
  deleteSchemeType: schemeTypeService.deleteSchemeType
};
