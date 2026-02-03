// ============================================================================
// RBAC ROLE SERVICE
// ============================================================================
// Purpose: Role management operations
// Table: ms_roles, ms_role_permissions, ms_role_wildcard_permissions
// ============================================================================

const { sequelize } = require('../../config/db');
const logger = require('../../config/logger');

// ==================== ROLE CRUD OPERATIONS ====================

/**
 * Get all roles with optional pagination and search
 * @param {Object} filters - Filter options (includeInactive, search, page, limit)
 * @returns {Promise<Array|Object>} List of roles or paginated result
 */
const getAllRoles = async (filters = {}) => {
  try {
    const includeInactive = !!filters.includeInactive;
    const search = filters.search;

    let whereClause = `WHERE r.is_deleted = false`;
    const replacements = {};

    if (!includeInactive) {
      whereClause += ` AND r.is_active = true`;
    }

    if (search) {
      whereClause += ` AND (r.role_name ILIKE :search OR r.role_code ILIKE :search OR r.description ILIKE :search)`;
      replacements.search = `%${search}%`;
    }

    const usePagination = filters.page !== undefined || filters.limit !== undefined;

    if (!usePagination) {
      const query = `
        SELECT 
          r.role_id,
          r.role_name,
          r.role_code,
          r.description,
          r.is_system_role,
          r.is_active,
          r.created_at,
          r.updated_at,
          COUNT(DISTINCT u.admin_id) as user_count,
          COUNT(DISTINCT rp.permission_id) as permission_count
        FROM ms_roles r
        LEFT JOIN ms_admin_users u ON r.role_id = u.role_id AND u.is_deleted = false
        LEFT JOIN ms_role_permissions rp ON r.role_id = rp.role_id
        ${whereClause}
        GROUP BY r.role_id
        ORDER BY r.role_name
      `;

      const [roles] = await sequelize.query(query, { replacements });
      return roles;
    }

    // Pagination parameters
    const page = Math.max(parseInt(filters.page, 10) || 1, 1);
    const limit = Math.max(parseInt(filters.limit, 10) || 10, 1);
    const offset = (page - 1) * limit;

    const countQuery = `
      SELECT COUNT(DISTINCT r.role_id) AS total
      FROM ms_roles r
      LEFT JOIN ms_admin_users u ON r.role_id = u.role_id AND u.is_deleted = false
      LEFT JOIN ms_role_permissions rp ON r.role_id = rp.role_id
      ${whereClause}
    `;

    const [countResult] = await sequelize.query(countQuery, { replacements });
    const total = countResult.length > 0 ? parseInt(countResult[0].total, 10) : 0;

    const dataQuery = `
      SELECT 
        r.role_id,
        r.role_name,
        r.role_code,
        r.description,
        r.is_system_role,
        r.is_active,
        r.created_at,
        r.updated_at,
        COUNT(DISTINCT u.admin_id) as user_count,
        COUNT(DISTINCT rp.permission_id) as permission_count
      FROM ms_roles r
      LEFT JOIN ms_admin_users u ON r.role_id = u.role_id AND u.is_deleted = false
      LEFT JOIN ms_role_permissions rp ON r.role_id = rp.role_id
      ${whereClause}
      GROUP BY r.role_id
      ORDER BY r.role_name
      LIMIT :limit OFFSET :offset
    `;

    const [roles] = await sequelize.query(dataQuery, {
      replacements: { ...replacements, limit, offset }
    });

    return {
      roles,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1
      }
    };
  } catch (error) {
    logger.error('Error fetching roles:', error);
    throw error;
  }
};

/**
 * Get role by ID with permissions
 * @param {number} roleId - Role ID
 * @returns {Promise<Object|null>} Role object or null
 */
const getRoleById = async (roleId) => {
  try {
    const [roles] = await sequelize.query(
      `SELECT * FROM ms_roles WHERE role_id = :roleId AND is_deleted = false`,
      { replacements: { roleId } }
    );

    if (roles.length === 0) {
      return null;
    }

    const role = roles[0];

    // Get role's permissions
    const [permissions] = await sequelize.query(
      `SELECT p.permission_id, p.permission_name, p.permission_code, p.module, p.description
       FROM ms_permissions p
       JOIN ms_role_permissions rp ON p.permission_id = rp.permission_id
       WHERE rp.role_id = :roleId AND p.is_active = true AND p.is_deleted = false
       ORDER BY p.module, p.permission_name`,
      { replacements: { roleId } }
    );

    role.permissions = permissions;
    return role;
  } catch (error) {
    logger.error('Error fetching role:', error);
    throw error;
  }
};

/**
 * Create new role
 * @param {Object} data - Role data
 * @param {number} createdBy - Admin ID creating the role
 * @returns {Promise<Object>} Created role
 */
const createRole = async (data, createdBy) => {
  try {
    const [result] = await sequelize.query(
      `INSERT INTO ms_roles (role_name, role_code, description, is_system_role, is_active, created_by, created_at, updated_at)
       VALUES (:role_name, :role_code, :description, false, true, :created_by, NOW(), NOW())
       RETURNING *`,
      {
        replacements: {
          role_name: data.role_name,
          role_code: data.role_code.toUpperCase(),
          description: data.description || null,
          created_by: createdBy
        }
      }
    );

    logger.info(`Role created: ${result[0].role_id} by ${createdBy}`);
    return result[0];
  } catch (error) {
    logger.error('Error creating role:', error);
    throw error;
  }
};

/**
 * Update role
 * @param {number} roleId - Role ID
 * @param {Object} data - Update data
 * @param {number} updatedBy - Admin ID updating the role
 * @returns {Promise<Object|null>} Updated role or null
 */
const updateRole = async (roleId, data, updatedBy) => {
  try {
    const [result] = await sequelize.query(
      `UPDATE ms_roles 
       SET role_name = COALESCE(:role_name, role_name),
           description = COALESCE(:description, description),
           is_active = COALESCE(:is_active, is_active),
           updated_by = :updated_by,
           updated_at = NOW()
       WHERE role_id = :roleId AND is_deleted = false
       RETURNING *`,
      {
        replacements: {
          roleId,
          role_name: data.role_name || null,
          description: data.description || null,
          is_active: data.is_active !== undefined ? data.is_active : null,
          updated_by: updatedBy
        }
      }
    );

    if (result.length === 0) {
      return null;
    }

    logger.info(`Role updated: ${roleId} by ${updatedBy}`);
    return result[0];
  } catch (error) {
    logger.error('Error updating role:', error);
    throw error;
  }
};

/**
 * Soft delete role
 * @param {number} roleId - Role ID
 * @param {number} deletedBy - Admin ID deleting the role
 * @returns {Promise<boolean>} Success status
 */
const deleteRole = async (roleId, deletedBy) => {
  try {
    // Check if role is system role
    const [role] = await sequelize.query(
      `SELECT is_system_role FROM ms_roles WHERE role_id = :roleId`,
      { replacements: { roleId } }
    );

    if (role.length > 0 && role[0].is_system_role) {
      throw new Error('Cannot delete system role');
    }

    const [result] = await sequelize.query(
      `UPDATE ms_roles 
       SET is_deleted = true, deleted_by = :deleted_by, deleted_at = NOW()
       WHERE role_id = :roleId AND is_deleted = false
       RETURNING role_id`,
      {
        replacements: { roleId, deleted_by: deletedBy }
      }
    );

    if (result.length === 0) {
      return false;
    }

    logger.info(`Role deleted: ${roleId} by ${deletedBy}`);
    return true;
  } catch (error) {
    logger.error('Error deleting role:', error);
    throw error;
  }
};

/**
 * Assign permissions to role
 * @param {number} roleId - Role ID
 * @param {Array<number>} permissionIds - Array of permission IDs
 * @param {number} assignedBy - Admin ID assigning permissions
 * @returns {Promise<boolean>} Success status
 */
const assignPermissionsToRole = async (roleId, permissionIds, assignedBy) => {
  try {
    // Delete existing permissions
    await sequelize.query(
      `DELETE FROM ms_role_permissions WHERE role_id = :roleId`,
      { replacements: { roleId } }
    );

    // Insert new permissions
    if (permissionIds && permissionIds.length > 0) {
      const valuesPlaceholders = permissionIds
        .map((_, idx) => `(:roleId, :permId${idx})`)
        .join(',');

      const replacements = { roleId };
      permissionIds.forEach((permId, idx) => {
        replacements[`permId${idx}`] = permId;
      });

      await sequelize.query(
        `INSERT INTO ms_role_permissions (role_id, permission_id)
         VALUES ${valuesPlaceholders}`,
        { replacements }
      );
    }

    logger.info(`Permissions assigned to role ${roleId} by ${assignedBy}`);
    return true;
  } catch (error) {
    logger.error('Error assigning permissions:', error);
    throw error;
  }
};

/**
 * Remove permission from role
 * @param {number} roleId - Role ID
 * @param {number} permissionId - Permission ID
 * @returns {Promise<boolean>} Success status
 */
const removePermissionFromRole = async (roleId, permissionId) => {
  try {
    await sequelize.query(
      `DELETE FROM ms_role_permissions WHERE role_id = :roleId AND permission_id = :permissionId`,
      { replacements: { roleId, permissionId } }
    );

    logger.info(`Permission ${permissionId} removed from role ${roleId}`);
    return true;
  } catch (error) {
    logger.error('Error removing permission:', error);
    throw error;
  }
};

// ==================== WILDCARD PERMISSION OPERATIONS ====================

/**
 * Get wildcard permissions for a role
 * @param {number} roleId - Role ID
 * @returns {Promise<Array>} List of wildcard permissions
 */
const getRoleWildcardPermissions = async (roleId) => {
  try {
    const [wildcards] = await sequelize.query(
      `SELECT id, wildcard_pattern, description, granted_at
       FROM ms_role_wildcard_permissions
       WHERE role_id = :roleId
       ORDER BY wildcard_pattern`,
      { replacements: { roleId } }
    );
    return wildcards;
  } catch (error) {
    logger.error('Error fetching wildcard permissions:', error);
    throw error;
  }
};

/**
 * Assign wildcard permission to role
 * @param {number} roleId - Role ID
 * @param {string} wildcardPattern - Wildcard pattern
 * @param {string} description - Description
 * @param {number} grantedBy - Admin ID granting the wildcard
 * @returns {Promise<Object>} Created wildcard permission
 */
const assignWildcardToRole = async (roleId, wildcardPattern, description, grantedBy) => {
  try {
    // Validate wildcard pattern
    const validPatterns = /^(\*|[a-z_]+\.\*|\*\.[a-z_]+)$/;
    if (!validPatterns.test(wildcardPattern)) {
      throw new Error(`Invalid wildcard pattern: ${wildcardPattern}. Use '*', 'module.*', or '*.action'`);
    }

    const [result] = await sequelize.query(
      `INSERT INTO ms_role_wildcard_permissions (role_id, wildcard_pattern, description, granted_by, granted_at)
       VALUES (:roleId, :wildcardPattern, :description, :grantedBy, NOW())
       ON CONFLICT (role_id, wildcard_pattern) DO UPDATE SET
         description = EXCLUDED.description,
         granted_by = EXCLUDED.granted_by,
         granted_at = NOW()
       RETURNING *`,
      {
        replacements: { roleId, wildcardPattern, description, grantedBy }
      }
    );

    logger.info(`Wildcard permission '${wildcardPattern}' assigned to role ${roleId} by ${grantedBy}`);
    return result[0];
  } catch (error) {
    logger.error('Error assigning wildcard permission:', error);
    throw error;
  }
};

/**
 * Remove wildcard permission from role
 * @param {number} roleId - Role ID
 * @param {string} wildcardPattern - Wildcard pattern
 * @returns {Promise<boolean>} Success status
 */
const removeWildcardFromRole = async (roleId, wildcardPattern) => {
  try {
    const [result] = await sequelize.query(
      `DELETE FROM ms_role_wildcard_permissions 
       WHERE role_id = :roleId AND wildcard_pattern = :wildcardPattern
       RETURNING id`,
      { replacements: { roleId, wildcardPattern } }
    );

    if (result.length === 0) {
      return false;
    }

    logger.info(`Wildcard permission '${wildcardPattern}' removed from role ${roleId}`);
    return true;
  } catch (error) {
    logger.error('Error removing wildcard permission:', error);
    throw error;
  }
};

/**
 * Get all effective permissions for a role (including expanded wildcards)
 * @param {number} roleId - Role ID
 * @returns {Promise<Object>} Direct, wildcards, and effective permissions
 */
const getRoleEffectivePermissions = async (roleId) => {
  try {
    // Get direct permissions
    const [directPermissions] = await sequelize.query(
      `SELECT p.permission_id, p.permission_code, p.permission_name, p.module, p.resource, p.action, p.description,
              false as is_wildcard
       FROM ms_permissions p
       JOIN ms_role_permissions rp ON p.permission_id = rp.permission_id
       WHERE rp.role_id = :roleId AND p.is_active = true AND p.is_deleted = false`,
      { replacements: { roleId } }
    );

    // Get wildcard permissions
    const [wildcards] = await sequelize.query(
      `SELECT wildcard_pattern FROM ms_role_wildcard_permissions WHERE role_id = :roleId`,
      { replacements: { roleId } }
    );

    // Expand wildcards to actual permissions
    const expandedPermissions = [];
    for (const wc of wildcards) {
      const pattern = wc.wildcard_pattern;
      
      if (pattern === '*') {
        const [allPerms] = await sequelize.query(
          `SELECT permission_id, permission_code, permission_name, module, resource, action, description,
                  true as is_wildcard
           FROM ms_permissions WHERE is_active = true AND is_deleted = false`
        );
        expandedPermissions.push(...allPerms);
      } else if (pattern.endsWith('.*')) {
        const module = pattern.slice(0, -2);
        const [modulePerms] = await sequelize.query(
          `SELECT permission_id, permission_code, permission_name, module, resource, action, description,
                  true as is_wildcard
           FROM ms_permissions 
           WHERE module = :module AND is_active = true AND is_deleted = false`,
          { replacements: { module } }
        );
        expandedPermissions.push(...modulePerms);
      } else if (pattern.startsWith('*.')) {
        const action = pattern.slice(2);
        const [actionPerms] = await sequelize.query(
          `SELECT permission_id, permission_code, permission_name, module, resource, action, description,
                  true as is_wildcard
           FROM ms_permissions 
           WHERE action = :action AND is_active = true AND is_deleted = false`,
          { replacements: { action } }
        );
        expandedPermissions.push(...actionPerms);
      }
    }

    // Merge and deduplicate
    const allPermissions = [...directPermissions, ...expandedPermissions];
    const uniquePermissions = allPermissions.reduce((acc, perm) => {
      if (!acc.find(p => p.permission_code === perm.permission_code)) {
        acc.push(perm);
      }
      return acc;
    }, []);

    return {
      direct: directPermissions,
      wildcards: wildcards.map(w => w.wildcard_pattern),
      effective: uniquePermissions.sort((a, b) => a.permission_code.localeCompare(b.permission_code))
    };
  } catch (error) {
    logger.error('Error fetching effective permissions:', error);
    throw error;
  }
};

module.exports = {
  getAllRoles,
  getRoleById,
  createRole,
  updateRole,
  deleteRole,
  assignPermissionsToRole,
  removePermissionFromRole,
  getRoleWildcardPermissions,
  assignWildcardToRole,
  removeWildcardFromRole,
  getRoleEffectivePermissions
};
