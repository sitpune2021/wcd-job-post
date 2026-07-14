const authService = require('../../../services/authServiceEmail');
const db = require('../../../models');
const { generateToken } = require('../../../config/security');
const { ApiError } = require('../../../middleware/errorHandler');

const buildEmployeeUser = (employee) => {
  const applicant = employee.applicant || {};
  const personal = applicant.personal || {};

  return {
    employee_id: employee.employee_id,
    employee_code: employee.employee_code,
    applicant_id: employee.applicant_id,
    applicant_no: applicant.applicant_no || null,
    email: applicant.email || null,
    mobile_no: applicant.mobile_no || null,
    full_name: personal.full_name || null,
    role: 'EMPLOYEE',
    employment_status: employee.employment_status,
    onboarding_status: employee.onboarding_status,
    password_change_required: !!employee.password_change_required
  };
};

const findActiveEmployeeByApplicantId = async (applicantId) => {
  const employee = await db.EmployeeMaster.findOne({
    where: {
      applicant_id: applicantId,
      is_deleted: false
    },
    include: [{
      model: db.ApplicantMaster,
      as: 'applicant',
      attributes: ['applicant_id', 'applicant_no', 'email', 'mobile_no'],
      include: [{
        model: db.ApplicantPersonal,
        as: 'personal',
        attributes: ['full_name'],
        required: false
      }]
    }]
  });

  if (!employee) {
    throw new ApiError(403, 'No employee account is linked with this login');
  }

  if (!employee.is_active) {
    throw new ApiError(403, 'Employee account is not active');
  }

  return employee;
};

const login = async ({ email, password }) => {
  let applicantLogin;
  try {
    applicantLogin = await authService.loginApplicant(email, password);
  } catch (error) {
    if (error.statusCode) throw error;

    const message = error.message || 'Login failed';
    if (message.toLowerCase().includes('invalid email or password')) {
      throw new ApiError(401, 'Invalid email or password');
    }

    throw new ApiError(400, message);
  }

  const applicantId = applicantLogin?.user?.applicant_id;

  if (!applicantId) {
    throw new ApiError(401, 'Invalid email or password');
  }

  const employee = await findActiveEmployeeByApplicantId(applicantId);
  const user = buildEmployeeUser(employee);

  const token = generateToken({
    id: applicantId,
    applicant_id: applicantId,
    employee_id: employee.employee_id,
    email: user.email,
    role: 'EMPLOYEE'
  });

  return {
    user,
    token
  };
};

const forgotPassword = (email) => authService.sendPasswordResetOTP(email);
const resetPassword = (email, otp, newPassword) => authService.resetPassword(email, otp, newPassword);
const changePassword = (applicantId, currentPassword, newPassword) => (
  authService.changePassword(applicantId, currentPassword, newPassword)
);

module.exports = {
  login,
  forgotPassword,
  resetPassword,
  changePassword
};
