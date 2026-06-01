/**
 * Simplified Payroll View Service
 * Provides basic payslip viewing functionality for admin and employee
 * No complex calculations, just displays stored payroll data
 */

const db = require('../../../models');
const { ApiError } = require('../../../middleware/errorHandler');
const logger = require('../../../config/logger');
const { buildHierarchyFilter } = require('../utils/hrmHelpers');
const { getWorkingDaysInMonth } = require('../utils/workingDayHelpers');
const { generatePayslip } = require('../utils/salaryCalculations');
const ApplicantPersonal = db.ApplicantPersonal;

const EmployeeMaster = db.EmployeeMaster;
const Attendance = db.HrmAttendance;
const LeaveApplication = db.HrmLeaveApplication;
const PostMaster = db.PostMaster;
const DistrictMaster = db.DistrictMaster;

// getWorkingDaysInMonth moved to workingDayHelpers.js for consolidation
// Import from workingDayHelpers instead: const { getWorkingDaysInMonth } = require('../utils/workingDayHelpers');

// calculateDeductions moved to salaryCalculations.js for consolidation
// Import from salaryCalculations instead: const { calculateDeductions } = require('../utils/salaryCalculations');

/**
 * Calculate attendance summary for an employee
 */
const calculateAttendanceSummary = async (employeeId, month, year) => {
  // Get employee contract info
  const employee = await EmployeeMaster.findOne({
    where: { employee_id: employeeId },
    attributes: ['contract_start_date', 'contract_end_date']
  });

  // Get attendance records for the specific month
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0);
  
  const attendanceRecords = await Attendance.findAll({
    where: {
      employee_id: employeeId,
      attendance_date: {
        [db.Sequelize.Op.between]: [
          monthStart.toISOString().split('T')[0],
          monthEnd.toISOString().split('T')[0]
        ]
      },
      status: ['PRESENT', 'ABSENT', 'HALF_DAY', 'ON_LEAVE', 'HOLIDAY', 'SUNDAY']
    }
  });

  // Get approved leaves for the specific month
  const approvedLeaves = await LeaveApplication.findAll({
    where: {
      employee_id: employeeId,
      status: 'APPROVED',
      [db.Sequelize.Op.or]: [
        {
          from_date: { [db.Sequelize.Op.between]: [
            monthStart.toISOString().split('T')[0],
            monthEnd.toISOString().split('T')[0]
          ]},
          to_date: { [db.Sequelize.Op.between]: [
            monthStart.toISOString().split('T')[0],
            monthEnd.toISOString().split('T')[0]
          ]}
        },
        {
          from_date: { [db.Sequelize.Op.lte]: monthStart.toISOString().split('T')[0] },
          to_date: { [db.Sequelize.Op.gte]: monthEnd.toISOString().split('T')[0] }
        }
      ]
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
        halfDays += 1; // Count half days as whole numbers for salary calculation
        break;
      case 'ON_LEAVE':
        leaveDays++;
        break;
    }
  });

  // Calculate working days considering contract start date
  let workingDaysResult = await getWorkingDaysInMonth(month, year);
  let workingDays = workingDaysResult.workingDays;
  
  // If employee joined mid-month, adjust working days
  if (employee?.contract_start_date) {
    const contractStart = new Date(employee.contract_start_date);
    if (contractStart.getFullYear() === year && contractStart.getMonth() === month - 1) {
      // Employee joined this month - count days from contract start
      workingDays = 0;
      const daysInMonth = new Date(year, month, 0).getDate();
      for (let day = contractStart.getDate(); day <= daysInMonth; day++) {
        const date = new Date(year, month - 1, day);
        const dayOfWeek = date.getDay();
        if (dayOfWeek !== 0) { // Exclude Sundays
          workingDays++;
        }
      }
    }
  }
  
  // Paid days = present + (half days * 0.5) + leave days
  const halfDayDays = halfDays * 0.5;
  const paidDays = presentDays + halfDayDays + leaveDays;

  
  return {
    working_days: workingDays,
    present_days: presentDays,
    absent_days: absentDays, // Use actual database count
    leave_days: leaveDays,
    half_days: halfDays,
    half_day_days: halfDayDays,
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
        { model: DistrictMaster, as: 'district', attributes: ['district_name'] },
        {
          model: db.ApplicantMaster,
          as: 'applicant',
          attributes: ['applicant_id'],
          required: false,
          include: [
            {
              model: ApplicantPersonal,
              as: 'personal',
              attributes: ['full_name', 'gender'],
              required: false
            }
          ]
        }
      ]
    });

    if (!employee) {
      throw ApiError.notFound('Employee not found or not in your jurisdiction');
    }

    // Get personal information for full name
    let fullName = employee.full_name || employee.applicant?.personal?.full_name || employee.employee_code;

    // Get employee pay (priority to employee_pay, fallback to post.amount)
    const monthlyPay = parseFloat(employee.employee_pay || employee.post?.amount || 0);

    if (monthlyPay === 0) {
      // Return zero salary for employees without pay information
      const attendance = await calculateAttendanceSummary(employeeId, month, year);
      return {
        employee: {
          employee_id: employee.employee_id,
          employee_code: employee.employee_code,
          full_name: fullName || employee.employee_code,
          email: employee.email,
          post_name: employee.post?.post_name || 'N/A',
          district_name: employee.district?.district_name || 'N/A'
        },
        salary: {
          monthly_pay: 0,
          deduction_amount: 0,
          net_salary: 0
        },
        attendance: attendance,
        generated_at: new Date().toISOString()
      };
    }

    // Calculate attendance
    const attendance = await calculateAttendanceSummary(employeeId, month, year);

    // Generate payslip using centralized salary calculations
    const payslipData = generatePayslip(employee, attendance, month, year);

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
        { model: DistrictMaster, as: 'district', attributes: ['district_name'] },
        { 
          model: db.ApplicantMaster, 
          as: 'applicant',
          attributes: ['applicant_id'],
          required: false,
          include: [
            {
              model: db.ApplicantPersonal,
              as: 'personal',
              attributes: ['gender'],
              required: false
            }
          ]
        }
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
        totalGrossSalary += payslipData.salary.calculated_salary;
        totalDeduction += payslipData.salary.total_deduction;
        totalNetPay += payslipData.salary.net_salary;
        
        // Create simplified employee payslip entry
        employeePayslips.push({
          employee_id: payslipData.employee.employee_id,
          employee_code: payslipData.employee.employee_code,
          full_name: payslipData.employee.full_name,
          district_name: payslipData.employee.district_name,
          post_name: payslipData.employee.post_name,
          basic_salary: payslipData.salary.monthly_pay,
          calculated_salary: payslipData.salary.calculated_salary,
          attendance_deduction: payslipData.salary.attendance_deduction,
          additional_deductions: payslipData.salary.additional_deductions,
          total_deduction: payslipData.salary.total_deduction,
          net_pay: payslipData.salary.net_salary,
          deduction_breakdown: payslipData.salary.deduction_breakdown
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
    // Get employee details with personal information
    const employee = await EmployeeMaster.findOne({
      where: {
        employee_id: employeeId,
        is_deleted: false
      },
      include: [
        { model: PostMaster, as: 'post', attributes: ['post_name', 'amount'] },
        { model: DistrictMaster, as: 'district', attributes: ['district_name'] },
        { 
          model: db.ApplicantMaster, 
          as: 'applicant',
          attributes: ['applicant_id'],
          required: false,
          include: [
            {
              model: db.ApplicantPersonal,
              as: 'personal',
              attributes: ['full_name', 'gender'],
              required: false
            }
          ]
        }
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
      // Calculate exact months difference
      const startYear = contractStart.getFullYear();
      const startMonth = contractStart.getMonth();
      const endYear = contractEnd.getFullYear();
      const endMonth = contractEnd.getMonth();
      
      contractPeriod = (endYear - startYear) * 12 + (endMonth - startMonth) + 1;
      
      // Months worked
      if (today >= contractStart) {
        const todayYear = today.getFullYear();
        const todayMonth = today.getMonth();
        monthsWorked = (todayYear - startYear) * 12 + (todayMonth - startMonth) + 1;
      }
      
      // Months left
      if (today < contractEnd) {
        const todayYear = today.getFullYear();
        const todayMonth = today.getMonth();
        monthsLeft = (endYear - todayYear) * 12 + (endMonth - todayMonth);
      }
    }

    // Find last paid month (simplified - assumes current month is being calculated)
    const lastPaidMonth = new Date(year, month - 2, 1); // Previous month
    const lastPaidGross = monthlyPay; // Simplified - same as monthly pay

    // Build payslip data
    const fullName = employee.applicant?.personal?.full_name || employee.full_name || employee.employee_code;
    const payslipData = {
      employee: {
        employee_id: employee.employee_id,
        employee_code: employee.employee_code,
        full_name: fullName,
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
