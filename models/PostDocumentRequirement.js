const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const PostDocumentRequirement = sequelize.define('PostDocumentRequirement', {
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
        key: 'id'
      }
    },
    doc_type_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'document_types',
        key: 'id'
      }
    },
    requirement_type: {
      type: DataTypes.STRING(1),
      allowNull: false,
      defaultValue: 'O',
      comment: 'M=Mandatory, O=Optional, N=Not Applicable',
      validate: {
        isIn: [['M', 'O', 'N']]
      }
    },
    mandatory_at_application: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    mandatory_before_engagement: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    remarks: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    }
  }, {
    tableName: 'ms_post_document_requirements',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      {
        unique: true,
        fields: ['post_id', 'doc_type_id']
      }
    ],
    defaultScope: {
      where: { is_active: true }
    },
    scopes: {
      all: {},
      mandatory: {
        where: { requirement_type: 'M', is_active: true }
      },
      optional: {
        where: { requirement_type: 'O', is_active: true }
      }
    }
  });

  // Class methods
  PostDocumentRequirement.getRequirementsForPost = async function(postId) {
    return this.findAll({
      where: { post_id: postId, is_active: true },
      include: [{
        model: sequelize.models.DocumentType,
        as: 'documentType'
      }],
      order: [['requirement_type', 'DESC'], ['id', 'ASC']]
    });
  };

  PostDocumentRequirement.getMandatoryDocsForPost = async function(postId) {
    return this.findAll({
      where: { 
        post_id: postId, 
        requirement_type: 'M',
        mandatory_at_application: true,
        is_active: true 
      },
      include: [{
        model: sequelize.models.DocumentType,
        as: 'documentType'
      }]
    });
  };

  return PostDocumentRequirement;
};
