const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const ExperienceDomain = sequelize.define('ExperienceDomain', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    doc_type_id: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    domain_code: {
      type: DataTypes.STRING(30),
      allowNull: false,
      unique: true
    },
    domain_name: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    domain_name_mr: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    description_mr: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    display_order: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    is_deleted: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    deleted_by: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    deleted_at: {
      type: DataTypes.DATE,
      allowNull: true
    }
  }, {
    tableName: 'ms_experience_domains',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    defaultScope: {
      where: { is_deleted: false }
    },
    scopes: {
      withDeleted: {},
      onlyActive: {
        where: { is_deleted: false, is_active: true }
      }
    }
  });

  // Backward-compatible alias used across services/routes
  ExperienceDomain.prototype.toJSON = function () {
    const values = Object.assign({}, this.get());
    values.domain_id = values.id;
    return values;
  };

  return ExperienceDomain;
};
