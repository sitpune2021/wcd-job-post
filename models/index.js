// ============================================================================
// MODELS INDEX
// ============================================================================
// Purpose: Central export for all Sequelize models and associations
// 
// Audit Tracking: All models automatically track created_by, updated_by,
// deleted_by using hooks that read from auditContext (set by middleware)
// ============================================================================

const sequelize = require('../config/db');
const { Sequelize } = require('sequelize');
const logger = require('../config/logger');
const { applyAuditHooks } = require('../utils/auditContext');

const db = {};

// Import all models directly
db.Permission = require('./Permission');
db.Role = require('./Role');
db.RolePermission = require('./RolePermission');
db.ApplicantMaster = require('./ApplicantMaster');
db.AdminUser = require('./AdminUser');
db.ApplicantPersonal = require('./ApplicantPersonal');
db.ApplicantAddress = require('./ApplicantAddress');
db.ApplicantEducation = require('./ApplicantEducation');
db.ApplicantExperience = require('./ApplicantExperience');
db.ApplicantSkill = require('./ApplicantSkill');
db.ApplicantDocument = require('./ApplicantDocument');
db.Application = require('./Application');
db.EligibilityResult = require('./EligibilityResult');
db.MeritList = require('./MeritList');
db.ApplicationStatusHistory = require('./ApplicationStatusHistory');
db.Component = require('./Component');
db.Department = require('./Department');
db.DistrictMaster = require('./DistrictMaster');
db.SkillMaster = require('./SkillMaster');
db.TalukaMaster = require('./TalukaMaster');
db.PostMaster = require('./PostMaster');
db.DocumentType = require('./DocumentType');
db.ApplicationStatus = require('./ApplicationStatus');
db.EducationLevel = require('./EducationLevel');
db.AuditLog = require('./AuditLog');
db.NotificationLog = require('./NotificationLog');
db.OtpLog = require('./OtpLog');
db.RefreshToken = require('./RefreshToken');
db.LoginAttempt = require('./LoginAttempt');
db.BannerMaster = require('./BannerMaster');

// Category Master and Post Categories
db.CategoryMaster = require('./CategoryMaster');
db.PostCategory = require('./PostCategory');
db.PostAllotmentUpload = require('./PostAllotmentUpload');

// New models for Phase 1
db.ExperienceDomain = require('./ExperienceDomain')(sequelize);
db.StreamGroup = require('./StreamGroup')(sequelize);
db.PostDocumentRequirement = require('./PostDocumentRequirement')(sequelize);
db.RejectionReason = require('./RejectionReason')(sequelize);

// Acknowledgements tracking
db.ApplicantAcknowledgement = require('./ApplicantAcknowledgement');

// Document Verification and Stage History
db.DocumentVerification = require('./DocumentVerification');
db.ApplicationStageHistory = require('./ApplicationStageHistory');

// Allotment Email Distribution System
db.AllotmentEmailSchedule = require('./AllotmentEmailSchedule');
db.AllotmentEmailTracking = require('./AllotmentEmailTracking');

// Set up associations
// Role <-> Permission (Many-to-Many)
db.Role.belongsToMany(db.Permission, { 
  through: db.RolePermission, 
  foreignKey: 'role_id',
  otherKey: 'permission_id',
  as: 'permissions'
});
db.Permission.belongsToMany(db.Role, { 
  through: db.RolePermission, 
  foreignKey: 'permission_id',
  otherKey: 'role_id',
  as: 'roles'
});

// AdminUser -> Role
db.AdminUser.belongsTo(db.Role, { foreignKey: 'role_id', as: 'role' });
db.Role.hasMany(db.AdminUser, { foreignKey: 'role_id', as: 'users' });

// AdminUser -> DistrictMaster
db.AdminUser.belongsTo(db.DistrictMaster, { foreignKey: 'district_id', as: 'district' });
db.DistrictMaster.hasMany(db.AdminUser, { foreignKey: 'district_id', as: 'admins' });

// AdminUser -> AdminUser (created_by)
db.AdminUser.belongsTo(db.AdminUser, { foreignKey: 'created_by', as: 'creator' });
db.AdminUser.hasMany(db.AdminUser, { foreignKey: 'created_by', as: 'createdUsers' });

// DistrictMaster -> TalukaMaster
db.DistrictMaster.hasMany(db.TalukaMaster, { foreignKey: 'district_id', as: 'talukas' });
db.TalukaMaster.belongsTo(db.DistrictMaster, { foreignKey: 'district_id', as: 'district' });

// ApplicantAddress -> DistrictMaster / TalukaMaster
db.ApplicantAddress.belongsTo(db.DistrictMaster, { foreignKey: 'district_id', as: 'district' });
db.DistrictMaster.hasMany(db.ApplicantAddress, { foreignKey: 'district_id', as: 'applicantAddresses' });
db.ApplicantAddress.belongsTo(db.TalukaMaster, { foreignKey: 'taluka_id', as: 'taluka' });
db.TalukaMaster.hasMany(db.ApplicantAddress, { foreignKey: 'taluka_id', as: 'applicantAddresses' });

db.ApplicantAddress.belongsTo(db.DistrictMaster, { foreignKey: 'permanent_district_id', as: 'permanentDistrict' });
db.DistrictMaster.hasMany(db.ApplicantAddress, { foreignKey: 'permanent_district_id', as: 'permanentApplicantAddresses' });
db.ApplicantAddress.belongsTo(db.TalukaMaster, { foreignKey: 'permanent_taluka_id', as: 'permanentTaluka' });
db.TalukaMaster.hasMany(db.ApplicantAddress, { foreignKey: 'permanent_taluka_id', as: 'permanentApplicantAddresses' });

// ApplicantMaster associations
db.ApplicantMaster.hasOne(db.ApplicantPersonal, { foreignKey: 'applicant_id', as: 'personal' });
db.ApplicantMaster.hasOne(db.ApplicantAddress, { foreignKey: 'applicant_id', as: 'address' });
db.ApplicantMaster.hasMany(db.ApplicantEducation, { foreignKey: 'applicant_id', as: 'education' });
db.ApplicantMaster.hasMany(db.ApplicantExperience, { foreignKey: 'applicant_id', as: 'experience' });
db.ApplicantMaster.hasMany(db.ApplicantSkill, { foreignKey: 'applicant_id', as: 'skills' });
db.ApplicantMaster.hasMany(db.ApplicantDocument, { foreignKey: 'applicant_id', as: 'documents' });
db.ApplicantMaster.hasMany(db.Application, { foreignKey: 'applicant_id', as: 'applications' });

// ApplicantSkill -> ApplicantMaster
db.ApplicantSkill.belongsTo(db.ApplicantMaster, { foreignKey: 'applicant_id', as: 'applicant' });

// Application associations
db.Application.belongsTo(db.ApplicantMaster, { foreignKey: 'applicant_id', as: 'applicant' });
db.Application.belongsTo(db.PostMaster, { foreignKey: 'post_id', as: 'post' });
db.Application.belongsTo(db.DistrictMaster, { foreignKey: 'district_id', as: 'district' });
db.DistrictMaster.hasMany(db.Application, { foreignKey: 'district_id', as: 'applications' });
db.Application.belongsTo(db.AdminUser, { foreignKey: 'verified_by', as: 'verifier' });
db.Application.hasOne(db.EligibilityResult, { foreignKey: 'application_id', as: 'eligibility' });
db.Application.hasOne(db.MeritList, { foreignKey: 'application_id', as: 'merit' });
db.Application.hasMany(db.ApplicationStatusHistory, { foreignKey: 'application_id', as: 'statusHistory' });
db.ApplicationStatusHistory.belongsTo(db.Application, { foreignKey: 'application_id', as: 'application' });
db.ApplicationStatusHistory.belongsTo(db.AdminUser, { foreignKey: 'changed_by', as: 'changedByUser' });

// Component -> District
db.Component.belongsTo(db.DistrictMaster, { foreignKey: 'district_id', as: 'district' });
db.DistrictMaster.hasMany(db.Component, { foreignKey: 'district_id', as: 'components' });

// PostMaster -> Component
db.PostMaster.belongsTo(db.Component, { foreignKey: 'component_id', as: 'component' });
db.Component.hasMany(db.PostMaster, { foreignKey: 'component_id', as: 'posts' });

// PostMaster -> EducationLevel (min education requirement)
db.PostMaster.belongsTo(db.EducationLevel, { foreignKey: 'min_education_level_id', as: 'minEducationLevel' });
db.EducationLevel.hasMany(db.PostMaster, { foreignKey: 'min_education_level_id', as: 'posts' });

// EducationLevel -> DocumentType (optional)
db.EducationLevel.belongsTo(db.DocumentType, { foreignKey: 'doc_type_id', as: 'documentType' });
db.DocumentType.hasMany(db.EducationLevel, { foreignKey: 'doc_type_id', as: 'educationLevels' });

// PostMaster -> ExperienceDomain
db.PostMaster.belongsTo(db.ExperienceDomain, { foreignKey: 'experience_domain_id', as: 'experienceDomain' });
db.ExperienceDomain.hasMany(db.PostMaster, { foreignKey: 'experience_domain_id', as: 'posts' });

// PostMaster -> DistrictMaster (for district-specific posts)
db.PostMaster.belongsTo(db.DistrictMaster, { foreignKey: 'district_id', as: 'district' });
db.DistrictMaster.hasMany(db.PostMaster, { foreignKey: 'district_id', as: 'posts' });

// ExperienceDomain -> DocumentType (optional)
db.ExperienceDomain.belongsTo(db.DocumentType, { foreignKey: 'doc_type_id', as: 'documentType' });
db.DocumentType.hasMany(db.ExperienceDomain, { foreignKey: 'doc_type_id', as: 'experienceDomains' });

// PostDocumentRequirement associations
db.PostDocumentRequirement.belongsTo(db.PostMaster, { foreignKey: 'post_id', as: 'post' });
db.PostDocumentRequirement.belongsTo(db.DocumentType, { foreignKey: 'doc_type_id', as: 'documentType' });
db.PostMaster.hasMany(db.PostDocumentRequirement, { foreignKey: 'post_id', as: 'documentRequirements' });
db.DocumentType.hasMany(db.PostDocumentRequirement, { foreignKey: 'doc_type_id', as: 'postRequirements' });

// PostAllotmentUpload associations
db.PostAllotmentUpload.belongsTo(db.PostMaster, { foreignKey: 'post_id', as: 'post' });
db.PostMaster.hasOne(db.PostAllotmentUpload, { foreignKey: 'post_id', as: 'allotmentUpload' });

// AllotmentEmailSchedule associations
db.AllotmentEmailSchedule.belongsTo(db.PostMaster, { foreignKey: 'post_id', as: 'post' });
db.AllotmentEmailSchedule.belongsTo(db.PostAllotmentUpload, { foreignKey: 'upload_id', as: 'upload' });
db.AllotmentEmailSchedule.belongsTo(db.AdminUser, { foreignKey: 'created_by', as: 'creator' });
db.PostMaster.hasMany(db.AllotmentEmailSchedule, { foreignKey: 'post_id', as: 'emailSchedules' });
db.PostAllotmentUpload.hasMany(db.AllotmentEmailSchedule, { foreignKey: 'upload_id', as: 'emailSchedules' });
db.AdminUser.hasMany(db.AllotmentEmailSchedule, { foreignKey: 'created_by', as: 'emailSchedules' });

// AllotmentEmailTracking associations
db.AllotmentEmailTracking.belongsTo(db.AllotmentEmailSchedule, { foreignKey: 'schedule_id', as: 'schedule' });
db.AllotmentEmailTracking.belongsTo(db.PostMaster, { foreignKey: 'post_id', as: 'post' });
db.AllotmentEmailTracking.belongsTo(db.ApplicantMaster, { foreignKey: 'applicant_id', as: 'applicant' });
db.AllotmentEmailTracking.belongsTo(db.Application, { foreignKey: 'application_id', as: 'application' });
db.AllotmentEmailSchedule.hasMany(db.AllotmentEmailTracking, { foreignKey: 'schedule_id', as: 'trackings' });
db.PostMaster.hasMany(db.AllotmentEmailTracking, { foreignKey: 'post_id', as: 'emailTrackings' });
db.ApplicantMaster.hasMany(db.AllotmentEmailTracking, { foreignKey: 'applicant_id', as: 'emailTrackings' });

// ApplicantExperience -> ExperienceDomain
db.ApplicantExperience.belongsTo(db.ExperienceDomain, { foreignKey: 'domain_id', as: 'domain' });
db.ExperienceDomain.hasMany(db.ApplicantExperience, { foreignKey: 'domain_id', as: 'experiences' });

// ApplicantEducation -> EducationLevel
db.ApplicantEducation.belongsTo(db.EducationLevel, { foreignKey: 'education_level_id', as: 'educationLevel' });
db.EducationLevel.hasMany(db.ApplicantEducation, { foreignKey: 'education_level_id', as: 'applicantEducations' });

// ApplicantSkill -> SkillMaster
db.ApplicantSkill.belongsTo(db.SkillMaster, { foreignKey: 'skill_id', as: 'skill' });
db.SkillMaster.hasMany(db.ApplicantSkill, { foreignKey: 'skill_id', as: 'applicantSkills' });

// ApplicantDocument -> DocumentType
db.ApplicantDocument.belongsTo(db.DocumentType, { foreignKey: 'doc_type_id', as: 'documentType' });
db.DocumentType.hasMany(db.ApplicantDocument, { foreignKey: 'doc_type_id', as: 'applicantDocuments' });

// CategoryMaster associations
// ApplicantPersonal -> CategoryMaster
db.ApplicantPersonal.belongsTo(db.CategoryMaster, { foreignKey: 'category_id', as: 'categoryMaster' });
db.CategoryMaster.hasMany(db.ApplicantPersonal, { foreignKey: 'category_id', as: 'applicants' });

// PostMaster <-> CategoryMaster (Many-to-Many through PostCategory)
db.PostMaster.belongsToMany(db.CategoryMaster, { 
  through: db.PostCategory, 
  foreignKey: 'post_id',
  otherKey: 'category_id',
  as: 'allowedCategories'
});
db.CategoryMaster.belongsToMany(db.PostMaster, { 
  through: db.PostCategory, 
  foreignKey: 'category_id',
  otherKey: 'post_id',
  as: 'posts'
});

// PostCategory direct associations for querying
db.PostCategory.belongsTo(db.PostMaster, { foreignKey: 'post_id', as: 'post' });
db.PostCategory.belongsTo(db.CategoryMaster, { foreignKey: 'category_id', as: 'category' });
db.PostMaster.hasMany(db.PostCategory, { foreignKey: 'post_id', as: 'postCategories' });
db.CategoryMaster.hasMany(db.PostCategory, { foreignKey: 'category_id', as: 'categoryPosts' });

// PostMaster -> EducationLevel (max education requirement)
db.PostMaster.belongsTo(db.EducationLevel, { foreignKey: 'max_education_level_id', as: 'maxEducationLevel' });

// ApplicantAcknowledgement associations
db.ApplicantAcknowledgement.belongsTo(db.ApplicantMaster, { foreignKey: 'applicant_id', as: 'applicant' });
db.ApplicantMaster.hasMany(db.ApplicantAcknowledgement, { foreignKey: 'applicant_id', as: 'acknowledgements' });
db.ApplicantAcknowledgement.belongsTo(db.Application, { foreignKey: 'application_id', as: 'application' });
db.Application.hasMany(db.ApplicantAcknowledgement, { foreignKey: 'application_id', as: 'acknowledgements' });

// MeritList -> DistrictMaster
db.MeritList.belongsTo(db.DistrictMaster, { foreignKey: 'district_id', as: 'district' });
db.DistrictMaster.hasMany(db.MeritList, { foreignKey: 'district_id', as: 'meritLists' });

// DocumentVerification associations
db.DocumentVerification.belongsTo(db.Application, { foreignKey: 'application_id', as: 'application' });
db.Application.hasMany(db.DocumentVerification, { foreignKey: 'application_id', as: 'documentVerifications' });
db.DocumentVerification.belongsTo(db.AdminUser, { foreignKey: 'verified_by', as: 'verifier' });

// ApplicationStageHistory associations
db.ApplicationStageHistory.belongsTo(db.Application, { foreignKey: 'application_id', as: 'application' });
db.Application.hasMany(db.ApplicationStageHistory, { foreignKey: 'application_id', as: 'stageHistory' });
db.ApplicationStageHistory.belongsTo(db.AdminUser, { foreignKey: 'entered_by', as: 'enteredByUser' });
db.ApplicationStageHistory.belongsTo(db.AdminUser, { foreignKey: 'exited_by', as: 'exitedByUser' });

db.sequelize = sequelize;
db.Sequelize = Sequelize;

// ==================== APPLY AUDIT HOOKS TO ALL MODELS ====================
// This enables automatic tracking of created_by, updated_by, deleted_by
// The actual user ID is obtained from auditContext (set by middleware)

const modelsWithAudit = [
  'AdminUser', 'Role', 'Permission', 'RolePermission',
  'ApplicantMaster', 'ApplicantPersonal', 'ApplicantAddress',
  'ApplicantEducation', 'ApplicantExperience', 'ApplicantDocument',
  'Application', 'EligibilityResult', 'MeritList',
  'Component', 'DistrictMaster', 'TalukaMaster', 'PostMaster',
  'SkillMaster',
  'DocumentType', 'EducationLevel', 'CategoryMaster', 'PostCategory',
  'ExperienceDomain', 'StreamGroup', 'PostDocumentRequirement', 'RejectionReason',
  'PostAllotmentUpload', 'DocumentVerification', 'BannerMaster',
  'AllotmentEmailSchedule'
];

modelsWithAudit.forEach(modelName => {
  if (db[modelName]) {
    applyAuditHooks(db[modelName]);
  }
});

module.exports = db;
