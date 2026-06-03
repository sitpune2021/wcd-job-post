/**
 * Attendance Cron Service
 * Handles scheduled tasks for attendance management
 */

const db = require('../../../models');
const { EmployeeMaster, Attendance } = require('../models');
const { finalizeDailyAttendance } = require('../services/attendanceService');
const logger = require('../../../config/logger');
const { processPendingCheckOuts } = require('../../../services/admin/attendanceReminderHelper');

/**
 * Mark absent employees who don't have attendance records for a given date
 * This runs daily to ensure all employees have attendance records
 */
async function markAbsentEmployees(date = null) {
  try {
    // Process yesterday's attendance (not today)
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const attendanceDate = date || yesterday.toISOString().split('T')[0];
    
    logger.info(`CRON: Marking absent employees for date: ${attendanceDate}`);
    
    // Get all active employees
    const activeEmployees = await EmployeeMaster.findAll({
      where: {
        is_active: true,
        is_deleted: false
      },
      attributes: ['employee_id', 'employee_code']
    });
    
    if (activeEmployees.length === 0) {
      logger.info('CRON: No active employees found');
      return { markedAbsent: 0, date: attendanceDate };
    }
    
    const employeeIds = activeEmployees.map(emp => emp.employee_id);
    
    // Get employees who already have attendance for this date
    const existingAttendance = await Attendance.findAll({
      where: {
        employee_id: { [db.Sequelize.Op.in]: employeeIds },
        attendance_date: attendanceDate,
        is_deleted: false
      },
      attributes: ['employee_id']
    });
    
    const existingEmployeeIds = existingAttendance.map(att => att.employee_id);
    
    // Find employees who don't have attendance for this date
    const absentEmployeeIds = employeeIds.filter(id => !existingEmployeeIds.includes(id));
    
    if (absentEmployeeIds.length === 0) {
      logger.info(`CRON: All employees have attendance records for ${attendanceDate}`);
      return { markedAbsent: 0, date: attendanceDate };
    }
    
    // Check for open sessions before marking absent
    // This handles night shift workers who might still be working
    const AttendanceSession = require('../models/AttendanceSession');
    const employeesWithOpenSessions = await AttendanceSession.findAll({
      where: {
        employee_id: { [db.Sequelize.Op.in]: absentEmployeeIds },
        check_out_time: null,
        created_at: {
          [db.Sequelize.Op.gte]: new Date(yesterday.setHours(0, 0, 0, 0))
        }
      },
      attributes: ['employee_id']
    });
    
    const openSessionEmployeeIds = employeesWithOpenSessions.map(s => s.employee_id);
    const finalAbsentEmployeeIds = absentEmployeeIds.filter(id => !openSessionEmployeeIds.includes(id));
    
    if (finalAbsentEmployeeIds.length === 0) {
      logger.info(`CRON: No employees to mark absent for ${attendanceDate} (all have open sessions)`);
      return { 
        markedAbsent: 0, 
        date: attendanceDate,
        skippedDueToOpenSessions: openSessionEmployeeIds.length
      };
    }
    
    // Mark absent employees with proper audit trail
    const absentRecords = await Promise.all(
      finalAbsentEmployeeIds.map(employeeId => 
        Attendance.create({
          employee_id: employeeId,
          attendance_date: attendanceDate,
          status: 'ABSENT',
          final_status: 'ABSENT',
          remarks: 'Auto-marked ABSENT by system (no sessions recorded)',
          status_change_reason: 'Auto-marked ABSENT by system (no sessions recorded)',
          status_changed_by: null, // System generated
          status_changed_at: new Date(),
          created_by: null,
          created_at: new Date()
        })
      )
    );
    
    logger.info(`CRON: Marked ${finalAbsentEmployeeIds.length} employees as absent for ${attendanceDate} (checked for open sessions)`);
    
    return {
      markedAbsent: finalAbsentEmployeeIds.length,
      date: attendanceDate,
      employeeIds: finalAbsentEmployeeIds,
      skippedDueToOpenSessions: openSessionEmployeeIds.length
    };
    
  } catch (error) {
    logger.error('CRON: Error marking absent employees:', error);
    throw error;
  }
}

/**
 * Clean up old pending bulk attendance records
 * Remove bulk records older than 30 days that are still pending
 */
async function cleanupOldPendingBulkRecords() {
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    logger.info(`CRON: Cleaning up bulk records older than ${thirtyDaysAgo.toISOString()}`);
    
    const { BulkAttendance } = require('../models');
    
    // Find old pending bulk records
    const oldPendingBulks = await BulkAttendance.findAll({
      where: {
        status: 'PENDING',
        created_at: { [db.Sequelize.Op.lt]: thirtyDaysAgo },
        is_deleted: false
      },
      attributes: ['bulk_id', 'bulk_no', 'created_at']
    });
    
    if (oldPendingBulks.length === 0) {
      logger.info('CRON: No old pending bulk records found');
      return { deleted: 0 };
    }
    
    // Soft delete old pending bulk records
    const bulkIds = oldPendingBulks.map(bulk => bulk.bulk_id);
    
    await BulkAttendance.update(
      { is_deleted: true },
      { where: { bulk_id: { [db.Sequelize.Op.in]: bulkIds } } }
    );
    
    logger.info(`CRON: Deleted ${oldPendingBulks.length} old pending bulk records`);
    
    return { deleted: oldPendingBulks.length };
    
  } catch (error) {
    logger.error('CRON: Error cleaning up old bulk records:', error);
    throw error;
  }
}

/**
 * Generate attendance summary report
 * Creates a daily summary of attendance statistics
 */
async function generateAttendanceSummary(date = null) {
  try {
    const attendanceDate = date || new Date().toISOString().split('T')[0];
    
    logger.info(`CRON: Generating attendance summary for ${attendanceDate}`);
    
    const summary = await Attendance.findAll({
      where: {
        attendance_date: attendanceDate,
        is_deleted: false
      },
      attributes: [
        [db.Sequelize.fn('COUNT', db.Sequelize.col('attendance_id')), 'total'],
        [db.Sequelize.fn('SUM', db.Sequelize.literal("CASE WHEN status = 'PRESENT' THEN 1 ELSE 0 END")), 'present'],
        [db.Sequelize.fn('SUM', db.Sequelize.literal("CASE WHEN status = 'ABSENT' THEN 1 ELSE 0 END")), 'absent'],
        [db.Sequelize.fn('SUM', db.Sequelize.literal("CASE WHEN status = 'HALF_DAY' THEN 1 ELSE 0 END")), 'half_day'],
        [db.Sequelize.fn('SUM', db.Sequelize.literal("CASE WHEN status = 'ON_LEAVE' THEN 1 ELSE 0 END")), 'on_leave'],
        [db.Sequelize.fn('SUM', db.Sequelize.literal("CASE WHEN status = 'HOLIDAY' THEN 1 ELSE 0 END")), 'holiday'],
        [db.Sequelize.fn('SUM', db.Sequelize.literal("CASE WHEN status = 'SUNDAY' THEN 1 ELSE 0 END")), 'sunday']
      ],
      raw: true
    });
    
    const stats = summary[0];
    
    logger.info(`CRON: Attendance Summary for ${attendanceDate}:`, {
      total: stats.total,
      present: stats.present,
      absent: stats.absent,
      half_day: stats.half_day,
      on_leave: stats.on_leave,
      holiday: stats.holiday,
      sunday: stats.sunday
    });
    
    return {
      date: attendanceDate,
      summary: stats
    };
    
  } catch (error) {
    logger.error('CRON: Error generating attendance summary:', error);
    throw error;
  }
}

/**
 * Send attendance reminder emails to OSC admins
 * This runs every 5 minutes to check for employees who haven't checked out after 8 hours
 */
async function sendAttendanceReminders() {
  try {
    logger.info('CRON: Running attendance reminder check...');
    
    const reminderResult = await processPendingCheckOuts();
    
    logger.info('CRON: Attendance reminder check completed', {
      processed: reminderResult.processed,
      remindersSent: reminderResult.remindersSent,
      errors: reminderResult.errors.length
    });
    
    return reminderResult;
    
  } catch (error) {
    logger.error('CRON: Error sending attendance reminders:', error);
    throw error;
  }
}

/**
 * Run all attendance cron tasks
 * This is the main function called by the scheduler
 */
async function runAttendanceCronTasks() {
  try {
    logger.info('CRON: Running attendance cron tasks...');
    
    // Task 1: Mark absent employees for today
    const absentResult = await markAbsentEmployees();
    
    // Task 2: Clean up old pending bulk records
    const cleanupResult = await cleanupOldPendingBulkRecords();
    
    // Task 3: Finalize attendance based on 8-hour requirement
    const finalizationResult = await finalizeDailyAttendance();
    
    // Task 4: Generate attendance summary
    const summaryResult = await generateAttendanceSummary();
    
    // Task 5: Send attendance reminder emails
    const reminderResult = await sendAttendanceReminders();
    
    logger.info('CRON: Attendance cron tasks completed', {
      absent: absentResult.markedAbsent,
      cleanup: cleanupResult.deleted,
      finalization: finalizationResult.processed,
      summary: summaryResult.summary,
      reminders: reminderResult.remindersSent
    });
    
    return {
      success: true,
      tasks: {
        markAbsent: absentResult,
        cleanup: cleanupResult,
        finalization: finalizationResult,
        summary: summaryResult,
        reminders: reminderResult
      }
    };
    
  } catch (error) {
    logger.error('CRON: Error running attendance cron tasks:', error);
    throw error;
  }
}

module.exports = {
  markAbsentEmployees,
  cleanupOldPendingBulkRecords,
  generateAttendanceSummary,
  sendAttendanceReminders,
  runAttendanceCronTasks
};
