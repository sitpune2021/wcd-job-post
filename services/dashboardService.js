const db = require('../models');
const { Op } = require('sequelize');
const logger = require('../config/logger');

class DashboardService {
  /**
   * Get aggregated counts of posts and applications grouped by district.
   */
  async getSummaryByDistrict() {
    try {
      // 1. Get all active districts
      const districts = await db.DistrictMaster.findAll({
        where: { is_deleted: false, is_active: true },
        attributes: ['district_id', 'district_name'],
        order: [['district_name', 'ASC']],
        raw: true
      });

      // 2. Get post counts grouped by district
      const postCounts = await db.PostMaster.findAll({
        where: { is_deleted: false, is_active: true },
        attributes: [
          'district_id',
          [db.sequelize.fn('COUNT', db.sequelize.col('post_id')), 'count']
        ],
        group: ['district_id'],
        raw: true
      });

      // 3. Get application counts grouped by district
      const appCounts = await db.Application.findAll({
        where: { is_deleted: false },
        attributes: [
          'district_id',
          [db.sequelize.fn('COUNT', db.sequelize.col('application_id')), 'count']
        ],
        group: ['district_id'],
        raw: true
      });

      // 4. Merge data
      const summary = districts.map(district => {
        const pCount = postCounts.find(p => p.district_id === district.district_id);
        const aCount = appCounts.find(a => a.district_id === district.district_id);
        
        return {
          district_id: district.district_id,
          district_name: district.district_name,
          post_count: pCount ? parseInt(pCount.count) : 0,
          application_count: aCount ? parseInt(aCount.count) : 0
        };
      });

      return summary;
    } catch (error) {
      logger.error('Error fetching dashboard summary by district:', error);
      throw error;
    }
  }
}

module.exports = new DashboardService();
