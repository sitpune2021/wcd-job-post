const nodemailer = require('nodemailer');
const logger = require('../../../config/logger');

/**
 * HRM Email Service
 * Reuses existing email infrastructure but focused on HRM onboarding
 */

// Create transporter (reuse existing email config)
const createTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT) || 465,
    secure: process.env.SMTP_PORT === '465', // SSL for port 465, TLS for others
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD
    }
  });
};

/**
 * Send onboarding email to existing employee (Flow B)
 * Contains login link, username (email), and temporary password
 */
async function sendOnboardingEmail(employeeData) {
  const {
    email,
    fullName,
    tempPassword,
    employeeCode,
    postName,
    postCode,
    districtName,
    componentName,
    contractStartDate,
    loginUrl
  } = employeeData;

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background-color: #4CAF50; color: white; padding: 20px; text-align: center; }
        .content { background-color: #f9f9f9; padding: 20px; border: 1px solid #ddd; }
        .credentials { background-color: #fff; padding: 15px; margin: 15px 0; border-left: 4px solid #4CAF50; }
        .button { display: inline-block; padding: 12px 24px; background-color: #4CAF50; color: white; text-decoration: none; border-radius: 4px; margin: 15px 0; }
        .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
        .warning { background-color: #fff3cd; padding: 10px; border-left: 4px solid #ffc107; margin: 15px 0; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Welcome to WCD HRM System</h1>
        </div>
        <div class="content">
          <h2>Dear ${fullName},</h2>
          <p>Welcome to the Women and Child Development Department! Your employee profile has been created in our HRM system.</p>
          
          <h3>Your Employment Details:</h3>
          <ul>
            <li><strong>Employee Code:</strong> ${employeeCode}</li>
            <li><strong>Post:</strong> ${postName} (${postCode})</li>
            <li><strong>District:</strong> ${districtName}</li>
            ${componentName ? `<li><strong>OSC/Hub:</strong> ${componentName}</li>` : ''}
            <li><strong>Contract Start Date:</strong> ${contractStartDate}</li>
          </ul>

          <div class="credentials">
            <h3>Your Login Credentials:</h3>
            <p><strong>Portal URL:</strong> <a href="${loginUrl}">${loginUrl}</a></p>
            <p><strong>Username:</strong> ${email}</p>
            <p><strong>Temporary Password:</strong> <code style="background: #f0f0f0; padding: 4px 8px; font-size: 16px;">${tempPassword}</code></p>
          </div>

          <div class="warning">
            <strong>⚠️ Important - First Login Steps:</strong>
            <ol>
              <li>Login with the credentials above</li>
              <li>You will be required to <strong>change your password</strong></li>
              <li>You must <strong>upload your Allotment Letter (PDF)</strong></li>
              <li>Complete your profile information</li>
            </ol>
            <p>You will not be able to access the system until you complete these steps.</p>
          </div>

          <center>
            <a href="${loginUrl}" class="button">Login to Portal</a>
          </center>

          <p style="margin-top: 20px;">If you have any questions or face any issues, please contact your administrator.</p>
        </div>
        <div class="footer">
          <p>This is an automated email from WCD HRM System. Please do not reply to this email.</p>
          <p>&copy; ${new Date().getFullYear()} Women and Child Development Department</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const textContent = `
Welcome to WCD HRM System

Dear ${fullName},

Welcome to the Women and Child Development Department! Your employee profile has been created in our HRM system.

Your Employment Details:
- Employee Code: ${employeeCode}
- Post: ${postName} (${postCode})
- District: ${districtName}
${componentName ? `- OSC/Hub: ${componentName}` : ''}
- Contract Start Date: ${contractStartDate}

Your Login Credentials:
- Portal URL: ${loginUrl}
- Username: ${email}
- Temporary Password: ${tempPassword}

IMPORTANT - First Login Steps:
1. Login with the credentials above
2. You will be required to change your password
3. You must upload your Allotment Letter (PDF)
4. Complete your profile information

You will not be able to access the system until you complete these steps.

If you have any questions or face any issues, please contact your administrator.

---
This is an automated email from WCD HRM System. Please do not reply to this email.
© ${new Date().getFullYear()} Women and Child Development Department
  `;

  try {
    const transporter = createTransporter();
    
    const mailOptions = {
      from: `"WCD HRM System" <${process.env.EMAIL_FROM || process.env.EMAIL_USER}>`,
      to: email,
      subject: `Welcome to WCD - Your Employee Login Credentials (${employeeCode})`,
      text: textContent,
      html: htmlContent
    };

    const info = await transporter.sendMail(mailOptions);
    
    logger.info('Onboarding email sent successfully', {
      email,
      employeeCode,
      messageId: info.messageId
    });

    return {
      success: true,
      messageId: info.messageId
    };
  } catch (error) {
    logger.error('Failed to send onboarding email', {
      email,
      employeeCode,
      error: error.message
    });
    throw new Error(`Failed to send onboarding email: ${error.message}`);
  }
}

/**
 * Send password change confirmation email
 */
async function sendPasswordChangeConfirmation(email, fullName) {
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
      <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2>Password Changed Successfully</h2>
        <p>Dear ${fullName},</p>
        <p>Your password has been changed successfully. You can now access the HRM system with your new password.</p>
        <p>If you did not make this change, please contact your administrator immediately.</p>
        <p style="margin-top: 30px; color: #666; font-size: 12px;">
          This is an automated email from WCD HRM System.
        </p>
      </div>
    </body>
    </html>
  `;

  try {
    const transporter = createTransporter();
    
    await transporter.sendMail({
      from: `"WCD HRM System" <${process.env.EMAIL_FROM || process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Password Changed Successfully - WCD HRM',
      html: htmlContent
    });

    logger.info('Password change confirmation email sent', { email });
  } catch (error) {
    logger.error('Failed to send password change confirmation', { email, error: error.message });
  }
}

module.exports = {
  sendOnboardingEmail,
  sendPasswordChangeConfirmation
};
