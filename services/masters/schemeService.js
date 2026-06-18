const { Scheme, SchemeType, DistrictMaster } = require('../../models');
const { Op } = require('sequelize');
const logger = require('../../config/logger');
const { paginatedQuery } = require('../../utils/pagination');

class SchemeService {
  async getAllSchemes(query = {}) {
    try {
      const includeInactive = query.include_inactive === 'true';
      
      const baseWhere = { is_deleted: false };
      if (!includeInactive) {
        baseWhere.is_active = true;
      }

      return await paginatedQuery(Scheme, {
        query,
        searchFields: ['scheme_code', 'scheme_name', 'scheme_name_mr'],
        filterConfig: {
          scheme_type_id: { field: 'scheme_type_id', type: 'number' },
          district_id: { field: 'district_id', type: 'number' },
          is_active: { field: 'is_active', type: 'boolean' }
        },
        baseWhere,
        include: [
          { 
            model: SchemeType, 
            as: 'schemeType', 
            attributes: ['scheme_type_id', 'scheme_code', 'scheme_name'],
            where: { is_deleted: false },
            required: true
          },
          { 
            model: DistrictMaster, 
            as: 'district', 
            attributes: ['district_id', 'district_name'],
            required: false
          }
        ],
        order: [['scheme_id', 'DESC']],
        dataKey: 'schemes'
      });
    } catch (error) {
      logger.error('Error in SchemeService.getAllSchemes:', error);
      throw error;
    }
  }

  async getSchemeById(schemeId, language = 'en') {
    try {
      const scheme = await Scheme.findOne({
        where: { scheme_id: schemeId, is_deleted: false },
        include: [
          { 
            model: SchemeType, 
            as: 'schemeType',
            where: { is_deleted: false },
            required: true
          },
          { 
            model: DistrictMaster, 
            as: 'district',
            required: false
          }
        ]
      });

      if (!scheme) {
        return null;
      }

      return scheme;
    } catch (error) {
      logger.error('Error in SchemeService.getSchemeById:', error);
      throw error;
    }
  }

  async createScheme(data, admin_id) {
    try {
      // Validate scheme_code uniqueness
      const existingScheme = await Scheme.findOne({
        where: { 
          scheme_code: data.scheme_code,
          is_deleted: false 
        }
      });

      if (existingScheme) {
        throw new Error('Scheme code already exists');
      }

      const scheme = await Scheme.create({
        ...data,
        created_by: admin_id,
        updated_by: admin_id
      });

      // Return the created scheme with associations
      return await this.getSchemeById(scheme.scheme_id);
    } catch (error) {
      logger.error('Error in SchemeService.createScheme:', error);
      throw error;
    }
  }

  async updateScheme(schemeId, data, admin_id) {
    try {
      const scheme = await Scheme.findByPk(schemeId);
      
      if (!scheme || scheme.is_deleted) {
        return null;
      }

      // If scheme_code is being updated, check uniqueness
      if (data.scheme_code && data.scheme_code !== scheme.scheme_code) {
        const existingScheme = await Scheme.findOne({
          where: { 
            scheme_code: data.scheme_code,
            is_deleted: false,
            scheme_id: { [Op.ne]: schemeId }
          }
        });

        if (existingScheme) {
          throw new Error('Scheme code already exists');
        }
      }

      await scheme.update({
        ...data,
        updated_by: admin_id
      });

      // Return the updated scheme with associations
      return await this.getSchemeById(schemeId);
    } catch (error) {
      logger.error('Error in SchemeService.updateScheme:', error);
      throw error;
    }
  }

  async deleteScheme(schemeId, admin_id) {
    try {
      const scheme = await Scheme.findByPk(schemeId);
      
      if (!scheme || scheme.is_deleted) {
        return false;
      }

      await scheme.update({
        is_active: false,
        is_deleted: true,
        deleted_by: admin_id,
        deleted_at: new Date(),
        updated_by: admin_id
      });

      return true;
    } catch (error) {
      logger.error('Error in SchemeService.deleteScheme:', error);
      throw error;
    }
  }

  async getSchemesByType(scheme_type_code) {
    try {
      const schemes = await Scheme.findAll({
        where: { is_deleted: false },
        include: [
          { 
            model: SchemeType, 
            as: 'schemeType',
            where: { 
              scheme_code: scheme_type_code,
              is_deleted: false 
            },
            required: true
          },
          { 
            model: DistrictMaster, 
            as: 'district',
            required: false
          }
        ],
        order: [['scheme_id', 'DESC']]
      });

      return schemes;
    } catch (error) {
      logger.error('Error in SchemeService.getSchemesByType:', error);
      throw error;
    }
  }

  async getSchemeOptions(scheme_type_code = null) {
    try {
      const where = { is_deleted: false, is_active: true };
      
      let include = [
        { 
          model: SchemeType, 
          as: 'schemeType',
          where: { is_deleted: false },
          required: true
        }
      ];

      if (scheme_type_code) {
        include[0].where.scheme_code = scheme_type_code;
      }

      const schemes = await Scheme.findAll({
        where,
        include,
        attributes: ['scheme_id', 'scheme_code', 'scheme_name'],
        order: [['scheme_id', 'DESC']]
      });

      return schemes.map(scheme => ({
        value: scheme.scheme_id,
        label: `${scheme.scheme_name} (${scheme.scheme_code})`,
        scheme_code: scheme.scheme_code,
        scheme_type: scheme.schemeType.scheme_code
      }));
    } catch (error) {
      logger.error('Error in SchemeService.getSchemeOptions:', error);
      throw error;
    }
  }

  async validateSchemeCode(scheme_code, exclude_id = null) {
    try {
      const where = { 
        scheme_code,
        is_deleted: false 
      };
      
      if (exclude_id) {
        where.scheme_id = { [Op.ne]: exclude_id };
      }

      const existing = await Scheme.findOne({ where });
      return !existing; // Returns true if valid (not found)
    } catch (error) {
      logger.error('Error in SchemeService.validateSchemeCode:', error);
      throw error;
    }
  }
}

module.exports = new SchemeService();
