// ============================================================================
// RBAC PERMISSION SERVICE
// ============================================================================
// Purpose: Permission management operations
// Table: ms_permissions
// ============================================================================

const { sequelize } = require('../../config/db');
const logger = require('../../config/logger');

// ==================== PERMISSION CRUD OPERATIONS ====================

/**
 * Get all permissions (grouped by module)
 * @returns {Promise<Object>} Permissions grouped by module
 */
const getAllPermissions = async () => {
  try {
    const [permissions] = await sequelize.query(
      `SELECT * FROM ms_permissions WHERE is_deleted = false AND is_active = true
       ORDER BY module, permission_name`
    );

    // Group by module
    const grouped = permissions.reduce((acc, perm) => {
      if (!acc[perm.module]) {
        acc[perm.module] = [];
      }
      acc[perm.module].push(perm);
      return acc;
    }, {});

    return grouped;
  } catch (error) {
    logger.error('Error fetching permissions:', error);
    throw error;
  }
};

/**
 * Get permission by ID
 * @param {number} permissionId - Permission ID
 * @returns {Promise<Object|null>} Permission object or null
 */
const getPermissionById = async (permissionId) => {
  try {
    const [permissions] = await sequelize.query(
      `SELECT * FROM ms_permissions WHERE permission_id = :permissionId AND is_deleted = false`,
      { replacements: { permissionId } }
    );

    return permissions.length > 0 ? permissions[0] : null;
  } catch (error) {
    logger.error('Error fetching permission:', error);
    throw error;
  }
};

/**
 * Create new permission
 * @param {Object} data - Permission data
 * @param {number} createdBy - Admin ID creating the permission
 * @returns {Promise<Object>} Created permission
 */
const createPermission = async (data, createdBy) => {
  try {
    const [result] = await sequelize.query(
      `INSERT INTO ms_permissions (permission_name, permission_code, description, module, is_active, created_by, created_at)
       VALUES (:permission_name, :permission_code, :description, :module, true, :created_by, NOW())
       RETURNING *`,
      {
        replacements: {
          permission_name: data.permission_name,
          permission_code: data.permission_code,
          description: data.description || null,
          module: data.module,
          created_by: createdBy
        }
      }
    );

    logger.info(`Permission created: ${result[0].permission_id} by ${createdBy}`);
    return result[0];
  } catch (error) {
    logger.error('Error creating permission:', error);
    throw error;
  }
};

/**
 * Update permission
 * @param {number} permissionId - Permission ID
 * @param {Object} data - Update data
 * @param {number} updatedBy - Admin ID updating the permission
 * @returns {Promise<Object|null>} Updated permission or null
 */
const updatePermission = async (permissionId, data, updatedBy) => {
  try {
    const [result] = await sequelize.query(
      `UPDATE ms_permissions 
       SET permission_name = COALESCE(:permission_name, permission_name),
           description = COALESCE(:description, description),
           is_active = COALESCE(:is_active, is_active),
           updated_by = :updated_by,
           updated_at = NOW()
       WHERE permission_id = :permissionId AND is_deleted = false
       RETURNING *`,
      {
        replacements: {
          permissionId,
          permission_name: data.permission_name || null,
          description: data.description || null,
          is_active: data.is_active !== undefined ? data.is_active : null,
          updated_by: updatedBy
        }
      }
    );

    if (result.length === 0) {
      return null;
    }

    logger.info(`Permission updated: ${permissionId} by ${updatedBy}`);
    return result[0];
  } catch (error) {
    logger.error('Error updating permission:', error);
    throw error;
  }
};

/**
 * Soft delete permission
 * @param {number} permissionId - Permission ID
 * @param {number} deletedBy - Admin ID deleting the permission
 * @returns {Promise<boolean>} Success status
 */
const deletePermission = async (permissionId, deletedBy) => {
  try {
    const [result] = await sequelize.query(
      `UPDATE ms_permissions 
       SET is_deleted = true, deleted_by = :deleted_by, deleted_at = NOW()
       WHERE permission_id = :permissionId AND is_deleted = false
       RETURNING permission_id`,
      {
        replacements: { permissionId, deleted_by: deletedBy }
      }
    );

    if (result.length === 0) {
      return false;
    }

    logger.info(`Permission deleted: ${permissionId} by ${deletedBy}`);
    return true;
  } catch (error) {
    logger.error('Error deleting permission:', error);
    throw error;
  }
};

/**
 * Sync permissions from registry to database
 * @returns {Promise<Object>} Sync result
 */
const syncPermissionsFromRegistry = async () => {
  try {
    const { syncToDatabase } = require('../../utils/permissionRegistry');
    const result = await syncToDatabase(sequelize);
    logger.info('Permissions synced from registry:', result);
    return result;
  } catch (error) {
    logger.error('Error syncing permissions from registry:', error);
    throw error;
  }
};

/**
 * Get available wildcard patterns
 * @returns {Promise<Array>} List of available wildcard patterns
 */
const getAvailableWildcardPatterns = async () => {
  try {
    // Get all modules
    const [modules] = await sequelize.query(
      `SELECT DISTINCT module FROM ms_permissions WHERE is_active = true AND is_deleted = false ORDER BY module`
    );

    // Get all actions
    const [actions] = await sequelize.query(
      `SELECT DISTINCT action FROM ms_permissions WHERE action IS NOT NULL AND is_active = true AND is_deleted = false ORDER BY action`
    );

    const patterns = [
      { pattern: '*', description: 'Full access - all permissions', type: 'full' }
    ];

    // Module wildcards
    modules.forEach(m => {
      patterns.push({
        pattern: `${m.module}.*`,
        description: `All ${m.module} permissions`,
        type: 'module'
      });
    });

    // Action wildcards
    actions.forEach(a => {
      if (a.action) {
        patterns.push({
          pattern: `*.${a.action}`,
          description: `${a.action} permission on all modules`,
          type: 'action'
        });
      }
    });

    return patterns;
  } catch (error) {
    logger.error('Error fetching available wildcard patterns:', error);
    throw error;
  }
};

module.exports = {
  getAllPermissions,
  getPermissionById,
  createPermission,
  updatePermission,
  deletePermission,
  syncPermissionsFromRegistry,
  getAvailableWildcardPatterns
};
