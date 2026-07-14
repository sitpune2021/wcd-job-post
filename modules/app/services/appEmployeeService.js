const { Op } = require('sequelize');
const db = require('../../../models');
const { ApiError } = require('../../../middleware/errorHandler');
const attendanceService = require('../../hrm/services/attendanceService');
const calendarService = require('../../hrm/services/calendarService');
const leaveService = require('../../hrm/services/leaveService');
const weeklyOffClaimService = require('../../hrm/services/weeklyOffClaimService');
const { getEmployeeFromUser } = require('../../hrm/utils/hrmHelpers');
const { validateGeofence, detectDevice, getAllowedRadius } = require('../../hrm/utils/geofencing');

const toNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const todayString = () => {
  const now = new Date();
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const year = ist.getFullYear();
  const month = String(ist.getMonth() + 1).padStart(2, '0');
  const day = String(ist.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getEmployeeIdFromUser = async (user) => {
  const employee = await getEmployeeFromUser(user, db.EmployeeMaster);
  if (!employee) {
    throw new ApiError(404, 'Employee record not found');
  }
  return employee.employee_id;
};

const getEmployeeProfileRecord = async (user) => {
  const applicantId = user.applicant_id || user.dataValues?.applicant_id;
  const employeeId = user.employee_id || user.dataValues?.employee_id;

  const where = {
    is_deleted: false,
    is_active: true
  };

  if (employeeId) where.employee_id = employeeId;
  else if (applicantId) where.applicant_id = applicantId;
  else throw new ApiError(401, 'Employee identity missing from token');

  const employee = await db.EmployeeMaster.findOne({
    where,
    include: [
      {
        model: db.ApplicantMaster,
        as: 'applicant',
        attributes: ['applicant_id', 'applicant_no', 'email', 'mobile_no', 'is_verified'],
        include: [{
          model: db.ApplicantPersonal,
          as: 'personal',
          attributes: [
            'full_name', 'dob', 'gender', 'photo_path', 'aadhaar_path', 'pan_path',
            'resume_path', 'domicile_path', 'signature_path'
          ],
          required: false
        }]
      },
      {
        model: db.PostMaster,
        as: 'post',
        attributes: ['post_id', 'post_name', 'post_name_mr', 'post_code'],
        required: false
      },
      {
        model: db.DistrictMaster,
        as: 'district',
        attributes: ['district_id', 'district_name', 'district_name_mr'],
        required: false
      },
      {
        model: db.Scheme,
        as: 'scheme',
        attributes: [
          'scheme_id', 'scheme_code', 'scheme_name', 'scheme_name_mr',
          'latitude', 'longitude', 'geofence_radius_meters'
        ],
        required: false,
        include: [{
          model: db.SchemeType,
          as: 'schemeType',
          attributes: ['scheme_type_id', 'scheme_code', 'scheme_name'],
          required: false
        }]
      }
    ]
  });

  if (!employee) {
    throw new ApiError(404, 'Employee profile not found');
  }

  return employee;
};

const mapProfile = (employee) => {
  const applicant = employee.applicant || {};
  const personal = applicant.personal || {};
  const scheme = employee.scheme || {};
  const schemeType = scheme.schemeType || {};
  const post = employee.post || {};
  const district = employee.district || {};

  return {
    employee_id: employee.employee_id,
    employee_code: employee.employee_code,
    applicant_id: employee.applicant_id,
    applicant_no: applicant.applicant_no || null,
    full_name: personal.full_name || null,
    email: applicant.email || null,
    mobile_no: applicant.mobile_no || null,
    dob: personal.dob || null,
    gender: personal.gender || null,
    post: {
      post_id: employee.post_id,
      post_code: post.post_code || null,
      post_name: post.post_name || null,
      post_name_mr: post.post_name_mr || null
    },
    district: {
      district_id: employee.district_id,
      district_name: district.district_name || null,
      district_name_mr: district.district_name_mr || null
    },
    scheme: {
      scheme_id: employee.scheme_id,
      scheme_code: scheme.scheme_code || null,
      scheme_name: scheme.scheme_name || null,
      scheme_name_mr: scheme.scheme_name_mr || null,
      scheme_type_id: schemeType.scheme_type_id || null,
      scheme_type_code: schemeType.scheme_code || null,
      scheme_type_name: schemeType.scheme_name || null,
      latitude: toNumber(scheme.latitude),
      longitude: toNumber(scheme.longitude),
      geofence_radius_meters: scheme.geofence_radius_meters || null
    },
    employment: {
      employment_status: employee.employment_status,
      onboarding_status: employee.onboarding_status,
      contract_start_date: employee.contract_start_date || null,
      contract_end_date: employee.contract_end_date || null,
      joining_date: employee.created_at || null
    },
    paths: {
      photo_path: personal.photo_path || null,
      aadhaar_path: personal.aadhaar_path || null,
      pan_path: personal.pan_path || null,
      resume_path: personal.resume_path || null,
      domicile_path: personal.domicile_path || null,
      signature_path: personal.signature_path || null,
      allotment_letter_path: employee.allotment_letter_path || null
    }
  };
};

const getProfile = async (user) => mapProfile(await getEmployeeProfileRecord(user));

const getTodayAttendanceRecord = async (employeeId) => {
  const today = todayString();
  return db.HrmAttendance.findOne({
    where: {
      employee_id: employeeId,
      attendance_date: today,
      is_deleted: false
    },
    attributes: [
      'attendance_id', 'attendance_date', 'check_in_time', 'check_out_time',
      'status', 'total_work_hours', 'latitude', 'longitude', 'geo_address',
      'attendance_image_path', 'check_in_photo_path', 'check_out_photo_path'
    ]
  });
};

const getTodayAttendance = async (user) => {
  const employeeId = await getEmployeeIdFromUser(user);
  const [sessionStatus, attendance] = await Promise.all([
    attendanceService.getTodaySessionStatus(user),
    getTodayAttendanceRecord(employeeId)
  ]);

  return {
    date: sessionStatus.attendance_date || todayString(),
    attendance_id: attendance?.attendance_id || null,
    status: attendance?.status || sessionStatus.projected_status || 'NOT_MARKED',
    check_in_time: attendance?.check_in_time || sessionStatus.sessions?.[0]?.check_in || null,
    check_out_time: attendance?.check_out_time || null,
    total_work_hours: attendance?.total_work_hours || sessionStatus.projected_total_hours || 0,
    current_session_running: !!sessionStatus.current_session_running,
    can_check_in: !sessionStatus.current_session_running,
    can_check_out: !!sessionStatus.current_session_running,
    sessions: sessionStatus.sessions || [],
    location: {
      latitude: toNumber(attendance?.latitude),
      longitude: toNumber(attendance?.longitude),
      geo_address: attendance?.geo_address || null
    },
    paths: {
      attendance_image_path: attendance?.attendance_image_path || null,
      check_in_photo_path: attendance?.check_in_photo_path || null,
      check_out_photo_path: attendance?.check_out_photo_path || null
    },
    message: sessionStatus.message || null
  };
};

const getHome = async (user) => {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const [profile, todayAttendance, calendar, leaveBalance] = await Promise.all([
    getProfile(user),
    getTodayAttendance(user),
    calendarService.getEmployeeCalendar(user, { month, year }),
    leaveService.getMyLeaveBalances(user)
  ]);

  return {
    employee: {
      employee_id: profile.employee_id,
      employee_code: profile.employee_code,
      full_name: profile.full_name,
      post_name: profile.post.post_name,
      district_name: profile.district.district_name,
      scheme_name: profile.scheme.scheme_name,
      scheme_type_code: profile.scheme.scheme_type_code,
      photo_path: profile.paths.photo_path
    },
    live_location: {
      scheme_name: profile.scheme.scheme_name,
      latitude: profile.scheme.latitude,
      longitude: profile.scheme.longitude,
      geofence_radius_meters: profile.scheme.geofence_radius_meters
    },
    today_attendance: todayAttendance,
    monthly_summary: calendar.summary || {},
    leave_balance: leaveBalance || [],
    notifications_enabled: false,
    recent_notifications: []
  };
};

const checkLocation = async (user, payload, userAgent) => {
  const profile = await getProfile(user);
  const targetLat = profile.scheme.latitude;
  const targetLon = profile.scheme.longitude;
  const userLat = toNumber(payload.latitude);
  const userLon = toNumber(payload.longitude);

  if (userLat === null || userLon === null) {
    throw new ApiError(400, 'Latitude and longitude are required');
  }

  if (targetLat === null || targetLon === null) {
    throw new ApiError(400, 'Scheme location is not configured. Please contact admin.');
  }

  const deviceType = detectDevice(userAgent);
  const allowedRadius = getAllowedRadius(deviceType, profile.scheme.geofence_radius_meters || 100);
  const validation = validateGeofence({ userLat, userLon, targetLat, targetLon, allowedRadius });

  return {
    ...validation,
    device_type: deviceType,
    scheme: {
      scheme_id: profile.scheme.scheme_id,
      scheme_name: profile.scheme.scheme_name,
      latitude: targetLat,
      longitude: targetLon,
      geofence_radius_meters: profile.scheme.geofence_radius_meters
    },
    current_location: {
      latitude: userLat,
      longitude: userLon,
      geo_address: payload.geo_address || null
    }
  };
};

const getCalendar = (user, query) => calendarService.getEmployeeCalendar(user, query);
const getAttendanceHistory = (user, query) => attendanceService.getMyAttendance(user, query);
const getLeaveTypes = () => leaveService.getLeaveTypes();
const getLeaveBalances = (user) => leaveService.getMyLeaveBalances(user);
const getLeaves = (user, query) => leaveService.getMyLeaves(user, query);
const applyLeave = (user, data) => leaveService.applyLeave(user, data);
const cancelLeave = (user, leaveId) => leaveService.cancelLeave(user, leaveId);

const getWeeklyOffs = async (user, query = {}) => {
  const employeeId = await getEmployeeIdFromUser(user);
  await weeklyOffClaimService.generateWeeklyOffEntitlements(employeeId);

  const filters = {};
  if (query.status) filters.status = query.status;
  if (query.month) filters.monthCode = parseInt(query.month, 10);

  return weeklyOffClaimService.getEmployeeWeeklyOffClaims(employeeId, filters);
};

const claimWeeklyOff = async (user, claimId, claimedOffDate) => {
  const employeeId = await getEmployeeIdFromUser(user);
  return weeklyOffClaimService.submitWeeklyOffClaim(
    employeeId,
    parseInt(claimId, 10),
    claimedOffDate,
    user.applicant_id || user.employee_id || null
  );
};

const getLeaveDatesForMonth = async (user, month, year) => {
  const employeeId = await getEmployeeIdFromUser(user);
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const endDate = new Date(year, month, 0);
  const end = `${year}-${String(month).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;

  return db.HrmLeaveApplication.findAll({
    where: {
      employee_id: employeeId,
      is_deleted: false,
      status: { [Op.in]: ['PENDING', 'APPROVED'] },
      [Op.or]: [
        { from_date: { [Op.between]: [start, end] } },
        { to_date: { [Op.between]: [start, end] } },
        { from_date: { [Op.lte]: start }, to_date: { [Op.gte]: end } }
      ]
    },
    attributes: ['leave_id', 'from_date', 'to_date', 'status', 'total_days', 'reason']
  });
};

module.exports = {
  getProfile,
  getHome,
  getTodayAttendance,
  checkLocation,
  getCalendar,
  getAttendanceHistory,
  getLeaveTypes,
  getLeaveBalances,
  getLeaves,
  applyLeave,
  cancelLeave,
  getWeeklyOffs,
  claimWeeklyOff,
  getLeaveDatesForMonth
};
