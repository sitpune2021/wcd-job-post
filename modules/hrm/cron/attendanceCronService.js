/**
 * Attendance Cron Service
 * Handles scheduled tasks for attendance management
 */

const db = require('../../../models');
const { EmployeeMaster, Attendance } = require('../models');
const logger = require('../../../config/logger');

/**
 * Mark absent employees who don't have attendance records for a given date
 * This runs daily to ensure all employees have attendance records
 */
async function markAbsentEmployees(date = null) {
  try {
    const attendanceDate = date || new Date().toISOString().split('T')[0]; // Today's date in YYYY-MM-DD format
    
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
    
    // Mark absent employees
    const absentRecords = await Promise.all(
      absentEmployeeIds.map(employeeId => 
        Attendance.create({
          employee_id: employeeId,
          attendance_date: attendanceDate,
          status: 'ABSENT',
          remarks: 'Auto-marked as absent (no attendance record found)',
          created_by: null, // System generated
          created_at: new Date()
        })
      )
    );
    
    logger.info(`CRON: Marked ${absentEmployeeIds.length} employees as absent for ${attendanceDate}`);
    
    return {
      markedAbsent: absentEmployeeIds.length,
      date: attendanceDate,
      employeeIds: absentEmployeeIds
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
    
    // Task 3: Generate attendance summary
    const summaryResult = await generateAttendanceSummary();
    
    logger.info('CRON: Attendance cron tasks completed', {
      absent: absentResult.markedAbsent,
      cleanup: cleanupResult.deleted,
      summary: summaryResult.summary
    });
    
    return {
      success: true,
      tasks: {
        markAbsent: absentResult,
        cleanup: cleanupResult,
        summary: summaryResult
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
  runAttendanceCronTasks
};
