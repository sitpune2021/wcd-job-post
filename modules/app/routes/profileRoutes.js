const express = require('express');
const { requireAppEmployee } = require('../middleware/appAuth');
const appEmployeeService = require('../services/appEmployeeService');
const ApiResponse = require('../../../utils/ApiResponse');

const router = express.Router();

router.get('/', requireAppEmployee, async (req, res, next) => {
  try {
    const profile = await appEmployeeService.getProfile(req.user);
    return ApiResponse.success(res, profile, 'Profile retrieved successfully');
  } catch (error) {
    next(error);
  }
});

module.exports = router;
