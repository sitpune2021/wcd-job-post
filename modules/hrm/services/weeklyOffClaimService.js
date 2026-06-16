const db = require('../../../models');
const { Op } = require('sequelize');
const logger = require('../../../config/logger');

const { HrmWeeklyOffClaim: WeeklyOffClaim, EmployeeMaster, HrmAttendance: Attendance } = db;

/**
 * Get the Sunday of the current week
 */
function getWeekStart(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day; // Sunday is day 0
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Get the Saturday of the current week (6 days after Sunday)
 */
function getWeekEnd(weekStart) {
  const d = new Date(weekStart);
  d.setDate(d.getDate() + 6);
  return d;
}

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

/**
 * Generate monthly weekly off entitlements for all active employees
 * Creates 4 entitlements per employee per month
 * Monthly quota system: 4 per month, can be used anytime within the month
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

    // Get all active employees or specific employee
    const employees = employeeId 
      ? await EmployeeMaster.findAll({
          where: {
            employee_id: employeeId,
            is_active: true
          },
          attributes: ['employee_id', 'employee_code']
        })
      : await EmployeeMaster.findAll({
          where: {
            is_active: true
          },
          attributes: ['employee_id', 'employee_code']
        });

    let created = 0;
    let skipped = 0;

    for (const employee of employees) {
      // Check if employee already has entitlements for current month
      const existingEntitlements = await WeeklyOffClaim.findAll({
        where: {
          employee_id: employee.employee_id,
          entitlement_month: monthCode,
          claim_status: 'PENDING'
        }
      });

      // If employee already has 4 pending entitlements for this month, skip
      if (existingEntitlements.length >= 4) {
        skipped++;
        continue;
      }

      // Create remaining entitlements to reach 4 per month
      const entitlementsNeeded = 4 - existingEntitlements.length;
      
      for (let i = 0; i < entitlementsNeeded; i++) {
        await WeeklyOffClaim.create({
          employee_id: employee.employee_id,
          entitlement_month: monthCode,
          monthly_quota: 4,
          claim_status: 'PENDING', // Available to claim
          created_by: null // System generated
        });

        created++;
      }
    }

    logger.info('Monthly weekly off entitlements generation completed', {
      created,
      skipped,
      totalEmployees: employees.length
    });

    return { created, skipped, total: employees.length };
  } catch (error) {
    logger.error('Error generating monthly weekly off entitlements:', error);
    
    // Retry logic for failed generations
    if (retryCount < 2) {
      logger.warn(`Retrying monthly weekly off entitlement generation (attempt ${retryCount + 2})`);
      return await generateWeeklyOffEntitlements(employeeId, retryCount + 1);
    }
    
    throw error;
  }
}

/**
 * Get all weekly off claims for an employee
 */
async function getEmployeeWeeklyOffClaims(employeeId, filters = {}) {
  try {
    const { status, monthCode } = filters;
    const currentDate = new Date();
    const currentMonthCode = getMonthCode(currentDate);

    const whereClause = {
      employee_id: employeeId
    };

    // Include claims from current month OR recent pending claims from current month
    if (monthCode) {
      whereClause.entitlement_month = monthCode;
    } else {
      // If no month filter, include all claims from current month
      whereClause.entitlement_month = currentMonthCode;
    }

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

    // Calculate stats based on monthly quota
    const pendingClaims = claims.filter(c => c.claim_status === 'PENDING' && !c.claimed_off_date);
    const approvedClaims = claims.filter(c => c.claim_status === 'APPROVED');
    const usedClaims = claims.filter(c => c.claimed_off_date);
    
    // Get monthly quota (default 4)
    const monthlyQuota = claims.length > 0 ? claims[0].monthly_quota : 4;
    
    const stats = {
      totalEntitlements: claims.length,
      monthlyQuota: monthlyQuota,
      pending: pendingClaims.length,
      approved: approvedClaims.length,
      claimed: usedClaims.length,
      remaining: monthlyQuota - usedClaims.length
    };

    return {
      data: claims,
      stats: stats
    };
  } catch (error) {
    logger.error('Error getting employee weekly off claims:', error);
    throw error;
  }
}

/**
 * Submit or update a weekly off claim
 */
async function submitWeeklyOffClaim(employeeId, claimId, claimedOffDate, updatedBy = null) {
  const transaction = await db.sequelize.transaction();

  try {
    // Find the claim
    const claim = await WeeklyOffClaim.findOne({
      where: {
        claim_id: claimId,
        employee_id: employeeId
      },
      transaction
    });

    if (!claim) {
      throw new Error('Weekly off claim not found');
    }

    // Check if already approved
    if (claim.claim_status === 'APPROVED') {
      throw new Error('Cannot modify an already approved weekly off claim');
    }

    // Validate claimed date is within the same month as entitlement
    const claimedDate = new Date(claimedOffDate);
    const entitlementMonth = claim.entitlement_month;
    const claimedMonthCode = getMonthCode(claimedDate);

    if (claimedMonthCode !== entitlementMonth) {
      throw new Error(`Claimed date must be within the entitlement month (${entitlementMonth})`);
    }

    // Check if employee has exceeded monthly quota
    const usedClaimsInMonth = await WeeklyOffClaim.count({
      where: {
        employee_id: employeeId,
        entitlement_month: entitlementMonth,
        claimed_off_date: { [Op.not]: null },
        claim_status: 'APPROVED'
      }
    });

    if (usedClaimsInMonth >= claim.monthly_quota) {
      throw new Error(`You have already used your monthly quota of ${claim.monthly_quota} weekly off claims`);
    }

    // Check if another claim exists for the same date
    const existingClaimForDate = await WeeklyOffClaim.findOne({
      where: {
        employee_id: employeeId,
        claimed_off_date: claimedOffDate,
        claim_status: 'APPROVED',
        claim_id: { [Op.ne]: claimId }
      },
      transaction
    });

    if (existingClaimForDate) {
      throw new Error('You already have an approved weekly off for this date');
    }

    // Update the claim
    await claim.update({
      claimed_off_date: claimedOffDate,
      requested_at: new Date(),
      updated_by: updatedBy
    }, { transaction });

    await transaction.commit();

    logger.info('Weekly off claim submitted/updated', {
      claimId,
      employeeId,
      claimedOffDate
    });

    return claim;
  } catch (error) {
    await transaction.rollback();
    logger.error('Error submitting weekly off claim:', error);
    throw error;
  }
}

/**
 * Approve a weekly off claim (admin only)
 */
async function approveWeeklyOffClaim(claimId, adminId, remarks) {
  try {
    const claim = await WeeklyOffClaim.findOne({
      where: {
        claim_id: claimId,
        claim_status: 'PENDING'
      }
    });

    if (!claim) {
      throw new Error('Weekly off claim not found or already processed');
    }

    // Update claim status
    await claim.update({
      claim_status: 'APPROVED',
      approved_by: adminId,
      approved_at: new Date(),
      admin_remarks: remarks,
      updated_by: adminId
    });

    logger.info('Weekly off claim approved successfully', {
      claimId,
      employeeId: claim.employee_id,
      approvedBy: adminId
    });

    return claim;
  } catch (error) {
    logger.error('Error approving weekly off claim:', error);
    throw error;
  }
}

/**
 * Auto-approve claims older than 24 hours
 */
async function autoApproveWeeklyOffClaims() {
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const pendingClaims = await WeeklyOffClaim.findAll({
      where: {
        claim_status: 'PENDING',
        requested_at: { [Op.lt]: twentyFourHoursAgo }
      }
    });

    let approved = 0;

    for (const claim of pendingClaims) {
      let transaction;
      try {
        transaction = await db.sequelize.transaction();

        const existingAttendance = await Attendance.findOne({
          where: {
            employee_id: claim.employee_id,
            attendance_date: claim.claimed_off_date
          },
          transaction,
          lock: transaction.LOCK.UPDATE
        });
        if (existingAttendance) {
          if (['ABSENT', 'WEEKLY_OFF'].includes(existingAttendance.status)) {
            await existingAttendance.update({
              status: 'WEEKLY_OFF',
              remarks: `Weekly Off Claim - Auto Approved (Month: ${claim.entitlement_month})`,
              updated_by: null
            }, { transaction });

            await claim.update({
              claim_status: 'APPROVED',
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
              claimId: claim.claim_id,
              employeeId: claim.employee_id,
              attendanceId: existingAttendance.attendance_id,
              previousAttendanceStatus: existingAttendance.status
            });
            continue;
          }

          await claim.update({
            approved_by: null,
            approved_at: null,
            admin_remarks: 'Attendance already exists for the claimed date. Weekly off claim kept pending for review.',
            auto_approved: false,
            attendance_id: existingAttendance.attendance_id,
            updated_by: null
          }, { transaction });
          await transaction.commit();
          logger.warn('Weekly off claim kept pending because attendance already exists', {
            claimId: claim.claim_id,
            employeeId: claim.employee_id,
            attendanceId: existingAttendance.attendance_id,
            attendanceStatus: existingAttendance.status
          });
          continue;
        }

        // Create attendance record
        const attendanceRecord = await Attendance.create({
          employee_id: claim.employee_id,
          attendance_date: claim.claimed_off_date,
          status: 'WEEKLY_OFF',
          check_in_time: null,
          check_out_time: null,
          total_work_hours: 0,
          remarks: `Weekly Off Claim - Auto Approved (Month: ${claim.entitlement_month})`,
          created_by: null
        }, { transaction });

        // Update claim
        await claim.update({
          claim_status: 'APPROVED',
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
          claimId: claim.claim_id,
          employeeId: claim.employee_id
        });
      } catch (error) {
        logger.error(`Failed to auto-approve claim ${claim.claim_id}:`, error);
        // CRITICAL FIX: Rollback transaction on error to prevent connection leak
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
      totalPending: pendingClaims.length
    });

    return { approved, total: pendingClaims.length };
  } catch (error) {
    logger.error('Error in auto-approval process:', error);
    throw error;
  }
}

/**
 * Expire all unclaimed weekly off entitlements from previous month
 */
async function expireMonthlyWeeklyOffClaims() {
  try {
    const currentDate = new Date();
    const currentMonthCode = getMonthCode(currentDate);

    // Find all PENDING claims from previous months
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
 * Get pending weekly off claims for admin approval
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

    // Get total count for pagination
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
    const total = parseInt(countResult[0].total);

    // Get paginated data
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

    replacements.limit = parseInt(limit);
    replacements.offset = parseInt(offset);

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
        limit: parseInt(limit),
        offset: parseInt(offset),
        page: Math.floor(parseInt(offset) / parseInt(limit)) + 1,
        totalPages: Math.ceil(total / parseInt(limit))
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
