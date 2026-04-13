/**
 * Attendance Service
 * Handles marking attendance, viewing records, and summaries
 * Enhanced with proper date/time handling and safe database queries
 */
const { Op, fn, col, literal } = require('sequelize');
const sequelize = require('../../../config/db');
const logger = require('../../../config/logger');
const { ApiError } = require('../../../middleware/errorHandler');
const db = require('../../../models');
const { Attendance, Holiday, LeaveApplication, LeaveType } = require('../models');
const EmployeeMaster = db.EmployeeMaster;
const { getEmployeeFromUser, buildHierarchyFilter, getEmployeeIdsUnderAdmin, getWorkingDaysInMonth, getWorkingDaysInRange, getPagination, paginatedResponse } = require('../utils/hrmHelpers');
const { buildQueryOptions, buildResponse, COMMON_FIELDS } = require('../utils/hrmFilterBuilder');
const { validateGeofence, detectDevice, getAllowedRadius } = require('../utils/geofencing');

// Enhanced utilities for precise date/time handling and safe queries
const { getCurrentDate, getCurrentTime, isWeekend } = require('../utils/dateTimeHelpers');
const { safeQuery, safeHolidayCheck, safeLeaveCheck, safeAttendanceCheck } = require('../utils/safeQueryHelpers');

/**
 * Mark attendance for the logged-in employee
 * One attendance per day, auto-captures time + IP
 * Enhanced with proper date/time handling and safe queries
 */
const markAttendance = async (user, data, ip) => {
  const employee = await getEmployeeFromUser(user, EmployeeMaster);
  if (!employee) {
    throw new ApiError(404, 'Employee record not found. Please contact admin.');
  }
  if (employee.employment_status !== 'ACTIVE') {
    throw new ApiError(403, 'Only active employees can mark attendance.');
  }

  // Initialize attendance data object and detect device type
  const attendanceData = {};
  if (data.userAgent) {
    attendanceData.device_type = detectDevice(data.userAgent);
  }

  // Use standardized date/time (IST timezone)
  const today = getCurrentDate();

  // Check if Sunday using standardized date check
  if (isWeekend(today)) {
    throw new ApiError(400, 'Cannot mark attendance on Sunday.');
  }

  // Check if today is a holiday using safe query
  const holiday = await safeHolidayCheck(today);
  if (holiday) {
    throw new ApiError(400, `Today is a holiday: ${holiday.holiday_name}`);
  }

  // Check if on approved leave using safe query
  const approvedLeave = await safeLeaveCheck(employee.employee_id, today);
  if (approvedLeave) {
    throw new ApiError(400, `Cannot mark attendance - you are on approved leave: ${approvedLeave.leaveType?.leave_name || 'Leave'}`);
  }

  // Check if already marked today using safe query
  const existing = await safeAttendanceCheck(employee.employee_id, today);
  if (existing) {
    throw new ApiError(400, 'Attendance already marked for today.');
  }

  // Geofencing validation - check if employee is within allowed location
  if (data.latitude && data.longitude) {
    logger.info('Starting geofencing validation', {
      employeeId: employee.employee_id,
      userLat: data.latitude,
      userLon: data.longitude,
      hasComponentId: !!employee.component_id,
      hasHubId: !!employee.hub_id
    });

    // Get employee's post details with OSC/Hub location
    const employeeId = employee.employee_id;
    const employeeWithLocation = await db.EmployeeMaster.findOne({
      where: { employee_id: employeeId },
      include: [
        {
          model: db.Component,
          as: 'component',
          attributes: ['component_id', 'component_name', 'latitude', 'longitude', 'geofence_radius_meters'],
          required: false
        },
        {
          model: db.Hub,
          as: 'hub',
          attributes: ['hub_id', 'hub_name', 'latitude', 'longitude', 'geofence_radius_meters'],
          required: false
        }
      ]
    });

    
    logger.info('Employee location data retrieved', {
      employeeId: employeeWithLocation.employee_id,
      hasComponent: !!employeeWithLocation.component,
      hasHub: !!employeeWithLocation.hub
    });

    // Determine employee's actual posting and validate against correct center
    let targetLocation = null;
    let locationType = null;
    let postingCenter = null;

    // Check employee's actual posting (component_id indicates OSC posting, hub_id indicates Hub posting)
    if (employeeWithLocation.hub_id && employeeWithLocation.hub) {
      // Employee is posted to Hub
      postingCenter = 'Hub';
      
      // Get coordinates (handle string or numeric)
      const lat = employeeWithLocation.hub?.latitude;
      const lon = employeeWithLocation.hub?.longitude;
      
      logger.info('Using Hub location for geofencing', {
        employeeId: employeeWithLocation.employee_id,
        hubId: employeeWithLocation.hub_id,
        hubName: employeeWithLocation.hub.hub_name
      });
      
      // Convert strings to numbers if needed and validate
      const numLat = lat ? parseFloat(lat) : null;
      const numLon = lon ? parseFloat(lon) : null;
      
      if (!isNaN(numLat) && !isNaN(numLon) && numLat !== null && numLon !== null && numLat !== 0 && numLon !== 0) {
        // Create a copy with numeric coordinates
        targetLocation = {
          ...employeeWithLocation.hub,
          latitude: lat,
          longitude: lon
        };
        locationType = 'Hub';
        logger.info('Employee posted to Hub - using Hub location for geofencing', {
          employeeId: employeeWithLocation.employee_id,
          hubId: employeeWithLocation.hub_id,
          hubName: employeeWithLocation.hub.hub_name,
          latitude: lat,
          longitude: lon
        });
      } else {
        // Hub has no location data
        throw new ApiError(403, 
          `Your assigned Hub "${employeeWithLocation.hub.hub_name}" does not have location coordinates configured. ` +
          `Please contact your administrator to set up the Hub location for attendance marking.`
        );
      }
    } else if (employeeWithLocation.component_id && employeeWithLocation.component) {
      // Employee is posted to Component (OSC)
      postingCenter = 'OSC';
      
      // Get coordinates (handle string or numeric)
      const lat = employeeWithLocation.component?.latitude;
      const lon = employeeWithLocation.component?.longitude;
      
      // Convert strings to numbers if needed and validate
      const numLat = lat ? parseFloat(lat) : null;
      const numLon = lon ? parseFloat(lon) : null;
      
      logger.info('DEBUG: OSC coordinate validation', {
        employeeId: employeeWithLocation.employee_id,
        componentId: employeeWithLocation.component_id,
        componentName: employeeWithLocation.component.component_name,
        rawLat: lat,
        rawLon: lon,
        latType: typeof lat,
        lonType: typeof lon,
        numLat: numLat,
        numLon: numLon,
        isNaN: isNaN(numLat) || isNaN(numLon),
        zeroCheck: numLat === 0 || numLon === 0,
        nullCheck: numLat === null || numLon === null,
        willPassValidation: (!isNaN(numLat) && !isNaN(numLon) && numLat !== null && numLon !== null && numLat !== 0 && numLon !== 0)
      });
      
      if (!isNaN(numLat) && !isNaN(numLon) && numLat !== null && numLon !== null && numLat !== 0 && numLon !== 0) {
        // Create a copy with numeric coordinates
        targetLocation = {
          ...employeeWithLocation.component,
          latitude: lat,
          longitude: lon
        };
        locationType = 'OSC';
        logger.info('Employee posted to Component - using OSC location for geofencing', {
          employeeId: employeeWithLocation.employee_id,
          componentId: employeeWithLocation.component_id,
          componentName: employeeWithLocation.component.component_name,
          latitude: lat,
          longitude: lon
        });
      } else {
        // Component has no valid location data
        logger.error('DEBUG: OSC coordinates validation failed', {
          employeeId: employeeWithLocation.employee_id,
          componentId: employeeWithLocation.component_id,
          componentName: employeeWithLocation.component.component_name,
          rawLat: lat,
          rawLon: lon,
          latType: typeof lat,
          lonType: typeof lon,
          numLat: numLat,
          numLon: numLon,
          isNaN: isNaN(numLat) || isNaN(numLon),
          nullCheck: numLat === null || numLon === null,
          zeroCheck: numLat === 0 || numLon === 0,
          validationFailed: true
        });
        
        throw new ApiError(403, 
          `Your assigned OSC "${employeeWithLocation.component.component_name}" does not have location coordinates configured. ` +
          `Please contact your administrator to set up the OSC location for attendance marking.`
        );
      }
    } else {
      // Employee has no posting information
      throw new ApiError(403, 
        `Your posting information is not configured. Please contact your administrator to set up your Hub or OSC assignment.`
      );
    }

    // Validate geofence against the correct center
    if (targetLocation) {
      // Detect device type from user agent
      const deviceType = detectDevice(data.userAgent);
      
      // Get allowed radius based on device type
      const baseRadius = targetLocation.geofence_radius_meters || 100;
      const allowedRadius = getAllowedRadius(deviceType, baseRadius);

      // Validate location
      const targetLat = parseFloat(targetLocation.latitude);
      const targetLon = parseFloat(targetLocation.longitude);
      
      logger.info('DEBUG: Before geofence validation', {
        employeeId: employee.employee_id,
        locationType,
        locationName: targetLocation.hub_name || targetLocation.component_name,
        deviceType,
        userLat: data.latitude,
        userLon: data.longitude,
        targetLat: targetLat,
        targetLon: targetLon,
        targetLatType: typeof targetLocation.latitude,
        targetLonType: typeof targetLocation.longitude,
        baseRadius: baseRadius,
        allowedRadius: allowedRadius
      });

      const validation = validateGeofence({
        userLat: data.latitude,
        userLon: data.longitude,
        targetLat: targetLat,
        targetLon: targetLon,
        allowedRadius
      });

      // Get multipliers for logging
      const mobileMultiplier = parseFloat(process.env.GEOFENCE_MOBILE_MULTIPLIER) || 2;
      const desktopMultiplier = parseFloat(process.env.GEOFENCE_DESKTOP_MULTIPLIER) || 1;
      const currentMultiplier = deviceType === 'mobile' ? mobileMultiplier : desktopMultiplier;

      logger.info('DEBUG: Geofencing validation completed', {
        employeeId: employee.employee_id,
        locationType,
        locationName: targetLocation.hub_name || targetLocation.component_name,
        deviceType,
        distance: validation.distance,
        baseRadius: baseRadius,
        deviceMultiplier: currentMultiplier,
        finalRadius: validation.allowedRadius,
        isWithinRange: validation.isWithinRange,
        metersOver: validation.distance > validation.allowedRadius ? Math.round(validation.distance - validation.allowedRadius) : 0
      });

      if (!validation.isWithinRange) {
        const locationName = targetLocation.hub_name || targetLocation.component_name;
        const metersOutOfRange = Math.round(validation.distance - validation.allowedRadius);
        
        throw new ApiError(403, 
          `You are too far from your assigned ${locationType} "${locationName}". ` +
          `Current distance: ${validation.distance}m, Allowed range: ${validation.allowedRadius}m. ` +
          `You are ${metersOutOfRange} meters out of range. ` +
          `Please move closer to your ${locationType} location and try again.`
        );
      }
    }
  }

  // Use standardized time (IST timezone)
  const timeStr = getCurrentTime();

  const attendance = await Attendance.create({
    employee_id: employee.employee_id,
    attendance_date: today,
    check_in_time: timeStr,
    status: 'PRESENT',
    ip_address: ip || null,
    latitude: data.latitude || null,
    longitude: data.longitude || null,
    geo_address: data.geo_address || null,
    attendance_image_path: data.image?.path || null,
    attendance_image_name: data.image?.originalName || null,
    attendance_image_size: data.image?.size || null,
    device_type: attendanceData.device_type || null,
    remarks: data.remarks || null,
    created_by: user.applicant_id || user.id
  });

  logger.info(`Attendance marked: employee=${employee.employee_code}, date=${today}, time=${timeStr}`);
  return attendance;
};

/**
 * Get my attendance records (for the logged-in employee)
 */
const getMyAttendance = async (user, query) => {
  const employee = await getEmployeeFromUser(user, EmployeeMaster);
  if (!employee) {
    throw new ApiError(404, 'Employee record not found.');
  }

  // Build standardized query options
  const queryOptions = buildQueryOptions(query, {
    baseWhere: {
      employee_id: employee.employee_id,
      is_deleted: false
    },
    dateField: 'attendance_date',
    defaultSort: [['attendance_date', 'DESC']],
    ...COMMON_FIELDS.ATTENDANCE,
    paginate: false // No pagination for personal attendance
  });

  const records = await Attendance.findAll(queryOptions);

  // Filter records to include only essential fields for user
  const filteredRecords = records.map(record => ({
    attendance_id: record.attendance_id,
    attendance_date: record.attendance_date,
    check_in_time: record.check_in_time,
    status: record.status,
    half_day_type: record.half_day_type,
    ip_address: record.ip_address,
    latitude: record.latitude,
    longitude: record.longitude,
    geo_address: record.geo_address,
    attendance_image_path: record.attendance_image_path,
    attendance_image_name: record.attendance_image_name,
    attendance_image_size: record.attendance_image_size,
    device_type: record.device_type,
    remarks: record.remarks
  }));

  // Calculate summary
  const present = records.filter(r => r.status === 'PRESENT').length;
  const absent = records.filter(r => r.status === 'ABSENT').length;
  const halfDay = records.filter(r => r.status === 'HALF_DAY').length;
  const onLeave = records.filter(r => r.status === 'ON_LEAVE').length;
  
  let workingDays, summaryData;
  
  if (query.from_date && query.to_date) {
    // Custom date range
    const startDate = new Date(query.from_date);
    const endDate = new Date(query.to_date);
    workingDays = await getWorkingDaysInRange(startDate, endDate, Holiday);
    summaryData = {
      month: startDate.getMonth() + 1,
      year: startDate.getFullYear(),
      from_date: query.from_date,
      to_date: query.to_date,
      working_days: workingDays,
      present,
      absent,
      half_day: halfDay,
      on_leave: onLeave,
      attendance_percentage: workingDays > 0 ? Math.round((present / workingDays) * 100) : 0
    };
  } else {
    // Month/year filter (default)
    const now = new Date();
    const month = parseInt(query.month) || (now.getMonth() + 1);
    const year = parseInt(query.year) || now.getFullYear();
    workingDays = await getWorkingDaysInMonth(year, month, Holiday);
    summaryData = {
      month,
      year,
      from_date: null,
      to_date: null,
      working_days: workingDays,
      present,
      absent,
      half_day: halfDay,
      on_leave: onLeave,
      attendance_percentage: workingDays > 0 ? Math.round((present / workingDays) * 100) : 0
    };
  }

  // Build standardized response
  return buildResponse({ records: filteredRecords }, query, {
    message: 'Attendance retrieved successfully',
    summary: summaryData
  });
};

/**
 * Get attendance records for all employees (admin view)
 * Filtered by admin's jurisdiction
 */
const getAttendanceRecords = async (adminUser, query) => {
  const { page, limit, offset } = getPagination(query);
  const employeeIds = await getEmployeeIdsUnderAdmin(adminUser, EmployeeMaster);

  if (employeeIds.length === 0) {
    return paginatedResponse([], 0, page, limit);
  }

  const where = {
    employee_id: { [Op.in]: employeeIds },
    is_deleted: false
  };

  if (query.status) where.status = query.status;

  // Date filtering
  if (query.month && query.year) {
    const startDate = new Date(query.year, query.month - 1, 1);
    const endDate = new Date(query.year, query.month, 0);
    where.attendance_date = { [Op.between]: [startDate.toISOString().split('T')[0], endDate.toISOString().split('T')[0]] };
  } else if (query.date) {
    where.attendance_date = query.date;
  }

  // Filter by specific employee
  if (query.employee_id) {
    if (!employeeIds.includes(parseInt(query.employee_id))) {
      throw new ApiError(403, 'You do not have access to this employee.');
    }
    where.employee_id = parseInt(query.employee_id);
  }

  const { count, rows } = await Attendance.findAndCountAll({
    where,
    include: [
      {
        model: EmployeeMaster,
        as: 'employee',
        attributes: ['employee_id', 'employee_code', 'post_id', 'district_id', 'component_id'],
        include: [
          {
            model: db.ApplicantMaster,
            as: 'applicant',
            attributes: ['applicant_id', 'email'],
            required: false,
            include: [
              {
                model: db.ApplicantPersonal,
                as: 'personal',
                attributes: ['full_name'],
                required: false
              }
            ]
          }
        ]
      }
    ],
    order: [['attendance_date', 'DESC'], ['check_in_time', 'DESC']],
    limit,
    offset
  });

  // Flatten the response to avoid deep nesting
  const flattenedRows = rows.map(row => {
    const rowData = row.toJSON();
    
    // Extract employee info
    if (rowData.employee) {
      rowData.employee_code = rowData.employee.employee_code;
      rowData.employee_name = rowData.employee.applicant?.personal?.full_name || null;
      rowData.employee_email = rowData.employee.applicant?.email || null;
      
      // Remove nested employee object
      delete rowData.employee;
    }
    
    return rowData;
  });

  return paginatedResponse(flattenedRows, count, page, limit);
};

/**
 * Get attendance summary (admin view - simplified with pagination)
 */
const getAttendanceSummary = async (adminUser, query) => {
  const employeeIds = await getEmployeeIdsUnderAdmin(adminUser, EmployeeMaster);

  if (employeeIds.length === 0) {
    return { summary: {}, employees: { records: [], pagination: {} } };
  }

  const now = new Date();
  const month = parseInt(query.month) || (now.getMonth() + 1);
  const year = parseInt(query.year) || now.getFullYear();
  const district_id = query.district_id ? parseInt(query.district_id) : null;
  const search = query.search || '';
  const page = parseInt(query.page) || 1;
  const limit = parseInt(query.limit) || 10;
  
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0);
  const workingDays = await getWorkingDaysInMonth(year, month, Holiday);

  // Build employee filter
  const employeeFilter = {
    employee_id: { [Op.in]: employeeIds },
    is_deleted: false,
    is_active: true,
    ...(district_id && { district_id })
  };

  // Get total count for pagination
  const totalCount = await EmployeeMaster.count({
    where: employeeFilter
  });

  // Get paginated employees with related data
  const { offset } = getPagination({ page, limit });
  const employees = await EmployeeMaster.findAll({
    where: employeeFilter,
    attributes: ['employee_id', 'employee_code', 'district_id', 'component_id', 'post_id'],
    include: [
      {
        model: db.DistrictMaster,
        as: 'district',
        attributes: ['district_id', 'district_name'],
        required: false
      },
      {
        model: db.PostMaster,
        as: 'post',
        attributes: ['post_id', 'post_name'],
        required: false
      },
      {
        model: db.ApplicantMaster,
        as: 'applicant',
        attributes: ['applicant_id', 'email'],
        required: false,
        include: [
          {
            model: db.ApplicantPersonal,
            as: 'personal',
            attributes: ['full_name'],
            required: false
          }
        ]
      }
    ],
    limit,
    offset,
    order: [['employee_code', 'ASC']]
  });

  const dateRange = {
    [Op.between]: [startDate.toISOString().split('T')[0], endDate.toISOString().split('T')[0]]
  };

  // Get attendance counts per employee
  const attendanceCounts = await Attendance.findAll({
    where: {
      employee_id: { [Op.in]: employees.map(e => e.employee_id) },
      attendance_date: dateRange,
      is_deleted: false
    },
    attributes: [
      'employee_id',
      [fn('COUNT', literal("CASE WHEN status = 'PRESENT' THEN 1 END")), 'present_count'],
      [fn('COUNT', literal("CASE WHEN status = 'ABSENT' THEN 1 END")), 'absent_count'],
      [fn('COUNT', literal("CASE WHEN status = 'ON_LEAVE' THEN 1 END")), 'leave_count'],
      [fn('COUNT', literal("CASE WHEN status = 'HALF_DAY' THEN 1 END")), 'half_day_count']
    ],
    group: ['employee_id']
  });

  const countMap = {};
  attendanceCounts.forEach(ac => {
    countMap[ac.employee_id] = ac.dataValues;
  });

  // Build per-employee result
  const employeeSummaries = employees.map(emp => {
    const counts = countMap[emp.employee_id] || {};
    const present = parseInt(counts.present_count) || 0;
    const absent = parseInt(counts.absent_count) || 0;
    const onLeave = parseInt(counts.leave_count) || 0;
    const halfDay = parseInt(counts.half_day_count) || 0;
    
    // Apply search filter if provided
    const fullName = emp.applicant?.personal?.full_name || '';
    if (search && !emp.employee_code.toLowerCase().includes(search.toLowerCase()) && 
        !fullName.toLowerCase().includes(search.toLowerCase())) {
      return null;
    }
    
    return {
      employee_id: emp.employee_id,
      employee_code: emp.employee_code,
      name: fullName,
      district: emp.district?.district_name || '',
      district_id: emp.district_id,
      osc: emp.component?.component_name || '',
      post: emp.post?.post_name || '',
      working_days: workingDays,
      present,
      absent,
      on_leave: onLeave,
      half_day: halfDay,
      attendance_percentage: workingDays > 0 ? Math.round(((present + halfDay/2) / workingDays) * 100) : 0
    };
  }).filter(emp => emp !== null); // Remove filtered out employees

  // Single summary object for filtered data
  const summary = {
    total_employees: employeeSummaries.length,
    total_present: employeeSummaries.reduce((sum, e) => sum + e.present, 0),
    total_absent: employeeSummaries.reduce((sum, e) => sum + e.absent, 0),
    total_on_leave: employeeSummaries.reduce((sum, e) => sum + e.on_leave, 0),
    total_half_day: employeeSummaries.reduce((sum, e) => sum + e.half_day, 0),
    total_working: employeeSummaries.length * workingDays,
    attendance_percentage: employeeSummaries.length > 0 ? 
      Math.round(((employeeSummaries.reduce((sum, e) => sum + e.present + (e.half_day/2), 0)) / (employeeSummaries.length * workingDays)) * 100) : 0,
    month,
    year,
    working_days: workingDays,
    district_filter: district_id,
    search_filter: search
  };

  return {
    summary,
    employees: paginatedResponse(employeeSummaries, totalCount, page, limit)
  };
};

/**
 * Mark attendance for employees (admin function)
 */
const markAttendanceByAdmin = async (adminUser, data) => {
  const { employee_ids, attendance_date, status, remarks, half_day_type } = data;
  
  // Validate admin permissions
  const employeeIds = await getEmployeeIdsUnderAdmin(adminUser, EmployeeMaster);
  
  // Validate all employee IDs are under admin jurisdiction
  const invalidEmployees = employee_ids.filter(id => !employeeIds.includes(id));
  if (invalidEmployees.length > 0) {
    throw new ApiError(403, `You do not have permission to manage employees: ${invalidEmployees.join(', ')}`);
  }
  
  // Validate date
  const attendanceDate = new Date(attendance_date);
  const today = new Date();
  
  if (attendanceDate > today) {
    throw new ApiError(400, 'Cannot mark attendance for future dates.');
  }
  
  // Don't allow marking too far back
  const maxDaysBack = 365;
  const minAllowedDate = new Date();
  minAllowedDate.setDate(minAllowedDate.getDate() - maxDaysBack);
  
  if (attendanceDate < minAllowedDate) {
    throw new ApiError(400, `Cannot mark attendance older than ${maxDaysBack} days.`);
  }
  
  const dateStr = attendanceDate.toISOString().split('T')[0];
  
  // Validate status
  const validStatuses = ['PRESENT', 'ABSENT', 'HALF_DAY', 'ON_LEAVE', 'WORK_FROM_HOME'];
  if (!validStatuses.includes(status)) {
    throw new ApiError(400, 'Invalid attendance status.');
  }
  
  if (status === 'HALF_DAY' && !half_day_type) {
    throw new ApiError(400, 'Half day type is required when status is HALF_DAY.');
  }
  
  const t = await sequelize.transaction();
  
  try {
    const results = [];
    
    for (const employee_id of employee_ids) {
      // Validate employee
      const employee = await EmployeeMaster.findOne({
        where: { employee_id, is_deleted: false, is_active: true },
        attributes: ['employee_id', 'employee_code'],
        include: [
          {
            model: db.ApplicantMaster,
            as: 'applicant',
            attributes: ['email'],
            required: false,
            include: [
              {
                model: db.ApplicantPersonal,
                as: 'personal',
                attributes: ['full_name'],
                required: false
              }
            ]
          }
        ],
        transaction: t
      });
      
      if (!employee) {
        throw new ApiError(404, `Employee ${employee_id} not found or inactive.`);
      }
      
      // Check for holidays
      const holiday = await Holiday.findOne({
        where: { holiday_date: dateStr, is_active: true, is_deleted: false },
        transaction: t
      });
      
      // Check if attendance already exists
      const existing = await Attendance.findOne({
        where: { employee_id, attendance_date: dateStr, is_deleted: false },
        transaction: t
      });
      
      let attendance;
      if (existing) {
        // Update existing attendance
        attendance = existing;
        attendance.status = status;
        attendance.remarks = remarks || null;
        attendance.half_day_type = (status === 'HALF_DAY') ? half_day_type : null;
        attendance.updated_by = adminUser.admin_id;
        attendance.updated_at = new Date();
        await attendance.save({ transaction: t });
        
        logger.info(`Attendance updated by admin: employee=${employee.employee_code}, date=${dateStr}, status=${status}, admin=${adminUser.admin_id}`);
      } else {
        // Create new attendance
        attendance = await Attendance.create({
          employee_id,
          attendance_date: dateStr,
          status,
          remarks: remarks || (holiday ? `Holiday: ${holiday.holiday_name}` : null),
          half_day_type: (status === 'HALF_DAY') ? half_day_type : null,
          check_in_time: status === 'PRESENT' ? '09:00:00' : null,
          check_out_time: status === 'PRESENT' ? '18:00:00' : null,
          ip_address: '127.0.0.1',
          device_type: 'desktop',
          is_holiday: !!holiday,
          created_by: adminUser.admin_id
        }, { transaction: t });
        
        logger.info(`Attendance marked by admin: employee=${employee.employee_code}, date=${dateStr}, status=${status}, admin=${adminUser.admin_id}`);
      }
      
      results.push({
        employee_id: employee.employee_id,
        employee_code: employee.employee_code,
        employee_name: employee.applicant?.personal?.full_name || 'N/A',
        attendance_date: dateStr,
        status: attendance.status,
        action: existing ? 'updated' : 'created'
      });
    }
    
    await t.commit();
    
    return {
      success: true,
      message: `Attendance marked for ${results.length} employee(s)`,
      data: results
    };
    
  } catch (error) {
    await t.rollback();
    throw error;
  }
};

module.exports = {
  markAttendance,
  markAttendanceByAdmin,
  getMyAttendance,
  getAttendanceRecords,
  getAttendanceSummary
};
