module.exports = (sequelize, DataTypes) => {
  const Scheme = sequelize.define('Scheme', {
    scheme_id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    scheme_code: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: true
    },
    scheme_name: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    scheme_name_mr: DataTypes.STRING(255),
    scheme_type_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'ms_scheme_types',
        key: 'scheme_type_id'
      }
    },
    description: DataTypes.TEXT,
    description_mr: DataTypes.TEXT,
    district_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'ms_district_master',
        key: 'district_id'
      }
    },
    latitude: {
      type: DataTypes.DECIMAL(10,8),
      allowNull: true
    },
    longitude: {
      type: DataTypes.DECIMAL(11,8),
      allowNull: true
    },
    geofence_radius_meters: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 100
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
    },
    is_deleted: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    deleted_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'ms_admin_users',
        key: 'admin_id'
      }
    },
    deleted_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    created_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'ms_admin_users',
        key: 'admin_id'
      }
    },
    updated_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'ms_admin_users',
        key: 'admin_id'
      }
    }
  }, {
    tableName: 'ms_schemes',
    timestamps: true,
    underscored: true,
    paranoid: false,
    indexes: [
      {
        fields: ['scheme_type_id']
      },
      {
        fields: ['district_id']
      },
      {
        fields: ['is_deleted']
      },
      {
        fields: ['is_active']
      },
      {
        fields: ['scheme_code'],
        unique: true
      }
    ]
  });

  return Scheme;
};
