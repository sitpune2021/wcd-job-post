const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const PostMaster = sequelize.define('PostMaster', {
  post_id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  post_name: {
    type: DataTypes.STRING(100),
    allowNull: false
  },
  post_name_mr: {
    type: DataTypes.STRING(200),
    allowNull: true,
    comment: 'Post name in Marathi'
  },
  min_qualification: {
    type: DataTypes.STRING(50),
    allowNull: true
  },
  min_experience_months: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  district_specific: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  component_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'components',
      key: 'component_id'
    }
  },
  hub_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'ms_hub_master',
      key: 'hub_id'
    },
    comment: 'Linked hub for the post'
  },
  district_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'ms_district_master',
      key: 'district_id'
    },
    comment: 'District for district-specific posts (null for state-level posts)'
  },
  post_code: {
    type: DataTypes.STRING(50),
    allowNull: true,
    unique: true
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  description_mr: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Post description in Marathi'
  },
  eligibility_criteria: {
    type: DataTypes.JSONB,
    allowNull: true,
    comment: 'JSON structure for eligibility rules'
  },
  required_domains: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  required_stream_group: {
    type: DataTypes.STRING(50),
    allowNull: true
  },
  min_experience_years: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  min_education_level_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'education_levels',
      key: 'level_id'
    },
    comment: 'Minimum education level required for the post'
  },
  max_education_level_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'education_levels',
      key: 'level_id'
    },
    comment: 'Maximum education level allowed for the post'
  },
  experience_domain_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'ms_experience_domains',
      key: 'id'
    }
  },
  min_age: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  max_age: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  female_only: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  male_only: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  local_resident_required: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  local_resident_preferred: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  counselling_experience_required: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  computer_proficiency_required: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  education_text: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  experience_text: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  remarks: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  display_order: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  opening_date: {
    type: DataTypes.DATEONLY,
    allowNull: true,
    comment: 'Post opening date for applications'
  },
  closing_date: {
    type: DataTypes.DATEONLY,
    allowNull: true,
    comment: 'Post closing date for applications'
  },
  total_positions: {
    type: DataTypes.INTEGER,
    defaultValue: 1,
    comment: 'Total number of positions available'
  },
  filled_positions: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: 'Number of positions filled'
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  is_state_level: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  is_deleted: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  is_closed: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: 'Whether post is closed (by cron or manually)'
  },
  closed_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  closed_by: {
    type: DataTypes.STRING(50),
    allowNull: true,
    comment: 'CRON_JOB or admin username'
  },
  deleted_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  deleted_by: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  created_by: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  updated_by: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  updated_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'ms_post_master',
  timestamps: false,
  hooks: {
    beforeUpdate: (post) => {
      // If closing_date is changed to a future date, reopen the post
      if (post.changed('closing_date') && post.closing_date) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const closingDate = new Date(post.closing_date);
        
        // If new closing date is in the future, reopen the post
        if (closingDate >= today) {
          post.is_closed = false;
          post.is_active = true;
          post.closed_at = null;
          post.closed_by = null;
        }
      }
    }
  }
});

PostMaster.prototype.getRequiredDomainsArray = function() {
  if (!this.required_domains) return [];
  return this.required_domains.split(',').map(domain => domain.trim());
};

module.exports = PostMaster;
