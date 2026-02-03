// ============================================================================
// DEPARTMENT SERVICE
// ============================================================================
// Purpose: CRUD operations for department master data
// Table: ms_departments
// ============================================================================

const db = require('../../models');
const { Department, sequelize } = db;
const logger = require('../../config/logger');
const { paginatedQuery } = require('../../utils/pagination');
const { localizeField } = require('./helpers');
const { Op } = require('sequelize');

const transformDepartment = (language = 'en') => (dept) => ({
  department_id: dept.department_id,
  department_code: dept.department_code,
  department_name: localizeField(dept, 'department_name', language),
  department_name_en: dept.department_name,
  department_name_mr: dept.department_name_mr,
  description: dept.description,
  description_mr: dept.description_mr,
  is_active: dept.is_active,
  created_at: dept.created_at,
  updated_at: dept.updated_at
});

const getDepartments = async (query = {}) => {
  try {
    const language = query.lang || 'en';
    const includeInactive = query.include_inactive === 'true';

    const baseWhere = {};
    if (!includeInactive) {
      baseWhere.is_active = true;
    }

    return await paginatedQuery(Department, {
      query,
      searchFields: ['department_name', 'department_name_mr', 'department_code', 'description'],
      filterConfig: {
        is_active: { field: 'is_active', type: 'boolean' }
      },
      baseWhere,
      order: [['department_id', 'DESC']],
      dataKey: 'departments',
      transform: transformDepartment(language)
    });
  } catch (error) {
    logger.error('Error fetching departments:', error);
    throw error;
  }
};

const getDepartmentById = async (departmentId, language = 'en') => {
  try {
    const department = await Department.findByPk(departmentId);

    if (!department) {
      return null;
    }

    return transformDepartment(language)(department);
  } catch (error) {
    logger.error('Error fetching department:', error);
    throw error;
  }
};

const createDepartment = async (data, userId) => {
  try {
    const existing = await Department.scope('withDeleted').findOne({
      where: sequelize.where(
        sequelize.fn('LOWER', sequelize.col('department_code')),
        sequelize.fn('LOWER', data.department_code)
      )
    });

    if (existing) {
      if (existing.is_deleted) {
        await existing.update({
          department_code: data.department_code,
          department_name: data.department_name,
          department_name_mr: data.department_name_mr || null,
          description: data.description || null,
          description_mr: data.description_mr || null,
          is_active: data.is_active !== undefined ? data.is_active : true,
          is_deleted: false,
          deleted_by: null,
          deleted_at: null,
          updated_by: userId,
          updated_at: new Date()
        });

        logger.info(`Department restored: ${existing.department_id} by user ${userId}`);
        return existing;
      }

      const error = new Error('Department with this code already exists');
      error.statusCode = 400;
      throw error;
    }

    const department = await Department.create({
      department_code: data.department_code,
      department_name: data.department_name,
      department_name_mr: data.department_name_mr || null,
      description: data.description || null,
      description_mr: data.description_mr || null,
      is_active: data.is_active !== undefined ? data.is_active : true,
      created_by: userId
    });

    logger.info(`Department created: ${department.department_id} by user ${userId}`);
    return department;
  } catch (error) {
    logger.error('Error creating department:', error);
    throw error;
  }
};

const updateDepartment = async (departmentId, data, userId) => {
  try {
    const department = await Department.findByPk(departmentId);

    if (!department) {
      return null;
    }

    if (data.department_code !== undefined) {
      const existing = await Department.scope('withDeleted').findOne({
        where: {
          [Op.and]: [
            sequelize.where(
              sequelize.fn('LOWER', sequelize.col('department_code')),
              sequelize.fn('LOWER', data.department_code)
            ),
            { department_id: { [Op.ne]: departmentId } }
          ]
        }
      });

      if (existing) {
        const error = new Error(existing.is_deleted
          ? 'Department code is used by a deleted record. Restore it instead of creating/updating.'
          : 'Department with this code already exists');
        error.statusCode = 400;
        throw error;
      }
    }

    const updateData = { updated_by: userId, updated_at: new Date() };
    if (data.department_code !== undefined) updateData.department_code = data.department_code;
    if (data.department_name !== undefined) updateData.department_name = data.department_name;
    if (data.department_name_mr !== undefined) updateData.department_name_mr = data.department_name_mr;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.description_mr !== undefined) updateData.description_mr = data.description_mr;
    if (data.is_active !== undefined) updateData.is_active = data.is_active;

    await department.update(updateData);

    logger.info(`Department updated: ${departmentId} by user ${userId}`);
    return department;
  } catch (error) {
    logger.error('Error updating department:', error);
    throw error;
  }
};

const deleteDepartment = async (departmentId, userId) => {
  try {
    const department = await Department.findByPk(departmentId);

    if (!department) {
      return false;
    }

    await department.update({
      is_deleted: true,
      is_active: false,
      deleted_by: userId,
      deleted_at: new Date()
    });

    logger.info(`Department deleted: ${departmentId} by user ${userId}`);
    return true;
  } catch (error) {
    logger.error('Error deleting department:', error);
    throw error;
  }
};

module.exports = {
  getDepartments,
  getDepartmentById,
  createDepartment,
  updateDepartment,
  deleteDepartment
};
