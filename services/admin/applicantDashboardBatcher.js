const { sequelize } = require('../../config/db');
const {
  ApplicantMaster,
  ApplicantPersonal,
  ApplicantAddress,
  ApplicantEducation,
  ApplicantExperience,
  ApplicantDocument,
  Application,
  DocumentType
} = require('../../models');
const logger = require('../../config/logger');

/**
 * Batch fetch dashboard data for multiple applicants
 * Eliminates N+1 queries by fetching all data in 2-3 queries
 * @param {Array<number>} applicantIds - Array of applicant IDs
 * @returns {Promise<Object>} - Map of applicantId -> dashboard data
 */
const batchGetDashboards = async (applicantIds) => {
  const batchStart = Date.now();
  const batchId = `BATCH-${Date.now()}-${applicantIds.length}`;
  
  try {
    logger.info(`[${batchId}] Batch dashboard START for ${applicantIds.length} applicants`);
    
    if (!applicantIds || applicantIds.length === 0) {
      return {};
    }

    // QUERY 1: Fetch all applicant master data with associations in ONE query
    const fetchStart = Date.now();
    const applicants = await ApplicantMaster.findAll({
      where: { applicant_id: applicantIds },
      include: [
        { model: ApplicantPersonal, as: 'personal', required: false },
        { model: ApplicantAddress, as: 'address', required: false },
        { 
          model: ApplicantEducation, 
          as: 'education', 
          required: false,
          where: { is_deleted: false },
          required: false
        },
        { 
          model: ApplicantExperience, 
          as: 'experience', 
          required: false,
          where: { is_deleted: false },
          required: false
        },
        { 
          model: ApplicantDocument, 
          as: 'documents',
          required: false,
          where: { is_deleted: false },
          required: false
        }
      ]
    });
    const fetchTime = Date.now() - fetchStart;
    logger.info(`[${batchId}] Batch fetch applicants: ${fetchTime}ms, count=${applicants.length}`);

    // QUERY 2: Fetch all applications for these applicants in ONE query
    const appsStart = Date.now();
    const applications = await Application.findAll({
      where: { 
        applicant_id: applicantIds,
        is_deleted: false
      },
      attributes: ['application_id', 'applicant_id', 'post_id', 'status']
    });
    const appsTime = Date.now() - appsStart;
    
    logger.info(`[${batchId}] Fetched ${applications.length} applications: ${appsTime}ms`);

    // QUERY 3: Fetch all mandatory document types (once for all applicants)
    const docTypesStart = Date.now();
    const requiredDocTypes = await DocumentType.findAll({
      where: { is_mandatory: true, is_active: true },
      attributes: ['doc_type_id', 'doc_code']
    });
    const docTypesTime = Date.now() - docTypesStart;
    
    logger.info(`[${batchId}] Fetched ${requiredDocTypes.length} mandatory document types: ${docTypesTime}ms`);

    // Group applications by applicant_id
    const applicationsByApplicant = {};
    for (const app of applications) {
      const aid = app.applicant_id;
      if (!applicationsByApplicant[aid]) {
        applicationsByApplicant[aid] = [];
      }
      applicationsByApplicant[aid].push(app);
    }

    // Build dashboard data for each applicant
    const dashboardMap = {};
    const processStart = Date.now();
    
    for (const applicant of applicants) {
      const applicantId = applicant.applicant_id;
      const personal = applicant.personal;
      const address = applicant.address;
      const education = applicant.education || [];
      const experience = applicant.experience || [];
      const documents = (applicant.documents || []).filter(d => !d.is_deleted);

      // Calculate profile completion
      const personalMissing = [];
      if (!personal || !personal.dob) personalMissing.push('dob');
      if (!personal || !personal.gender) personalMissing.push('gender');
      const personalCompleted = personalMissing.length === 0;

      const addressMissing = [];
      if (!address || !address.address_line) addressMissing.push('address_line');
      if (!address || !address.district_id) addressMissing.push('district_id');
      if (!address || !address.taluka_id) addressMissing.push('taluka_id');
      if (!address || !address.pincode) addressMissing.push('pincode');
      const addressCompleted = addressMissing.length === 0;

      const educationCompleted = education.length > 0;
      
      const wantsExperience = personal?.has_experience;
      let experienceCompleted;
      if (wantsExperience === true) {
        experienceCompleted = experience.length > 0;
      } else if (wantsExperience === false) {
        experienceCompleted = true;
      } else {
        experienceCompleted = experience.length > 0;
      }

      // Documents - proper check to match applicant dashboard exactly
      // Use pre-fetched mandatory document types
      
      const uploadedDocTypeIds = new Set(
        documents
          .filter(d => !d.is_deleted && d.doc_type_id)
          .map(d => d.doc_type_id)
      );
      
      const uploadedDocCodes = new Set(
        documents
          .filter(d => !d.is_deleted)
          .map(d => (d.doc_type || '').toString().trim().toUpperCase())
          .filter(Boolean)
      );
      
      let documentsMissing = [];
      for (const req of requiredDocTypes) {
        const requiredId = req?.doc_type_id;
        const requiredCode = (req?.doc_code || '').toString().trim().toUpperCase();
        if (!requiredId && !requiredCode) continue;

        const hasById = requiredId ? uploadedDocTypeIds.has(requiredId) : false;
        const hasByCode = requiredCode ? uploadedDocCodes.has(requiredCode) : false;

        if (!hasById && !hasByCode) {
          documentsMissing.push(`Document type ${requiredId || requiredCode} required`);
        }
      }
      
      const documentsCompleted = requiredDocTypes.length === 0 ? true : documentsMissing.length === 0;

      // Weights
      const weights = {
        personal: 25,
        address: 20,
        education: 25,
        experience: 15,
        documents: 15
      };

      const sections = {
        personal: { weight: weights.personal, completed: personalCompleted },
        address: { weight: weights.address, completed: addressCompleted },
        education: { weight: weights.education, completed: educationCompleted },
        experience: { weight: weights.experience, completed: experienceCompleted },
        documents: { weight: weights.documents, completed: documentsCompleted }
      };

      const totalWeight = Object.values(weights).reduce((sum, w) => sum + w, 0);
      const completedWeight = Object.entries(sections)
        .filter(([, s]) => s.completed)
        .reduce((sum, [, s]) => sum + s.weight, 0);

      const percentage = Math.round((completedWeight / totalWeight) * 100);

      // Application counts
      const applicantApps = applicationsByApplicant[applicantId] || [];
      const normalizeStatus = (raw) => {
        if (!raw) return null;
        const s = raw.toString().trim().toUpperCase().replace(/\s+/g, '_');
        if (s === 'HOLD' || s === 'ONHOLD' || s === 'ON-HOLD') return 'ON_HOLD';
        if (s === 'REJECT' || s === 'REJECTED') return 'REJECTED';
        if (s === 'SELECT' || s === 'SELECTED') return 'SELECTED';
        if (s === 'NOTELIGIBLE' || s === 'NOT-ELIGIBLE') return 'NOT_ELIGIBLE';
        return s;
      };

      const counts = {
        total: 0,
        draft: 0,
        eligible: 0,
        selected: 0,
        rejected: 0,
        on_hold: 0,
        not_eligible: 0
      };

      for (const a of applicantApps) {
        counts.total += 1;
        const s = normalizeStatus(a.status);
        if (s === 'DRAFT') counts.draft += 1;
        else if (s === 'ELIGIBLE') counts.eligible += 1;
        else if (s === 'SELECTED') counts.selected += 1;
        else if (s === 'REJECTED') counts.rejected += 1;
        else if (s === 'ON_HOLD') counts.on_hold += 1;
        else if (s === 'NOT_ELIGIBLE') counts.not_eligible += 1;
      }

      // Store simplified dashboard data
      dashboardMap[applicantId] = {
        profile_completion: percentage,
        application_count: counts.total,
        applications_submitted: counts.total - counts.draft,
        sections_completed: {
          personal: personalCompleted,
          address: addressCompleted,
          education: educationCompleted,
          experience: experienceCompleted,
          documents: documentsCompleted
        }
      };
    }

    const processTime = Date.now() - processStart;
    const totalTime = Date.now() - batchStart;
    
    logger.info(`[${batchId}] Batch processing: ${processTime}ms`);
    logger.info(`[${batchId}] Batch dashboard COMPLETE: ${totalTime}ms for ${applicantIds.length} applicants (avg: ${Math.round(totalTime / applicantIds.length)}ms per applicant)`);
    logger.info(`[${batchId}] Performance: fetch=${fetchTime}ms, apps=${appsTime}ms, docTypes=${docTypesTime}ms, process=${processTime}ms`);

    return dashboardMap;
  } catch (error) {
    const totalTime = Date.now() - batchStart;
    logger.error(`[${batchId}] Batch dashboard error after ${totalTime}ms:`, error);
    throw error;
  }
};

module.exports = {
  batchGetDashboards
};
