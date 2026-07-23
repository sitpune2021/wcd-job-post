/**
 * Payroll View Service
 * Provides admin and employee payslip data from one salary calculation path.
 */

const db = require('../../../models');
const { ApiError } = require('../../../middleware/errorHandler');
const logger = require('../../../config/logger');
const { buildHierarchyFilter } = require('../utils/hrmHelpers');
const { generatePayslip, calculatePaymentSplit } = require('../utils/salaryCalculations');

const ApplicantPersonal = db.ApplicantPersonal;
const EmployeeMaster = db.EmployeeMaster;
const EmployeeBankDetail = db.EmployeeBankDetail;
const Attendance = db.HrmAttendance;
const LeaveApplication = db.HrmLeaveApplication;
const WeeklyOffClaim = db.HrmWeeklyOffClaim;
const PostMaster = db.PostMaster;
const DistrictMaster = db.DistrictMaster;
const Scheme = db.Scheme;
const SchemeType = db.SchemeType;
const PaymentDistributionSetting = db.PaymentDistributionSetting;
const { Op } = db.Sequelize;

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const roundMoney = (value) => parseFloat(toNumber(value).toFixed(2));

const toDateOnly = (date) => {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const parseDateOnly = (value) => {
  if (!value) return null;
  const [year, month, day] = String(value).slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
};

const isCurrentMonth = (month, year) => {
  const today = new Date();
  return today.getFullYear() === parseInt(year, 10) && today.getMonth() + 1 === parseInt(month, 10);
};

const buildDateRange = (startDate, endDate) => {
  const dates = [];
  const cursor = new Date(startDate);
  while (cursor <= endDate) {
    dates.push(toDateOnly(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
};

const clampDateRange = (startDate, endDate, minDate, maxDate) => {
  const effectiveStart = startDate && startDate > minDate ? startDate : minDate;
  const effectiveEnd = endDate && endDate < maxDate ? endDate : maxDate;
  if (effectiveStart > effectiveEnd) return null;
  return { effectiveStart, effectiveEnd };
};

const getPaymentSettingInclude = () => ({
  model: PaymentDistributionSetting,
  as: 'paymentSetting',
  attributes: ['setting_id', 'center_share_percent', 'state_share_percent'],
  required: false
});

const getSchemeTypeInclude = () => ({
  model: SchemeType,
  as: 'schemeType',
  attributes: ['scheme_type_id', 'scheme_code', 'scheme_name'],
  required: false,
  include: [getPaymentSettingInclude()]
});

const getSchemeInclude = () => ({
  model: Scheme,
  as: 'scheme',
  attributes: ['scheme_id', 'scheme_code', 'scheme_name', 'scheme_type_id'],
  required: false,
  include: [getSchemeTypeInclude()]
});

const getEmployeeIncludes = () => [
  {
    model: PostMaster,
    as: 'post',
    attributes: ['post_id', 'post_name', 'amount', 'scheme_id'],
    required: false,
    include: [getSchemeInclude()]
  },
  { model: DistrictMaster, as: 'district', attributes: ['district_id', 'district_name'], required: false },
  getSchemeInclude(),
  {
    model: EmployeeBankDetail,
    as: 'bankDetail',
    attributes: [
      'bank_name',
      'account_holder_name',
      'account_number',
      'ifsc_code',
      'aadhar_number',
      'state',
      'district'
    ],
    required: false
  },
  {
    model: db.ApplicantMaster,
    as: 'applicant',
    attributes: ['applicant_id', 'email', 'mobile_no'],
    required: false,
    include: [
      {
        model: ApplicantPersonal,
        as: 'personal',
        attributes: ['full_name', 'gender', 'aadhar_no'],
        required: false
      }
    ]
  }
];

const buildPayrollWhere = (adminUser, filters) => {
  const { employee_id, district_id, search } = filters;
  const where = {
    is_deleted: false,
    is_active: true,
    ...buildHierarchyFilter(adminUser)
  };

  if (employee_id) where.employee_id = employee_id;
  if (district_id) where.district_id = district_id;

  if (search) {
    const pattern = `%${String(search).trim()}%`;
    where[Op.or] = [
      { employee_code: { [Op.iLike]: pattern } },
      { '$applicant.personal.full_name$': { [Op.iLike]: pattern } },
      { '$post.post_name$': { [Op.iLike]: pattern } }
    ];
  }

  return where;
};

const getPayrollEmployees = async (adminUser, filters, options = {}) => {
  const where = buildPayrollWhere(adminUser, filters);
  const query = {
    where,
    include: getEmployeeIncludes(),
    distinct: true,
    subQuery: false,
    order: [['employee_code', 'ASC']]
  };

  if (options.paginated) {
    const page = parseInt(filters.page || 1, 10);
    const limit = parseInt(filters.limit || 10, 10);
    return EmployeeMaster.findAndCountAll({
      ...query,
      limit,
      offset: (page - 1) * limit
    });
  }

  return EmployeeMaster.findAll(query);
};

/**
 * Calculate payroll attendance summary for one or more employees.
 *
 * Payroll rule:
 * - Salary denominator is every calendar day in the employee contract overlap for the selected month.
 * - Sundays and holidays are normal payable/deductible days; they are not paid automatically.
 * - Approved weekly off and paid approved leave are paid.
 * - Explicit absent, unpaid leave, half-day shortage, and past unmarked days are deducted.
 * - In the current month, future contract days are neutral: not paid in day counts and not deducted yet.
 */
const calculateAttendanceSummaries = async (employees, month, year) => {
  const employeeList = Array.isArray(employees) ? employees : [employees];
  const employeeIds = employeeList.map((employee) => employee.employee_id).filter(Boolean);
  const summaries = new Map();

  if (employeeIds.length === 0) {
    return summaries;
  }

  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0);
  const monthStartText = toDateOnly(monthStart);
  const monthEndText = toDateOnly(monthEnd);
  const today = new Date();
  const dueEnd = isCurrentMonth(month, year) && today < monthEnd ? today : monthEnd;
  const dueEndText = toDateOnly(dueEnd);

  const attendanceRecords = await Attendance.findAll({
    where: {
      employee_id: { [Op.in]: employeeIds },
      attendance_date: { [Op.between]: [monthStartText, monthEndText] },
      status: { [Op.in]: ['PRESENT', 'ABSENT', 'HALF_DAY', 'ON_LEAVE', 'WEEKLY_OFF', 'HOLIDAY', 'SUNDAY'] },
      is_deleted: false
    },
    attributes: ['employee_id', 'attendance_date', 'status']
  });

  const approvedLeaves = await LeaveApplication.findAll({
    where: {
      employee_id: { [Op.in]: employeeIds },
      status: 'APPROVED',
      is_deleted: false,
      from_date: { [Op.lte]: monthEndText },
      to_date: { [Op.gte]: monthStartText }
    },
    attributes: ['employee_id', 'from_date', 'to_date', 'is_half_day', 'is_paid']
  });

  const approvedWeeklyOffs = await WeeklyOffClaim.findAll({
    where: {
      employee_id: { [Op.in]: employeeIds },
      claim_status: 'APPROVED',
      claimed_off_date: { [Op.between]: [monthStartText, monthEndText] }
    },
    attributes: ['employee_id', 'claimed_off_date']
  });

  const attendanceByEmployeeDate = new Map();
  attendanceRecords.forEach((record) => {
    const key = `${record.employee_id}:${record.attendance_date}`;
    attendanceByEmployeeDate.set(key, record.status);
  });

  const weeklyOffByEmployeeDate = new Set();
  approvedWeeklyOffs.forEach((claim) => {
    if (!claim.claimed_off_date) return;
    weeklyOffByEmployeeDate.add(`${claim.employee_id}:${claim.claimed_off_date}`);
  });

  const approvedLeavesByEmployeeDate = new Map();
  approvedLeaves.forEach((leave) => {
    const leaveStart = parseDateOnly(leave.from_date);
    const leaveEnd = parseDateOnly(leave.to_date);
    if (!leaveStart || !leaveEnd) return;

    const range = clampDateRange(leaveStart, leaveEnd, monthStart, monthEnd);
    if (!range) return;

    buildDateRange(range.effectiveStart, range.effectiveEnd).forEach((dateText) => {
      const key = `${leave.employee_id}:${dateText}`;
      if (!approvedLeavesByEmployeeDate.has(key)) {
        approvedLeavesByEmployeeDate.set(key, []);
      }
      approvedLeavesByEmployeeDate.get(key).push(leave);
    });
  });

  for (const employee of employeeList) {
    const employeeId = employee.employee_id;
    summaries.set(employeeId, {
      salary_days: 0,
      working_days: 0,
      present_days: 0,
      absent_days: 0,
      leave_days: 0,
      paid_leave_days: 0,
      unpaid_leave_days: 0,
      weekly_off_days: 0,
      half_days: 0,
      half_day_days: 0,
      future_days: 0,
      paid_days: 0,
      deducted_days: 0
    });
  }

  for (const employee of employeeList) {
    const summary = summaries.get(employee.employee_id);
    const contractStart = parseDateOnly(employee.contract_start_date);
    const contractEnd = parseDateOnly(employee.contract_end_date);

    if ((contractStart && contractStart > monthEnd) || (contractEnd && contractEnd < monthStart)) {
      continue;
    }

    const range = clampDateRange(contractStart, contractEnd, monthStart, monthEnd);
    if (!range) continue;

    const salaryDates = buildDateRange(range.effectiveStart, range.effectiveEnd);
    summary.salary_days = salaryDates.length;
    summary.working_days = salaryDates.length;

    salaryDates.forEach((dateText) => {
      const dayKey = `${employee.employee_id}:${dateText}`;
      const attendanceStatus = attendanceByEmployeeDate.get(dayKey);
      const leaves = approvedLeavesByEmployeeDate.get(dayKey) || [];
      const hasApprovedWeeklyOff = weeklyOffByEmployeeDate.has(dayKey) || attendanceStatus === 'WEEKLY_OFF';
      const isFutureUndueDay = dateText > dueEndText;

      if (isFutureUndueDay) {
        summary.future_days += 1;
        return;
      }

      if (hasApprovedWeeklyOff) {
        summary.weekly_off_days += 1;
        summary.paid_days += 1;
        return;
      }

      const paidFullLeave = leaves.find((leave) => !leave.is_half_day && leave.is_paid !== false);
      const unpaidFullLeave = leaves.find((leave) => !leave.is_half_day && leave.is_paid === false);
      const halfDayLeave = leaves.find((leave) => leave.is_half_day);

      if (paidFullLeave) {
        summary.leave_days += 1;
        summary.paid_leave_days += 1;
        summary.paid_days += 1;
        return;
      }

      if (unpaidFullLeave) {
        summary.leave_days += 1;
        summary.unpaid_leave_days += 1;
        summary.absent_days += 1;
        summary.deducted_days += 1;
        return;
      }

      if (halfDayLeave) {
        const isPaidHalfLeave = halfDayLeave.is_paid !== false;
        summary.leave_days += 0.5;
        if (isPaidHalfLeave) {
          summary.paid_leave_days += 0.5;
          summary.paid_days += 0.5;
        } else {
          summary.unpaid_leave_days += 0.5;
          summary.deducted_days += 0.5;
        }

        // Leave approval stores half-day leave as HALF_DAY attendance, so only an
        // explicit PRESENT record can pay the remaining half of this salary day.
        if (attendanceStatus === 'PRESENT') {
          summary.present_days += 0.5;
          summary.paid_days += 0.5;
        } else {
          summary.absent_days += 0.5;
          summary.deducted_days += 0.5;
        }
        return;
      }

      switch (attendanceStatus) {
        case 'PRESENT':
          summary.present_days += 1;
          summary.paid_days += 1;
          break;
        case 'HALF_DAY':
          summary.half_days += 1;
          summary.half_day_days += 0.5;
          summary.paid_days += 0.5;
          summary.deducted_days += 0.5;
          break;
        case 'ON_LEAVE':
          summary.leave_days += 1;
          summary.paid_leave_days += 1;
          summary.paid_days += 1;
          break;
        case 'ABSENT':
        case 'HOLIDAY':
        case 'SUNDAY':
        default:
          summary.absent_days += 1;
          summary.deducted_days += 1;
          break;
      }
    });
  }

  return summaries;
};

const calculateAttendanceSummary = async (employeeId, month, year) => {
  const employee = await EmployeeMaster.findOne({
    where: { employee_id: employeeId },
    attributes: ['employee_id', 'contract_start_date', 'contract_end_date']
  });

  if (!employee) {
    return {
      salary_days: 0,
      working_days: 0,
      present_days: 0,
      absent_days: 0,
      leave_days: 0,
      paid_leave_days: 0,
      unpaid_leave_days: 0,
      weekly_off_days: 0,
      half_days: 0,
      half_day_days: 0,
      future_days: 0,
      paid_days: 0,
      deducted_days: 0
    };
  }

  const summaries = await calculateAttendanceSummaries([employee], month, year);
  return summaries.get(employeeId);
};

const resolveScheme = (employee) => employee?.scheme || employee?.post?.scheme || null;

const resolvePaymentDistribution = (employee) => {
  const scheme = resolveScheme(employee);
  const schemeType = scheme?.schemeType || null;
  const paymentSetting = schemeType?.paymentSetting || null;

  return {
    scheme_id: scheme?.scheme_id || null,
    scheme_code: scheme?.scheme_code || null,
    scheme_name: scheme?.scheme_name || null,
    scheme_type_id: schemeType?.scheme_type_id || null,
    scheme_type_code: schemeType?.scheme_code || null,
    scheme_type_name: schemeType?.scheme_name || null,
    center_share_percent: paymentSetting?.center_share_percent || 0,
    state_share_percent: paymentSetting?.state_share_percent || 0
  };
};

const buildBankDetails = (employee, fullName) => {
  const bank = employee?.bankDetail || {};
  const personal = employee?.applicant?.personal || {};

  return {
    beneficiary_name: fullName || '',
    beneficiary_name_as_per_bank: bank.account_holder_name || '',
    bank_name: bank.bank_name || '',
    aadhaar_number: bank.aadhar_number || personal.aadhar_no || '',
    account_number: bank.account_number || '',
    ifsc_code: bank.ifsc_code || '',
    state: bank.state || '',
    district: bank.district || employee?.district?.district_name || ''
  };
};

const buildEmployeePayslip = (employee, attendance, month, year) => {
  const payslipData = generatePayslip(employee, attendance, month, year);
  const fullName = payslipData.employee.full_name;
  const paymentDistribution = resolvePaymentDistribution(employee);
  const split = calculatePaymentSplit(payslipData.salary.net_salary, paymentDistribution);

  payslipData.employee.scheme_id = paymentDistribution.scheme_id;
  payslipData.employee.scheme_code = paymentDistribution.scheme_code;
  payslipData.employee.scheme_name = paymentDistribution.scheme_name;
  payslipData.employee.scheme_type_id = paymentDistribution.scheme_type_id;
  payslipData.employee.scheme_type_code = paymentDistribution.scheme_type_code;
  payslipData.employee.scheme_type_name = paymentDistribution.scheme_type_name;
  payslipData.bank = buildBankDetails(employee, fullName);
  payslipData.payment_distribution = {
    ...paymentDistribution,
    ...split
  };
  payslipData.salary.center_share_amount = split.center_share_amount;
  payslipData.salary.state_share_amount = split.state_share_amount;
  payslipData.salary.undistributed_amount = split.undistributed_amount;

  return payslipData;
};

const toEmployeeListRow = (payslipData) => ({
  employee_id: payslipData.employee.employee_id,
  employee_code: payslipData.employee.employee_code,
  full_name: payslipData.employee.full_name,
  district_name: payslipData.employee.district_name,
  post_name: payslipData.employee.post_name,
  scheme_name: payslipData.employee.scheme_name,
  scheme_type_name: payslipData.employee.scheme_type_name,
  basic_salary: payslipData.salary.monthly_pay,
  calculated_salary: payslipData.salary.calculated_salary,
  attendance_deduction: payslipData.salary.attendance_deduction,
  additional_deductions: payslipData.salary.additional_deductions,
  total_deduction: payslipData.salary.total_deduction,
  net_pay: payslipData.salary.net_salary,
  center_share_amount: payslipData.payment_distribution.center_share_amount,
  state_share_amount: payslipData.payment_distribution.state_share_amount,
  undistributed_amount: payslipData.payment_distribution.undistributed_amount,
  center_share_percent: payslipData.payment_distribution.center_share_percent,
  state_share_percent: payslipData.payment_distribution.state_share_percent,
  deduction_breakdown: payslipData.salary.deduction_breakdown
});

const summarizePayslips = (payslips, month, year) => {
  const totals = payslips.reduce(
    (acc, payslip) => {
      acc.totalBasicSalary += payslip.salary.monthly_pay;
      acc.totalCalculatedSalary += payslip.salary.calculated_salary;
      acc.totalDeduction += payslip.salary.total_deduction;
      acc.totalNetPay += payslip.salary.net_salary;
      acc.totalCenterShare += payslip.payment_distribution.center_share_amount;
      acc.totalStateShare += payslip.payment_distribution.state_share_amount;
      acc.totalUndistributed += payslip.payment_distribution.undistributed_amount;
      return acc;
    },
    {
      totalBasicSalary: 0,
      totalCalculatedSalary: 0,
      totalDeduction: 0,
      totalNetPay: 0,
      totalCenterShare: 0,
      totalStateShare: 0,
      totalUndistributed: 0
    }
  );

  return {
    total_employees: payslips.length,
    total_basic_salary: roundMoney(totals.totalBasicSalary),
    total_gross_salary: roundMoney(totals.totalCalculatedSalary),
    total_calculated_salary: roundMoney(totals.totalCalculatedSalary),
    total_deduction: roundMoney(totals.totalDeduction),
    total_net_pay: roundMoney(totals.totalNetPay),
    total_center_share: roundMoney(totals.totalCenterShare),
    total_state_share: roundMoney(totals.totalStateShare),
    total_undistributed_amount: roundMoney(totals.totalUndistributed),
    pay_period: {
      month: parseInt(month, 10),
      year: parseInt(year, 10),
      month_name: new Date(year, month - 1).toLocaleString('default', { month: 'long' })
    }
  };
};

const buildPayslipsForEmployees = async (employees, month, year) => {
  const attendanceMap = await calculateAttendanceSummaries(employees, parseInt(month, 10), parseInt(year, 10));
  return employees.map((employee) => {
    const attendance = attendanceMap.get(employee.employee_id) || {
      working_days: 0,
      salary_days: 0,
      present_days: 0,
      absent_days: 0,
      leave_days: 0,
      paid_leave_days: 0,
      unpaid_leave_days: 0,
      weekly_off_days: 0,
      half_days: 0,
      half_day_days: 0,
      future_days: 0,
      paid_days: 0,
      deducted_days: 0
    };
    return buildEmployeePayslip(employee, attendance, parseInt(month, 10), parseInt(year, 10));
  });
};

/**
 * Get payslip data for an employee.
 */
const getEmployeePayslip = async (adminUser, employeeId, month, year) => {
  try {
    const employee = await EmployeeMaster.findOne({
      where: {
        employee_id: employeeId,
        is_deleted: false,
        ...buildHierarchyFilter(adminUser)
      },
      include: getEmployeeIncludes()
    });

    if (!employee) {
      throw ApiError.notFound('Employee not found or not in your jurisdiction');
    }

    const [payslipData] = await buildPayslipsForEmployees([employee], month, year);
    return payslipData;
  } catch (error) {
    logger.error('Error getting employee payslip:', error);
    throw error;
  }
};

/**
 * Get multiple employees payslips with page rows and full-filter summary.
 */
const getEmployeesPayslips = async (adminUser, filters) => {
  try {
    const { month, year, page = 1, limit = 10, employee_id, district_id, search } = filters;

    if (!month || !year) {
      throw ApiError.badRequest('Month and year are required');
    }

    const [allEmployees, pagedResult] = await Promise.all([
      getPayrollEmployees(adminUser, filters, { paginated: false }),
      getPayrollEmployees(adminUser, filters, { paginated: true })
    ]);

    const allPayslips = await buildPayslipsForEmployees(allEmployees, month, year);
    const payslipByEmployeeId = new Map(allPayslips.map((payslip) => [payslip.employee.employee_id, payslip]));
    const employeePayslips = pagedResult.rows
      .map((employee) => payslipByEmployeeId.get(employee.employee_id))
      .filter(Boolean)
      .map(toEmployeeListRow);

    const pageLimit = parseInt(limit, 10);

    return {
      summary: summarizePayslips(allPayslips, month, year),
      employees: employeePayslips,
      pagination: {
        current_page: parseInt(page, 10),
        total_pages: Math.ceil(pagedResult.count / pageLimit),
        total_records: pagedResult.count,
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

const getPayrollPaymentLogRows = async (adminUser, filters) => {
  const { month, year } = filters;

  if (!month || !year) {
    throw ApiError.badRequest('Month and year are required');
  }

  const employees = await getPayrollEmployees(adminUser, filters, { paginated: false });
  const payslips = await buildPayslipsForEmployees(employees, month, year);

  return payslips.map((payslip) => ({
    beneficiary_name: payslip.bank.beneficiary_name,
    beneficiary_name_as_per_bank: payslip.bank.beneficiary_name_as_per_bank,
    bank_name: payslip.bank.bank_name,
    aadhaar_number: payslip.bank.aadhaar_number,
    account_number: payslip.bank.account_number,
    ifsc_code: payslip.bank.ifsc_code,
    state: payslip.bank.state,
    district: payslip.bank.district || payslip.employee.district_name,
    center_share_payment_amount: payslip.payment_distribution.center_share_amount,
    state_share_payment_amount: payslip.payment_distribution.state_share_amount,
    total_amount: payslip.payment_distribution.total_amount,
    employee_code: payslip.employee.employee_code,
    post_name: payslip.employee.post_name,
    scheme_type_name: payslip.employee.scheme_type_name
  }));
};

/**
 * Get own payslip (employee view).
 */
const getMyPayslip = async (employeeId, month, year) => {
  try {
    const employee = await EmployeeMaster.findOne({
      where: {
        employee_id: employeeId,
        is_deleted: false
      },
      include: getEmployeeIncludes()
    });

    if (!employee) {
      throw ApiError.notFound('Employee not found');
    }

    const [payslipData] = await buildPayslipsForEmployees([employee], month, year);

    const today = new Date();
    const contractStart = parseDateOnly(employee.contract_start_date);
    const contractEnd = parseDateOnly(employee.contract_end_date);
    let monthsWorked = 0;
    let monthsLeft = 0;
    let contractPeriod = 0;

    if (contractStart && contractEnd) {
      contractPeriod =
        (contractEnd.getFullYear() - contractStart.getFullYear()) * 12 +
        (contractEnd.getMonth() - contractStart.getMonth()) +
        1;

      if (today >= contractStart) {
        monthsWorked =
          (today.getFullYear() - contractStart.getFullYear()) * 12 +
          (today.getMonth() - contractStart.getMonth()) +
          1;
      }

      if (today < contractEnd) {
        monthsLeft =
          (contractEnd.getFullYear() - today.getFullYear()) * 12 +
          (contractEnd.getMonth() - today.getMonth());
      }
    }

    const lastPaidMonth = new Date(year, month - 2, 1);

    return {
      ...payslipData,
      contract: {
        start_date: employee.contract_start_date,
        end_date: employee.contract_end_date,
        total_months: contractPeriod,
        months_worked: monthsWorked,
        months_left: monthsLeft
      },
      last_paid: {
        gross_total: payslipData.salary.monthly_pay,
        month: lastPaidMonth.getMonth() + 1,
        year: lastPaidMonth.getFullYear(),
        month_name: lastPaidMonth.toLocaleString('default', { month: 'long' })
      },
      current_month: {
        month,
        year,
        month_name: new Date(year, month - 1).toLocaleString('default', { month: 'long' }),
        gross_salary: payslipData.salary.monthly_pay,
        deducted_amount: payslipData.salary.total_deduction,
        net_pay: payslipData.salary.net_salary
      }
    };
  } catch (error) {
    logger.error('Error getting my payslip:', error);
    throw error;
  }
};

module.exports = {
  getEmployeePayslip,
  getEmployeesPayslips,
  getPayrollPaymentLogRows,
  getMyPayslip,
  calculateAttendanceSummary
};
