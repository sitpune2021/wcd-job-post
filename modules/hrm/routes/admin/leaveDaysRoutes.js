const express = require('express');
const router = express.Router();
const { authenticate } = require('../../../../middleware/auth');
const { hrmFeatureFlag } = require('../../middleware');
const { requireHRMAdminPermission } = require('../../middleware/permissionGuard');
const db = require('../../models');
const { LeaveType, LeaveBalance } = require('../models');
const EmployeeMaster = db.EmployeeMaster;
const ApiResponse = require('../../../../utils/ApiResponse');
const Joi = require('joi');

router.use(hrmFeatureFlag.checkHRMEnabled);
router.use(authenticate);
router.use(requireHRMAdminPermission('hrm.leave.manage'));

/**
 * Get paid leave days for all employees for a year
 * GET /api/hrm/admin/leave-days?year=2026
 */
router.get('/', async (req, res, next) => {
  try {
    const schema = Joi.object({
      year: Joi.number().integer().min(2000).max(2100).default(new Date().getFullYear())
    });

    const { error, value } = schema.validate(req.query);
    if (error) {
      return res.status(400).json({ success: false, message: error.details[0].message });
    }

    const { year } = value;

    // Get all leave balances for the year
    const balances = await LeaveBalance.findAll({
      where: { year },
      include: [
        {
          model: LeaveType,
          as: 'leaveType',
          attributes: ['leave_type_id', 'leave_code', 'leave_name']
        }
      ],
      order: [
        ['leave_type_id', 'ASC']
      ]
    });

    // Group by leave type and get unique days
    const leaveDaysMap = new Map();
    balances.forEach(balance => {
      const leaveTypeId = balance.leave_type_id;
      if (!leaveDaysMap.has(leaveTypeId)) {
        leaveDaysMap.set(leaveTypeId, {
          leave_type_id: leaveTypeId,
          leave_code: balance.leaveType?.leave_code,
          leave_name: balance.leaveType?.leave_name,
          days: balance.total_allocated
        });
      }
    });

    const result = Array.from(leaveDaysMap.values());

    return ApiResponse.success(res, { year, leave_days: result }, 'Leave days retrieved successfully');
  } catch (err) {
    next(err);
  }
});

/**
 * Set paid leave days for all employees for a year
 * POST /api/hrm/admin/leave-days
 * Body: {
 *   year: 2026,
 *   leave_days: [
 *     { leave_type_id: 1, days: 15 },
 *     { leave_type_id: 2, days: 12 }
 *   ]
 * }
 */
router.post('/', async (req, res, next) => {
  try {
    const schema = Joi.object({
      year: Joi.number().integer().min(2020).max(2100).required(),
      leave_days: Joi.array().items(
        Joi.object({
          leave_type_id: Joi.number().integer().required(),
          days: Joi.number().integer().min(0).max(365).required()
        })
      ).min(1).required()
    });

    const { error, value } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({ success: false, message: error.details[0].message });
    }

    const { year, leave_days } = value;

    // Get all active employees
    const employees = await EmployeeMaster.findAll({
      where: { is_active: true, is_deleted: false },
      attributes: ['employee_id']
    });

    let totalUpdated = 0;
    let totalCreated = 0;

    for (const leaveDay of leave_days) {
      const { leave_type_id, days } = leaveDay;

      // Verify leave type exists
      const leaveType = await LeaveType.findByPk(leave_type_id);
      if (!leaveType) {
        return res.status(404).json({ success: false, message: `Leave type ${leave_type_id} not found` });
      }

      for (const employee of employees) {
        const [balance, isNew] = await LeaveBalance.findOrCreate({
          where: {
            employee_id: employee.employee_id,
            leave_type_id: leave_type_id,
            year: year
          },
          defaults: {
            employee_id: employee.employee_id,
            leave_type_id: leave_type_id,
            year: year,
            total_allocated: days,
            used: 0,
            remaining: days,
            created_by: req.user.admin_id
          }
        });

        if (isNew) {
          totalCreated++;
        } else {
          // Update existing balance
          const newRemaining = days - balance.used;
          await balance.update({
            total_allocated: days,
            remaining: newRemaining >= 0 ? newRemaining : 0,
            updated_by: req.user.admin_id
          });
          totalUpdated++;
        }
      }
    }

    return ApiResponse.success(res, {
      year,
      total_employees: employees.length,
      total_created: totalCreated,
      total_updated: totalUpdated,
      leave_days: leave_days
    }, `Leave days set for all employees`);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
