const express = require('express');
const { requireAppEmployee } = require('../middleware/appAuth');
const appEmployeeService = require('../services/appEmployeeService');
const ApiResponse = require('../../../utils/ApiResponse');

const router = express.Router();

router.get('/', requireAppEmployee, async (req, res, next) => {
  try {
    const home = await appEmployeeService.getHome(req.user);
    return ApiResponse.success(res, home, 'Home data retrieved successfully');
  } catch (error) {
    next(error);
  }
});

module.exports = router;
