const express = require('express');
const { requireAppEmployee } = require('../middleware/appAuth');
const { getShiftTypes } = require('../../hrm/services/shiftTypeService');
const ApiResponse = require('../../../utils/ApiResponse');

const router = express.Router();

router.get('/', requireAppEmployee, async (req, res, next) => {
  try {
    const shiftTypes = await getShiftTypes();
    return ApiResponse.success(res, shiftTypes, 'Shift types retrieved successfully');
  } catch (error) {
    next(error);
  }
});

module.exports = router;
