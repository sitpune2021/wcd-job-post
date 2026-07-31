/**
 * Centralized HRM Salary Calculations Module
 * Consolidates all salary-related calculations to reduce code duplication
 * and ensure consistency across the application
 */

const logger = require('../../../config/logger');

/**
 * Calculate additional deductions based on configurable rules
 * @param {Object} employee - Employee object with personal details
 * @param {number} monthlyPay - Monthly salary amount
 * @param {number} calculatedSalary - Calculated salary for deduction purposes
 * @returns {Object} Deductions breakdown
 */
const calculateDeductions = (employee, monthlyPay, calculatedSalary) => {
  const deductions = [];
  let totalDeductions = 0;

  // PT Tax (Professional Tax) - Configurable by gender and salary
  if (process.env.PT_TAX_ENABLED === 'true') {
    const maleThreshold = parseFloat(process.env.PT_TAX_MALE_THRESHOLD || 10000);
    const maleAmount = parseFloat(process.env.PT_TAX_MALE_AMOUNT || 200);
    const femaleThreshold = parseFloat(process.env.PT_TAX_FEMALE_THRESHOLD || 10000);
    const femaleAmount = parseFloat(process.env.PT_TAX_FEMALE_AMOUNT || 200);

    // Determine gender from employee data
    const gender = employee.gender?.toLowerCase() || 'male'; // Default to male if not specified
    let ptTaxAmount = 0;
    let ptTaxReason = '';

    if (gender === 'male' && monthlyPay >= maleThreshold) {
      ptTaxAmount = maleAmount;
      ptTaxReason = `PT Tax (Male): Salary ≥ ₹${maleThreshold.toLocaleString('en-IN')}`;
    } else if (gender === 'female' && monthlyPay >= femaleThreshold) {
      ptTaxAmount = femaleAmount;
      ptTaxReason = `PT Tax (Female): Salary ≥ ₹${femaleThreshold.toLocaleString('en-IN')}`;
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
 * Calculate paid days for salary
 * @param {number} present - Number of present days
 * @param {number} halfDays - Number of half days
 * @param {number} onLeave - Number of leave days
 * @returns {number} Total paid days
 */
const calculatePaidDays = (present, halfDays, onLeave) => {
  const halfDayDays = halfDays * 0.5;
  return present + halfDayDays + onLeave;
};

/**
 * Calculate salary based on attendance and deductions
 * @param {Object} employee - Employee object with salary and personal details
 * @param {Object} attendance - Attendance summary object
 * @returns {Object} Salary calculation result
 */
const calculateSalary = (employee, attendance) => {
  try {
    // Get employee pay (priority to employee_pay, fallback to post.amount)
    const monthlyPay = parseFloat(employee.employee_pay || employee.post?.amount || 0);

    if (monthlyPay === 0) {
      return {
        monthly_pay: 0,
        per_day_salary: 0,
        calculated_salary: 0,
        attendance_deduction: 0,
        additional_deductions: 0,
        total_deduction: 0,
        net_salary: 0,
        deduction_breakdown: []
      };
    }

    // Calculate salary - PT deduction first, then attendance-based
    const deductions = calculateDeductions(employee, monthlyPay, monthlyPay);
    const salaryAfterPT = monthlyPay - deductions.totalDeductions;
    
    // Calculate per-day salary after PT deduction
    const perDaySalary = salaryAfterPT / attendance.working_days;
    const calculatedSalary = perDaySalary * attendance.paid_days;
    const attendanceDeduction = perDaySalary * attendance.absent_days;
    
    const netSalary = calculatedSalary;

    return {
      monthly_pay: parseFloat(monthlyPay.toFixed(2)),
      per_day_salary: parseFloat(perDaySalary.toFixed(2)),
      calculated_salary: parseFloat(calculatedSalary.toFixed(2)),
      attendance_deduction: parseFloat(attendanceDeduction.toFixed(2)),
      additional_deductions: parseFloat(deductions.totalDeductions.toFixed(2)),
      total_deduction: parseFloat((attendanceDeduction + deductions.totalDeductions).toFixed(2)),
      net_salary: parseFloat(netSalary.toFixed(2)),
      deduction_breakdown: deductions.breakdown
    };
  } catch (error) {
    logger.error('Error calculating salary:', error);
    throw error;
  }
};

/**
 * Generate complete payslip data
 * @param {Object} employee - Employee object
 * @param {Object} attendance - Attendance summary object
 * @param {number} month - Month (1-12)
 * @param {number} year - Year
 * @returns {Object} Complete payslip data
 */
const generatePayslip = (employee, attendance, month, year) => {
  try {
    // Get personal information for full name
    let fullName = employee.full_name || employee.applicant?.personal?.full_name || employee.employee_code;

    // Calculate salary
    const salary = calculateSalary(employee, attendance);

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
      salary: salary,
      attendance: attendance,
      generated_at: new Date().toISOString()
    };

    return payslipData;
  } catch (error) {
    logger.error('Error generating payslip:', error);
    throw error;
  }
};

/**
 * Validate salary calculation inputs
 * @param {Object} employee - Employee object
 * @param {Object} attendance - Attendance object
 * @returns {boolean} True if inputs are valid
 */
const validateSalaryInputs = (employee, attendance) => {
  if (!employee || !attendance) {
    return false;
  }

  if (!employee.employee_id || !attendance.working_days) {
    return false;
  }

  if (attendance.working_days <= 0) {
    return false;
  }

  return true;
};

module.exports = {
  calculateDeductions,
  calculatePaidDays,
  calculateSalary,
  generatePayslip,
  validateSalaryInputs
};
