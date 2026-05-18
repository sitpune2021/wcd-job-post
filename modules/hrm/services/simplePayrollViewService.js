/**
 * Simplified Payroll View Service
 * Provides basic payslip viewing functionality for admin and employee
 * No complex calculations, just displays stored payroll data
 */

const db = require('../../../models');
const { ApiError } = require('../../../middleware/errorHandler');
const logger = require('../../../config/logger');
const { buildHierarchyFilter } = require('../utils/hrmHelpers');
const ApplicantPersonal = db.ApplicantPersonal;

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
 * Calculate additional deductions based on configurable rules
 */
const calculateDeductions = (employee, monthlyPay, calculatedSalary) => {
  const deductions = [];
  let totalDeductions = 0;

  // PT Tax (Professional Tax) - Configurable by gender and salary
  if (process.env.PT_TAX_ENABLED === 'true') {
    const maleThreshold = parseFloat(process.env.PT_TAX_MALE_THRESHOLD || 10000);
    const maleAmount = parseFloat(process.env.PT_TAX_MALE_AMOUNT || 200);
    const femaleThreshold = parseFloat(process.env.PT_TAX_FEMALE_THRESHOLD || 25000);
    const femaleAmount = parseFloat(process.env.PT_TAX_FEMALE_AMOUNT || 200);

    // Check if employee qualifies for PT tax
    const gender = employee.applicant?.personal?.gender?.toLowerCase() || 'male'; // Default to male if not specified
    let ptTaxAmount = 0;
    let ptTaxReason = '';

    if (gender === 'male' && monthlyPay >= maleThreshold) {
      ptTaxAmount = maleAmount;
      ptTaxReason = `PT Tax (Male): Salary ≥ ₹${maleThreshold.toLocaleString('en-IN')}`;
    } else if (gender === 'female' && monthlyPay > femaleThreshold) {
      ptTaxAmount = femaleAmount;
      ptTaxReason = `PT Tax (Female): Salary > ₹${femaleThreshold.toLocaleString('en-IN')}`;
    }

    if (ptTaxAmount > 0) {
      deductions.push({
        type: 'PT_TAX',
        name: 'Professional Tax',
        amount: ptTaxAmount,
        reason: ptTaxReason,
        calculation: `₹${ptTaxAmount} (Fixed amount based on gender and salary threshold)`
      });
      totalDeductions += ptTaxAmount;
    }
  }

  return {
    deductions,
    totalDeductions,
    breakdown: deductions.map(d => ({
      name: d.name,
      amount: d.amount,
      reason: d.reason,
      calculation: d.calculation
    }))
  };
};

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

  // Calculate working days considering contract start date
  let workingDays = getWorkingDaysInMonth(month, year);
  
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

    // Get personal information for full name
    let fullName = employee.full_name;
    if (employee.applicant_id) {
      try {
        const personalInfo = await ApplicantPersonal.findOne({
          where: { applicant_id: employee.applicant_id, is_deleted: false },
          attributes: ['full_name'],
          raw: true
        });
        if (personalInfo?.full_name) {
          fullName = personalInfo.full_name;
        }
      } catch (e) {
        // Fallback to employee_code if personal info fetch fails
      }
    }

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

    // Calculate salary
    const perDaySalary = monthlyPay / attendance.working_days;
    const calculatedSalary = perDaySalary * attendance.paid_days;
    const deductionAmount = perDaySalary * attendance.absent_days;

    // Calculate additional deductions
    const deductions = calculateDeductions(employee, monthlyPay, calculatedSalary);
    const totalDeductionAmount = deductionAmount + deductions.totalDeductions;
    const netSalary = monthlyPay - totalDeductionAmount;

    // Build payslip data
    const payslipData = {
      employee: {
        employee_id: employee.employee_id,
        employee_code: employee.employee_code,
        full_name: fullName || employee.employee_code,
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
        attendance_deduction: parseFloat(deductionAmount.toFixed(2)),
        additional_deductions: parseFloat(deductions.totalDeductions.toFixed(2)),
        total_deduction: parseFloat(totalDeductionAmount.toFixed(2)),
        net_salary: parseFloat(netSalary.toFixed(2)),
        deduction_breakdown: deductions.breakdown
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
