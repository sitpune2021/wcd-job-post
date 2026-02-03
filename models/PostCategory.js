const { DataTypes } = require('sequelize');
const sequelize = require('../config/db');

/**
 * Post Category Junction Model
 * Links posts to allowed categories (many-to-many relationship)
 * A post can be open to multiple categories
 * An applicant's category must match one of the post's allowed categories
 */
const PostCategory = sequelize.define('PostCategory', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  post_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'post_master',
      key: 'post_id'
    },
    comment: 'Reference to post_master'
  },
  category_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'category_master',
      key: 'category_id'
    },
    comment: 'Reference to category_master'
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
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
  tableName: 'ms_post_categories',
  timestamps: false,
  indexes: [
    {
      unique: true,
      fields: ['post_id', 'category_id']
    }
  ]
});

module.exports = PostCategory;
