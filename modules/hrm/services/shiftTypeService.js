const { ShiftType } = require('../models');
const db = require('../../../config/db');
const logger = require('../../../config/logger');

/**
 * Get all active shift types
 */
const getShiftTypes = async () => {
  try {
    const shiftTypes = await ShiftType.findAll({
      where: { is_active: true },
      order: [['sort_order', 'ASC'], ['shift_name', 'ASC']],
      attributes: ['shift_type_id', 'shift_name', 'shift_code', 'description']
    });
    
    return shiftTypes;
  } catch (error) {
    logger.error('Error fetching shift types:', error);
    throw error;
  }
};

/**
 * Get shift type by ID
 */
const getShiftTypeById = async (shiftTypeId) => {
  try {
    const shiftType = await ShiftType.findOne({
      where: { 
        shift_type_id: shiftTypeId, 
        is_active: true 
      },
      attributes: ['shift_type_id', 'shift_name', 'shift_code', 'description']
    });
    
    return shiftType;
  } catch (error) {
    logger.error('Error fetching shift type by ID:', error);
    throw error;
  }
};

/**
 * Create new shift type (admin function)
 */
const createShiftType = async (adminUser, shiftData) => {
  const { shift_name, shift_code, description, start_time, end_time, sort_order } = shiftData;
  
  const transaction = await db.sequelize.transaction();
  
  try {
    // Check if shift name or code already exists
    const existingShift = await ShiftType.findOne({
      where: {
        [db.Sequelize.Op.or]: [
          { shift_name },
          { shift_code }
        ]
      },
      transaction
    });
    
    if (existingShift) {
      throw new Error('Shift type with this name or code already exists');
    }
    
    const newShiftType = await ShiftType.create({
      shift_name,
      shift_code: shift_code.toUpperCase(),
      description,
      start_time,
      end_time,
      sort_order: sort_order || 0,
      created_by: adminUser.admin_id,
      updated_by: adminUser.admin_id
    }, { transaction });
    
    await transaction.commit();
    
    logger.info(`Shift type created: ${shift_name} by admin ${adminUser.admin_id}`);
    
    return newShiftType;
  } catch (error) {
    await transaction.rollback();
    logger.error('Error creating shift type:', error);
    throw error;
  }
};

/**
 * Update shift type (admin function)
 */
const updateShiftType = async (adminUser, shiftTypeId, shiftData) => {
  const { shift_name, shift_code, description, start_time, end_time, sort_order, is_active } = shiftData;
  
  const transaction = await db.sequelize.transaction();
  
  try {
    const shiftType = await ShiftType.findByPk(shiftTypeId, { transaction });
    
    if (!shiftType) {
      throw new Error('Shift type not found');
    }
    
    // Check if shift name or code already exists (excluding current record)
    const existingShift = await ShiftType.findOne({
      where: {
        [db.Sequelize.Op.or]: [
          { shift_name },
          { shift_code }
        ],
        shift_type_id: { [db.Sequelize.Op.ne]: shiftTypeId }
      },
      transaction
    });
    
    if (existingShift) {
      throw new Error('Shift type with this name or code already exists');
    }
    
    await shiftType.update({
      shift_name,
      shift_code: shift_code ? shift_code.toUpperCase() : shiftType.shift_code,
      description,
      start_time,
      end_time,
      sort_order: sort_order || shiftType.sort_order,
      is_active: is_active !== undefined ? is_active : shiftType.is_active,
      updated_by: adminUser.admin_id
    }, { transaction });
    
    await transaction.commit();
    
    logger.info(`Shift type updated: ${shift_name} by admin ${adminUser.admin_id}`);
    
    return shiftType;
  } catch (error) {
    await transaction.rollback();
    logger.error('Error updating shift type:', error);
    throw error;
  }
};

/**
 * Delete/deactivate shift type (admin function)
 */
const deleteShiftType = async (adminUser, shiftTypeId) => {
  const transaction = await db.sequelize.transaction();
  
  try {
    const shiftType = await ShiftType.findByPk(shiftTypeId, { transaction });
    
    if (!shiftType) {
      throw new Error('Shift type not found');
    }
    
    // Soft delete by deactivating
    await shiftType.update({
      is_active: false,
      updated_by: adminUser.admin_id
    }, { transaction });
    
    await transaction.commit();
    
    logger.info(`Shift type deactivated: ${shiftType.shift_name} by admin ${adminUser.admin_id}`);
    
    return { success: true, message: 'Shift type deactivated successfully' };
  } catch (error) {
    await transaction.rollback();
    logger.error('Error deactivating shift type:', error);
    throw error;
  }
};

module.exports = {
  getShiftTypes,
  getShiftTypeById,
  createShiftType,
  updateShiftType,
  deleteShiftType
};
