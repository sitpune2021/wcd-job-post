/**
 * Centralized HRM Salary Calculations Module
 * Keeps salary, deduction, and payment split rules in one backend source.
 */

const logger = require('../../../config/logger');

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const roundMoney = (value) => parseFloat(toNumber(value).toFixed(2));

const resolveEmployeeGender = (employee) => {
  const rawGender = employee?.gender || employee?.applicant?.personal?.gender || '';
  const gender = String(rawGender).trim().toLowerCase();
  if (gender.startsWith('f')) return 'female';
  if (gender.startsWith('m')) return 'male';
  return 'male';
};

/**
 * Calculate additional deductions based on configurable rules.
 */
const calculateDeductions = (employee, monthlyPay) => {
  const deductions = [];
  let totalDeductions = 0;

  if (process.env.PT_TAX_ENABLED === 'true') {
    const maleThreshold = toNumber(process.env.PT_TAX_MALE_THRESHOLD, 10000);
    const maleAmount = toNumber(process.env.PT_TAX_MALE_AMOUNT, 200);
    const femaleThreshold = toNumber(process.env.PT_TAX_FEMALE_THRESHOLD, 25000);
    const femaleAmount = toNumber(process.env.PT_TAX_FEMALE_AMOUNT, 200);
    const gender = resolveEmployeeGender(employee);

    let ptTaxAmount = 0;
    let ptTaxReason = '';

    if (gender === 'male' && monthlyPay >= maleThreshold) {
      ptTaxAmount = maleAmount;
      ptTaxReason = `PT Tax (Male): Salary >= INR ${maleThreshold.toLocaleString('en-IN')}`;
    } else if (gender === 'female' && monthlyPay >= femaleThreshold) {
      ptTaxAmount = femaleAmount;
      ptTaxReason = `PT Tax (Female): Salary >= INR ${femaleThreshold.toLocaleString('en-IN')}`;
    }

    if (ptTaxAmount > 0) {
      deductions.push({
        type: 'PT_TAX',
        name: 'Professional Tax',
        amount: roundMoney(ptTaxAmount),
        reason: ptTaxReason,
        calculation: `INR ${ptTaxAmount.toLocaleString('en-IN')} fixed amount based on gender and salary threshold`
      });
      totalDeductions += ptTaxAmount;
    }
  }

  return {
    deductions,
    totalDeductions: roundMoney(totalDeductions),
    breakdown: deductions.map((d) => ({
      name: d.name,
      amount: d.amount,
      reason: d.reason,
      calculation: d.calculation
    }))
  };
};

/**
 * Calculate paid days for salary.
 */
const calculatePaidDays = (salaryDays, deductedDays) => {
  return Math.max(toNumber(salaryDays) - toNumber(deductedDays), 0);
};

/**
 * Calculate salary based on attendance and configured deductions.
 *
 * Formula:
 * - Monthly pay is always taken from the assigned post amount.
 * - Salary days are all calendar days in the employee's contract overlap for the month.
 * - Past unmarked days, absent days, unpaid leave, and half-day shortage are deducted.
 * - Approved weekly off, paid leave, and present days are paid.
 * - Future current-month days are neutral and not included in payable salary yet.
 * - Additional deductions such as PT are applied after attendance proration.
 * - Net salary is till-date payable and is later split by payment distribution.
 */
const calculateSalary = (employee, attendance) => {
  try {
    const monthlyPay = toNumber(employee?.post?.amount, 0);
    const salaryDays = toNumber(attendance?.salary_days || attendance?.working_days, 0);

    if (monthlyPay <= 0 || salaryDays <= 0) {
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

    const deductedDays = Math.min(Math.max(toNumber(attendance?.deducted_days, 0), 0), salaryDays);
    const paidDays = Math.min(Math.max(toNumber(attendance?.paid_days, calculatePaidDays(salaryDays, deductedDays)), 0), salaryDays);
    const futureDays = Math.min(Math.max(toNumber(attendance?.future_days, 0), 0), salaryDays);
    const perDaySalary = monthlyPay / salaryDays;
    const earnedTillDate = perDaySalary * paidDays;
    const attendanceDeduction = Math.min(perDaySalary * deductedDays, monthlyPay);
    const futurePendingAmount = Math.min(perDaySalary * futureDays, monthlyPay);
    const calculatedSalary = Math.max(earnedTillDate, 0);
    const deductions = calculateDeductions(employee, monthlyPay);
    const netSalary = Math.max(calculatedSalary - deductions.totalDeductions, 0);

    return {
      monthly_pay: roundMoney(monthlyPay),
      per_day_salary: roundMoney(perDaySalary),
      salary_days: roundMoney(salaryDays),
      paid_days: roundMoney(paidDays),
      deducted_days: roundMoney(deductedDays),
      future_days: roundMoney(futureDays),
      earned_till_date: roundMoney(earnedTillDate),
      future_pending_amount: roundMoney(futurePendingAmount),
      calculated_salary: roundMoney(calculatedSalary),
      attendance_deduction: roundMoney(attendanceDeduction),
      additional_deductions: roundMoney(deductions.totalDeductions),
      total_deduction: roundMoney(attendanceDeduction + deductions.totalDeductions),
      net_salary: roundMoney(netSalary),
      deduction_breakdown: deductions.breakdown
    };
  } catch (error) {
    logger.error('Error calculating salary:', error);
    throw error;
  }
};

/**
 * Split net salary into center/state portions based on scheme type settings.
 */
const calculatePaymentSplit = (netSalary, paymentDistribution) => {
  const totalAmount = roundMoney(netSalary);
  const centerPercent = toNumber(paymentDistribution?.center_share_percent, 0);
  const statePercent = toNumber(paymentDistribution?.state_share_percent, 0);
  const hasDistribution = centerPercent > 0 || statePercent > 0;

  if (!hasDistribution || totalAmount <= 0) {
    return {
      center_share_percent: centerPercent,
      state_share_percent: statePercent,
      center_share_amount: 0,
      state_share_amount: 0,
      undistributed_amount: totalAmount,
      total_amount: totalAmount,
      has_distribution: hasDistribution
    };
  }

  const centerShareAmount = roundMoney((totalAmount * centerPercent) / 100);
  const stateShareAmount = roundMoney((totalAmount * statePercent) / 100);
  const undistributedAmount = roundMoney(Math.max(totalAmount - centerShareAmount - stateShareAmount, 0));

  return {
    center_share_percent: centerPercent,
    state_share_percent: statePercent,
    center_share_amount: centerShareAmount,
    state_share_amount: stateShareAmount,
    undistributed_amount: undistributedAmount,
    total_amount: totalAmount,
    has_distribution: true
  };
};

/**
 * Generate complete payslip data.
 */
const generatePayslip = (employee, attendance, month, year) => {
  try {
    const fullName = employee?.full_name || employee?.applicant?.personal?.full_name || employee?.employee_code;
    const salary = calculateSalary(employee, attendance);

    return {
      employee: {
        employee_id: employee.employee_id,
        employee_code: employee.employee_code,
        full_name: fullName || employee.employee_code,
        email: employee.email,
        post_name: employee.post?.post_name || 'N/A',
        district_name: employee.district?.district_name || 'N/A'
      },
      pay_period: {
        month,
        year,
        month_name: new Date(year, month - 1).toLocaleString('default', { month: 'long' })
      },
      salary,
      attendance,
      generated_at: new Date().toISOString()
    };
  } catch (error) {
    logger.error('Error generating payslip:', error);
    throw error;
  }
};

/**
 * Validate salary calculation inputs.
 */
const validateSalaryInputs = (employee, attendance) => {
  if (!employee || !attendance) return false;
  const salaryDays = toNumber(attendance.salary_days || attendance.working_days, 0);
  if (!employee.employee_id || salaryDays <= 0) return false;
  return true;
};

module.exports = {
  calculateDeductions,
  calculatePaidDays,
  calculateSalary,
  calculatePaymentSplit,
  generatePayslip,
  validateSalaryInputs
};
