const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const RejectionReason = sequelize.define('RejectionReason', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    reason_code: {
      type: DataTypes.STRING(30),
      allowNull: false,
      unique: true
    },
    reason_text: {
      type: DataTypes.STRING(200),
      allowNull: false
    },
    reason_text_mr: {
      type: DataTypes.STRING(200),
      allowNull: true
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    category: {
      type: DataTypes.STRING(50),
      allowNull: true,
      comment: 'EDUCATION, EXPERIENCE, DOCUMENT, AGE, GENDER, RESIDENCY, OTHER'
    },
    display_order: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    }
  }, {
    tableName: 'ms_rejection_reasons',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    defaultScope: {
      where: { is_active: true },
      order: [['display_order', 'ASC']]
    },
    scopes: {
      all: {},
      active: {
        where: { is_active: true }
      },
      byCategory: (category) => ({
        where: { category, is_active: true }
      })
    }
  });

  // Class methods
  RejectionReason.getByCategory = async function(category) {
    return this.findAll({
      where: { category, is_active: true },
      order: [['display_order', 'ASC']]
    });
  };

  return RejectionReason;
};
