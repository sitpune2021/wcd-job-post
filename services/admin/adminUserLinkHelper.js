const { sequelize } = require('../../config/db');
const logger = require('../../config/logger');

/**
 * Fetch employee + applicant details required for linking admin accounts
 */
const fetchLinkedEmployeeDetails = async (employeeId) => {
  try {
    const [rows] = await sequelize.query(
      `SELECT 
        e.employee_id,
        e.employee_code,
        e.scheme_id,
        e.district_id,
        e.is_active,
        e.is_deleted,
        am.applicant_id,
        LOWER(am.email) AS normalized_email,
        am.email,
        am.password_hash,
        ap.full_name
       FROM ms_employee_master e
       JOIN ms_applicant_master am ON am.applicant_id = e.applicant_id
       LEFT JOIN ms_applicant_personal ap ON ap.applicant_id = e.applicant_id
       WHERE e.employee_id = :employeeId
         AND e.is_deleted = false
         AND am.is_deleted = false
       LIMIT 1`,
      { replacements: { employeeId } }
    );

    if (!rows || rows.length === 0) {
      const error = new Error('Employee not found for linking');
      error.statusCode = 404;
      throw error;
    }

    const employee = rows[0];
    if (employee.is_active === false) {
      const error = new Error('Cannot link inactive employee');
      error.statusCode = 400;
      throw error;
    }

    if (!employee.email || !employee.password_hash) {
      const error = new Error('Employee email or password missing for linking');
      error.statusCode = 400;
      throw error;
    }

    return employee;
  } catch (error) {
    logger.error('fetchLinkedEmployeeDetails error:', error);
    throw error;
  }
};

/**
 * Ensure admin username is unique (case insensitive)
 */
const ensureAdminUsernameAvailable = async (username, excludeAdminId = null) => {
  if (!username) return;
  const [rows] = await sequelize.query(
    `SELECT admin_id FROM ms_admin_users 
     WHERE LOWER(username) = LOWER(:username)
       AND is_deleted = false
       ${excludeAdminId ? 'AND admin_id <> :excludeAdminId' : ''}
     LIMIT 1`,
    {
      replacements: {
        username,
        excludeAdminId
      }
    }
  );

  if (rows.length > 0) {
    const error = new Error('An admin account already exists with this username/email');
    error.statusCode = 409;
    throw error;
  }
};

/**
 * Build normalized admin fields from linked employee
 */
const buildLinkedAdminFields = (employee, fallbackName) => {
  const fullName = fallbackName || employee.full_name || employee.employee_code || employee.email;

  return {
    username: employee.email,
    email: employee.email,
    full_name: fullName,
    password_hash: employee.password_hash,
    district_id: employee.district_id || null,
    scheme_id: employee.scheme_id || null
  };
};

module.exports = {
  fetchLinkedEmployeeDetails,
  ensureAdminUsernameAvailable,
  buildLinkedAdminFields
};
