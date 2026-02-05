const Razorpay = require('razorpay');
const crypto = require('crypto');
const db = require('../models');
const { Op } = require('sequelize');
const logger = require('../config/logger');
const { ApiError } = require('../middleware/errorHandler');

class PaymentService {
  constructor() {
    this.PAYMENT_ENABLED = process.env.PAYMENT_ENABLED === 'true';
    this.BASE_FEE = parseFloat(process.env.PAYMENT_BASE_FEE) || 100;
    this.PLATFORM_FEE_PERCENT = parseFloat(process.env.PAYMENT_PLATFORM_FEE_PERCENT) || 2.5;
    this.CGST_PERCENT = parseFloat(process.env.PAYMENT_CGST_PERCENT) || 9;
    this.SGST_PERCENT = parseFloat(process.env.PAYMENT_SGST_PERCENT) || 9;
    this.MAX_DISTINCT_POST_NAMES = parseInt(process.env.MAX_DISTINCT_POST_NAMES) || 2;

    if (this.PAYMENT_ENABLED) {
      this.razorpay = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET
      });
    }
  }

  /**
   * Calculate payment amount breakdown
   * @returns {Object} - Payment breakdown
   */
  calculatePaymentAmount() {
    const baseFee = this.BASE_FEE;
    const platformFee = (baseFee * this.PLATFORM_FEE_PERCENT) / 100;
    const subtotal = baseFee + platformFee;
    const cgst = (subtotal * this.CGST_PERCENT) / 100;
    const sgst = (subtotal * this.SGST_PERCENT) / 100;
    const totalAmount = subtotal + cgst + sgst;

    return {
      baseFee: parseFloat(baseFee.toFixed(2)),
      platformFee: parseFloat(platformFee.toFixed(2)),
      cgst: parseFloat(cgst.toFixed(2)),
      sgst: parseFloat(sgst.toFixed(2)),
      totalAmount: parseFloat(totalAmount.toFixed(2))
    };
  }

  /**
   * Check if payment is required for a post application
   * @param {number} applicantId - Applicant ID
   * @param {number} postId - Post ID
   * @param {string} postName - Post name
   * @param {number} districtId - District ID
   * @returns {Promise<Object>} - { required: boolean, reason: string, amount: number, breakdown: object }
   */
  async checkPaymentRequired(applicantId, postId, postName, districtId) {
    try {
      // If payment is disabled globally, no payment required
      if (!this.PAYMENT_ENABLED) {
        return {
          required: false,
          reason: 'PAYMENT_DISABLED',
          message: 'Payment is currently disabled'
        };
      }

      // Get all successful payments for this applicant
      const successfulPayments = await db.Payment.findAll({
        where: {
          applicant_id: applicantId,
          payment_status: 'SUCCESS',
          is_deleted: false
        },
        attributes: ['payment_id', 'post_name', 'district_id', 'post_id'],
        order: [['created_at', 'ASC']]
      });

      // If no payments yet, payment is required
      if (successfulPayments.length === 0) {
        const breakdown = this.calculatePaymentAmount();
        return {
          required: true,
          reason: 'FIRST_APPLICATION',
          message: 'Payment required for first application',
          amount: breakdown.totalAmount,
          breakdown
        };
      }

      // Check if already paid for this exact post
      const alreadyPaidForPost = successfulPayments.some(
        payment => payment.post_id === postId
      );

      if (alreadyPaidForPost) {
        return {
          required: false,
          reason: 'ALREADY_PAID_FOR_POST',
          message: 'Payment already completed for this post'
        };
      }

      // Get distinct post names paid for in the same district
      const paidPostNamesInDistrict = successfulPayments
        .filter(payment => payment.district_id === districtId)
        .map(payment => payment.post_name);

      const distinctPaidPostNames = [...new Set(paidPostNamesInDistrict)];

      // Check if current post name is already paid for in this district
      if (distinctPaidPostNames.includes(postName)) {
        return {
          required: false,
          reason: 'SAME_POST_NAME_PAID',
          message: `Payment already completed for "${postName}" in this district. You can apply to different OSCs for free.`
        };
      }

      // Check if distinct post name limit reached
      if (distinctPaidPostNames.length >= this.MAX_DISTINCT_POST_NAMES) {
        return {
          required: false,
          reason: 'POST_NAME_LIMIT_REACHED',
          message: `You have already paid for ${this.MAX_DISTINCT_POST_NAMES} distinct post names. No additional payment required.`
        };
      }

      // Payment required for new distinct post name
      const breakdown = this.calculatePaymentAmount();
      return {
        required: true,
        reason: 'NEW_POST_NAME',
        message: `Payment required for new post name "${postName}" (${distinctPaidPostNames.length + 1}/${this.MAX_DISTINCT_POST_NAMES})`,
        amount: breakdown.totalAmount,
        breakdown,
        paidPostNames: distinctPaidPostNames
      };

    } catch (error) {
      logger.error('Error checking payment requirement:', error);
      throw error;
    }
  }

  /**
   * Create Razorpay order for payment
   * @param {number} applicantId - Applicant ID
   * @param {number} postId - Post ID
   * @param {string} postName - Post name
   * @param {number} districtId - District ID
   * @param {Object} applicationData - Application data (declaration, place, ip, user_agent)
   * @returns {Promise<Object>} - Razorpay order details
   */
  async createPaymentOrder(applicantId, postId, postName, districtId, applicationData = {}) {
    try {
      if (!this.PAYMENT_ENABLED) {
        throw new ApiError(400, 'Payment is currently disabled');
      }

      // Check if payment is required
      const paymentCheck = await this.checkPaymentRequired(applicantId, postId, postName, districtId);

      if (!paymentCheck.required) {
        throw new ApiError(400, paymentCheck.message);
      }

      const breakdown = paymentCheck.breakdown;
      const amountInPaise = Math.round(breakdown.totalAmount * 100);

      // Create Razorpay order
      const razorpayOrder = await this.razorpay.orders.create({
        amount: amountInPaise,
        currency: 'INR',
        receipt: `APPL_${applicantId}_${postId}_${Date.now()}`,
        notes: {
          applicant_id: applicantId,
          post_id: postId,
          post_name: postName,
          district_id: districtId
        }
      });

      // Save payment record with application metadata
      const payment = await db.Payment.create({
        applicant_id: applicantId,
        post_id: postId,
        post_name: postName,
        district_id: districtId,
        razorpay_order_id: razorpayOrder.id,
        amount: breakdown.totalAmount,
        base_fee: breakdown.baseFee,
        platform_fee: breakdown.platformFee,
        cgst: breakdown.cgst,
        sgst: breakdown.sgst,
        payment_status: 'PENDING',
        metadata: {
          razorpay_order: razorpayOrder,
          application_data: {
            declaration_accepted: applicationData.declaration_accepted,
            place: applicationData.place,
            ip_address: applicationData.ip_address,
            user_agent: applicationData.user_agent
          }
        }
      });

      logger.info(`Payment order created for applicant ${applicantId}, post ${postId}`, {
        payment_id: payment.payment_id,
        razorpay_order_id: razorpayOrder.id,
        amount: breakdown.totalAmount
      });

      return {
        payment_id: payment.payment_id,
        razorpay_order_id: razorpayOrder.id,
        amount: breakdown.totalAmount,
        breakdown,
        razorpay_key_id: process.env.RAZORPAY_KEY_ID
      };

    } catch (error) {
      logger.error('Error creating payment order:', error);
      throw error;
    }
  }

  /**
   * Verify Razorpay payment signature
   * @param {string} orderId - Razorpay order ID
   * @param {string} paymentId - Razorpay payment ID
   * @param {string} signature - Razorpay signature
   * @returns {boolean} - Signature is valid
   */
  verifyPaymentSignature(orderId, paymentId, signature) {
    try {
      const text = `${orderId}|${paymentId}`;
      const expectedSignature = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(text)
        .digest('hex');

      return expectedSignature === signature;
    } catch (error) {
      logger.error('Error verifying payment signature:', error);
      return false;
    }
  }

  /**
   * Verify and update payment status
   * @param {string} razorpayOrderId - Razorpay order ID
   * @param {string} razorpayPaymentId - Razorpay payment ID
   * @param {string} razorpaySignature - Razorpay signature
   * @returns {Promise<Object>} - Updated payment record
   */
  async verifyAndUpdatePayment(razorpayOrderId, razorpayPaymentId, razorpaySignature) {
    try {
      // Find payment record
      const payment = await db.Payment.findOne({
        where: {
          razorpay_order_id: razorpayOrderId,
          is_deleted: false
        }
      });

      if (!payment) {
        throw new ApiError(404, 'Payment record not found');
      }

      if (payment.payment_status === 'SUCCESS') {
        throw new ApiError(400, 'Payment already verified');
      }

      // Verify signature
      const isValid = this.verifyPaymentSignature(razorpayOrderId, razorpayPaymentId, razorpaySignature);

      if (!isValid) {
        await payment.update({
          payment_status: 'FAILED',
          failure_reason: 'Invalid payment signature'
        });
        throw new ApiError(400, 'Invalid payment signature');
      }

      // Update payment status
      await payment.update({
        razorpay_payment_id: razorpayPaymentId,
        razorpay_signature: razorpaySignature,
        payment_status: 'SUCCESS',
        paid_at: new Date()
      });

      logger.info(`Payment verified successfully for order ${razorpayOrderId}`, {
        payment_id: payment.payment_id,
        applicant_id: payment.applicant_id
      });

      return payment;

    } catch (error) {
      logger.error('Error verifying payment:', error);
      throw error;
    }
  }

  /**
   * Mark payment as failed
   * @param {string} razorpayOrderId - Razorpay order ID
   * @param {string} reason - Failure reason
   * @returns {Promise<Object>} - Updated payment record
   */
  async markPaymentFailed(razorpayOrderId, reason) {
    try {
      const payment = await db.Payment.findOne({
        where: {
          razorpay_order_id: razorpayOrderId,
          is_deleted: false
        }
      });

      if (!payment) {
        throw new ApiError(404, 'Payment record not found');
      }

      await payment.update({
        payment_status: 'FAILED',
        failure_reason: reason
      });

      logger.info(`Payment marked as failed for order ${razorpayOrderId}`, {
        payment_id: payment.payment_id,
        reason
      });

      return payment;

    } catch (error) {
      logger.error('Error marking payment as failed:', error);
      throw error;
    }
  }

  /**
   * Get payment history for applicant
   * @param {number} applicantId - Applicant ID
   * @returns {Promise<Array>} - Payment history
   */
  async getPaymentHistory(applicantId) {
    try {
      const payments = await db.Payment.findAll({
        where: {
          applicant_id: applicantId,
          is_deleted: false
        },
        include: [
          {
            model: db.PostMaster,
            as: 'post',
            attributes: ['post_id', 'post_name', 'post_code']
          },
          {
            model: db.DistrictMaster,
            as: 'district',
            attributes: ['district_id', 'district_name']
          }
        ],
        order: [['created_at', 'DESC']]
      });

      return payments;

    } catch (error) {
      logger.error('Error getting payment history:', error);
      throw error;
    }
  }
}

module.exports = new PaymentService();
