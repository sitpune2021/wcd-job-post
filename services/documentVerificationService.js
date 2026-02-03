/**
 * Document Verification Service
 * Handles document verification workflow for applications
 */
const db = require('../models');
const { Op } = require('sequelize');
const logger = require('../config/logger');
const { ApiError } = require('../middleware/errorHandler');

class DocumentVerificationService {
  
  /**
   * Get all documents for an application that need verification
   * @param {number} applicationId - Application ID
   * @returns {Promise<Array>} - List of documents with verification status
   */
  async getApplicationDocuments(applicationId, transaction = null) {
    try {
      const application = await db.Application.findByPk(applicationId, {
        include: [
          {
            model: db.ApplicantMaster,
            as: 'applicant',
            required: false, // Use LEFT JOIN instead of INNER JOIN
            include: [
              { model: db.ApplicantPersonal, as: 'personal', required: false },
              { model: db.ApplicantEducation, as: 'education', required: false },
              { model: db.ApplicantExperience, as: 'experience', required: false },
              { model: db.ApplicantSkill, as: 'skills', required: false, include: [{ model: db.SkillMaster, as: 'skill', required: false }] }
            ]
          }
        ],
        transaction
      });

      if (!application) {
        throw new ApiError(404, 'Application not found');
      }

      const documents = [];
      const personal = application.applicant?.personal;
      
      
      // Core personal documents
      if (personal) {
        const normalizePath = (path) => path ? path.replace(/^\/+/, '') : null;
        
        if (personal.photo_path) {
          documents.push({
            type: 'PHOTO',
            path: normalizePath(personal.photo_path),
            label: 'Photograph',
            referenceId: null
          });
        }
        if (personal.signature_path) {
          documents.push({
            type: 'SIGNATURE',
            path: normalizePath(personal.signature_path),
            label: 'Signature',
            referenceId: null
          });
        }
        if (personal.aadhaar_path) {
          documents.push({
            type: 'AADHAAR',
            path: normalizePath(personal.aadhaar_path),
            label: 'Aadhaar Card',
            referenceId: null
          });
        }
        // PAN temporarily disabled
        // if (personal.pan_path) {
        //   documents.push({
        //     type: 'PAN',
        //     path: normalizePath(personal.pan_path),
        //     label: 'PAN Card',
        //     referenceId: null
        //   });
        // }
        if (personal.resume_path) {
          documents.push({
            type: 'RESUME',
            path: normalizePath(personal.resume_path),
            label: 'Resume/CV',
            referenceId: null
          });
        }
        if (personal.domicile_path) {
          documents.push({
            type: 'DOMICILE',
            path: normalizePath(personal.domicile_path),
            label: 'Domicile Certificate',
            referenceId: null
          });
        }
      }

      // Education certificates
      if (application.applicant?.education) {
        application.applicant.education.forEach((edu, index) => {
          if (edu.certificate_path) {
            documents.push({
              type: 'EDUCATION_CERT',
              path: edu.certificate_path.replace(/^\/+/, ''),
              label: `Education Certificate ${index + 1}`,
              referenceId: edu.education_id
            });
          }
        });
      }

      // Experience certificates
      if (application.applicant?.experience) {
        application.applicant.experience.forEach((exp, index) => {
          if (exp.certificate_path) {
            documents.push({
              type: 'EXPERIENCE_CERT',
              path: exp.certificate_path.replace(/^\/+/, ''),
              label: `Experience Certificate ${index + 1}`,
              referenceId: exp.experience_id
            });
          }
        });
      }

      // Skill certificates
      if (application.applicant?.skills) {
        application.applicant.skills.forEach((skill, index) => {
          if (skill.certificate_path) {
            documents.push({
              type: 'SKILL_CERT',
              path: skill.certificate_path.replace(/^\/+/, ''),
              label: `${skill.skill?.skill_name || 'Skill'} Certificate`,
              referenceId: skill.applicant_skill_id
            });
          }
        });
      }

      // Documents are already collected from personal, education, and experience tables above

      // Get existing verification records
      const verifications = await db.DocumentVerification.findAll({
        where: { application_id: applicationId },
        include: [{ model: db.AdminUser, as: 'verifier', attributes: ['admin_id', 'full_name'] }],
        transaction
      });

      // Map verification status to documents
      const documentsWithStatus = documents.map(doc => {
        const verification = verifications.find(
          v => v.document_type === doc.type && 
               (v.document_reference_id === doc.referenceId || (!v.document_reference_id && !doc.referenceId))
        );

        return {
          ...doc,
          verificationId: verification?.verification_id || null,
          verificationStatus: verification?.verification_status || 'PENDING',
          verifiedBy: verification?.verifier?.full_name || null,
          verifiedAt: verification?.verified_at || null,
          remarks: verification?.remarks || null
        };
      });

      return documentsWithStatus;
    } catch (error) {
      logger.error('Error getting application documents:', error);
      throw error;
    }
  }

  /**
   * Verify a single document or multiple documents
   * @param {number} applicationId - Application ID
   * @param {Array} documents - Array of {type, referenceId, status, remarks}
   * @param {number} verifiedBy - Admin ID who is verifying
   * @returns {Promise<Object>} - Verification result
   */
  async verifyDocuments(applicationId, documents, verifiedBy) {
    const transaction = await db.sequelize.transaction();

    try {
      const application = await db.Application.findByPk(applicationId, { transaction });
      if (!application) {
        throw new ApiError(404, 'Application not found');
      }

      const verificationResults = [];

      for (const doc of documents) {
        // Find or create verification record
        let verification = await db.DocumentVerification.findOne({
          where: {
            application_id: applicationId,
            document_type: doc.type,
            document_reference_id: doc.referenceId || null
          },
          transaction
        });

        if (verification) {
          // Update existing verification
          await verification.update({
            verification_status: doc.status,
            verified_by: verifiedBy,
            verified_at: new Date(),
            remarks: doc.remarks || null
          }, { transaction });
        } else {
          // Create new verification record
          verification = await db.DocumentVerification.create({
            application_id: applicationId,
            document_type: doc.type,
            document_reference_id: doc.referenceId || null,
            document_path: doc.path || null,
            verification_status: doc.status,
            verified_by: verifiedBy,
            verified_at: new Date(),
            remarks: doc.remarks || null
          }, { transaction });
        }

        verificationResults.push(verification);
      }

      // Check if all documents are verified
      const allDocuments = await this.getApplicationDocuments(applicationId, transaction);
      const allVerified = allDocuments.every(doc => doc.verificationStatus === 'VERIFIED');

      // Update application document_verified flag
      await application.update({
        document_verified: allVerified
      }, { transaction });

      await transaction.commit();

      logger.info(`Documents verified for application ${applicationId} by admin ${verifiedBy}`);

      return {
        success: true,
        verifiedCount: documents.length,
        allDocumentsVerified: allVerified,
        verifications: verificationResults
      };
    } catch (error) {
      await transaction.rollback();
      logger.error('Error verifying documents:', error);
      throw error;
    }
  }

  /**
   * Get verification summary for an application
   * @param {number} applicationId - Application ID
   * @returns {Promise<Object>} - Verification summary
   */
  async getVerificationSummary(applicationId) {
    try {
      const documents = await this.getApplicationDocuments(applicationId);
      
      const summary = {
        total: documents.length,
        verified: documents.filter(d => d.verificationStatus === 'VERIFIED').length,
        pending: documents.filter(d => d.verificationStatus === 'PENDING').length,
        rejected: documents.filter(d => d.verificationStatus === 'REJECTED').length,
        allVerified: documents.every(d => d.verificationStatus === 'VERIFIED')
      };

      return summary;
    } catch (error) {
      logger.error('Error getting verification summary:', error);
      throw error;
    }
  }

  /**
   * Bulk verify all documents for an application
   * @param {number} applicationId - Application ID
   * @param {number} verifiedBy - Admin ID who is verifying
   * @param {string} status - VERIFIED or REJECTED
   * @returns {Promise<Object>} - Verification result
   */
  async bulkVerifyAllDocuments(applicationId, verifiedBy, status = 'VERIFIED') {
    try {
      const documents = await this.getApplicationDocuments(applicationId);
      
      const documentsToVerify = documents.map(doc => ({
        type: doc.type,
        referenceId: doc.referenceId,
        path: doc.path,
        status: status,
        remarks: null
      }));

      return await this.verifyDocuments(applicationId, documentsToVerify, verifiedBy);
    } catch (error) {
      logger.error('Error bulk verifying documents:', error);
      throw error;
    }
  }
}

module.exports = new DocumentVerificationService();
