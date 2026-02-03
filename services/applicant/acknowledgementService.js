const db = require('../../models');
const logger = require('../../config/logger');

class AcknowledgementService {
  /**
   * Save multiple acknowledgments for an applicant
   * @param {number} applicantId - Applicant ID
   * @param {Array} acknowledgements - Array of acknowledgment objects
   * @param {Object} options - Additional options
   * @returns {Promise<Array>} - Created acknowledgments
   */
  static async saveAcknowledgements(applicantId, acknowledgements, options = {}) {
    const { applicationId = null, actionType = 'GENERAL', ipAddress, userAgent } = options;
    
    try {
      const acknowledgementsToCreate = acknowledgements.map(ack => ({
        applicant_id: applicantId,
        application_id: applicationId,
        action_type: actionType,
        checkbox_code: ack.code || ack.checkbox_code,
        checkbox_label: ack.label || ack.checkbox_label,
        ip_address: ipAddress,
        user_agent: userAgent,
        accepted_at: new Date()
      }));

      const created = await db.ApplicantAcknowledgement.bulkCreate(acknowledgementsToCreate);
      
      logger.info(`ACKNOWLEDGEMENTS: Saved ${created.length} acknowledgments for applicant ${applicantId}`);
      
      return created;
    } catch (error) {
      logger.error('ACKNOWLEDGEMENTS: Error saving acknowledgments:', error);
      throw error;
    }
  }

  /**
   * Get acknowledgments for an applicant
   * @param {number} applicantId - Applicant ID
   * @param {Object} filters - Filter options
   * @returns {Promise<Array>} - Acknowledgments
   */
  static async getApplicantAcknowledgements(applicantId, filters = {}) {
    const { actionType, applicationId } = filters;
    
    try {
      const whereClause = { applicant_id: applicantId };
      
      if (actionType) {
        whereClause.action_type = actionType;
      }
      
      if (applicationId) {
        whereClause.application_id = applicationId;
      }

      const acknowledgements = await db.ApplicantAcknowledgement.findAll({
        where: whereClause,
        order: [['created_at', 'DESC']]
      });

      return acknowledgements;
    } catch (error) {
      logger.error('ACKNOWLEDGEMENTS: Error fetching acknowledgments:', error);
      throw error;
    }
  }

  /**
   * Check if applicant has accepted specific acknowledgments
   * @param {number} applicantId - Applicant ID
   * @param {Array} requiredCodes - Array of required checkbox codes
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} - Object with acceptance status
   */
  static async checkRequiredAcknowledgements(applicantId, requiredCodes, options = {}) {
    const { actionType } = options;
    
    try {
      const whereClause = {
        applicant_id: applicantId,
        checkbox_code: requiredCodes
      };
      
      if (actionType) {
        whereClause.action_type = actionType;
      }

      const acknowledgements = await db.ApplicantAcknowledgement.findAll({
        where: whereClause,
        attributes: ['checkbox_code', 'accepted_at']
      });

      const acceptedCodes = acknowledgements.map(ack => ack.checkbox_code);
      const missingCodes = requiredCodes.filter(code => !acceptedCodes.includes(code));
      
      return {
        allAccepted: missingCodes.length === 0,
        acceptedCodes,
        missingCodes,
        acknowledgements: acknowledgements
      };
    } catch (error) {
      logger.error('ACKNOWLEDGEMENTS: Error checking required acknowledgments:', error);
      throw error;
    }
  }

  /**
   * Get acknowledgment summary for an applicant
   * @param {number} applicantId - Applicant ID
   * @returns {Promise<Object>} - Summary of acknowledgments
   */
  static async getAcknowledgementSummary(applicantId) {
    try {
      const summary = await db.ApplicantAcknowledgement.findAll({
        where: { applicant_id: applicantId },
        attributes: [
          'action_type',
          [require('sequelize').fn('COUNT', require('sequelize').col('acknowledgement_id')), 'count'],
          [require('sequelize').fn('MAX', require('sequelize').col('created_at')), 'last_updated']
        ],
        group: ['action_type'],
        raw: true
      });

      return summary;
    } catch (error) {
      logger.error('ACKNOWLEDGEMENTS: Error getting acknowledgment summary:', error);
      throw error;
    }
  }
}

module.exports = AcknowledgementService;
