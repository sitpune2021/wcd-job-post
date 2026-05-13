/**
 * Attendance Summary Service
 * Provides accurate attendance summary for employee profiles
 */

const db = require('../../../models');
const { ApiError } = require('../../../middleware/errorHandler');
const logger = require('../../../config/logger');

const EmployeeMaster = db.EmployeeMaster;
const Attendance = db.HrmAttendance;
const LeaveApplication = db.HrmLeaveApplication;

/**
 * Get attendance summary for an employee for current month
 */
const getAttendanceSummary = async (employeeId) => {
  try {
    // Get employee contract info
    const employee = await EmployeeMaster.findOne({
      where: { employee_id: employeeId },
      attributes: ['contract_start_date', 'contract_end_date']
    });

    if (!employee) {
      throw ApiError.notFound('Employee not found');
    }

    // Get current month date range
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    
    // Adjust start date if employee joined mid-month
    const attendanceStartDate = employee.contract_start_date && 
      new Date(employee.contract_start_date) > monthStart ? 
      new Date(employee.contract_start_date) : monthStart;

    // Get attendance records for the current month
    const attendanceRecords = await Attendance.findAll({
      where: {
        employee_id: employeeId,
        attendance_date: {
          [db.Sequelize.Op.between]: [
            attendanceStartDate.toISOString().split('T')[0],
            monthEnd.toISOString().split('T')[0]
          ]
        }
      }
    });

    // Get approved leaves for the current month
    const approvedLeaves = await LeaveApplication.findAll({
      where: {
        employee_id: employeeId,
        status: 'APPROVED',
        [db.Sequelize.Op.or]: [
          {
            from_date: { [db.Sequelize.Op.between]: [
              attendanceStartDate.toISOString().split('T')[0],
              monthEnd.toISOString().split('T')[0]
            ]},
            to_date: { [db.Sequelize.Op.between]: [
              attendanceStartDate.toISOString().split('T')[0],
              monthEnd.toISOString().split('T')[0]
            ]}
          },
          {
            from_date: { [db.Sequelize.Op.lte]: attendanceStartDate.toISOString().split('T')[0] },
            to_date: { [db.Sequelize.Op.gte]: monthEnd.toISOString().split('T')[0] }
          }
        ]
      }
    });

    
    // Calculate attendance summary
    let presentDays = 0;
    let absentDays = 0;
    let halfDays = 0;
    let leaveDays = 0;

    // Count from attendance records
    attendanceRecords.forEach(record => {
      switch (record.status) {
        case 'PRESENT':
          presentDays++;
          break;
        case 'ABSENT':
          absentDays++;
          break;
        case 'HALF_DAY':
          halfDays += 0.5;
          break;
        case 'ON_LEAVE':
          leaveDays++;
          break;
      }
    });

    // Count from approved leaves (for days without attendance records)
    approvedLeaves.forEach(leave => {
      const fromDate = new Date(leave.from_date);
      const toDate = new Date(leave.to_date);
      
      for (let date = new Date(fromDate); date <= toDate; date.setDate(date.getDate() + 1)) {
        const dateStr = date.toISOString().split('T')[0];
        
        // Check if within our month range
        if (date >= attendanceStartDate && date <= monthEnd) {
          // Check if already counted in attendance records
          const hasAttendanceRecord = attendanceRecords.some(record => 
            record.attendance_date === dateStr
          );
          
          if (!hasAttendanceRecord) {
            leaveDays += leave.is_half_day ? 0.5 : 1;
          }
        }
      }
    });

    // Calculate total days
    const totalDays = presentDays + absentDays + halfDays + leaveDays;

    const result = {
      present_days: presentDays,
      absent_days: absentDays,
      half_days: halfDays,
      leave_days: leaveDays,
      holidays: 0,
      total_days: totalDays
    };

    return result;
  } catch (error) {
    logger.error('Error getting attendance summary:', error);
    throw error;
  }
};

module.exports = {
  getAttendanceSummary
};
