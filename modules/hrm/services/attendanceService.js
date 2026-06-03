/**
 * Attendance Service
 * Handles marking attendance, viewing records, and summaries
 * Enhanced with proper date/time handling and safe database queries
 */
const { Op, fn, col, literal } = require('sequelize');
const { Attendance, AttendanceSession, EmployeeMaster, Holiday, LeaveApplication } = require('../models');
const db = require('../../../models');
const logger = require('../../../config/logger');
const { ApiError } = require('../../../middleware/errorHandler');
const { getEmployeeFromUser, buildHierarchyFilter, getEmployeeIdsUnderAdmin, getWorkingDaysInYear, getWorkingDaysInQuarter, getWorkingDaysInRange, getPagination, paginatedResponse } = require('../utils/hrmHelpers');
const { getWorkingDaysInMonth } = require('../utils/workingDayHelpers');
const { buildEmployeeAttendanceSummary, buildAggregatedSummary, getAttendanceCountAttributes } = require('../utils/attendanceCalculations');
const { buildQueryOptions, buildResponse, COMMON_FIELDS } = require('../utils/hrmFilterBuilder');
const { validateGeofence, detectDevice, getAllowedRadius } = require('../utils/geofencing');

/**
 * Format attendance record for consistent API response
 * Flattens nested employee data for easier frontend consumption
 */
const formatAttendanceRecord = (record) => {
  try {
    const data = record?.toJSON ? record.toJSON() : record;
    const employee = data.employee || {};
    const applicant = employee.applicant || {};
    const personal = applicant.personal || {};
    const district = employee.district || {};
    const scheme = employee.scheme || {};
    const latitude = data.latitude;
    const longitude = data.longitude;

    return {
      attendance_id: data.attendance_id,
      employee_id: data.employee_id,
      attendance_date: data.attendance_date,
      check_in_time: data.check_in_time,
      check_out_time: data.check_out_time,
      total_work_hours: data.total_work_hours,
      status: data.status,
      latitude,
      longitude,
      employee_code: employee.employee_code || '',
      employee_name: personal.full_name || '',
      employee_email: applicant.email || '',
      district_name: district.district_name || '',
      scheme_name: scheme.scheme_name || '',
      scheme_type: scheme.schemeType?.scheme_name || scheme.schemeType?.scheme_code || '',
      location: latitude && longitude
        ? `${parseFloat(latitude).toFixed(4)}, ${parseFloat(longitude).toFixed(4)}`
        : '--'
    };
  } catch (error) {
    logger.error('Error formatting attendance record:', error);
    return {
      attendance_id: data.attendance_id,
      employee_id: data.employee_id,
      attendance_date: data.attendance_date,
      check_in_time: data.check_in_time,
      check_out_time: data.check_out_time,
      total_work_hours: data.total_work_hours,
      status: data.status,
      latitude: data.latitude,
      longitude: data.longitude,
      employee_code: '',
      employee_name: '',
      employee_email: '',
      district_name: '',
      scheme_name: '',
      scheme_type: '',
      location: '--'
    };
  }
};

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

  // Check if attendance date is within contract period
  if (employee.contract_start_date && employee.contract_end_date) {
    if (today < employee.contract_start_date || today > employee.contract_end_date) {
      throw new ApiError(403, `Cannot mark attendance outside contract period. Contract: ${employee.contract_start_date} to ${employee.contract_end_date}`);
    }
  }

  // Sunday and Holiday restrictions removed
  // Employees can now mark attendance on any day
  // Status will be determined based on work hours and holiday rules

  // Check if on approved leave using safe query
  const approvedLeave = await safeLeaveCheck(employee.employee_id, today);
  if (approvedLeave) {
    throw new ApiError(400, `Cannot mark attendance - you are on approved leave: ${approvedLeave.leaveType?.leave_name || 'Leave'}`);
  }

  // Check if there's already an attendance record for today (for session tracking)
  const existingAttendance = await safeAttendanceCheck(employee.employee_id, today);
  
  if (existingAttendance) {
    logger.info('Using existing attendance record for additional session', {
      employeeId: employee.employee_id,
      attendanceId: existingAttendance.attendance_id
    });
  }

  // Geofencing validation - check if employee is within allowed location
  if (data.latitude && data.longitude) {
    logger.info('Starting geofencing validation', {
      employeeId: employee.employee_id,
      userLat: data.latitude,
      userLon: data.longitude,
      hasSchemeId: !!employee.scheme_id
    });

    // Get employee's post details with Scheme location (scheme-only approach)
    const employeeId = employee.employee_id;
    const employeeWithLocation = await EmployeeMaster.findOne({
      where: { employee_id: employeeId },
      include: [
        {
          model: db.Scheme,
          as: 'scheme',
          include: [
            {
              model: db.SchemeType,
              as: 'schemeType',
              attributes: ['scheme_type_id', 'scheme_code', 'scheme_name'],
              required: false
            }
          ],
          attributes: ['scheme_id', 'scheme_code', 'scheme_name', 'latitude', 'longitude', 'geofence_radius_meters'],
          required: false
        }
      ]
    });

    
    logger.info('Employee location data retrieved', {
      employeeId: employeeWithLocation.employee_id,
      hasScheme: !!employeeWithLocation.scheme
    });

    // Determine employee's actual posting and validate against correct center (scheme-only approach)
    let targetLocation = null;
    let locationType = null;
    let postingCenter = null;
    let latitude = null;
    let longitude = null;
    let geofenceRadius = null;

    // Scheme-only approach: All employees must have a scheme assignment
    if (!employeeWithLocation.scheme || !employeeWithLocation.scheme.schemeType) {
      throw new ApiError(400, 'Employee scheme assignment not configured. Please contact admin.');
    }

    postingCenter = employeeWithLocation.scheme.schemeType.scheme_code; // 'OSC' or 'HUB'
    latitude = employeeWithLocation.scheme.latitude;
    longitude = employeeWithLocation.scheme.longitude;
    geofenceRadius = employeeWithLocation.scheme.geofence_radius_meters;
    
    logger.info('Using Scheme location for geofencing', {
      employeeId: employeeWithLocation.employee_id,
      schemeId: employeeWithLocation.scheme.scheme_id,
      schemeCode: employeeWithLocation.scheme.scheme_code,
      schemeType: postingCenter
    });

    // Convert strings to numbers if needed and validate
    const numLat = latitude ? parseFloat(latitude) : null;
    const numLon = longitude ? parseFloat(longitude) : null;
    
    if (!isNaN(numLat) && !isNaN(numLon) && numLat !== null && numLon !== null && numLat !== 0 && numLon !== 0) {
      // Create a copy with numeric coordinates
      targetLocation = {
        latitude: numLat,
        longitude: numLon,
        geofence_radius_meters: geofenceRadius
      };
      locationType = postingCenter;
      
      logger.info('Employee location validated for geofencing', {
        employeeId: employeeWithLocation.employee_id,
        postingCenter: postingCenter,
        locationType: locationType,
        latitude: numLat,
        longitude: numLon,
        geofenceRadius: geofenceRadius
      });
    } else {
      // Location has no valid coordinates
      const locationName = employeeWithLocation.scheme.scheme_name;
      
      throw new ApiError(403, 
        `Your assigned ${postingCenter} "${locationName}" does not have valid location coordinates configured. ` +
        `Please contact your administrator to set up the location for attendance marking.`
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
        locationName: targetLocation.scheme_name || 'Unknown Scheme',
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
        locationName: targetLocation.scheme_name || 'Unknown Scheme',
        deviceType,
        distance: validation.distance,
        baseRadius: baseRadius,
        deviceMultiplier: currentMultiplier,
        finalRadius: validation.allowedRadius,
        isWithinRange: validation.isWithinRange,
        metersOver: validation.distance > validation.allowedRadius ? Math.round(validation.distance - validation.allowedRadius) : 0
      });

      if (!validation.isWithinRange) {
        // Get proper scheme name and type from employee data
        const schemeName = employeeWithLocation.scheme?.scheme_name || 'Unknown Scheme';
        const schemeTypeName = employeeWithLocation.scheme?.schemeType?.scheme_name || 'Unknown Type';
        
        const metersOutOfRange = Math.round(validation.distance - validation.allowedRadius);
        
        // Create detailed error message with proper scheme information
        const errorMessage = 
          `Location Access Denied\n\n` +
          `You are too far from your assigned Scheme: "${schemeName}" (${schemeTypeName})\n\n` +
          `Distance Details:\n` +
          `• Your current distance: ${validation.distance}m\n` +
          `• Maximum allowed distance: ${validation.allowedRadius}m\n` +
          `• You are ${metersOutOfRange} meters out of range\n\n` +
          `Target Location:\n` +
          `• Scheme: ${schemeName}\n` +
          `• Type: ${schemeTypeName}\n` +
          `• Coordinates: ${targetLocation.latitude}, ${targetLocation.longitude}\n\n` +
          `Please move closer to your Scheme location and try again.`;
        
        throw new ApiError(422, errorMessage);
      }
    }
  }

  // Use standardized time (IST timezone)
  const timeStr = getCurrentTime();

  let attendance;
  
  if (existingAttendance) {
    // Use existing attendance record for additional sessions
    attendance = existingAttendance;
    logger.info('Creating additional session for existing attendance', {
      employeeId: employee.employee_id,
      attendanceId: attendance.attendance_id,
      currentTotalHours: attendance.total_work_hours
    });
  } else {
    // Create new attendance record for first session
    attendance = await Attendance.create({
      employee_id: employee.employee_id,
      attendance_date: today,
      check_in_time: timeStr,
      status: 'PRESENT', // Show present while actively marking attendance
      final_status: 'PENDING', // Will be finalized by cron job
      total_work_hours: 0,
      ip_address: ip || null,
      latitude: data.latitude || null,
      longitude: data.longitude || null,
      geo_address: data.geo_address || null,
      attendance_image_path: data.image?.path || null,
      attendance_image_name: data.image?.originalName || null,
      attendance_image_size: data.image?.size || null,
      check_in_photo_path: data.image?.path || null, // Save check-in image here too
      device_type: attendanceData.device_type || null,
      remarks: data.remarks || null,
      created_by: user.applicant_id || user.id
    });
    
    logger.info(`Created new attendance record: employee=${employee.employee_code}, date=${today}, time=${timeStr}`);
  }

  // Create new session for check-in
  try {
    logger.info('Attempting to create attendance session', {
      attendanceId: attendance.attendance_id,
      checkInTime: timeStr,
      photoPath: data.image?.path
    });

    const session = await AttendanceSession.create({
      attendance_id: attendance.attendance_id,
      check_in_time: timeStr,
      check_in_photo_path: data.image?.path || null
    });

    logger.info(`Attendance session created successfully: sessionId=${session.session_id}, employee=${employee.employee_code}, date=${today}, time=${timeStr}, attendanceId=${attendance.attendance_id}`);
  } catch (sessionError) {
    logger.error('Failed to create attendance session:', {
      error: sessionError.message,
      stack: sessionError.stack,
      attendanceId: attendance.attendance_id,
      checkInTime: timeStr
    });
    // Still return attendance record even if session creation fails
    logger.warn('Attendance record created but session creation failed - continuing without session tracking');
  }

  return attendance;
};

/**
 * Generate complete attendance records including all days (Sundays, Holidays, Absent)
 */
const generateCompleteAttendanceRecords = async (employee, attendanceRecords, query) => {
  // Debug Holiday model
  logger.info('Holiday model available:', !!Holiday);
  logger.info('Holiday model type:', typeof Holiday);
  
  // Determine date range
  let startDate, endDate;
  if (query.from_date && query.to_date) {
    startDate = new Date(query.from_date);
    endDate = new Date(query.to_date);
  } else {
    const now = new Date();
    const month = parseInt(query.month) || (now.getMonth() + 1);
    const year = parseInt(query.year) || now.getFullYear();
    startDate = new Date(year, month - 1, 1);
    endDate = new Date(year, month, 0);
  }

  // Get holidays for the date range
  let holidays = [];
  try {
    holidays = await Holiday.findAll({
      where: {
        holiday_date: {
          [Op.between]: [
            startDate.toISOString().split('T')[0],
            endDate.toISOString().split('T')[0]
          ]
        },
        is_active: true,
        is_deleted: false
      }
    });
  } catch (error) {
    logger.error('Error fetching holidays:', error);
    // Continue without holidays if there's an error
  }

  const holidayMap = new Map();
  holidays.forEach(holiday => {
    holidayMap.set(holiday.holiday_date, holiday);
  });

  // Create attendance record map for quick lookup
  const attendanceMap = new Map();
  attendanceRecords.forEach(record => {
    attendanceMap.set(record.attendance_date, record);
  });

  const completeRecords = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Generate records for each day in the range
  for (let date = new Date(startDate); date <= endDate; date.setDate(date.getDate() + 1)) {
    const dateStr = date.toISOString().split('T')[0];
    const dayOfWeek = date.getDay();
    
    let record = attendanceMap.get(dateStr);
    
    if (record) {
      // Use existing attendance record
      completeRecords.push(record);
    } else if (date < today) {
      // Only generate past records, not future ones
      let status = 'NOT_MARKED';
      let remarks = null;
      
      if (holidayMap.has(dateStr)) {
        status = 'HOLIDAY';
        const holiday = holidayMap.get(dateStr);
        remarks = holiday.holiday_name;
      } else if (dayOfWeek === 0) {
        status = 'SUNDAY';
        remarks = 'Sunday';
      } else if (isWithinContractPeriod(date, employee)) {
        status = 'ABSENT';
        remarks = 'Absent';
      }

      // Create a complete record structure
      completeRecords.push({
        attendance_id: null,
        attendance_date: dateStr,
        check_in_time: null,
        check_out_time: null,
        status: status,
        half_day_type: null,
        ip_address: null,
        latitude: null,
        longitude: null,
        geo_address: null,
        attendance_image_path: null,
        attendance_image_name: null,
        attendance_image_size: null,
        device_type: null,
        remarks: remarks,
        total_work_hours: null,
        has_active_session: false,
        active_session_id: null,
        active_check_in_time: null
      });
    }
  }

  // Sort by date descending (newest first)
  completeRecords.sort((a, b) => new Date(b.attendance_date) - new Date(a.attendance_date));

  return completeRecords;
};

/**
 * Check if date is within employee contract period
 */
const isWithinContractPeriod = (date, employee) => {
  const dateStr = date.toISOString().split('T')[0];
  const isWithinContract = (!employee.contract_start_date || dateStr >= employee.contract_start_date) &&
                           (!employee.contract_end_date || dateStr <= employee.contract_end_date);
  return isWithinContract;
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
  const filteredRecords = await Promise.all(records.map(async (record) => {
    // Check for active sessions (sessions without check-out time)
    const activeSession = await AttendanceSession.findOne({
      where: {
        attendance_id: record.attendance_id,
        check_out_time: null
      },
      order: [['created_at', 'DESC']]
    });

    logger.info('Session lookup for attendance record:', {
      attendance_id: record.attendance_id,
      has_active_session: !!activeSession,
      active_session_id: activeSession?.session_id,
      active_check_in_time: activeSession?.check_in_time
    });

    return {
      attendance_id: record.attendance_id,
      attendance_date: record.attendance_date,
      check_in_time: record.check_in_time,
      check_out_time: record.check_out_time,
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
      remarks: record.remarks,
      total_work_hours: record.total_work_hours,
      // Add session information for state detection
      has_active_session: !!activeSession,
      active_session_id: activeSession?.session_id || null,
      active_check_in_time: activeSession?.check_in_time || null
    };
  }));

  // Generate complete day records including Sundays, Holidays, and Absent days
  const completeRecords = await generateCompleteAttendanceRecords(employee, filteredRecords, query);

  let summaryData;
  
  if (query.from_date && query.to_date) {
    // Custom date range
    const startDate = new Date(query.from_date);
    const endDate = new Date(query.to_date);
    summaryData = {
      month: startDate.getMonth() + 1,
      year: startDate.getFullYear(),
      from_date: query.from_date,
      to_date: query.to_date
    };
  } else {
    // Month/year filter (default)
    const now = new Date();
    const month = parseInt(query.month) || (now.getMonth() + 1);
    const year = parseInt(query.year) || now.getFullYear();
    summaryData = {
      month,
      year,
      from_date: null,
      to_date: null
    };
  }

  // Build standardized response
  return buildResponse({ records: completeRecords }, query, {
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

  // Date filtering - support both month/year and date range
  if (query.from_date && query.to_date) {
    // Date range filtering
    where.attendance_date = { [Op.between]: [query.from_date, query.to_date] };
  } else if (query.month && query.year) {
    // Month/year filtering (existing logic)
    const startDate = new Date(query.year, query.month - 1, 1);
    const endDate = new Date(query.year, query.month, 0);
    where.attendance_date = { [Op.between]: [startDate.toISOString().split('T')[0], endDate.toISOString().split('T')[0]] };
  } else if (query.date) {
    // Single date filtering (existing logic)
    where.attendance_date = query.date;
  }

  // Filter by specific employee
  if (query.employee_id) {
    if (!employeeIds.includes(parseInt(query.employee_id))) {
      throw new ApiError(403, 'You do not have access to this employee.');
    }
    where.employee_id = parseInt(query.employee_id);
  }

  // Add district and scheme filters
  if (query.district_id) {
    where['$employee.district_id$'] = parseInt(query.district_id);
  }

  // Add scheme_type_id filter if provided
  if (query.scheme_type_id) {
    where['$employee.scheme.scheme_type_id$'] = parseInt(query.scheme_type_id);
  }

  // Add scheme_id filter if provided
  if (query.scheme_id) {
    where['$employee.scheme_id$'] = parseInt(query.scheme_id);
  }

  // Handle filter_type for radio button selections (legacy support)
  if (query.filter_type === 'osc_only') {
    // Show only records where scheme_type is OSC
    where['$employee.scheme.schemeType.scheme_code$'] = 'OSC';
  } else if (query.filter_type === 'hub_only') {
    // Show only records where scheme_type is HUB
    where['$employee.scheme.schemeType.scheme_code$'] = 'HUB';
  }

  // Build include options with only necessary associations
  const includeOptions = [
    {
      model: EmployeeMaster,
      as: 'employee',
      attributes: ['employee_id', 'employee_code', 'district_id', 'scheme_id'],
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
        },
        {
          model: db.DistrictMaster,
          as: 'district',
          attributes: ['district_name'],
          required: false
        },
        {
          model: db.Scheme,
          as: 'scheme',
          attributes: ['scheme_id', 'scheme_name', 'scheme_type_id'],
          include: [{
            model: db.SchemeType,
            as: 'schemeType',
            attributes: ['scheme_type_id', 'scheme_code'],
            required: false
          }],
          required: false
        }
      ]
    }
  ];

  // Add search functionality
  if (query.search && query.search.trim()) {
    const searchTerm = query.search.trim();
    
    // Apply status filter if provided
    if (query.status) {
      where.status = query.status;
    }

    // Add search conditions to where clause
    where[Op.or] = [
      { '$employee.employee_code$': { [Op.iLike]: `%${searchTerm}%` } },
      { '$employee.applicant.personal.full_name$': { [Op.iLike]: `%${searchTerm}%` } },
      { '$employee.district.district_name$': { [Op.iLike]: `%${searchTerm}%` } },
      { '$employee.scheme.scheme_name$': { [Op.iLike]: `%${searchTerm}%` } },
      { '$employee.scheme.schemeType.scheme_code$': { [Op.iLike]: `%${searchTerm}%` } }
    ];
  }

  const { count, rows } = await Attendance.findAndCountAll({
    where,
    include: includeOptions,
    order: [['attendance_date', 'DESC'], ['check_in_time', 'DESC']],
    limit,
    offset
  });

  const formattedRows = rows.map(formatAttendanceRecord);

  return paginatedResponse(formattedRows, count, page, limit);
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
  let year = parseInt(query.year);
  
  // Fix year validation - if year is 0 or invalid, use current year
  if (!year || year < 2000 || year > 2100) {
    year = now.getFullYear();
  }
  
  const district_id = query.district_id ? parseInt(query.district_id) : null;
  const search = query.search || '';
  const page = parseInt(query.page) || 1;
  const limit = parseInt(query.limit) || 10;
  const yearly = query.yearly === 'true' || query.yearly === true;
  const filter_type = query.filter_type || 'all';
  
  let startDate, endDate, workingDays;
  
  if (yearly) {
    // Yearly aggregation
    startDate = new Date(year, 0, 1); // Jan 1st
    endDate = new Date(year, 11, 31); // Dec 31st
    try {
      workingDays = await getWorkingDaysInYear(year, Holiday);
    } catch (error) {
      logger.error('Error calculating yearly working days:', error);
      // Fallback to approximate working days (261 days excluding Sundays)
      workingDays = 261;
    }
  } else {
    // Monthly aggregation (existing logic)
    startDate = new Date(year, month - 1, 1);
    endDate = new Date(year, month, 0);
    const workingDaysResult = await getWorkingDaysInMonth(month, year);
    workingDays = workingDaysResult.workingDays;
  }

  // Build employee filter
  const employeeFilter = {
    employee_id: { [Op.in]: employeeIds },
    is_deleted: false,
    is_active: true,
    ...(district_id && { district_id })
  };

  // Add scheme_type_id filter if provided
  if (query.scheme_type_id) {
    employeeFilter['$scheme.scheme_type_id$'] = parseInt(query.scheme_type_id);
  }

  // Add scheme_id filter if provided
  if (query.scheme_id) {
    employeeFilter['$scheme.scheme_id$'] = parseInt(query.scheme_id);
  }

  // Handle filter_type for radio button selections (legacy support)
  if (filter_type === 'osc_only') {
    // Show only employees where scheme_type is OSC
    employeeFilter['$scheme.schemeType.scheme_code$'] = 'OSC';
  } else if (filter_type === 'hub_only') {
    // Show only employees where scheme_type is HUB
    employeeFilter['$scheme.schemeType.scheme_code$'] = 'HUB';
  }

  // Add search filter to employee query
  if (search) {
    employeeFilter[Op.or] = [
      { employee_code: { [Op.like]: `%${search}%` } },
      { '$applicant.email$': { [Op.like]: `%${search}%` } },
      { '$applicant.personal.full_name$': { [Op.like]: `%${search}%` } }
    ];
  }

  // Get total count for pagination
  const totalCount = await EmployeeMaster.count({
    where: employeeFilter,
    include: [
      {
        model: db.ApplicantMaster,
        as: 'applicant',
        attributes: [],
        required: false,
        include: [
          {
            model: db.ApplicantPersonal,
            as: 'personal',
            attributes: [],
            required: false
          }
        ]
      },
      {
        model: db.Scheme,
        as: 'scheme',
        attributes: [],
        required: false
      }
    ]
  });

  // Get paginated employees with related data
  const { offset } = getPagination({ page, limit });
  const employees = await EmployeeMaster.findAll({
    where: employeeFilter,
    attributes: ['employee_id', 'employee_code', 'district_id', 'scheme_id', 'post_id'],
    include: [
      {
        model: db.DistrictMaster,
        as: 'district',
        attributes: ['district_id', 'district_name'],
        required: false
      },
      {
        model: db.Scheme,
        as: 'scheme',
        attributes: ['scheme_id', 'scheme_name', 'scheme_type_id'],
        include: [{
          model: db.SchemeType,
          as: 'schemeType',
          attributes: ['scheme_type_id', 'scheme_code'],
          required: false
        }],
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
    order: [['employee_id', 'DESC']]
  });

  const dateRange = {
    [Op.between]: [startDate.toISOString().split('T')[0], endDate.toISOString().split('T')[0]]
  };

  // Get attendance counts per employee using centralized attributes
  const attendanceCounts = await Attendance.findAll({
    where: {
      employee_id: { [Op.in]: employees.map(e => e.employee_id) },
      attendance_date: dateRange,
      is_deleted: false
    },
    attributes: getAttendanceCountAttributes(),
    group: ['employee_id']
  });

  const countMap = {};
  attendanceCounts.forEach(ac => {
    countMap[ac.employee_id] = ac.dataValues;
  });

  
  // Build per-employee result using centralized function
  const employeeSummaries = employees.map(emp => {
    const counts = countMap[emp.employee_id] || {};
    
    // Properly extract employee data from Sequelize object
    const employeeData = {
      employee_id: emp.employee_id,
      employee_code: emp.get('employee_code'), // Use get() method for Sequelize
      district_id: emp.get('district_id'),
      scheme_id: emp.get('scheme_id'),
      post_id: emp.get('post_id'),
      district: emp.district,
      scheme: emp.scheme,
      post: emp.post,
      applicant: emp.applicant,
      ...counts
    };
    
    return buildEmployeeAttendanceSummary(employeeData, workingDays);
  });

  // Build aggregated summary using centralized function
  const summary = {
    ...buildAggregatedSummary(employeeSummaries, workingDays),
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
  
  const t = await db.sequelize.transaction();
  
  try {
    const results = [];
    
    for (const employee_id of employee_ids) {
      // Validate employee
      const employee = await EmployeeMaster.findOne({
        where: { employee_id, is_deleted: false, is_active: true },
        attributes: ['employee_id', 'employee_code', 'contract_start_date', 'contract_end_date'],
        include: [
          {
            model: ApplicantMaster,
            as: 'applicant',
            attributes: ['email'],
            required: false,
            include: [
              {
                model: ApplicantPersonal,
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

      // Check if attendance date is within contract period
      if (employee.contract_start_date && employee.contract_end_date) {
        if (dateStr < employee.contract_start_date || dateStr > employee.contract_end_date) {
          throw new ApiError(403, `Cannot mark attendance outside contract period for employee ${employee.employee_code}. Contract: ${employee.contract_start_date} to ${employee.contract_end_date}`);
        }
      }
      
      // Check for holidays
      const holiday = await Holiday.findOne({
        where: { holiday_date: dateStr, is_active: true, is_deleted: false },
        transaction: t
      });

      if (holiday && status !== 'HOLIDAY') {
        throw new ApiError(400, `Cannot mark attendance on holiday (${holiday.holiday_name}). Please mark as HOLIDAY or choose another date.`);
      }
      
      // Check if attendance already exists
      const existing = await Attendance.findOne({
        where: { employee_id, attendance_date: dateStr, is_deleted: false },
        transaction: t
      });
      
      let attendance;
      if (existing) {
        // Override existing attendance - remarks are mandatory
        if (!remarks || !remarks.trim()) {
          throw new ApiError(400, `Remarks are mandatory when overriding existing attendance for employee ${employee.employee_code} on ${dateStr}. Previous status: ${existing.status}`);
        }
        
        attendance = existing;
        const previousStatus = existing.status;
        attendance.previous_status = previousStatus;
        attendance.status = status;
        attendance.remarks = remarks;
        attendance.half_day_type = (status === 'HALF_DAY') ? half_day_type : null;
        attendance.status_changed_by = adminUser.admin_id;
        attendance.status_changed_at = new Date();
        attendance.status_change_reason = remarks;
        attendance.updated_by = adminUser.admin_id;
        attendance.updated_at = new Date();
        await attendance.save({ transaction: t });
        
        logger.info(`Attendance OVERRIDDEN by admin: employee=${employee.employee_code}, date=${dateStr}, previousStatus=${previousStatus}, newStatus=${status}, reason="${remarks}", admin=${adminUser.admin_id}`);
      } else {
        // Create new attendance
        const attendanceData = {
          employee_id: parseInt(employee_id),
          attendance_date: dateStr,
          status: status,
          remarks: remarks || null,
          half_day_type: (status === 'HALF_DAY') ? half_day_type : null,
          check_in_time: status === 'PRESENT' ? '09:00:00' : null,
          check_out_time: status === 'PRESENT' ? '18:00:00' : null,
          ip_address: '127.0.0.1',
          device_type: 'desktop',
          is_deleted: false,
          created_by: adminUser.admin_id
        };
        
        attendance = await Attendance.create(attendanceData, { transaction: t });
      }
      
      const result = {
        employee_id: employee.employee_id,
        employee_code: employee.employee_code,
        employee_name: employee.applicant?.personal?.full_name || 'N/A',
        attendance_date: dateStr,
        status: attendance.status,
        action: existing ? 'updated' : 'created'
      };
      
      // Include audit trail info when attendance was overridden
      if (existing) {
        result.previous_status = attendance.previous_status;
        result.changed_by = adminUser.admin_id;
        result.change_reason = remarks;
      }
      
      results.push(result);
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

/**
 * Simple check-in enhancement for existing attendance
 * Adds check_in_time and check_in_photo_path to existing mark attendance flow
 */
const enhanceMarkAttendanceWithCheckIn = (attendanceData, imageData) => {
  // Add check-in specific data to existing attendance structure
  return {
    ...attendanceData,
    check_in_time: getCurrentTime(),
    check_in_photo_path: imageData?.path || attendanceData.attendance_image_path
  };
};

/**
 * Simple check-out enhancement for existing attendance
 * Updates check_out_time and check_out_photo_path for existing attendance
 */
const checkOutSimple = async (user, data, ip) => {
  const employee = await getEmployeeFromUser(user, EmployeeMaster);
  if (!employee) {
    throw new ApiError(404, 'Employee record not found. Please contact admin.');
  }

  const today = getCurrentDate();
  const currentTime = getCurrentTime();
  
  // Get yesterday's date for cross-midnight session detection
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];
  
  // Find the latest incomplete session across today and yesterday
  let attendance = null;
  let latestSession = null;
  
  // First check today's attendance
  const todayAttendance = await Attendance.findOne({
    where: {
      employee_id: employee.employee_id,
      attendance_date: today,
      is_deleted: false
    }
  });
  
  if (todayAttendance) {
    latestSession = await AttendanceSession.findOne({
      where: {
        attendance_id: todayAttendance.attendance_id,
        check_out_time: null
      },
      order: [['created_at', 'DESC']]
    });
    if (latestSession) {
      attendance = todayAttendance;
    }
  }
  
  // If no active session today, check yesterday's attendance (cross-midnight)
  if (!latestSession) {
    const yesterdayAttendance = await Attendance.findOne({
      where: {
        employee_id: employee.employee_id,
        attendance_date: yesterdayStr,
        is_deleted: false
      }
    });
    
    if (yesterdayAttendance) {
      latestSession = await AttendanceSession.findOne({
        where: {
          attendance_id: yesterdayAttendance.attendance_id,
          check_out_time: null
        },
        order: [['created_at', 'DESC']]
      });
      if (latestSession) {
        attendance = yesterdayAttendance;
        logger.info('Cross-midnight checkout detected', {
          employeeId: employee.employee_id,
          sessionId: latestSession.session_id,
          attendanceDate: yesterdayStr,
          checkInTime: latestSession.check_in_time
        });
      }
    }
  }

  if (!attendance || !latestSession) {
    throw new ApiError(400, 'No active check-in session found. Please check-in first.');
  }

  // Calculate session duration
  const duration = calculateDuration(latestSession.check_in_time, currentTime);

  // Update session with check-out details
  await latestSession.update({
    check_out_time: currentTime,
    check_out_photo_path: data.photoPath || attendance.attendance_image_path,
    duration_hours: duration
  });

  // Update attendance with new total hours
  const totalHours = await AttendanceSession.sum('duration_hours', {
    where: { attendance_id: attendance.attendance_id }
  });

  // Check if today is a holiday for status calculation
  const holiday = await safeHolidayCheck(today);
  const isHoliday = !!holiday;
  
  // Auto-determine status based on total work hours using new function
  const hours = parseFloat(totalHours) || 0;
  const updatedStatus = calculateAttendanceStatus(hours, isHoliday);
  logger.info('Auto-calculated attendance status', {
    employeeId: employee.employee_id,
    checkInTime: attendance.check_in_time,
    checkOutTime: currentTime,
    totalHours: hours,
    isHoliday: isHoliday,
    calculatedStatus: updatedStatus
  });

  // Check for double shift and flag in remarks
  const config = require('../config/attendanceConfig');
  let remarks = attendance.remarks;
  if (hours >= config.DOUBLE_SHIFT_HOURS) {
    remarks = remarks ? `${remarks}; DOUBLE_SHIFT (${hours}h)` : `DOUBLE_SHIFT (${hours}h)`;
    logger.info('Double shift detected', {
      employeeId: employee.employee_id,
      totalHours: hours,
      threshold: config.DOUBLE_SHIFT_HOURS
    });
  }

  await attendance.update({
    check_out_time: currentTime,
    check_out_photo_path: data.photoPath || attendance.attendance_image_path,
    total_work_hours: hours,
    status: updatedStatus,
    remarks: remarks,
    ip_address: ip,
    latitude: data.latitude || attendance.latitude,
    longitude: data.longitude || attendance.longitude,
    geo_address: data.geo_address || attendance.geo_address,
    updated_at: new Date(),
    updated_by: employee.employee_id
  });

  logger.info('Employee checked-out successfully', {
    employeeId: employee.employee_id,
    checkOutTime: currentTime
  });

  return {
    success: true,
    message: 'Check-out successful',
    data: attendance
  };
};

/**
 * Calculate attendance status based on total work hours
 * Uses new threshold logic: 0-4h = HALF_DAY, >=4h = PRESENT
 * @param {number} totalWorkHours - Total work hours from all sessions
 * @param {boolean} isHoliday - Whether this is a holiday
 * @returns {string|null} - 'PRESENT' | 'HALF_DAY' | null (for cron to handle)
 */
const calculateAttendanceStatus = (totalWorkHours, isHoliday = false) => {
  const config = require('../config/attendanceConfig');
  const hours = parseFloat(totalWorkHours) || 0;
  
  // Holiday special case: any work = PRESENT
  if (isHoliday && hours > 0) {
    return 'PRESENT';
  }
  
  // New threshold logic: 0-4h = HALF_DAY, 4h+ = PRESENT
  if (hours >= config.HALF_DAY_MIN_HOURS) {
    return 'PRESENT'; // 4h and above = PRESENT
  } else if (hours > 0) {
    return 'HALF_DAY'; // 0-4h with any sessions = HALF_DAY
  } else {
    return null; // No sessions, let cron handle
  }
};

/**
 * Calculate duration between check-in and check-out times
 * Handles cross-midnight sessions (e.g., 23:00 to 05:00)
 */
const calculateDuration = (checkInTime, checkOutTime) => {
  if (!checkInTime || !checkOutTime) return 0;
  
  const [inHours, inMinutes, inSeconds] = checkInTime.split(':').map(Number);
  const [outHours, outMinutes, outSeconds] = checkOutTime.split(':').map(Number);
  
  // Create date objects for calculation
  const baseDate = new Date();
  const checkIn = new Date(baseDate.setHours(inHours, inMinutes, inSeconds || 0, 0));
  const checkOut = new Date(baseDate.setHours(outHours, outMinutes, outSeconds || 0, 0));
  
  // Calculate difference in milliseconds
  let diffMs = checkOut - checkIn;
  
  // Handle cross-midnight: if checkout is before checkin, add 24 hours
  if (diffMs < 0) {
    diffMs += 24 * 60 * 60 * 1000; // Add 24 hours in milliseconds
  }
  
  const diffHours = diffMs / (1000 * 60 * 60);
  
  return Math.round(diffHours * 100) / 100; // Round to 2 decimal places
};

/**
 * Finalize daily attendance status based on total work hours
 * Should be run by cron job for yesterday (not today)
 */
const finalizeDailyAttendance = async () => {
  // Process yesterday's attendance (not today)
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];
  
  // Find all attendance records for yesterday with PENDING final status
  const pendingAttendances = await Attendance.findAll({
    where: {
      attendance_date: yesterdayStr,
      final_status: 'PENDING'
    },
    include: [{
      model: require('../models').AttendanceSession,
      as: 'sessions',
      where: { check_out_time: null },
      required: false // LEFT JOIN to check for open sessions
    }]
  });

  let processed = 0;
  
  for (const attendance of pendingAttendances) {
    // Skip if employee has open sessions (still working)
    if (attendance.sessions && attendance.sessions.length > 0) {
      logger.info('Skipping finalization - employee has open sessions', {
        employeeId: attendance.employee_id,
        date: yesterdayStr,
        openSessions: attendance.sessions.length
      });
      continue;
    }
    
    // Check if yesterday was a holiday
    const holiday = await safeHolidayCheck(yesterdayStr);
    const isHoliday = !!holiday;
    
    // Use new calculateAttendanceStatus with total_work_hours
    const hours = parseFloat(attendance.total_work_hours) || 0;
    const calculatedStatus = calculateAttendanceStatus(hours, isHoliday);
    
    // Determine final status
    let finalStatus = calculatedStatus;
    if (finalStatus === null) {
      // No sessions worked, mark as ABSENT
      finalStatus = 'ABSENT';
    }
    
    // Check for double shift and flag in remarks
    const config = require('../config/attendanceConfig');
    let remarks = attendance.remarks;
    if (hours >= config.DOUBLE_SHIFT_HOURS) {
      remarks = remarks ? `${remarks}; DOUBLE_SHIFT (${hours}h)` : `DOUBLE_SHIFT (${hours}h)`;
      logger.info('Double shift detected during finalization', {
        employeeId: attendance.employee_id,
        date: yesterdayStr,
        totalHours: hours,
        threshold: config.DOUBLE_SHIFT_HOURS
      });
    }
    
    await attendance.update({
      final_status: finalStatus,
      status: finalStatus,
      remarks: remarks,
      status_change_reason: 'Finalized by cron',
      status_changed_by: null,
      status_changed_at: new Date()
    });

    logger.info('Attendance finalized', {
      employeeId: attendance.employee_id,
      date: yesterdayStr,
      totalHours: hours,
      isHoliday: isHoliday,
      finalStatus: finalStatus
    });
    
    processed++;
  }

  return {
    processed,
    date: yesterdayStr
  };
};

/**
 * Get today's attendance session status for employee
 * Shows live tally of sessions, hours worked, and projected status
 */
const getTodaySessionStatus = async (user) => {
  const employee = await getEmployeeFromUser(user, EmployeeMaster);
  if (!employee) {
    throw new ApiError(404, 'Employee record not found.');
  }

  const today = getCurrentDate();
  const config = require('../config/attendanceConfig');
  
  // Get yesterday's date for cross-midnight session detection
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];
  
  // Get attendance records for today and yesterday (for cross-midnight sessions)
  const [todayAttendance, yesterdayAttendance] = await Promise.all([
    Attendance.findOne({
      where: {
        employee_id: employee.employee_id,
        attendance_date: today,
        is_deleted: false
      },
      include: [{
        model: require('../models').AttendanceSession,
        as: 'sessions',
        order: [['created_at', 'ASC']]
      }]
    }),
    Attendance.findOne({
      where: {
        employee_id: employee.employee_id,
        attendance_date: yesterdayStr,
        is_deleted: false
      },
      include: [{
        model: require('../models').AttendanceSession,
        as: 'sessions',
        order: [['created_at', 'ASC']]
      }]
    })
  ]);

  // Check for active sessions from yesterday (cross-midnight shifts)
  let attendance = todayAttendance;
  let sessions = [];
  let totalCompletedHours = 0;
  let activeSession = null;
  
  logger.info('Cross-midnight session check', {
    employeeId: employee.employee_id,
    today: today,
    yesterday: yesterdayStr,
    todayAttendance: !!todayAttendance,
    yesterdayAttendance: !!yesterdayAttendance,
    yesterdaySessions: yesterdayAttendance?.sessions?.length || 0
  });
  
  if (yesterdayAttendance && yesterdayAttendance.sessions) {
    const yesterdayActiveSession = yesterdayAttendance.sessions.find(s => !s.check_out_time);
    logger.info('Yesterday active session check', {
      found: !!yesterdayActiveSession,
      sessionId: yesterdayActiveSession?.session_id,
      checkIn: yesterdayActiveSession?.check_in_time
    });
    
    if (yesterdayActiveSession) {
      // Found active session from yesterday
      activeSession = yesterdayActiveSession;
      sessions = yesterdayAttendance.sessions || [];
      totalCompletedHours = parseFloat(yesterdayAttendance.total_work_hours) || 0;
      attendance = yesterdayAttendance;
      logger.info('Using yesterday active session', {
        sessionId: activeSession.session_id,
        totalSessions: sessions.length,
        totalHours: totalCompletedHours
      });
    }
  }
  
  // If no active session from yesterday, use today's attendance
  if (!activeSession && todayAttendance) {
    sessions = todayAttendance.sessions || [];
    totalCompletedHours = parseFloat(todayAttendance.total_work_hours) || 0;
    attendance = todayAttendance;
    activeSession = sessions.find(s => !s.check_out_time);
    logger.info('Using today attendance', {
      totalSessions: sessions.length,
      activeSessionFound: !!activeSession,
      totalHours: totalCompletedHours
    });
  }
  
  // If still no attendance found, return empty state
  if (!attendance) {
    return {
      attendance_date: today,
      sessions: [],
      total_completed_hours: 0,
      current_session_running: false,
      projected_status: null,
      hours_needed_for_present: config.HALF_DAY_MIN_HOURS,
      message: 'No attendance marked today'
    };
  }

  // Check if today is a holiday
  const holiday = await safeHolidayCheck(today);
  const isHoliday = !!holiday;

  // Sessions already processed above for cross-midnight detection
  // No need to re-process here
  
  // Calculate projected status
  const statusInfo = config.getStatusMessage(totalCompletedHours, isHoliday);
  
  // Calculate live duration for active session
  const currentTime = getCurrentTime();
  const sessionsWithLiveDuration = sessions.map(s => {
    let hours = s.duration_hours || null;
    if (!s.check_out_time && s.check_in_time) {
      // Calculate live duration for active session
      hours = calculateDuration(s.check_in_time, currentTime);
    }
    return {
      session_id: s.session_id,
      check_in: s.check_in_time,
      check_out: s.check_out_time,
      hours: hours,
      active: !s.check_out_time
    };
  });
  
  // Calculate projected total including active session
  let projectedTotal = totalCompletedHours;
  if (activeSession && !activeSession.duration_hours) {
    projectedTotal += calculateDuration(activeSession.check_in_time, currentTime);
  }
  
  // Recalculate projected status with live duration
  const projectedStatusInfo = config.getStatusMessage(projectedTotal, isHoliday);

  return {
    attendance_date: today,
    sessions: sessionsWithLiveDuration,
    total_completed_hours: totalCompletedHours,
    projected_total_hours: Math.round(projectedTotal * 100) / 100,
    current_session_running: !!activeSession,
    projected_status: projectedStatusInfo.status,
    hours_needed_for_present: projectedStatusInfo.status === 'PRESENT' ? 0 : config.HALF_DAY_MIN_HOURS - projectedTotal,
    message: statusInfo.message,
    is_holiday: isHoliday
  };
};

/**
 * Generate PDF for attendance records with filters using existing HTML-to-PDF utility
 * Supports both month/year and date range filtering
 */
const generateAttendancePDF = async (adminUser, query) => {
  try {
    const htmlToPdf = require('html-pdf-node');
    const { 
      month, 
      year, 
      from_date, 
      to_date, 
      district_id, 
      scheme_id, 
      employee_id
    } = query;

    // Validate input - either month/year OR date range
    if (!month && !from_date) {
      throw ApiError.badRequest('Either month/year or from_date is required');
    }
    if (from_date && !to_date) {
      throw ApiError.badRequest('to_date is required when from_date is provided');
    }
    if (month && (!year || year < 2020 || year > 2100)) {
      throw ApiError.badRequest('Valid year is required when month is provided');
    }

    // Get optimized attendance records for PDF - only necessary fields
    const records = await getAttendanceRecordsForPDF(adminUser, query);

    // Generate HTML for PDF
    const html = generateAttendanceHTML(records, { 
      month, 
      year, 
      from_date, 
      to_date, 
      district_id, 
      scheme_id, 
      employee_id
    });

    // PDF options for compact design
    const pdfOptions = {
      format: 'A4',
      printBackground: true,
      margin: { 
        top: '10mm', 
        right: '8mm', 
        bottom: '10mm', 
        left: '8mm' 
      },
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    };

    const pdfBuffer = await htmlToPdf.generatePdf(
      { content: html },
      pdfOptions
    );

    // Generate appropriate filename
    let fileName;
    logger.info('PDF: Generating filename with date range:', { from_date, to_date, month, year });
    
    if (from_date && to_date) {
      // Handle Date objects by converting to YYYY-MM-DD format
      const fromDateStr = from_date instanceof Date ? from_date.toISOString().split('T')[0] : from_date;
      const toDateStr = to_date instanceof Date ? to_date.toISOString().split('T')[0] : to_date;
      fileName = `attendance_${fromDateStr}_to_${toDateStr}.pdf`;
    } else if (month && year) {
      fileName = `attendance_${month}_${year}.pdf`;
    } else {
      fileName = `attendance_report_${new Date().toISOString().split('T')[0]}.pdf`;
    }
    
    logger.info('PDF: Generated filename:', fileName);

    return {
      pdfBuffer,
      fileName
    };
  } catch (err) {
    logger.error('Error generating attendance PDF:', err);
    throw err;
  }
};

/**
 * Get optimized attendance records for PDF generation
 * Only fetches necessary fields to improve performance
 */
const getAttendanceRecordsForPDF = async (adminUser, query) => {
  try {
    const { month, year, from_date, to_date, district_id, scheme_id, employee_id } = query;
    
    const employeeIds = await getEmployeeIdsUnderAdmin(adminUser, EmployeeMaster);

    if (employeeIds.length === 0) {
      return [];
    }

    const where = {
      employee_id: { [Op.in]: employeeIds },
      is_deleted: false
    };

    // Date filtering - support both month/year and date range
    if (from_date && to_date) {
      // Date range filtering
      where.attendance_date = { [Op.between]: [from_date, to_date] };
    } else if (month && year) {
      // Month/year filtering (existing logic)
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0);
      where.attendance_date = { [Op.between]: [startDate.toISOString().split('T')[0], endDate.toISOString().split('T')[0]] };
    }

    // Add filters
    if (district_id) {
      where['$employee.district_id$'] = parseInt(district_id);
    }

    // Handle filter_type for radio button selections
    if (query.filter_type === 'osc_only') {
      // Show only records where scheme_type is OSC
      where['$employee.scheme.schemeType.scheme_code$'] = 'OSC';
    } else if (query.filter_type === 'hub_only') {
      // Show only records where scheme_type is HUB
      where['$employee.scheme.schemeType.scheme_code$'] = 'HUB';
    } else if (query.filter_type === 'all') {
      // Show all records (no additional filtering)
      // Still apply specific scheme_id if provided
      if (scheme_id) {
        where['$employee.scheme_id$'] = parseInt(scheme_id);
      }
    } else {
      // Legacy behavior - apply specific filters if provided
      if (scheme_id) {
        where['$employee.scheme_id$'] = parseInt(scheme_id);
      }
    }

    if (employee_id) {
      if (!employeeIds.includes(parseInt(employee_id))) {
        throw new ApiError(403, 'You do not have access to this employee.');
      }
      where.employee_id = parseInt(employee_id);
    }

    // Search functionality
    if (query.search && query.search.trim()) {
      const searchTerm = query.search.trim();
      where[Op.and] = [
        {
          [Op.or]: [
            { '$employee.employee_code$': { [Op.iLike]: `%${searchTerm}%` } },
            { '$employee.applicant.personal.full_name$': { [Op.iLike]: `%${searchTerm}%` } }
          ]
        }
      ];
    }

    const rawRecords = await Attendance.findAll({
      where,
      attributes: [
        'attendance_id', 'attendance_date', 'check_in_time', 'check_out_time', 
        'status', 'latitude', 'longitude', 'employee_id', 'total_work_hours', 'remarks'
      ],
      include: [
        {
          model: EmployeeMaster,
          as: 'employee',
          attributes: ['employee_code', 'district_id', 'scheme_id'],
          include: [
            {
              model: db.ApplicantMaster,
              as: 'applicant',
              attributes: ['email'],
              include: [
                {
                  model: db.ApplicantPersonal,
                  as: 'personal',
                  attributes: ['full_name'],
                  required: false
                }
              ],
              required: false
            },
            {
              model: db.DistrictMaster,
              as: 'district',
              attributes: ['district_name'],
              required: false
            },
            {
              model: db.Scheme,
              as: 'scheme',
              attributes: ['scheme_name', 'scheme_type_id'],
              required: false,
              include: [{
                model: db.SchemeType,
                as: 'schemeType',
                attributes: ['scheme_type_id', 'scheme_code', 'scheme_name'],
                required: false
              }]
            }
          ]
        }
      ],
      order: [['attendance_date', 'ASC'], ['employee_id', 'ASC']], // Order for better PDF layout
      limit: Math.min(query.pdf_limit || 5000, 10000) // Configurable limit with safety cap
    });

    return rawRecords.map(formatAttendanceRecord);
  } catch (error) {
    logger.error('PDF: Error in getAttendanceRecordsForPDF:', error);
    logger.error('PDF: Error stack:', error.stack);
    throw new ApiError(500, 'Failed to fetch attendance records for PDF: ' + error.message);
  }
};

/**
 * Generate HTML for attendance records PDF with clean design
 * Supports both date range and month/year filtering with compact/detailed formats
 */
const generateAttendanceHTML = (records, filters) => {
  const { month, year, from_date, to_date, district_id, scheme_id, employee_id } = filters;
  
  const escapeHtml = (value) => {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  const formatDateForPDF = (dateStr) => {
    if (!dateStr) return '';
    // Handle YYYY-MM-DD format
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr; // Return original if invalid
    return date.toLocaleDateString('en-IN', { 
      day: '2-digit', 
      month: '2-digit', 
      year: 'numeric',
      timeZone: 'Asia/Kolkata'
    });
  };

  const calculateWorkHours = (checkInTime, checkOutTime) => {
    if (!checkInTime || !checkOutTime) return '--';
    
    try {
      // Parse times in HH:MM:SS format
      const [inHours, inMinutes, inSeconds] = checkInTime.split(':').map(Number);
      const [outHours, outMinutes, outSeconds] = checkOutTime.split(':').map(Number);
      
      // Create date objects for calculation (using same date)
      const baseDate = new Date();
      const checkIn = new Date(baseDate.setHours(inHours, inMinutes, inSeconds || 0, 0));
      const checkOut = new Date(baseDate.setHours(outHours, outMinutes, outSeconds || 0, 0));
      
      // Calculate difference in milliseconds
      const diffMs = checkOut - checkIn;
      
      // Handle negative or zero difference
      if (diffMs <= 0) return '--';
      
      // Convert to hours
      const hours = diffMs / (1000 * 60 * 60);
      
      // Format to 2 decimal places
      return hours.toFixed(2);
    } catch (error) {
      return '--';
    }
  };

  
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
                      'July', 'August', 'September', 'October', 'November', 'December'];
  
  const generatedOn = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

  // Determine date range display
  let dateDisplay;
  if (from_date && to_date) {
    // Format dates as DD/MM/YYYY
    const fromDateFormatted = formatDateForPDF(from_date);
    const toDateFormatted = formatDateForPDF(to_date);
    dateDisplay = `Date Range: ${fromDateFormatted} to ${toDateFormatted}`;
  } else if (month && year) {
    const monthName = monthNames[month - 1];
    dateDisplay = `Month: ${monthName} ${year}`;
  } else {
    dateDisplay = 'Custom Date Range';
  }

  const firstRecord = records[0] || {};
  const filterLabels = [];
  if (district_id) {
    filterLabels.push(`District: ${firstRecord.district_name || district_id}`);
  }
  if (scheme_id) {
    filterLabels.push(`Scheme: ${firstRecord.scheme_name || scheme_id}`);
  }
  if (employee_id) {
    filterLabels.push(`Employee: ${firstRecord.employee_name || employee_id}`);
  }

  // Compact design with all detailed fields
  const fontSize = '7px';
  const padding = '2px 4px';
  const titleSize = '14px';
  const subtitleSize = '9px';
  const filterSize = '8px';

  let html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Attendance Records</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 10px; }
        .header { text-align: center; margin-bottom: 15px; }
        .title { font-size: ${titleSize}; font-weight: bold; margin-bottom: 5px; }
        .subtitle { font-size: ${subtitleSize}; color: #666; margin-bottom: 3px; }
        .filters { font-size: ${filterSize}; color: #888; margin-bottom: 10px; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
        th, td { border: 1px solid #ddd; padding: ${padding}; text-align: left; font-size: ${fontSize}; }
        th { background-color: #f5f5f5; font-weight: bold; }
        .footer { text-align: center; font-size: ${filterSize}; color: #888; margin-top: 15px; }
        .no-records { text-align: center; color: #666; margin: 30px 0; font-size: ${fontSize}; }
        .date-col { width: 60px; }
        .code-col { width: 80px; }
        .name-col { width: 100px; }
        .district-col { width: 80px; }
        .scheme-col { width: 80px; }
        .scheme-type-col { width: 60px; }
        .status-col { width: 50px; }
        .time-col { width: 50px; }
        .hours-col { width: 40px; }
        .location-col { width: 80px; }
        .remarks-col { width: 100px; }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="title">Attendance Records</div>
        <div class="subtitle">${dateDisplay}</div>
        <div class="filters">
          ${filterLabels.length ? filterLabels.join(' | ') : 'All Filters'}
        </div>
      </div>
      
      ${records.length === 0 ? 
        '<div class="no-records">No attendance records found for the selected criteria.</div>' :
        `
        <table>
          <thead>
            <tr>
              <th class="date-col">Date</th>
              <th class="code-col">Code</th>
              <th class="name-col">Name</th>
              <th class="district-col">District</th>
              <th class="scheme-col">Scheme</th>
              <th class="scheme-type-col">Type</th>
              <th class="status-col">Status</th>
              <th class="time-col">In</th>
              <th class="time-col">Out</th>
              <th class="hours-col">Hours</th>
              <th class="location-col">Location</th>
              <th class="remarks-col">Remarks</th>
            </tr>
          </thead>
          <tbody>
            ${records.map(record => {
              return `
              <tr>
                <td class="date-col">${escapeHtml(formatDateForPDF(record.attendance_date || ''))}</td>
                <td class="code-col">${escapeHtml(record.employee_code || '')}</td>
                <td class="name-col">${escapeHtml(record.employee_name || '')}</td>
                <td class="district-col">${escapeHtml(record.district_name || '')}</td>
                <td class="scheme-col">${escapeHtml(record.scheme_name || '')}</td>
                <td class="scheme-type-col">${escapeHtml(record.scheme_type || '')}</td>
                <td class="status-col">${escapeHtml(record.status || '')}</td>
                <td class="time-col">${escapeHtml(record.check_in_time || '')}</td>
                <td class="time-col">${escapeHtml(record.check_out_time || '')}</td>
                <td class="hours-col">${escapeHtml(calculateWorkHours(record.check_in_time, record.check_out_time))}</td>
                <td class="location-col"><small>${escapeHtml(record.latitude && record.longitude ? `${record.latitude},${record.longitude}` : '--')}</small></td>
                <td class="remarks-col"><small>${escapeHtml(record.remarks || '--')}</small></td>
              </tr>
            `;
            }).join('')}
          </tbody>
        </table>
        `
      }
      
      <div class="footer">
        Generated on: ${generatedOn} | Total Records: ${records.length}
      </div>
    </body>
    </html>
  `;

  return html;
};


module.exports = {
  markAttendance,
  markAttendanceByAdmin,
  getMyAttendance,
  getAttendanceRecords,
  getAttendanceSummary,
  enhanceMarkAttendanceWithCheckIn,
  checkOutSimple,
  finalizeDailyAttendance,
  generateAttendancePDF,
  getAttendanceRecordsForPDF,
  calculateAttendanceStatus,
  getTodaySessionStatus
};
