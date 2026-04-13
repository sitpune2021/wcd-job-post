/**
 * Simplified Payroll View Service
 * Provides basic payslip viewing functionality for admin and employee
 * No complex calculations, just displays stored payroll data
 */

const db = require('../../../models');
const { ApiError } = require('../../../middleware/errorHandler');
const logger = require('../../../config/logger');
const { buildHierarchyFilter } = require('../utils/hrmHelpers');

const EmployeeMaster = db.EmployeeMaster;
const Attendance = db.HrmAttendance;
const LeaveApplication = db.HrmLeaveApplication;
const PostMaster = db.PostMaster;
const DistrictMaster = db.DistrictMaster;

/**
 * Get working days in a month (excludes Sundays and holidays)
 */
const getWorkingDaysInMonth = (month, year) => {
  const daysInMonth = new Date(year, month, 0).getDate();
  let workingDays = 0;
  
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month - 1, day);
    const dayOfWeek = date.getDay();
    
    // Exclude Sundays (dayOfWeek === 0)
    if (dayOfWeek !== 0) {
      workingDays++;
    }
  }
  
  return workingDays;
};

/**
 * Calculate attendance summary for an employee
 */
const calculateAttendanceSummary = async (employeeId, month, year) => {
  // Get attendance records
  const attendanceRecords = await Attendance.findAll({
    where: {
      employee_id: employeeId,
      status: ['PRESENT', 'ABSENT', 'HALF_DAY', 'ON_LEAVE', 'HOLIDAY', 'SUNDAY']
    }
  });

  // Get approved leaves
  const approvedLeaves = await LeaveApplication.findAll({
    where: {
      employee_id: employeeId,
      status: 'APPROVED',
      from_date: { [db.Sequelize.Op.lte]: new Date(year, month, 0) },
      to_date: { [db.Sequelize.Op.gte]: new Date(year, month - 1, 1) }
    }
  });

  // Calculate days
  let presentDays = 0;
  let absentDays = 0;
  let leaveDays = 0;
  let halfDays = 0;

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

  // Add approved leaves
  approvedLeaves.forEach(leave => {
    const fromDate = new Date(leave.from_date);
    const toDate = new Date(leave.to_date);
    
    // Calculate days in the specified month
    for (let date = new Date(fromDate); date <= toDate; date.setDate(date.getDate() + 1)) {
      if (date.getMonth() === month - 1 && date.getFullYear() === year) {
        leaveDays += leave.is_half_day ? 0.5 : 1;
      }
    }
  });

  const workingDays = getWorkingDaysInMonth(month, year);
  const paidDays = presentDays + leaveDays + halfDays;
  
  // Calculate absent days as working days minus paid days
  const calculatedAbsentDays = Math.max(0, workingDays - paidDays);

  return {
    working_days: workingDays,
    present_days: presentDays,
    absent_days: calculatedAbsentDays, // Use calculated value
    leave_days: leaveDays,
    half_days: halfDays,
    paid_days: paidDays
  };
};

/**
 * Get payslip data for an employee (admin can view any employee)
 */
const getEmployeePayslip = async (adminUser, employeeId, month, year) => {
  try {
    // Get employee details
    const employee = await EmployeeMaster.findOne({
      where: {
        employee_id: employeeId,
        is_deleted: false,
        ...buildHierarchyFilter(adminUser)
      },
      include: [
        { model: PostMaster, as: 'post', attributes: ['post_name', 'amount'] },
        { model: DistrictMaster, as: 'district', attributes: ['district_name'] }
      ]
    });

    if (!employee) {
      throw ApiError.notFound('Employee not found or not in your jurisdiction');
    }

    // Get employee pay (priority to employee_pay, fallback to post.amount)
    const monthlyPay = parseFloat(employee.employee_pay || employee.post?.amount || 0);

    if (monthlyPay === 0) {
      throw ApiError.badRequest('No pay information available for this employee');
    }

    // Calculate attendance
    const attendance = await calculateAttendanceSummary(employeeId, month, year);

    // Calculate salary
    const perDaySalary = monthlyPay / attendance.working_days;
    const calculatedSalary = perDaySalary * attendance.paid_days;
    const deductionAmount = perDaySalary * attendance.absent_days;

    // Build payslip data
    const payslipData = {
      employee: {
        employee_id: employee.employee_id,
        employee_code: employee.employee_code,
        full_name: employee.full_name,
        email: employee.email,
        post_name: employee.post?.post_name || 'N/A',
        district_name: employee.district?.district_name || 'N/A'
      },
      pay_period: {
        month: month,
        year: year,
        month_name: new Date(year, month - 1).toLocaleString('default', { month: 'long' })
      },
      salary: {
        monthly_pay: parseFloat(monthlyPay.toFixed(2)),
        per_day_salary: parseFloat(perDaySalary.toFixed(2)),
        calculated_salary: parseFloat(calculatedSalary.toFixed(2)),
        deduction_amount: parseFloat(deductionAmount.toFixed(2)),
        net_salary: parseFloat(calculatedSalary.toFixed(2))
      },
      attendance: attendance,
      generated_at: new Date().toISOString()
    };

    return payslipData;
  } catch (error) {
    logger.error('Error getting employee payslip:', error);
    throw error;
  }
};

/**
 * Get multiple employees payslips (admin view with filters)
 */
const getEmployeesPayslips = async (adminUser, filters) => {
  try {
    const { month, year, employee_id, district_id, page = 1, limit = 10, search } = filters;
    
    if (!month || !year) {
      throw ApiError.badRequest('Month and year are required');
    }

    // Build where clause
    const where = {
      is_deleted: false,
      is_active: true,
      ...buildHierarchyFilter(adminUser)
    };
    
    if (employee_id) where.employee_id = employee_id;
    if (district_id) where.district_id = district_id;
    
    // Add search functionality
    if (search) {
      const { Op } = db.Sequelize;
      where[Op.or] = [
        { full_name: { [Op.iLike]: `%${search}%` } },
        { employee_code: { [Op.iLike]: `%${search}%` } }
      ];
    }

    // Get pagination
    const offset = (page - 1) * limit;

    // Get employees
    const { count, rows: employees } = await EmployeeMaster.findAndCountAll({
      where,
      include: [
        { model: PostMaster, as: 'post', attributes: ['post_name', 'amount'] },
        { model: DistrictMaster, as: 'district', attributes: ['district_name'] }
      ],
      limit: parseInt(limit),
      offset,
      order: [['employee_code', 'ASC']]
    });

    // Get payslips for each employee
    const employeePayslips = [];
    let totalEmployees = 0;
    let totalGrossSalary = 0;
    let totalDeduction = 0;
    let totalNetPay = 0;

    for (const employee of employees) {
      try {
        const payslipData = await getEmployeePayslip(adminUser, employee.employee_id, month, year);
        
        // Add to totals
        totalEmployees++;
        totalGrossSalary += payslipData.salary.monthly_pay;
        totalDeduction += payslipData.salary.deduction_amount;
        totalNetPay += payslipData.salary.net_salary;
        
        // Create simplified employee payslip entry
        employeePayslips.push({
          employee_id: payslipData.employee.employee_id,
          employee_code: payslipData.employee.employee_code,
          full_name: payslipData.employee.full_name,
          district_name: payslipData.employee.district_name,
          post_name: payslipData.employee.post_name,
          basic_salary: payslipData.salary.monthly_pay,
          deducted_amount: payslipData.salary.deduction_amount,
          net_pay: payslipData.salary.net_salary
        });
      } catch (error) {
        // Skip employees with errors (e.g., no pay info)
        logger.warn(`Skipping employee ${employee.employee_id}: ${error.message}`);
      }
    }

    return {
      summary: {
        total_employees: totalEmployees,
        total_gross_salary: parseFloat(totalGrossSalary.toFixed(2)),
        total_deduction: parseFloat(totalDeduction.toFixed(2)),
        total_net_pay: parseFloat(totalNetPay.toFixed(2)),
        pay_period: {
          month: parseInt(month),
          year: parseInt(year),
          month_name: new Date(year, month - 1).toLocaleString('default', { month: 'long' })
        }
      },
      employees: employeePayslips,
      pagination: {
        current_page: parseInt(page),
        total_pages: Math.ceil(count / limit),
        total_records: count,
        records_on_page: employeePayslips.length
      },
      filters: {
        month,
        year,
        employee_id,
        district_id,
        search
      }
    };
  } catch (error) {
    logger.error('Error getting employees payslips:', error);
    throw error;
  }
};

/**
 * Get own payslip (employee view)
 */
const getMyPayslip = async (employeeId, month, year) => {
  try {
    // Get employee details
    const employee = await EmployeeMaster.findOne({
      where: {
        employee_id: employeeId,
        is_deleted: false
      },
      include: [
        { model: PostMaster, as: 'post', attributes: ['post_name', 'amount'] },
        { model: DistrictMaster, as: 'district', attributes: ['district_name'] }
      ]
    });

    if (!employee) {
      throw ApiError.notFound('Employee not found');
    }

    // Get employee pay
    const monthlyPay = parseFloat(employee.employee_pay || employee.post?.amount || 0);

    if (monthlyPay === 0) {
      throw ApiError.badRequest('No pay information available');
    }

    // Calculate attendance
    const attendance = await calculateAttendanceSummary(employeeId, month, year);

    // Calculate salary
    const perDaySalary = monthlyPay / attendance.working_days;
    const calculatedSalary = perDaySalary * attendance.paid_days;
    const deductionAmount = perDaySalary * attendance.absent_days;

    // Calculate contract period and months left
    const today = new Date();
    const contractStart = employee.contract_start_date ? new Date(employee.contract_start_date) : null;
    const contractEnd = employee.contract_end_date ? new Date(employee.contract_end_date) : null;
    
    let monthsWorked = 0;
    let monthsLeft = 0;
    let contractPeriod = 0;
    
    if (contractStart && contractEnd) {
      // Total contract period in months
      const diffTime = Math.abs(contractEnd - contractStart);
      contractPeriod = Math.ceil(diffTime / (1000 * 60 * 60 * 24 * 30));
      
      // Months worked (approximate)
      if (today >= contractStart) {
        const workedTime = Math.abs(today - contractStart);
        monthsWorked = Math.ceil(workedTime / (1000 * 60 * 60 * 24 * 30));
      }
      
      // Months left
      if (today < contractEnd) {
        const leftTime = Math.abs(contractEnd - today);
        monthsLeft = Math.ceil(leftTime / (1000 * 60 * 60 * 24 * 30));
      }
    }

    // Find last paid month (simplified - assumes current month is being calculated)
    const lastPaidMonth = new Date(year, month - 2, 1); // Previous month
    const lastPaidGross = monthlyPay; // Simplified - same as monthly pay

    // Build payslip data
    const payslipData = {
      employee: {
        employee_id: employee.employee_id,
        employee_code: employee.employee_code,
        full_name: employee.full_name,
        email: employee.email,
        post_name: employee.post?.post_name || 'N/A',
        district_name: employee.district?.district_name || 'N/A'
      },
      contract: {
        start_date: employee.contract_start_date,
        end_date: employee.contract_end_date,
        total_months: contractPeriod,
        months_worked: monthsWorked,
        months_left: monthsLeft
      },
      last_paid: {
        gross_total: parseFloat(lastPaidGross.toFixed(2)),
        month: lastPaidMonth.getMonth() + 1,
        year: lastPaidMonth.getFullYear(),
        month_name: lastPaidMonth.toLocaleString('default', { month: 'long' })
      },
      current_month: {
        month: month,
        year: year,
        month_name: new Date(year, month - 1).toLocaleString('default', { month: 'long' }),
        gross_salary: parseFloat(monthlyPay.toFixed(2)),
        deducted_amount: parseFloat(deductionAmount.toFixed(2)),
        net_pay: parseFloat(calculatedSalary.toFixed(2))
      },
      attendance: attendance,
      generated_at: new Date().toISOString()
    };

    return payslipData;
  } catch (error) {
    logger.error('Error getting my payslip:', error);
    throw error;
  }
};

module.exports = {
  getEmployeePayslip,
  getEmployeesPayslips,
  getMyPayslip,
  calculateAttendanceSummary
};
