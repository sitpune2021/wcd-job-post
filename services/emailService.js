const nodemailer = require('nodemailer');
const logger = require('../config/logger');

/**
 * Email Service for Mission Shakti
 * Handles all email communications (OTP, notifications, status updates)
 */
class EmailService {
  constructor() {
    const port = Number.parseInt(process.env.SMTP_PORT, 10) || 587;
    const secure = (process.env.SMTP_SECURE != null)
      ? String(process.env.SMTP_SECURE).toLowerCase() === 'true'
      : port === 465;

    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port,
      secure,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD
      }
    });
  }

  getFrontendBaseUrl(userType = 'APPLICANT') {
    if (userType === 'ADMIN') {
      return process.env.ADMIN_FRONTEND_URL || process.env.FRONTEND_URL;
    }
    return process.env.APPLICANT_FRONTEND_URL || process.env.FRONTEND_URL;
  }

  /**
   * Send OTP via email
   * @param {string} email - Recipient email
   * @param {string} otp - 6-digit OTP
   * @returns {Promise<Object>}
   */
  async sendOTP(email, otp) {
    try {
      const info = await this.transporter.sendMail({
        from: process.env.SMTP_FROM || `Mission Shakti <${process.env.SMTP_USER}>`,
        to: email,
        subject: 'Mission Shakti - OTP Verification',
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: #2c3e50; color: white; padding: 20px; text-align: center; }
              .content { background: #f9f9f9; padding: 30px; border-radius: 5px; margin: 20px 0; }
              .otp { font-size: 32px; font-weight: bold; color: #e74c3c; text-align: center; 
                     padding: 20px; background: white; border-radius: 5px; letter-spacing: 5px; }
              .footer { text-align: center; color: #7f8c8d; font-size: 12px; margin-top: 20px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>Mission Shakti</h1>
                <p>Recruitment Portal</p>
              </div>
              <div class="content">
                <h2>OTP Verification</h2>
                <p>Your One-Time Password (OTP) for registration/login is:</p>
                <div class="otp">${otp}</div>
                <p><strong>This OTP will expire in 5 minutes.</strong></p>
                <p>If you did not request this OTP, please ignore this email.</p>
                <p>For security reasons, never share this OTP with anyone.</p>
              </div>
              <div class="footer">
                <p>This is an automated email from Mission Shakti Recruitment Portal.</p>
                <p>Please do not reply to this email.</p>
              </div>
            </div>
          </body>
          </html>
        `
      });
      
      logger.info(`OTP email sent to ${email}: ${info.messageId}`);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      logger.error('Error sending OTP email:', error);
      return { success: false, error: error.message };
    }
  }

  /**  NOT IN USE
   * Send application submitted confirmation
   * @param {string} email - Applicant email
   * @param {string} applicationNo - Application number
   * @param {string} applicantName - Applicant name
   * @returns {Promise<Object>}
   */
  async sendApplicationSubmitted(email, applicationNo, applicantName) {
    try {
      const info = await this.transporter.sendMail({
        from: process.env.SMTP_FROM || `Mission Shakti <${process.env.SMTP_USER}>`,
        to: email,
        subject: 'Application Submitted Successfully - Mission Shakti',
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: #27ae60; color: white; padding: 20px; text-align: center; }
              .content { background: #f9f9f9; padding: 30px; border-radius: 5px; margin: 20px 0; }
              .app-no { font-size: 24px; font-weight: bold; color: #27ae60; text-align: center; 
                        padding: 15px; background: white; border-radius: 5px; }
              .info-box { background: white; padding: 15px; border-left: 4px solid #27ae60; margin: 15px 0; }
              .footer { text-align: center; color: #7f8c8d; font-size: 12px; margin-top: 20px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>✓ Application Submitted</h1>
              </div>
              <div class="content">
                <p>Dear ${applicantName},</p>
                <p>Your application has been successfully submitted to Mission Shakti Recruitment Portal.</p>
                
                <div class="app-no">Application No: ${applicationNo}</div>
                
                <div class="info-box">
                  <h3>What's Next?</h3>
                  <ul>
                    <li>Your application is now under review</li>
                    <li>You can track your application status on the portal</li>
                    <li>You will receive email notifications for any status updates</li>
                    <li>Keep checking your email and portal dashboard regularly</li>
                  </ul>
                </div>
                
                <div class="info-box">
                  <h3>Important Notes:</h3>
                  <ul>
                    <li>Save your Application Number for future reference</li>
                    <li>Your application is now locked and cannot be edited</li>
                    <li>For any queries, contact the admin portal</li>
                  </ul>
                </div>
                
                <p>Thank you for applying to Mission Shakti!</p>
              </div>
              <div class="footer">
                <p>This is an automated email from Mission Shakti Recruitment Portal.</p>
                <p>Please do not reply to this email.</p>
              </div>
            </div>
          </body>
          </html>
        `
      });
      
      logger.info(`Application submitted email sent to ${email}`);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      logger.error('Error sending application email:', error);
      return { success: false, error: error.message };
    }
  }

  /**  NOT IN USE
   * Send application status update
   * @param {string} email - Applicant email
   * @param {string} applicationNo - Application number
   * @param {string} status - New status
   * @param {string} applicantName - Applicant name
   * @returns {Promise<Object>}
   */
  async sendStatusUpdate(email, applicationNo, status, applicantName) {
    try {
      const statusColors = {
        'UNDER_REVIEW': '#3498db',
        'ELIGIBLE': '#27ae60',
        'NOT_ELIGIBLE': '#e74c3c',
        'SELECTED': '#2ecc71',
        'REJECTED': '#c0392b'
      };
      
      const statusColor = statusColors[status] || '#95a5a6';
      
      const info = await this.transporter.sendMail({
        from: process.env.SMTP_FROM || `Mission Shakti <${process.env.SMTP_USER}>`,
        to: email,
        subject: `Application Status Update - ${status}`,
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: ${statusColor}; color: white; padding: 20px; text-align: center; }
              .content { background: #f9f9f9; padding: 30px; border-radius: 5px; margin: 20px 0; }
              .status { font-size: 24px; font-weight: bold; color: ${statusColor}; text-align: center; 
                        padding: 15px; background: white; border-radius: 5px; }
              .footer { text-align: center; color: #7f8c8d; font-size: 12px; margin-top: 20px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>Application Status Update</h1>
              </div>
              <div class="content">
                <p>Dear ${applicantName},</p>
                <p>Your application status has been updated.</p>
                
                <p><strong>Application Number:</strong> ${applicationNo}</p>
                <div class="status">${status.replace(/_/g, ' ')}</div>
                
                <p>Please login to the portal for more details and next steps.</p>
                <p>If you have any questions, please contact the admin.</p>
              </div>
              <div class="footer">
                <p>This is an automated email from Mission Shakti Recruitment Portal.</p>
                <p>Please do not reply to this email.</p>
              </div>
            </div>
          </body>
          </html>
        `
      });
      
      logger.info(`Status update email sent to ${email}`);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      logger.error('Error sending status email:', error);
      return { success: false, error: error.message };
    }
  }

  /**  the otp is used insted of this
   * Send password reset email
   * @param {string} email - User email
   * @param {string} resetToken - Password reset token
   * @returns {Promise<Object>}
   */
  async sendPasswordReset(email, resetToken) {
    try {
      const resetLink = `${this.getFrontendBaseUrl('APPLICANT')}/reset-password?token=${resetToken}`;
      
      const info = await this.transporter.sendMail({
        from: process.env.SMTP_FROM || `Mission Shakti <${process.env.SMTP_USER}>`,
        to: email,
        subject: 'Password Reset Request - Mission Shakti',
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: #e74c3c; color: white; padding: 20px; text-align: center; }
              .content { background: #f9f9f9; padding: 30px; border-radius: 5px; margin: 20px 0; }
              .button { display: inline-block; padding: 12px 30px; background: #e74c3c; color: white; 
                        text-decoration: none; border-radius: 5px; margin: 20px 0; }
              .footer { text-align: center; color: #7f8c8d; font-size: 12px; margin-top: 20px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>Password Reset Request</h1>
              </div>
              <div class="content">
                <p>You have requested to reset your password.</p>
                <p>Click the button below to reset your password:</p>
                
                <div style="text-align: center;">
                  <a href="${resetLink}" class="button">Reset Password</a>
                </div>
                
                <p>Or copy this link to your browser:</p>
                <p style="word-break: break-all; background: white; padding: 10px; border-radius: 5px;">
                  ${resetLink}
                </p>
                
                <p><strong>This link will expire in 1 hour.</strong></p>
                <p>If you did not request this, please ignore this email and your password will remain unchanged.</p>
              </div>
              <div class="footer">
                <p>This is an automated email from Mission Shakti Recruitment Portal.</p>
                <p>Please do not reply to this email.</p>
              </div>
            </div>
          </body>
          </html>
        `
      });
      
      logger.info(`Password reset email sent to ${email}`);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      logger.error('Error sending password reset email:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send allotment letter with PDF attachment
   * @param {Object} params - Email parameters
   * @param {string} params.to - Recipient email
   * @param {string} params.name - Candidate name
   * @param {string} params.postName - Post name
   * @param {string} params.postCode - Post code
   * @param {string} params.pdfPath - Full path to PDF file
   * @param {string} params.pdfFileName - PDF filename for attachment
   * @returns {Promise<Object>}
   */
  async sendAllotmentEmail({ to, name, postName, postCode, pdfPath, pdfFileName }) {
    try {
      const info = await this.transporter.sendMail({
        from: process.env.SMTP_FROM || `Mission Shakti <${process.env.SMTP_USER}>`,
        to,
        subject: `Allotment Letter - ${postName} (${postCode})`,
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: #2c3e50; color: white; padding: 20px; text-align: center; }
              .content { background: #f9f9f9; padding: 30px; border-radius: 5px; margin: 20px 0; }
              .highlight { background: #e8f5e9; padding: 15px; border-left: 4px solid #4caf50; margin: 20px 0; }
              .footer { text-align: center; color: #7f8c8d; font-size: 12px; margin-top: 20px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>Mission Shakti</h1>
                <p>Women & Child Development Department</p>
              </div>
              <div class="content">
                <h2>Congratulations ${name}!</h2>
                <p>You have been selected for the following post:</p>
                <div class="highlight">
                  <strong>Post Name:</strong> ${postName}<br>
                  <strong>Post Code:</strong> ${postCode}
                </div>
                <p>Please find your allotment letter attached to this email.</p>
                
              </div>
              <div class="footer">
                <p>This is an automated email from Mission Shakti Recruitment Portal.</p>
                <p>Please do not reply to this email.</p>
                <p>&copy; ${new Date().getFullYear()} Women & Child Development Department</p>
              </div>
            </div>
          </body>
          </html>
        `,
        attachments: [
          {
            filename: pdfFileName,
            path: pdfPath
          }
        ]
      });

      logger.info(`Allotment email sent to ${to}: ${info.messageId}`);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      logger.error('Error sending allotment email:', error);
      throw error;
    }
  }

  /**
   * Test email connection
   * @returns {Promise<boolean>}
   */
  async testConnection() {
    try {
      await this.transporter.verify();
      logger.info('Email service connection verified');
      return true;
    } catch (error) {
      logger.error('Email service connection failed:', error);
      return false;
    }
  }
}

module.exports = new EmailService();
