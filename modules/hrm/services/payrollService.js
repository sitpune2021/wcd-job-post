const { Op } = require('sequelize');
const db = require('../../../models');
const { ApiError } = require('../../../middleware/errorHandler');
const { buildHierarchyFilter } = require('../utils/hrmHelpers');
const { getPagination } = require('../utils/hrmHelpers');

const PayrollCycle = db.HrmPayrollCycle;
const Payslip = db.HrmPayslip;
const EmployeeMaster = db.EmployeeMaster;
const Attendance = db.HrmAttendance;
const LeaveApplication = db.HrmLeaveApplication;

const generatePayslipNumber = (employeeId, month, year) => {
  const paddedMonth = String(month).padStart(2, '0');
  const paddedEmpId = String(employeeId).padStart(6, '0');
  return `PAY${year}${paddedMonth}${paddedEmpId}`;
};

const getWorkingDaysInMonth = (month, year) => {
  const daysInMonth = new Date(year, month, 0).getDate();
  let workingDays = 0;
  
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month - 1, day);
    const dayOfWeek = date.getDay();
    if (dayOfWeek !== 0) workingDays++;
  }
  
  return workingDays;
};

const calculateAttendanceForEmployee = async (employeeId, month, year) => {
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

  let presentDays = 0;
  let absentDays = 0;
  let leaveDays = 0;

  attendanceRecords.forEach(record => {
    if (record.status === 'PRESENT') {
      presentDays += 1;
    } else if (record.status === 'HALF_DAY') {
      presentDays += 0.5;
      absentDays += 0.5;
    } else if (record.status === 'ON_LEAVE') {
      leaveDays += 1;
    } else if (record.status === 'ABSENT') {
      absentDays += 1;
    }
  });

  const approvedLeaves = await LeaveApplication.findAll({
    where: {
      employee_id: employeeId,
      status: 'APPROVED',
      from_date: {
        [Op.lte]: endDate
      },
      to_date: {
        [Op.gte]: startDate
      },
      is_deleted: false
    }
  });

  approvedLeaves.forEach(leave => {
    leaveDays += parseFloat(leave.total_days);
  });

  return { presentDays, absentDays, leaveDays };
};

const calculateSalaryForEmployee = async (employee, workingDays, presentDays, leaveDays) => {
  // Use employee_pay if available, otherwise fallback to post amount
  let postSalary = 0;
  
  // Priority 1: Use employee_pay (maintains consistency even if post changes)
  if (employee.employee_pay) {
    postSalary = parseFloat(employee.employee_pay);
  }
  // Priority 2: Fallback to post amount
  else {
    const post = await db.PostMaster.findOne({
      where: { post_id: employee.post_id, is_deleted: false },
      attributes: ['amount']
    });
    postSalary = parseFloat(post?.amount || 0);
  }
  
  if (postSalary === 0) {
    throw ApiError.badRequest(`Employee ${employee.employee_code} has no salary defined`);
  }

  const paidDays = presentDays + leaveDays; // Approved leaves are paid
  const perDaySalary = postSalary / workingDays;
  const calculatedSalary = perDaySalary * paidDays;

  return {
    postSalary,
    perDaySalary: parseFloat(perDaySalary.toFixed(2)),
    paidDays,
    calculatedSalary: parseFloat(calculatedSalary.toFixed(2))
  };
};

const generatePayroll = async (adminUser, data) => {
  const { month, year, payment_date } = data;

  const existingCycle = await PayrollCycle.findOne({
    where: { cycle_month: month, cycle_year: year, is_deleted: false }
  });

  if (existingCycle) {
    throw ApiError.badRequest(`Payroll cycle for ${month}/${year} already exists`);
  }

  const hierarchyFilter = buildHierarchyFilter(adminUser);
  
  const employees = await EmployeeMaster.findAll({
    where: {
      ...hierarchyFilter,
      is_active: true,
      is_deleted: false
    },
    attributes: ['employee_id', 'employee_code', 'post_id', 'employee_pay']
  });

  if (employees.length === 0) {
    throw ApiError.badRequest('No active employees found in your jurisdiction');
  }

  const cycle = await PayrollCycle.create({
    cycle_month: month,
    cycle_year: year,
    cycle_name: `${new Date(year, month - 1).toLocaleString('default', { month: 'long' })} ${year}`,
    payment_date: payment_date || null,
    status: 'DRAFT',
    total_employees: employees.length,
    generated_by: adminUser.admin_id,
    generated_at: new Date()
  });

  const workingDays = getWorkingDaysInMonth(month, year);
  const payslips = [];
  let totalAmount = 0;

  for (const employee of employees) {
    const { presentDays, absentDays, leaveDays } = await calculateAttendanceForEmployee(employee.employee_id, month, year);
    
    const salaryData = await calculateSalaryForEmployee(employee, workingDays, presentDays, leaveDays);

    const payslip = await Payslip.create({
      cycle_id: cycle.cycle_id,
      employee_id: employee.employee_id,
      payslip_number: generatePayslipNumber(employee.employee_id, month, year),
      pay_month: month,
      pay_year: year,
      post_salary: salaryData.postSalary,
      working_days: workingDays,
      present_days: presentDays,
      leave_days: leaveDays,
      absent_days: absentDays,
      paid_days: salaryData.paidDays,
      per_day_salary: salaryData.perDaySalary,
      calculated_salary: salaryData.calculatedSalary,
      status: 'GENERATED'
    });

    payslips.push(payslip);
    totalAmount += parseFloat(salaryData.calculatedSalary);
  }

  await cycle.update({
    status: 'GENERATED',
    total_amount: totalAmount
  });

  return {
    cycle,
    payslips_generated: payslips.length
  };
};

const getPayrollCycles = async (adminUser, filters) => {
  const { page = 1, limit = 10, status, year } = filters;
  const { offset, limit: pageLimit } = getPagination(page, limit);

  const where = { is_deleted: false };
  if (status) where.status = status;
  if (year) where.cycle_year = parseInt(year);

  const { count, rows } = await PayrollCycle.findAndCountAll({
    where,
    limit: pageLimit,
    offset,
    order: [['cycle_year', 'DESC'], ['cycle_month', 'DESC']],
    include: [
      { model: db.AdminUser, as: 'generator', attributes: ['admin_id', 'username', 'full_name'] }
    ]
  });

  return {
    cycles: rows,
    pagination: {
      total: count,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(count / limit)
    }
  };
};

const markPayrollAsPaid = async (adminUser, cycleId) => {
  const cycle = await PayrollCycle.findByPk(cycleId);
  
  if (!cycle) {
    throw ApiError.notFound('Payroll cycle not found');
  }

  if (cycle.status !== 'GENERATED') {
    throw ApiError.badRequest('Only generated payroll cycles can be marked as paid');
  }

  await cycle.update({
    status: 'PAID'
  });

  await Payslip.update(
    { status: 'PAID' },
    { where: { cycle_id: cycleId } }
  );

  return cycle;
};

const getPayslips = async (adminUser, filters) => {
  const { page = 1, limit = 10, month, year, employee_id, status } = filters;
  const { offset, limit: pageLimit } = getPagination(page, limit);

  const hierarchyFilter = buildHierarchyFilter(adminUser);
  
  const where = { is_deleted: false };
  if (month) where.pay_month = parseInt(month);
  if (year) where.pay_year = parseInt(year);
  if (status) where.status = status;

  const employeeWhere = { ...hierarchyFilter, is_deleted: false };
  if (employee_id) employeeWhere.employee_id = parseInt(employee_id);

  const { count, rows } = await Payslip.findAndCountAll({
    where,
    limit: pageLimit,
    offset,
    order: [['pay_year', 'DESC'], ['pay_month', 'DESC']],
    include: [
      {
        model: EmployeeMaster,
        as: 'employee',
        where: employeeWhere,
        attributes: ['employee_id', 'full_name', 'email', 'employee_code'],
        include: [
          { model: db.PostMaster, as: 'post', attributes: ['post_id', 'post_name'] },
          { model: db.DistrictMaster, as: 'district', attributes: ['district_id', 'district_name'] }
        ]
      },
      {
        model: PayrollCycle,
        as: 'cycle',
        attributes: ['cycle_id', 'cycle_name', 'status']
      }
    ]
  });

  return {
    payslips: rows,
    pagination: {
      total: count,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(count / limit)
    }
  };
};

const getEmployeePayslips = async (employeeId, filters) => {
  const { page = 1, limit = 10, year } = filters;
  const { offset, limit: pageLimit } = getPagination(page, limit);

  const where = {
    employee_id: employeeId,
    is_deleted: false
  };
  if (year) where.pay_year = parseInt(year);

  const { count, rows } = await Payslip.findAndCountAll({
    where,
    limit: pageLimit,
    offset,
    order: [['pay_year', 'DESC'], ['pay_month', 'DESC']],
    include: [
      {
        model: PayrollCycle,
        as: 'cycle',
        attributes: ['cycle_id', 'cycle_name', 'status', 'payment_date']
      }
    ]
  });

  return {
    payslips: rows,
    pagination: {
      total: count,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(count / limit)
    }
  };
};

const getPayslipById = async (payslipId, employeeId = null) => {
  const where = { payslip_id: payslipId, is_deleted: false };
  if (employeeId) where.employee_id = employeeId;

  const payslip = await Payslip.findOne({
    where,
    include: [
      {
        model: EmployeeMaster,
        as: 'employee',
        attributes: ['employee_id', 'full_name', 'email', 'employee_code'],
        include: [
          { model: db.PostMaster, as: 'post', attributes: ['post_id', 'post_name'] },
          { model: db.DistrictMaster, as: 'district', attributes: ['district_id', 'district_name'] }
        ]
      },
      {
        model: PayrollCycle,
        as: 'cycle',
        attributes: ['cycle_id', 'cycle_name', 'status', 'payment_date']
      }
    ]
  });

  if (!payslip) {
    throw ApiError.notFound('Payslip not found');
  }

  return payslip;
};

module.exports = {
  generatePayroll,
  getPayrollCycles,
  markPayrollAsPaid,
  getPayslips,
  getEmployeePayslips,
  getPayslipById
};
