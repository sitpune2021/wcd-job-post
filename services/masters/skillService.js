const db = require('../../models');
const { SkillMaster, sequelize } = db;
const logger = require('../../config/logger');
const { paginatedQuery } = require('../../utils/pagination');
const { localizeField } = require('./helpers');
const { Op } = require('sequelize');

const transformSkill = (language = 'en') => (s) => ({
  skill_id: s.skill_id,
  skill_name: localizeField(s, 'skill_name', language),
  skill_name_en: s.skill_name,
  skill_name_mr: s.skill_name_mr,
  description: localizeField(s, 'description', language),
  description_en: s.description,
  description_mr: s.description_mr,
  is_active: s.is_active,
  created_at: s.created_at,
  updated_at: s.updated_at
});

const getSkills = async (query = {}) => {
  try {
    const language = query.lang || 'en';
    const includeInactive = query.include_inactive === 'true';

    const baseWhere = {};
    if (!includeInactive) {
      baseWhere.is_active = true;
    }

    return await paginatedQuery(SkillMaster, {
      query,
      searchFields: ['skill_name', 'skill_name_mr', 'description', 'description_mr'],
      filterConfig: {
        is_active: { field: 'is_active', type: 'boolean' }
      },
      baseWhere,
      order: [['skill_id', 'DESC']],
      dataKey: 'skills',
      transform: transformSkill(language)
    });
  } catch (error) {
    logger.error('Error fetching skills:', error);
    throw error;
  }
};

const getSkillById = async (skillId, language = 'en') => {
  try {
    const skill = await SkillMaster.findByPk(skillId);
    if (!skill) return null;
    return transformSkill(language)(skill);
  } catch (error) {
    logger.error('Error fetching skill:', error);
    throw error;
  }
};

const createSkill = async (data, userId) => {
  try {
    const existing = await SkillMaster.scope('withDeleted').findOne({
      where: {
        [Op.and]: [
          sequelize.where(
            sequelize.fn('LOWER', sequelize.col('skill_name')),
            sequelize.fn('LOWER', data.skill_name)
          )
        ]
      }
    });

    if (existing) {
      if (existing.is_deleted) {
        await existing.update({
          skill_name: data.skill_name,
          skill_name_mr: data.skill_name_mr || null,
          description: data.description || null,
          description_mr: data.description_mr || null,
          is_active: data.is_active !== undefined ? data.is_active : true,
          is_deleted: false,
          deleted_by: null,
          deleted_at: null,
          updated_by: userId,
          updated_at: new Date()
        });

        logger.info(`Skill restored: ${existing.skill_id} by user ${userId}`);
        return existing;
      }

      const error = new Error('Skill with this name already exists');
      error.statusCode = 400;
      throw error;
    }

    const skill = await SkillMaster.create({
      skill_name: data.skill_name,
      skill_name_mr: data.skill_name_mr || null,
      description: data.description || null,
      description_mr: data.description_mr || null,
      is_active: data.is_active !== undefined ? data.is_active : true,
      created_by: userId
    });

    logger.info(`Skill created: ${skill.skill_id} by user ${userId}`);
    return skill;
  } catch (error) {
    logger.error('Error creating skill:', error);
    throw error;
  }
};

const updateSkill = async (skillId, data, userId) => {
  try {
    const skill = await SkillMaster.findByPk(skillId);
    if (!skill) return null;

    if (data.skill_name !== undefined) {
      const existing = await SkillMaster.scope('withDeleted').findOne({
        where: {
          [Op.and]: [
            sequelize.where(
              sequelize.fn('LOWER', sequelize.col('skill_name')),
              sequelize.fn('LOWER', data.skill_name)
            ),
            { skill_id: { [Op.ne]: skillId } }
          ]
        }
      });

      if (existing) {
        const error = new Error(existing.is_deleted
          ? 'Skill name is used by a deleted record. Restore it instead of creating/updating.'
          : 'Skill with this name already exists');
        error.statusCode = 400;
        throw error;
      }
    }

    const updateData = { updated_by: userId, updated_at: new Date() };
    if (data.skill_name !== undefined) updateData.skill_name = data.skill_name;
    if (data.skill_name_mr !== undefined) updateData.skill_name_mr = data.skill_name_mr;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.description_mr !== undefined) updateData.description_mr = data.description_mr;
    if (data.is_active !== undefined) updateData.is_active = data.is_active;

    await skill.update(updateData);

    logger.info(`Skill updated: ${skillId} by user ${userId}`);
    return skill;
  } catch (error) {
    logger.error('Error updating skill:', error);
    throw error;
  }
};

const deleteSkill = async (skillId, userId) => {
  try {
    const skill = await SkillMaster.findByPk(skillId);
    if (!skill) return false;

    await skill.update({
      is_deleted: true,
      is_active: false,
      deleted_by: userId,
      deleted_at: new Date()
    });

    logger.info(`Skill deleted: ${skillId} by user ${userId}`);
    return true;
  } catch (error) {
    logger.error('Error deleting skill:', error);
    throw error;
  }
};

module.exports = {
  getSkills,
  getSkillById,
  createSkill,
  updateSkill,
  deleteSkill
};
