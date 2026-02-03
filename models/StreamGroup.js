const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const StreamGroup = sequelize.define('StreamGroup', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    group_code: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: true
    },
    group_name: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    group_name_mr: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    streams: {
      type: DataTypes.ARRAY(DataTypes.TEXT),
      allowNull: true,
      comment: 'Array of stream names that belong to this group'
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    }
  }, {
    tableName: 'ms_stream_groups',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    defaultScope: {
      where: { is_active: true }
    },
    scopes: {
      all: {},
      active: {
        where: { is_active: true }
      }
    }
  });

  return StreamGroup;
};
