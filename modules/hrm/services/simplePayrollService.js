/**
 * Simplified Payroll Service
 * Just calculate and show payslips - no cycles, no complex management
 */
const { Op } = require('sequelize');
const db = require('../../../models');
const { ApiError } = require('../../../middleware/errorHandler');
const { buildHierarchyFilter } = require('../utils/hrmHelpers');

const EmployeeMaster = db.EmployeeMaster;
const Attendance = db.HrmAttendance;
const LeaveApplication = db.HrmLeaveApplication;

/**
 * Calculate working days in a month
 */
const getWorkingDaysInMonth = (month, year) => {
  const daysInMonth = new Date(year, month, 0).getDate();
  let workingDays = 0;
  
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month - 1, day);
    const dayOfWeek = date.getDay();
    if (dayOfWeek !== 0) workingDays++; // Exclude Sundays
  }
  
  return workingDays;
};

/**
 * Calculate attendance for an employee
 */
const calculateAttendanceForEmployee = async (employeeId, month, year) => {
  // Get attendance records for the month
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0);
  
  const attendanceRecords = await Attendance.findAll({
    where: {
      employee_id: employeeId,
      attendance_date: {
        [Op.between]: [startDate, endDate]
      },
      is_deleted: false
    }
  });

  // Get approved leaves
  const approvedLeaves = await LeaveApplication.findAll({
    where: {
      employee_id: employeeId,
      status: 'APPROVED',
      is_deleted: false,
      [Op.or]: [
        {
          [Op.and]: [
            { from_date: { [Op.lte]: new Date(year, month - 1, 1) } },
            { to_date: { [Op.gte]: new Date(year, month - 1, 1) } }
          ]
        },
        {
          [Op.and]: [
            { from_date: { [Op.gte]: new Date(year, month - 1, 1) } },
            { from_date: { [Op.lte]: new Date(year, month, 0) } }
          ]
        }
      ]
    }
  });

  let presentDays = attendanceRecords.filter(a => a.status === 'PRESENT').length;
  let leaveDays = 0;

  approvedLeaves.forEach(leave => {
    const start = new Date(leave.from_date);
    const end = new Date(leave.to_date);
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 0);
    
    const leaveStartInMonth = start < monthStart ? monthStart : start;
    const leaveEndInMonth = end > monthEnd ? monthEnd : end;
    
    const daysInMonth = Math.ceil((leaveEndInMonth - leaveStartInMonth) / (1000 * 60 * 60 * 24)) + 1;
    leaveDays += daysInMonth;
  });

  const workingDays = getWorkingDaysInMonth(month, year);
  const absentDays = workingDays - presentDays - leaveDays;

  return { presentDays, absentDays, leaveDays, workingDays };
};

/**
 * Calculate salary for an employee
 */
const calculateSalaryForEmployee = async (employee, month, year) => {
  // Get post data
  const post = await db.PostMaster.findOne({
    where: { post_id: employee.post_id, is_deleted: false },
    attributes: ['post_id', 'post_name', 'amount']  // Explicitly include post_id and amount
  });

  // Debug logging - write to a file for debugging
  const fs = require('fs');
  const debugInfo = {
    employee_code: employee.employee_code,
    employee_id: employee.employee_id,
    post_id: employee.post_id,
    post_found: !!post,
    post_data: post ? {
      post_id: post.post_id,
      post_name: post.post_name,
      amount: post.amount,
      amount_type: typeof post.amount,
      amount_value: parseFloat(post.amount || 0)
    } : null,
    timestamp: new Date().toISOString()
  };
  
  // Append to debug file
  fs.appendFileSync('payroll_debug.log', JSON.stringify(debugInfo) + '\n');
  
  console.log(`Employee ${employee.employee_code} - Post ID: ${employee.post_id} - Post found: ${!!post}`);

  // Use employee_pay if available, otherwise fallback to post amount
  let postSalary = 0;
  
  // Priority 1: Use employee_pay (maintains consistency even if post changes)
  if (employee.employee_pay) {
    postSalary = parseFloat(employee.employee_pay);
  }
  // Priority 2: Fallback to post amount
  else if (post?.amount) {
    // Handle different data types for amount
    if (typeof post.amount === 'number') {
      postSalary = post.amount;
    } else if (typeof post.amount === 'string') {
      // Remove any currency symbols, commas, and convert to number
      const cleanAmount = post.amount.replace(/[₹$,]/g, '').trim();
      postSalary = parseFloat(cleanAmount) || 0;
      console.log(`Parsing amount "${post.amount}" -> "${cleanAmount}" -> ${postSalary}`);
    } else {
      postSalary = parseFloat(post.amount) || 0;
    }
  }
  
  if (postSalary === 0 || isNaN(postSalary)) {
    return {
      employee_id: employee.employee_id,
      employee_code: employee.employee_code,
      post_name: post?.post_name || 'Unknown',
      error: 'No salary defined for this post',
      debug: {
        post_id: employee.post_id,
        post_found: !!post,
        post_amount: post?.amount,
        post_amount_type: typeof post?.amount,
        parsed_salary: postSalary,
        is_nan: isNaN(postSalary)
      }
    };
  }

  // Calculate attendance
  const { presentDays, absentDays, leaveDays, workingDays } = await calculateAttendanceForEmployee(employee.employee_id, month, year);

  // Calculate salary
  const paidDays = presentDays + leaveDays; // Approved leaves are paid
  const perDaySalary = postSalary / workingDays;
  const calculatedSalary = perDaySalary * paidDays;
  const deductionAmount = perDaySalary * absentDays;

  return {
    employee_id: employee.employee_id,
    employee_code: employee.employee_code,
    post_name: post?.post_name || 'Unknown',
    post_salary: postSalary,
    working_days: workingDays,
    present_days: presentDays,
    leave_days: leaveDays,
    absent_days: absentDays,
    paid_days: paidDays,
    per_day_salary: parseFloat(perDaySalary.toFixed(2)),
    calculated_salary: parseFloat(calculatedSalary.toFixed(2)),
    deduction_amount: parseFloat(deductionAmount.toFixed(2)),
    month: month,
    year: year
  };
};

/**
 * Generate payroll calculation (simplified - just calculate and show)
 */
const generatePayroll = async (adminUser, query) => {
  const { month, year } = query;

  if (!month || !year) {
    throw ApiError.badRequest('Month and year are required');
  }

  const hierarchyFilter = buildHierarchyFilter(adminUser);
  
  // Get employees under admin's jurisdiction
  const employees = await EmployeeMaster.findAll({
    where: {
      ...hierarchyFilter,
      is_active: true,
      is_deleted: false
    },
    attributes: ['employee_id', 'employee_code', 'post_id']
  });

  if (employees.length === 0) {
    return {
      month,
      year,
      total_employees: 0,
      total_salary: 0,
      payslips: [],
      message: 'No active employees found in your jurisdiction'
    };
  }

  // Calculate payslips for all employees
  const payslips = [];
  let totalSalary = 0;

  for (const employee of employees) {
    try {
      const payslip = await calculateSalaryForEmployee(employee, parseInt(month), parseInt(year));
      
      if (!payslip.error) {
        payslips.push(payslip);
        totalSalary += payslip.calculated_salary;
      } else {
        // Still include employees with errors but mark them
        payslips.push(payslip);
      }
    } catch (error) {
      // Include error payslips for visibility
      payslips.push({
        employee_id: employee.employee_id,
        employee_code: employee.employee_code,
        error: error.message
      });
    }
  }

  return {
    month: parseInt(month),
    year: parseInt(year),
    total_employees: employees.length,
    total_salary: parseFloat(totalSalary.toFixed(2)),
    payslips: payslips.sort((a, b) => a.employee_code.localeCompare(b.employee_code))
  };
};

/**
 * Get payroll summary for admin
 */
const getPayrollSummary = async (adminUser, query) => {
  const { month, year } = query;

  if (!month || !year) {
    throw ApiError.badRequest('Month and year are required');
  }

  const payroll = await generatePayroll(adminUser, { month, year });

  // Calculate summary statistics
  const validPayslips = payroll.payslips.filter(p => !p.error);
  const errorPayslips = payroll.payslips.filter(p => p.error);

  return {
    month: payroll.month,
    year: payroll.year,
    summary: {
      total_employees: payroll.total_employees,
      valid_payslips: validPayslips.length,
      error_payslips: errorPayslips.length,
      total_salary: payroll.total_salary,
      average_salary: validPayslips.length > 0 ? parseFloat((payroll.total_salary / validPayslips.length).toFixed(2)) : 0
    },
    payslips: payroll.payslips
  };
};

module.exports = {
  generatePayroll,
  getPayrollSummary,
  calculateSalaryForEmployee
};
