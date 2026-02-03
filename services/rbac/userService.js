// ============================================================================
// RBAC USER SERVICE
// ============================================================================
// Purpose: Admin user management operations
// Table: ms_admin_users
// ============================================================================

const { sequelize } = require('../../config/db');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const logger = require('../../config/logger');
const { getBcryptRounds } = require('../../config/security');

// ==================== USER CRUD OPERATIONS ====================

/**
 * Get all users with optional filters
 * @param {Object} filters - Filter options (role_id, is_active, search)
 * @returns {Promise<Array>} List of users
 */
const getAllUsers = async (filters = {}) => {
  try {
    let query = `
      SELECT 
        u.admin_id,
        u.username,
        u.email,
        u.full_name,
        u.mobile_no,
        u.role_id,
        r.role_name,
        r.role_code,
        u.is_active,
        u.last_login,
        u.created_at,
        u.updated_at
      FROM ms_admin_users u
      LEFT JOIN ms_roles r ON u.role_id = r.role_id
      WHERE u.is_deleted = false
    `;

    const replacements = {};

    if (filters.role_id) {
      query += ` AND u.role_id = :role_id`;
      replacements.role_id = filters.role_id;
    }

    if (filters.is_active !== undefined) {
      query += ` AND u.is_active = :is_active`;
      replacements.is_active = filters.is_active;
    }

    if (filters.search) {
      query += ` AND (u.username ILIKE :search OR u.full_name ILIKE :search OR u.email ILIKE :search)`;
      replacements.search = `%${filters.search}%`;
    }

    query += ` ORDER BY u.created_at DESC`;

    const [users] = await sequelize.query(query, { replacements });
    return users;
  } catch (error) {
    logger.error('Error fetching users:', error);
    throw error;
  }
};

/**
 * Get user by ID with permissions
 * @param {number} userId - User ID
 * @returns {Promise<Object|null>} User object or null
 */
const getUserById = async (userId) => {
  try {
    const [users] = await sequelize.query(
      `SELECT 
        u.admin_id,
        u.username,
        u.email,
        u.full_name,
        u.mobile_no,
        u.role_id,
        r.role_name,
        r.role_code,
        r.description as role_description,
        u.is_active,
        u.last_login,
        u.created_at,
        u.updated_at
      FROM ms_admin_users u
      LEFT JOIN ms_roles r ON u.role_id = r.role_id
      WHERE u.admin_id = :userId AND u.is_deleted = false`,
      { replacements: { userId } }
    );

    if (users.length === 0) {
      return null;
    }

    const user = users[0];

    // Get user's permissions through role
    if (user.role_id) {
      const [permissions] = await sequelize.query(
        `SELECT p.permission_id, p.permission_name, p.permission_code, p.module
         FROM ms_permissions p
         JOIN ms_role_permissions rp ON p.permission_id = rp.permission_id
         WHERE rp.role_id = :role_id AND p.is_active = true AND p.is_deleted = false
         ORDER BY p.module, p.permission_name`,
        { replacements: { role_id: user.role_id } }
      );

      user.permissions = permissions;
    } else {
      user.permissions = [];
    }

    return user;
  } catch (error) {
    logger.error('Error fetching user:', error);
    throw error;
  }
};

/**
 * Create new user
 * @param {Object} data - User data
 * @param {number} createdBy - Admin ID creating the user
 * @returns {Promise<Object>} Created user with temp password
 */
const createUser = async (data, createdBy) => {
  try {
    // Generate temporary password
    const tempPassword = crypto.randomBytes(8).toString('hex');
    const passwordHash = await bcrypt.hash(tempPassword, getBcryptRounds());

    const [result] = await sequelize.query(
      `INSERT INTO ms_admin_users (
        username, email, full_name, mobile_no, password_hash, role_id,
        is_active, created_by, created_at, updated_at
      )
      VALUES (
        :username, :email, :full_name, :mobile_no, :password_hash, :role_id,
        true, :created_by, NOW(), NOW()
      )
      RETURNING admin_id, username, email, full_name, mobile_no, role_id, is_active`,
      {
        replacements: {
          username: data.username,
          email: data.email,
          full_name: data.full_name,
          mobile_no: data.mobile_no || null,
          password_hash: passwordHash,
          role_id: data.role_id || null,
          created_by: createdBy
        }
      }
    );

    logger.info(`User created: ${result[0].admin_id} by ${createdBy}`);
    
    return {
      user: result[0],
      tempPassword // Return temp password to send via email
    };
  } catch (error) {
    logger.error('Error creating user:', error);
    throw error;
  }
};

/**
 * Update user
 * @param {number} userId - User ID
 * @param {Object} data - Update data
 * @param {number} updatedBy - Admin ID updating the user
 * @returns {Promise<Object|null>} Updated user or null
 */
const updateUser = async (userId, data, updatedBy) => {
  try {
    const [result] = await sequelize.query(
      `UPDATE ms_admin_users 
       SET email = COALESCE(:email, email),
           full_name = COALESCE(:full_name, full_name),
           mobile_no = COALESCE(:mobile_no, mobile_no),
           role_id = COALESCE(:role_id, role_id),
           is_active = COALESCE(:is_active, is_active),
           updated_by = :updated_by,
           updated_at = NOW()
       WHERE admin_id = :userId AND is_deleted = false
       RETURNING admin_id, username, email, full_name, mobile_no, role_id, is_active`,
      {
        replacements: {
          userId,
          email: data.email || null,
          full_name: data.full_name || null,
          mobile_no: data.mobile_no || null,
          role_id: data.role_id !== undefined ? data.role_id : null,
          is_active: data.is_active !== undefined ? data.is_active : null,
          updated_by: updatedBy
        }
      }
    );

    if (result.length === 0) {
      return null;
    }

    logger.info(`User updated: ${userId} by ${updatedBy}`);
    return result[0];
  } catch (error) {
    logger.error('Error updating user:', error);
    throw error;
  }
};

/**
 * Soft delete user
 * @param {number} userId - User ID
 * @param {number} deletedBy - Admin ID deleting the user
 * @returns {Promise<boolean>} Success status
 */
const deleteUser = async (userId, deletedBy) => {
  try {
    const [result] = await sequelize.query(
      `UPDATE ms_admin_users 
       SET is_deleted = true, deleted_by = :deleted_by, deleted_at = NOW()
       WHERE admin_id = :userId AND is_deleted = false
       RETURNING admin_id`,
      {
        replacements: { userId, deleted_by: deletedBy }
      }
    );

    if (result.length === 0) {
      return false;
    }

    logger.info(`User deleted: ${userId} by ${deletedBy}`);
    return true;
  } catch (error) {
    logger.error('Error deleting user:', error);
    throw error;
  }
};

/**
 * Assign role to user
 * @param {number} userId - User ID
 * @param {number} roleId - Role ID
 * @param {number} assignedBy - Admin ID assigning the role
 * @returns {Promise<Object|null>} Updated user or null
 */
const assignRoleToUser = async (userId, roleId, assignedBy) => {
  try {
    const [result] = await sequelize.query(
      `UPDATE ms_admin_users 
       SET role_id = :roleId, updated_by = :assignedBy, updated_at = NOW()
       WHERE admin_id = :userId AND is_deleted = false
       RETURNING admin_id, username, role_id`,
      {
        replacements: { userId, roleId, assignedBy }
      }
    );

    if (result.length === 0) {
      return null;
    }

    logger.info(`Role ${roleId} assigned to user ${userId} by ${assignedBy}`);
    return result[0];
  } catch (error) {
    logger.error('Error assigning role:', error);
    throw error;
  }
};

/**
 * Reset user password
 * @param {number} userId - User ID
 * @param {number} resetBy - Admin ID resetting the password
 * @returns {Promise<Object|null>} User with temp password or null
 */
const resetUserPassword = async (userId, resetBy) => {
  try {
    const tempPassword = crypto.randomBytes(8).toString('hex');
    const passwordHash = await bcrypt.hash(tempPassword, getBcryptRounds());

    const [result] = await sequelize.query(
      `UPDATE ms_admin_users 
       SET password_hash = :passwordHash, updated_by = :resetBy, updated_at = NOW()
       WHERE admin_id = :userId AND is_deleted = false
       RETURNING admin_id, username, email`,
      {
        replacements: { userId, passwordHash, resetBy }
      }
    );

    if (result.length === 0) {
      return null;
    }

    logger.info(`Password reset for user ${userId} by ${resetBy}`);
    return {
      user: result[0],
      tempPassword
    };
  } catch (error) {
    logger.error('Error resetting password:', error);
    throw error;
  }
};

/**
 * Get user's effective permissions (for JWT/session)
 * @param {number} userId - User ID
 * @returns {Promise<Array>} List of permission codes
 */
const getUserEffectivePermissions = async (userId) => {
  try {
    // Get user's role
    const [users] = await sequelize.query(
      `SELECT role_id FROM ms_admin_users WHERE admin_id = :userId AND is_deleted = false`,
      { replacements: { userId } }
    );

    if (users.length === 0 || !users[0].role_id) {
      return [];
    }

    const roleId = users[0].role_id;

    // Get direct permission codes
    const [directPerms] = await sequelize.query(
      `SELECT p.permission_code
       FROM ms_permissions p
       JOIN ms_role_permissions rp ON p.permission_id = rp.permission_id
       WHERE rp.role_id = :roleId AND p.is_active = true AND p.is_deleted = false`,
      { replacements: { roleId } }
    );

    // Get wildcard patterns
    const [wildcards] = await sequelize.query(
      `SELECT wildcard_pattern FROM ms_role_wildcard_permissions WHERE role_id = :roleId`,
      { replacements: { roleId } }
    );

    // Return both direct permissions and wildcard patterns
    const permissions = [
      ...directPerms.map(p => p.permission_code),
      ...wildcards.map(w => w.wildcard_pattern)
    ];

    return [...new Set(permissions)]; // Deduplicate
  } catch (error) {
    logger.error('Error fetching user effective permissions:', error);
    throw error;
  }
};

module.exports = {
  getAllUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  assignRoleToUser,
  resetUserPassword,
  getUserEffectivePermissions
};
