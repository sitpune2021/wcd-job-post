/**
 * HRM Employee/Applicant Shift Type Routes
 * Shift type management for employee attendance tracking
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../../../../middleware/auth');
const { ApiError } = require('../../../../middleware/errorHandler');
const logger = require('../../../../config/logger');
const { getShiftTypes } = require('../../services/shiftTypeService');

/**
 * GET /api/hrm/applicant/shift-types
 * Get all active shift types for employee attendance
 * Authentication required (employee/applicant)
 */
router.get('/', authenticate, async (req, res) => {
  try {
    const shiftTypes = await getShiftTypes();
    
    res.json({
      success: true,
      message: 'Shift types retrieved successfully',
      data: shiftTypes
    });
  } catch (error) {
    logger.error('Error fetching shift types for employee:', error);
    
    if (error.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        message: error.message
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Failed to fetch shift types'
    });
  }
});

module.exports = router;
