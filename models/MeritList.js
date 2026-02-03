const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

const MeritList = sequelize.define('MeritList', {
  merit_id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  application_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'applications',
      key: 'application_id'
    }
  },
  post_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'post_master',
      key: 'post_id'
    }
  },
  district_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'district_master',
      key: 'district_id'
    }
  },
  score: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true,
    comment: 'Total composite score for ranking'
  },
  rank: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  category_rank: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  education_score: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true,
    comment: 'Score based on education level display_order'
  },
  marks_score: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true,
    comment: 'Score based on percentage/marks'
  },
  experience_score: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true,
    comment: 'Score based on total experience months'
  },
  age_score: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true,
    comment: 'Score based on age (younger preferred)'
  },
  local_preference_score: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true,
    comment: 'Score for local candidate preference'
  },
  is_local_candidate: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: 'Whether permanent_district matches post district'
  },
  selection_status: {
    type: DataTypes.STRING(30),
    defaultValue: 'PENDING',
    comment: 'PENDING, SELECTED, REJECTED, SELECTED_IN_OTHER_POST'
  },
  generated_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  generated_by: {
    type: DataTypes.INTEGER,
    allowNull: true
  }
}, {
  tableName: 'ms_merit_lists',
  timestamps: false
});

module.exports = MeritList;
