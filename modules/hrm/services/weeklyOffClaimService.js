const db = require('../../../models');
const { Op } = require('sequelize');
const logger = require('../../../config/logger');
const { ApiError } = require('../../../middleware/errorHandler');

const {
  HrmWeeklyOffClaim: WeeklyOffClaim,
  EmployeeMaster,
  HrmAttendance: Attendance,
  HrmLeaveApplication: LeaveApplication,
  Scheme,
  WeeklyOffSetting
} = db;

const DEFAULT_MONTHLY_QUOTA = 4;
const MAX_MONTHLY_QUOTA = 5;
const CLAIM_SLOT_STATUSES = ['PENDING', 'APPROVED'];
const ACTIVE_LEAVE_STATUSES = ['PENDING', 'APPROVED'];

/**
 * Format date as YYYY-MM-DD
 */
function formatDate(date) {
  return date.toISOString().split('T')[0];
}

/**
 * Get YYYYMM format for month tracking
 */
function getMonthCode(date) {
  const d = new Date(date);
  return d.getFullYear() * 100 + (d.getMonth() + 1);
}

function normalizeMonthlyQuota(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_MONTHLY_QUOTA;
  return Math.min(Math.max(parsed, 0), MAX_MONTHLY_QUOTA);
}

async function findEmployeeForQuota(employeeId, transaction = null) {
  return EmployeeMaster.findOne({
    where: {
      employee_id: employeeId,
      is_active: true
    },
    attributes: ['employee_id', 'employee_code', 'scheme_id', 'contract_start_date', 'contract_end_date'],
    include: [{
      model: Scheme,
      as: 'scheme',
      attributes: ['scheme_id', 'scheme_type_id'],
      required: false
    }],
    transaction
  });
}

async function getWeeklyOffQuotaForEmployee(employee, transaction = null) {
  if (!employee) {
    return DEFAULT_MONTHLY_QUOTA;
  }

  const schemeTypeId = employee.scheme?.scheme_type_id || employee.schemeTypeId || null;
  if (!schemeTypeId || !WeeklyOffSetting) {
    return DEFAULT_MONTHLY_QUOTA;
  }

  try {
    const setting = await WeeklyOffSetting.findOne({
      where: { scheme_type_id: schemeTypeId },
      attributes: ['monthly_quota'],
      transaction
    });

    return normalizeMonthlyQuota(setting?.monthly_quota);
  } catch (error) {
    logger.warn('Weekly off quota setting lookup failed; using default quota', {
      employeeId: employee.employee_id,
      schemeTypeId,
      error: error.message
    });
    return DEFAULT_MONTHLY_QUOTA;
  }
}

async function getWeeklyOffQuotaForEmployeeId(employeeId, transaction = null) {
  const employee = await findEmployeeForQuota(employeeId, transaction);
  return getWeeklyOffQuotaForEmployee(employee, transaction);
}

async function validateWeeklyOffClaimDate(employee, claimedOffDate, transaction = null) {
  if (!employee) {
    throw ApiError.forbidden('Employee profile not found for this user');
  }

  if (employee.contract_start_date && claimedOffDate < employee.contract_start_date) {
    throw ApiError.badRequest(`Weekly off date must be within your contract period (${employee.contract_start_date} to ${employee.contract_end_date || 'open-ended'})`);
  }

  if (employee.contract_end_date && claimedOffDate > employee.contract_end_date) {
    throw ApiError.badRequest(`Weekly off date must be within your contract period (${employee.contract_start_date} to ${employee.contract_end_date})`);
  }

  const existingLeave = await LeaveApplication.findOne({
    where: {
      employee_id: employee.employee_id,
      is_deleted: false,
      status: { [Op.in]: ACTIVE_LEAVE_STATUSES },
      from_date: { [Op.lte]: claimedOffDate },
      to_date: { [Op.gte]: claimedOffDate }
    },
    attributes: ['leave_id', 'status', 'from_date', 'to_date'],
    transaction
  });

  if (existingLeave) {
    const leaveStatus = String(existingLeave.status || '').toLowerCase();
    throw ApiError.badRequest(`You already have a ${leaveStatus} leave application for ${claimedOffDate}. Weekly off cannot be claimed on the same date.`);
  }
}

async function countClaimedSlots(employeeId, entitlementMonth, excludeClaimId = null, transaction = null) {
  const where = {
    employee_id: employeeId,
    entitlement_month: entitlementMonth,
    claimed_off_date: { [Op.not]: null },
    claim_status: { [Op.in]: CLAIM_SLOT_STATUSES }
  };

  if (excludeClaimId) {
    where.claim_id = { [Op.ne]: excludeClaimId };
  }

  return WeeklyOffClaim.count({ where, transaction });
}

async function ensureClaimWithinMonthlyQuota(claim, monthlyQuota, transaction = null) {
  if (monthlyQuota <= 0) {
    throw ApiError.badRequest('Weekly off is not available for your scheme this month');
  }

  const claimedSlots = await countClaimedSlots(
    claim.employee_id,
    claim.entitlement_month,
    claim.claim_id,
    transaction
  );

  if (claimedSlots >= monthlyQuota) {
    throw ApiError.badRequest(`You have already used your monthly quota of ${monthlyQuota} weekly off claims`);
  }
}

function trimVisibleClaimsToQuota(claims, monthlyQuota) {
  const claimedOrProcessedClaims = claims.filter(c => c.claimed_off_date || c.claim_status !== 'PENDING');
  const openPendingClaims = claims.filter(c => c.claim_status === 'PENDING' && !c.claimed_off_date);
  const claimedSlots = claimedOrProcessedClaims.filter(c =>
    c.claimed_off_date && CLAIM_SLOT_STATUSES.includes(c.claim_status)
  ).length;
  const visibleOpenSlots = Math.max(monthlyQuota - claimedSlots, 0);

  const visibleClaims = [
    ...claimedOrProcessedClaims,
    ...openPendingClaims.slice(0, visibleOpenSlots)
  ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  return visibleClaims;
}

/**
 * Generate monthly weekly off entitlements for all active employees.
 * Monthly quota comes from HRM settings per scheme type, with default 4.
 */
async function generateWeeklyOffEntitlements(employeeId = null, retryCount = 0) {
  try {
    const currentDate = new Date();
    const monthCode = getMonthCode(currentDate);

    logger.info('Generating monthly weekly off entitlements', {
      currentDate: formatDate(currentDate),
      monthCode,
      employeeId: employeeId || 'all',
      attempt: retryCount + 1
    });

    const where = { is_active: true };
    if (employeeId) {
      where.employee_id = employeeId;
    }

    const employees = await EmployeeMaster.findAll({
      where,
      attributes: ['employee_id', 'employee_code', 'scheme_id'],
      include: [{
        model: Scheme,
        as: 'scheme',
        attributes: ['scheme_id', 'scheme_type_id'],
        required: false
      }]
    });

    let created = 0;
    let skipped = 0;
    let disabled = 0;

    for (const employee of employees) {
      const monthlyQuota = await getWeeklyOffQuotaForEmployee(employee);

      if (monthlyQuota <= 0) {
        disabled++;
        continue;
      }

      const activeEntitlementCount = await WeeklyOffClaim.count({
        where: {
          employee_id: employee.employee_id,
          entitlement_month: monthCode,
          claim_status: { [Op.ne]: 'EXPIRED' }
        }
      });

      if (activeEntitlementCount >= monthlyQuota) {
        skipped++;
        continue;
      }

      const entitlementsNeeded = monthlyQuota - activeEntitlementCount;

      for (let i = 0; i < entitlementsNeeded; i++) {
        await WeeklyOffClaim.create({
          employee_id: employee.employee_id,
          entitlement_month: monthCode,
          monthly_quota: monthlyQuota,
          claim_status: 'PENDING',
          created_by: null
        });

        created++;
      }
    }

    logger.info('Monthly weekly off entitlements generation completed', {
      created,
      skipped,
      disabled,
      totalEmployees: employees.length
    });

    return { created, skipped, disabled, total: employees.length };
  } catch (error) {
    logger.error('Error generating monthly weekly off entitlements:', error);

    if (retryCount < 2) {
      logger.warn(`Retrying monthly weekly off entitlement generation (attempt ${retryCount + 2})`);
      return generateWeeklyOffEntitlements(employeeId, retryCount + 1);
    }

    throw error;
  }
}

/**
 * Get all weekly off claims for an employee.
 */
async function getEmployeeWeeklyOffClaims(employeeId, filters = {}) {
  try {
    const { status, monthCode } = filters;
    const currentDate = new Date();
    const currentMonthCode = getMonthCode(currentDate);
    const requestedMonthCode = monthCode || currentMonthCode;

    const whereClause = {
      employee_id: employeeId,
      entitlement_month: requestedMonthCode
    };

    if (status) {
      whereClause.claim_status = status;
    }

    const claims = await WeeklyOffClaim.findAll({
      where: whereClause,
      order: [['created_at', 'DESC']],
      include: [
        {
          model: db.AdminUser,
          as: 'approver',
          attributes: ['admin_id', 'full_name'],
          required: false
        }
      ]
    });

    const settingQuota = await getWeeklyOffQuotaForEmployeeId(employeeId);
    const monthlyQuota = requestedMonthCode === currentMonthCode
      ? settingQuota
      : normalizeMonthlyQuota(claims[0]?.monthly_quota ?? settingQuota);
    const visibleClaims = trimVisibleClaimsToQuota(claims, monthlyQuota);

    const pendingClaims = visibleClaims.filter(c => c.claim_status === 'PENDING' && !c.claimed_off_date);
    const submittedClaims = visibleClaims.filter(c => c.claim_status === 'PENDING' && c.claimed_off_date);
    const approvedClaims = visibleClaims.filter(c => c.claim_status === 'APPROVED');
    const claimedSlots = visibleClaims.filter(c =>
      c.claimed_off_date && CLAIM_SLOT_STATUSES.includes(c.claim_status)
    );

    const stats = {
      totalEntitlements: visibleClaims.length,
      monthlyQuota,
      pending: pendingClaims.length,
      submitted: submittedClaims.length,
      approved: approvedClaims.length,
      claimed: claimedSlots.length,
      remaining: Math.max(monthlyQuota - claimedSlots.length, 0)
    };

    return {
      data: visibleClaims,
      stats
    };
  } catch (error) {
    logger.error('Error getting employee weekly off claims:', error);
    throw error;
  }
}

/**
 * Submit or update a weekly off claim.
 */
async function submitWeeklyOffClaim(employeeId, claimId, claimedOffDate, updatedBy = null) {
  const transaction = await db.sequelize.transaction();

  try {
    const claim = await WeeklyOffClaim.findOne({
      where: {
        claim_id: claimId,
        employee_id: employeeId
      },
      transaction,
      lock: transaction.LOCK.UPDATE
    });

    if (!claim) {
      throw ApiError.notFound('Weekly off claim not found');
    }

    if (claim.claim_status === 'APPROVED') {
      throw ApiError.badRequest('Cannot modify an already approved weekly off claim');
    }

    if (claim.claim_status !== 'PENDING') {
      throw ApiError.badRequest('This weekly off claim is no longer available');
    }

    const claimedDate = new Date(claimedOffDate);
    if (Number.isNaN(claimedDate.getTime())) {
      throw ApiError.badRequest('Invalid claimed off date');
    }

    const entitlementMonth = claim.entitlement_month;
    const claimedMonthCode = getMonthCode(claimedDate);

    if (claimedMonthCode !== entitlementMonth) {
      throw ApiError.badRequest(`Claimed date must be within the entitlement month (${entitlementMonth})`);
    }

    const claimedDateOnly = formatDate(claimedDate);
    const employee = await findEmployeeForQuota(employeeId, transaction);
    await validateWeeklyOffClaimDate(employee, claimedDateOnly, transaction);

    const monthlyQuota = await getWeeklyOffQuotaForEmployee(employee, transaction);
    await ensureClaimWithinMonthlyQuota(claim, monthlyQuota, transaction);

    const existingClaimForDate = await WeeklyOffClaim.findOne({
      where: {
        employee_id: employeeId,
        claimed_off_date: claimedDateOnly,
        claim_status: { [Op.in]: CLAIM_SLOT_STATUSES },
        claim_id: { [Op.ne]: claimId }
      },
      transaction,
      lock: transaction.LOCK.UPDATE
    });

    if (existingClaimForDate) {
      throw ApiError.badRequest('You already have a weekly off claim for this date');
    }

    await claim.update({
      claimed_off_date: claimedDateOnly,
      monthly_quota: monthlyQuota,
      requested_at: new Date(),
      updated_by: updatedBy
    }, { transaction });

    await transaction.commit();

    logger.info('Weekly off claim submitted/updated', {
      claimId,
      employeeId,
      claimedOffDate: claimedDateOnly,
      monthlyQuota
    });

    return claim;
  } catch (error) {
    await transaction.rollback();
    logger.error('Error submitting weekly off claim:', error);
    throw error;
  }
}

/**
 * Approve a weekly off claim (admin only).
 */
async function approveWeeklyOffClaim(claimId, adminId, remarks) {
  const transaction = await db.sequelize.transaction();

  try {
    const claim = await WeeklyOffClaim.findOne({
      where: {
        claim_id: claimId,
        claim_status: 'PENDING'
      },
      transaction,
      lock: transaction.LOCK.UPDATE
    });

    if (!claim) {
      throw ApiError.notFound('Weekly off claim not found or already processed');
    }

    if (!claim.claimed_off_date) {
      throw ApiError.badRequest('Cannot approve an unclaimed weekly off entitlement');
    }

    const monthlyQuota = await getWeeklyOffQuotaForEmployeeId(claim.employee_id, transaction);
    const approvedClaimsInMonth = await WeeklyOffClaim.count({
      where: {
        employee_id: claim.employee_id,
        entitlement_month: claim.entitlement_month,
        claimed_off_date: { [Op.not]: null },
        claim_status: 'APPROVED',
        claim_id: { [Op.ne]: claimId }
      },
      transaction
    });

    if (approvedClaimsInMonth >= monthlyQuota) {
      throw ApiError.badRequest(`Monthly weekly off quota of ${monthlyQuota} is already approved for this employee`);
    }

    await claim.update({
      claim_status: 'APPROVED',
      monthly_quota: monthlyQuota,
      approved_by: adminId,
      approved_at: new Date(),
      admin_remarks: remarks,
      updated_by: adminId
    }, { transaction });

    await transaction.commit();

    logger.info('Weekly off claim approved successfully', {
      claimId,
      employeeId: claim.employee_id,
      approvedBy: adminId,
      monthlyQuota
    });

    return claim;
  } catch (error) {
    await transaction.rollback();
    logger.error('Error approving weekly off claim:', error);
    throw error;
  }
}

/**
 * Auto-approve claims older than 24 hours.
 */
async function autoApproveWeeklyOffClaims() {
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const pendingClaims = await WeeklyOffClaim.findAll({
      where: {
        claim_status: 'PENDING',
        claimed_off_date: { [Op.not]: null },
        requested_at: { [Op.lt]: twentyFourHoursAgo }
      }
    });

    let approved = 0;
    let expired = 0;

    for (const claim of pendingClaims) {
      let transaction;
      try {
        transaction = await db.sequelize.transaction();

        const lockedClaim = await WeeklyOffClaim.findOne({
          where: {
            claim_id: claim.claim_id,
            claim_status: 'PENDING'
          },
          transaction,
          lock: transaction.LOCK.UPDATE
        });

        if (!lockedClaim) {
          await transaction.commit();
          continue;
        }

        const monthlyQuota = await getWeeklyOffQuotaForEmployeeId(lockedClaim.employee_id, transaction);
        const approvedClaimsInMonth = await WeeklyOffClaim.count({
          where: {
            employee_id: lockedClaim.employee_id,
            entitlement_month: lockedClaim.entitlement_month,
            claimed_off_date: { [Op.not]: null },
            claim_status: 'APPROVED',
            claim_id: { [Op.ne]: lockedClaim.claim_id }
          },
          transaction
        });

        if (monthlyQuota <= 0 || approvedClaimsInMonth >= monthlyQuota) {
          await lockedClaim.update({
            claim_status: 'EXPIRED',
            monthly_quota: monthlyQuota,
            admin_remarks: `Monthly weekly off quota of ${monthlyQuota} is already used`,
            updated_by: null
          }, { transaction });
          await transaction.commit();
          expired++;
          continue;
        }

        const existingLeave = await LeaveApplication.findOne({
          where: {
            employee_id: lockedClaim.employee_id,
            is_deleted: false,
            status: { [Op.in]: ACTIVE_LEAVE_STATUSES },
            from_date: { [Op.lte]: lockedClaim.claimed_off_date },
            to_date: { [Op.gte]: lockedClaim.claimed_off_date }
          },
          attributes: ['leave_id', 'status', 'from_date', 'to_date'],
          transaction,
          lock: transaction.LOCK.UPDATE
        });

        if (existingLeave) {
          await lockedClaim.update({
            admin_remarks: `${existingLeave.status} leave application already exists for the claimed date. Weekly off claim kept pending for review.`,
            auto_approved: false,
            updated_by: null
          }, { transaction });
          await transaction.commit();
          logger.warn('Weekly off claim kept pending because leave already exists', {
            claimId: lockedClaim.claim_id,
            employeeId: lockedClaim.employee_id,
            leaveId: existingLeave.leave_id,
            leaveStatus: existingLeave.status
          });
          continue;
        }

        const existingAttendance = await Attendance.findOne({
          where: {
            employee_id: lockedClaim.employee_id,
            attendance_date: lockedClaim.claimed_off_date
          },
          transaction,
          lock: transaction.LOCK.UPDATE
        });
        if (existingAttendance) {
          if (['ABSENT', 'WEEKLY_OFF'].includes(existingAttendance.status)) {
            await existingAttendance.update({
              status: 'WEEKLY_OFF',
              remarks: `Weekly Off Claim - Auto Approved (Month: ${lockedClaim.entitlement_month})`,
              updated_by: null
            }, { transaction });

            await lockedClaim.update({
              claim_status: 'APPROVED',
              monthly_quota: monthlyQuota,
              approved_by: null,
              approved_at: new Date(),
              admin_remarks: 'Auto-approved after 24 hours',
              auto_approved: true,
              attendance_id: existingAttendance.attendance_id,
              updated_by: null
            }, { transaction });

            await transaction.commit();
            approved++;

            logger.info('Weekly off claim auto-approved using existing attendance', {
              claimId: lockedClaim.claim_id,
              employeeId: lockedClaim.employee_id,
              attendanceId: existingAttendance.attendance_id,
              previousAttendanceStatus: existingAttendance.status
            });
            continue;
          }

          await lockedClaim.update({
            approved_by: null,
            approved_at: null,
            admin_remarks: 'Attendance already exists for the claimed date. Weekly off claim kept pending for review.',
            auto_approved: false,
            attendance_id: existingAttendance.attendance_id,
            updated_by: null
          }, { transaction });
          await transaction.commit();
          logger.warn('Weekly off claim kept pending because attendance already exists', {
            claimId: lockedClaim.claim_id,
            employeeId: lockedClaim.employee_id,
            attendanceId: existingAttendance.attendance_id,
            attendanceStatus: existingAttendance.status
          });
          continue;
        }

        const attendanceRecord = await Attendance.create({
          employee_id: lockedClaim.employee_id,
          attendance_date: lockedClaim.claimed_off_date,
          status: 'WEEKLY_OFF',
          check_in_time: null,
          check_out_time: null,
          total_work_hours: 0,
          remarks: `Weekly Off Claim - Auto Approved (Month: ${lockedClaim.entitlement_month})`,
          created_by: null
        }, { transaction });

        await lockedClaim.update({
          claim_status: 'APPROVED',
          monthly_quota: monthlyQuota,
          approved_by: null,
          approved_at: new Date(),
          admin_remarks: 'Auto-approved after 24 hours',
          auto_approved: true,
          attendance_id: attendanceRecord.attendance_id,
          updated_by: null
        }, { transaction });

        await transaction.commit();
        approved++;

        logger.info('Weekly off claim auto-approved', {
          claimId: lockedClaim.claim_id,
          employeeId: lockedClaim.employee_id
        });
      } catch (error) {
        logger.error(`Failed to auto-approve claim ${claim.claim_id}:`, error);
        if (transaction) {
          try {
            await transaction.rollback();
          } catch (rollbackError) {
            logger.error('Failed to rollback transaction:', rollbackError);
          }
        }
      }
    }

    logger.info('Auto-approval completed', {
      approved,
      expired,
      totalPending: pendingClaims.length
    });

    return { approved, expired, total: pendingClaims.length };
  } catch (error) {
    logger.error('Error in auto-approval process:', error);
    throw error;
  }
}

/**
 * Expire all unclaimed weekly off entitlements from previous month.
 */
async function expireMonthlyWeeklyOffClaims() {
  try {
    const currentDate = new Date();
    const currentMonthCode = getMonthCode(currentDate);

    const expiredClaims = await WeeklyOffClaim.update(
      { claim_status: 'EXPIRED' },
      {
        where: {
          entitlement_month: { [Op.lt]: currentMonthCode },
          claim_status: 'PENDING'
        },
        returning: true
      }
    );

    logger.info('Monthly weekly off claims expiry completed', {
      expiredCount: expiredClaims[0],
      currentMonthCode
    });

    return { expired: expiredClaims[0], monthCode: currentMonthCode };
  } catch (error) {
    logger.error('Error expiring monthly weekly off claims:', error);
    throw error;
  }
}

/**
 * Get pending weekly off claims for admin approval.
 */
async function getPendingWeeklyOffClaims(adminFilters = {}) {
  try {
    const { employeeId, districtId, employeeCode, search, limit = 50, offset = 0 } = adminFilters;

    const whereParts = [
      `w.claim_status = 'PENDING'`,
      `w.claimed_off_date IS NOT NULL`,
      `w.requested_at IS NOT NULL`
    ];
    const replacements = {};

    if (employeeId) {
      whereParts.push(`w.employee_id = :employeeId`);
      replacements.employeeId = employeeId;
    }
    if (districtId) {
      whereParts.push(`e.district_id = :districtId`);
      replacements.districtId = districtId;
    }
    if (employeeCode) {
      whereParts.push(`e.employee_code ILIKE :employeeCode`);
      replacements.employeeCode = `%${employeeCode}%`;
    }
    if (search) {
      whereParts.push(`(e.employee_code ILIKE :search OR ap.full_name ILIKE :search OR dm.district_name ILIKE :search OR s.scheme_name ILIKE :search)`);
      replacements.search = `%${search}%`;
    }

    const countSql = `
      SELECT COUNT(*) as total
      FROM ms_hrm_weekly_off_claims w
      INNER JOIN ms_employee_master e ON w.employee_id = e.employee_id
      LEFT JOIN ms_applicant_master am ON e.applicant_id = am.applicant_id
      LEFT JOIN ms_applicant_personal ap ON e.applicant_id = ap.applicant_id
      LEFT JOIN ms_district_master dm ON e.district_id = dm.district_id
      LEFT JOIN ms_schemes s ON e.scheme_id = s.scheme_id
      WHERE ${whereParts.join(' AND ')}
    `;

    const countResult = await db.sequelize.query(countSql, {
      replacements,
      type: db.Sequelize.QueryTypes.SELECT
    });
    const total = parseInt(countResult[0].total, 10);

    const dataSql = `
      SELECT
        w.claim_id,
        w.employee_id,
        w.entitlement_month,
        w.monthly_quota,
        w.claimed_off_date,
        w.claim_status,
        w.requested_at,
        w.approved_by,
        w.approved_at,
        w.admin_remarks,
        w.auto_approved,
        w.created_at,
        e.employee_code,
        e.district_id,
        e.scheme_id,
        ap.full_name AS employee_name,
        am.mobile_no,
        dm.district_name,
        s.scheme_name
      FROM ms_hrm_weekly_off_claims w
      INNER JOIN ms_employee_master e ON w.employee_id = e.employee_id
      LEFT JOIN ms_applicant_master am ON e.applicant_id = am.applicant_id
      LEFT JOIN ms_applicant_personal ap ON e.applicant_id = ap.applicant_id
      LEFT JOIN ms_district_master dm ON e.district_id = dm.district_id
      LEFT JOIN ms_schemes s ON e.scheme_id = s.scheme_id
      WHERE ${whereParts.join(' AND ')}
      ORDER BY w.requested_at DESC
      LIMIT :limit OFFSET :offset
    `;

    replacements.limit = parseInt(limit, 10);
    replacements.offset = parseInt(offset, 10);

    const rows = await db.sequelize.query(dataSql, {
      replacements,
      type: db.Sequelize.QueryTypes.SELECT
    });

    const claims = rows.map(r => ({
      claim_id: r.claim_id,
      employee_id: r.employee_id,
      entitlement_month: r.entitlement_month,
      monthly_quota: r.monthly_quota,
      claimed_off_date: r.claimed_off_date,
      claim_status: r.claim_status,
      requested_at: r.requested_at,
      approved_by: r.approved_by,
      approved_at: r.approved_at,
      admin_remarks: r.admin_remarks,
      auto_approved: r.auto_approved,
      created_at: r.created_at,
      employee: {
        employee_id: r.employee_id,
        employee_code: r.employee_code,
        district_id: r.district_id,
        scheme_id: r.scheme_id,
        employee_name: r.employee_name || null,
        mobile_no: r.mobile_no || null,
        district_name: r.district_name || null,
        scheme_name: r.scheme_name || null
      }
    }));

    return {
      data: claims,
      pagination: {
        total,
        limit: parseInt(limit, 10),
        offset: parseInt(offset, 10),
        page: Math.floor(parseInt(offset, 10) / parseInt(limit, 10)) + 1,
        totalPages: Math.ceil(total / parseInt(limit, 10))
      }
    };
  } catch (error) {
    logger.error('Error getting pending weekly off claims:', error);
    throw error;
  }
}

module.exports = {
  generateWeeklyOffEntitlements,
  getEmployeeWeeklyOffClaims,
  submitWeeklyOffClaim,
  approveWeeklyOffClaim,
  autoApproveWeeklyOffClaims,
  expireMonthlyWeeklyOffClaims,
  getPendingWeeklyOffClaims,
  formatDate,
  getMonthCode
};
