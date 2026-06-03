const { sequelize } = require('../../config/db');
const logger = require('../../config/logger');
const emailService = require('../emailService');

const REMINDERS_ENABLED = String(process.env.ATTENDANCE_REMINDER_ENABLED || 'true').toLowerCase() === 'true';

// Track sent emails to avoid duplicates
const sentEmails = new Map(); // key: "adminId:employeeId", value: timestamp

/**
 * Find employees with check-ins older than 8 hours without check-out
 */
const findEmployeesWithPendingCheckOut = async () => {
  try {
    // Get current time in IST
    const istOffset = 5.5 * 60 * 60 * 1000; // IST is UTC+5:30
    const istNow = new Date(Date.now() + istOffset);
    const eightHoursAgoInIst = new Date(istNow.getTime() - (8 * 60 * 60 * 1000));
    const istDate = istNow.toISOString().split('T')[0];
    
    logger.info(`Checking attendance reminders for ${istDate} (IST), 8+ hours before ${eightHoursAgoInIst.toISOString()}`);

    // First, let's do a simple test to see what attendance data exists today
    const [testRows] = await sequelize.query(
      `SELECT COUNT(*) as count, 
              MIN(a.check_in_time) as earliest_checkin,
              MAX(a.check_in_time) as latest_checkin
       FROM ms_hrm_attendance a
       WHERE a.attendance_date = :todayDate
         AND a.check_in_time IS NOT NULL
         AND a.check_out_time IS NULL
         AND a.is_deleted = false`,
      { replacements: { todayDate: istDate } }
    );
    
    logger.info('Today attendance test:', testRows[0]);

    const [rows] = await sequelize.query(
      `SELECT DISTINCT
         a.attendance_id,
         a.employee_id,
         e.employee_code,
         e.scheme_id,
         e.district_id,
         am.email AS employee_email,
         ap.full_name AS employee_name,
         s.scheme_name,
         dm.district_name,
         a.check_in_time,
         a.check_out_time,
         a.total_work_hours,
         a.final_status,
         a.attendance_date
       FROM ms_hrm_attendance a
       JOIN ms_employee_master e ON e.employee_id = a.employee_id
       JOIN ms_applicant_master am ON am.applicant_id = e.applicant_id
       LEFT JOIN ms_applicant_personal ap ON ap.applicant_id = e.applicant_id
       LEFT JOIN ms_schemes s ON s.scheme_id = e.scheme_id
       LEFT JOIN ms_district_master dm ON dm.district_id = e.district_id
       WHERE a.check_in_time IS NOT NULL
         AND a.check_out_time IS NULL
         AND a.attendance_date >= :todayDate
         AND e.is_active = true
         AND e.is_deleted = false
         AND am.is_deleted = false
         AND a.is_deleted = false
       ORDER BY a.attendance_date DESC, a.check_in_time ASC`,
      { replacements: { todayDate: istDate } }
    );

    // Debug: Log what we found
    logger.info(`Attendance query returned ${rows.length} rows without check-out`);
    if (rows.length > 0) {
      logger.info('Sample attendance data:', {
        employeeId: rows[0].employee_id,
        employeeCode: rows[0].employee_code,
        checkInTime: rows[0].check_in_time,
        attendanceDate: rows[0].attendance_date,
        eightHoursAgoInIst: eightHoursAgoInIst.toISOString()
      });
    }

    // Filter records where check-in was more than 8 hours ago
    // Since HRM stores date and time separately, we need to combine them
    const filteredRows = rows.filter(row => {
      if (!row.check_in_time || !row.attendance_date) {
        logger.warn(`Invalid attendance data for employee ${row.employee_id}: missing check_in_time or attendance_date`);
        return false;
      }
      
      // Combine date and time to create a full datetime in IST
      const checkInDateTime = new Date(`${row.attendance_date} ${row.check_in_time}`);
      const isOver8Hours = checkInDateTime <= eightHoursAgoInIst;
      
      logger.info(`Employee ${row.employee_code}: check-in=${row.attendance_date} ${row.check_in_time}, cutoff=${eightHoursAgoInIst.toISOString()}, qualifies=${isOver8Hours}`);
      
      return isOver8Hours;
    });

    logger.info(`Found ${filteredRows.length} employees who checked in 8+ hours ago without checking out`);
    return filteredRows;
  } catch (error) {
    logger.error('findEmployeesWithPendingCheckOut error:', error);
    throw error;
  }
};

/**
 * Find linked OSC admin accounts for an employee
 */
const findLinkedOscAdmins = async (employee) => {
  try {
    const [rows] = await sequelize.query(
      `SELECT 
         au.admin_id,
         au.username,
         au.email,
         au.full_name,
         au.is_active
       FROM ms_admin_users au
       WHERE au.is_deleted = false
         AND au.is_active = true
         AND (
           (au.scheme_id = :schemeId AND au.scheme_id IS NOT NULL)
           OR (au.district_id = :districtId AND au.district_id IS NOT NULL AND au.scheme_id IS NULL)
         )
       LIMIT 10`,
      {
        replacements: {
          schemeId: employee.scheme_id,
          districtId: employee.district_id
        }
      }
    );

    return rows;
  } catch (error) {
    logger.error('findLinkedOscAdmins error:', error);
    throw error;
  }
};

/**
 * Send reminder email to OSC admins
 */
const sendReminderEmail = async (admin, employee) => {
  try {
    // Check if email was already sent recently (avoid duplicates)
    const emailKey = `${admin.admin_id}:${employee.employee_id}`;
    const lastSent = sentEmails.get(emailKey);
    const now = Date.now();
    
    // Don't send if email was sent in the last 4 hours
    if (lastSent && (now - lastSent) < (4 * 60 * 60 * 1000)) {
      logger.info(`Skipping duplicate email to ${admin.email} for employee ${employee.employee_code} (sent ${(now - lastSent) / (1000 * 60 * 60)} hours ago)`);
      return { success: true, admin: admin.email, skipped: true, reason: 'Recently sent' };
    }
    
    // Combine attendance_date and check_in_time for HRM data structure
    const checkInDateTime = new Date(`${employee.attendance_date} ${employee.check_in_time}`);
    
    const subject = `Attendance Reminder: ${employee.employee_name} has not checked out`;
    
    const htmlBody = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #d9534f;">Attendance Check-out Reminder</h2>
        
        <p>Dear <strong>${admin.full_name}</strong>,</p>
        
        <p>This is an automated reminder that the following employee has checked in but not marked out for 8 hr:</p>
        
        <div style="background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 5px; padding: 15px; margin: 15px 0;">
          <h4 style="margin: 0 0 10px 0; color: #495057;">Employee Details</h4>
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 5px; font-weight: bold; width: 120px;">Name:</td>
              <td style="padding: 5px;">${employee.employee_name || 'N/A'}</td>
            </tr>
            <tr>
              <td style="padding: 5px; font-weight: bold;">Employee Code:</td>
              <td style="padding: 5px;">${employee.employee_code || 'N/A'}</td>
            </tr>
            <tr>
              <td style="padding: 5px; font-weight: bold;">Email:</td>
              <td style="padding: 5px;">${employee.employee_email || 'N/A'}</td>
            </tr>
            <tr>
              <td style="padding: 5px; font-weight: bold;">Scheme:</td>
              <td style="padding: 5px;">${employee.scheme_name || 'N/A'}</td>
            </tr>
            <tr>
              <td style="padding: 5px; font-weight: bold;">District:</td>
              <td style="padding: 5px;">${employee.district_name || 'N/A'}</td>
            </tr>
            <tr>
              <td style="padding: 5px; font-weight: bold;">Check-in Time:</td>
              <td style="padding: 5px;">${checkInDateTime.toLocaleString()}</td>
            </tr>
            <tr>
              <td style="padding: 5px; font-weight: bold;">Hours Since:</td>
              <td style="padding: 5px; color: #d9534f; font-weight: bold;">8 hr</td>
            </tr>
          </table>
        </div>
        
        <p style="background: #fff3cd; border: 1px solid #ffeaa7; border-radius: 5px; padding: 10px; margin: 15px 0;">
          <strong>Action Required:</strong> The employee hasn't logged out yet. Please remind them to check out or verify if there was an issue with the attendance system.
        </p>
        
        <p style="color: #6c757d; font-size: 12px;">
          This is an automated reminder. You will receive another reminder if the employee still hasn't checked out.
        </p>
        
        <hr style="border: none; border-top: 1px solid #dee2e6; margin: 20px 0;">
        <p style="color: #6c757d; font-size: 11px;">
          WCD Attendance System | Generated on ${new Date().toLocaleString()}
        </p>
      </div>
    `;

    const result = await emailService.transporter.sendMail({
      from: emailService.fromAddress,
      to: admin.email,
      subject,
      html: htmlBody
    });

    if (result && result.messageId) {
      // Record that email was sent
      sentEmails.set(emailKey, now);
      logger.info(`Reminder email sent to admin ${admin.email} for employee ${employee.employee_code} (Message ID: ${result.messageId})`);
      return { success: true, admin: admin.email };
    } else {
      throw new Error('Failed to send email');
    }
  } catch (error) {
    logger.error('sendReminderEmail error:', error);
    return { success: false, admin: admin.email, error: error.message };
  }
};

/**
 * Clean up old email entries (older than 24 hours)
 */
const cleanupSentEmails = () => {
  const now = Date.now();
  const twentyFourHoursAgo = now - (24 * 60 * 60 * 1000);
  
  for (const [key, timestamp] of sentEmails.entries()) {
    if (timestamp < twentyFourHoursAgo) {
      sentEmails.delete(key);
    }
  }
  
  if (sentEmails.size > 0) {
    logger.debug(`Email tracking cache size: ${sentEmails.size} entries`);
  }
};

/**
 * Process pending check-outs and send reminders
 */
const processPendingCheckOuts = async () => {
  try {
    if (!REMINDERS_ENABLED) {
      logger.info('Attendance reminders disabled via ATTENDANCE_REMINDER_ENABLED flag');
      return { processed: 0, remindersSent: 0, errors: [], disabled: true };
    }

    // Clean up old email entries
    cleanupSentEmails();

    const employees = await findEmployeesWithPendingCheckOut();
    if (employees.length === 0) {
      logger.info('No employees with pending check-outs found');
      return { processed: 0, remindersSent: 0, errors: [] };
    }

    logger.info(`Found ${employees.length} employees with pending check-outs`);

    let remindersSent = 0;
    let skippedEmails = 0;
    const errors = [];

    for (const employee of employees) {
      try {
        const admins = await findLinkedOscAdmins(employee);
        if (admins.length === 0) {
          logger.warn(`No OSC admins found for employee ${employee.employee_code} (scheme: ${employee.scheme_id}, district: ${employee.district_id})`);
          continue;
        }

        for (const admin of admins) {
          const result = await sendReminderEmail(admin, employee);
          if (result.success) {
            if (result.skipped) {
              skippedEmails++;
            } else {
              remindersSent++;
            }
          } else {
            errors.push({ admin: admin.email, employee: employee.employee_code, error: result.error });
          }
        }
      } catch (empError) {
        logger.error(`Error processing employee ${employee.employee_code}:`, empError);
        errors.push({ employee: employee.employee_code, error: empError.message });
      }
    }

    logger.info(`Attendance reminder processing completed. Employees: ${employees.length}, Reminders sent: ${remindersSent}, Skipped: ${skippedEmails}, Errors: ${errors.length}`);
    
    return {
      processed: employees.length,
      remindersSent,
      skippedEmails,
      errors
    };
  } catch (error) {
    logger.error('processPendingCheckOuts error:', error);
    throw error;
  }
};

module.exports = {
  findEmployeesWithPendingCheckOut,
  findLinkedOscAdmins,
  sendReminderEmail,
  processPendingCheckOuts
};
