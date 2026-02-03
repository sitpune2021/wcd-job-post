const { sequelize } = require('../config/db');
const logger = require('../config/logger');
const { postMasterService } = require('./masters');

/**
 * Post Management Service
 * Handles job post CRUD operations
 */

// Get all posts (public - only active)
const getAllPosts = async (filters = {}, language = 'en') => {
  try {
    let query = `
      SELECT 
        p.post_id,
        p.post_name,
        p.post_name_mr,
        p.description,
        p.description_mr,
        p.min_qualification,
        p.min_experience_months,
        p.required_domains,
        p.min_age,
        p.max_age,
        p.min_education_level_id,
        p.max_education_level_id,
        p.opening_date,
        p.closing_date,
        p.total_positions,
        p.filled_positions,
        p.district_specific,
        p.is_state_level,
        p.is_active,
        p.created_at,
        p.updated_at,
        (p.total_positions - p.filled_positions) as available_positions,
        CASE 
          WHEN p.closing_date >= CURRENT_DATE THEN true
          ELSE false
        END as is_open,
        min_edu.level_name as min_education_name,
        min_edu.level_name_mr as min_education_name_mr,
        max_edu.level_name as max_education_name,
        max_edu.level_name_mr as max_education_name_mr
      FROM ms_post_master p
      LEFT JOIN ms_education_levels min_edu ON p.min_education_level_id = min_edu.level_id
      LEFT JOIN ms_education_levels max_edu ON p.max_education_level_id = max_edu.level_id
      WHERE p.is_deleted = false
    `;

    const replacements = {};

    if (!filters.includeInactive) {
      query += ` AND p.is_active = true`;
    }

    if (filters.is_open) {
      query += ` AND p.closing_date >= CURRENT_DATE`;
    }

    if (filters.district_specific !== undefined) {
      query += ` AND p.district_specific = :district_specific`;
      replacements.district_specific = filters.district_specific;
    }

    query += ` ORDER BY p.updated_at DESC, p.created_at DESC, p.post_id DESC`;

    const [posts] = await sequelize.query(query, { replacements });

    // Fetch categories for each post
    const postsWithCategories = await Promise.all(posts.map(async (p) => {
      const categories = await postMasterService.getPostCategories(p.post_id, language);
      return {
        post_id: p.post_id,
        post_name: language === 'mr' && p.post_name_mr ? p.post_name_mr : p.post_name,
        post_name_en: p.post_name,
        post_name_mr: p.post_name_mr,
        description: language === 'mr' && p.description_mr ? p.description_mr : p.description,
        description_en: p.description,
        description_mr: p.description_mr,
        min_qualification: p.min_qualification,
        min_experience_months: p.min_experience_months,
        required_domains: p.required_domains,
        min_age: p.min_age,
        max_age: p.max_age,
        min_education_level_id: p.min_education_level_id,
        max_education_level_id: p.max_education_level_id,
        min_education: p.min_education_level_id ? {
          level_id: p.min_education_level_id,
          level_name: language === 'mr' && p.min_education_name_mr ? p.min_education_name_mr : p.min_education_name,
          level_name_en: p.min_education_name,
          level_name_mr: p.min_education_name_mr
        } : null,
        max_education: p.max_education_level_id ? {
          level_id: p.max_education_level_id,
          level_name: language === 'mr' && p.max_education_name_mr ? p.max_education_name_mr : p.max_education_name,
          level_name_en: p.max_education_name,
          level_name_mr: p.max_education_name_mr
        } : null,
        allowed_categories: categories,
        opening_date: p.opening_date,
        closing_date: p.closing_date,
        total_positions: p.total_positions,
        filled_positions: p.filled_positions,
        available_positions: p.available_positions,
        district_specific: p.district_specific,
        is_state_level: p.is_state_level,
        is_active: p.is_active,
        is_open: p.is_open,
        created_at: p.created_at,
        updated_at: p.updated_at
      };
    }));

    return postsWithCategories;
  } catch (error) {
    logger.error('Error fetching posts:', error);
    throw error;
  }
};

// Get post by ID
const getPostById = async (postId, language = 'en') => {
  try {
    const [posts] = await sequelize.query(
      `SELECT 
        p.*,
        (p.total_positions - p.filled_positions) as available_positions,
        CASE 
          WHEN p.closing_date >= CURRENT_DATE THEN true
          ELSE false
        END as is_open,
        COUNT(DISTINCT a.application_id) as application_count,
        min_edu.level_name as min_education_name,
        min_edu.level_name_mr as min_education_name_mr,
        min_edu.level_code as min_education_code,
        max_edu.level_name as max_education_name,
        max_edu.level_name_mr as max_education_name_mr,
        max_edu.level_code as max_education_code
      FROM ms_post_master p
      LEFT JOIN ms_applications a ON p.post_id = a.post_id AND a.is_deleted = false
      LEFT JOIN ms_education_levels min_edu ON p.min_education_level_id = min_edu.level_id
      LEFT JOIN ms_education_levels max_edu ON p.max_education_level_id = max_edu.level_id
      WHERE p.post_id = :postId AND p.is_deleted = false
      GROUP BY p.post_id, min_edu.level_id, max_edu.level_id`,
      { replacements: { postId } }
    );

    if (posts.length === 0) {
      return null;
    }

    const post = posts[0];
    
    return {
      post_id: post.post_id,
      post_name: language === 'mr' && post.post_name_mr ? post.post_name_mr : post.post_name,
      post_name_en: post.post_name,
      post_name_mr: post.post_name_mr,
      description: language === 'mr' && post.description_mr ? post.description_mr : post.description,
      description_en: post.description,
      description_mr: post.description_mr,
      min_qualification: post.min_qualification,
      min_experience_months: post.min_experience_months,
      required_domains: post.required_domains,
      min_age: post.min_age,
      max_age: post.max_age,
      min_education_level_id: post.min_education_level_id,
      max_education_level_id: post.max_education_level_id,
      min_education: post.min_education_level_id ? {
        level_id: post.min_education_level_id,
        level_code: post.min_education_code,
        level_name: language === 'mr' && post.min_education_name_mr ? post.min_education_name_mr : post.min_education_name,
        level_name_en: post.min_education_name,
        level_name_mr: post.min_education_name_mr
      } : null,
      max_education: post.max_education_level_id ? {
        level_id: post.max_education_level_id,
        level_code: post.max_education_code,
        level_name: language === 'mr' && post.max_education_name_mr ? post.max_education_name_mr : post.max_education_name,
        level_name_en: post.max_education_name,
        level_name_mr: post.max_education_name_mr
      } : null,
      allowed_categories: [],
      allowed_category_ids: [],
      opening_date: post.opening_date,
      closing_date: post.closing_date,
      total_positions: post.total_positions,
      filled_positions: post.filled_positions,
      available_positions: post.available_positions,
      district_specific: post.district_specific,
      is_state_level: post.is_state_level,
      is_active: post.is_active,
      is_open: post.is_open,
      application_count: post.application_count,
      created_at: post.created_at,
      updated_at: post.updated_at
    };
  } catch (error) {
    logger.error('Error fetching post:', error);
    throw error;
  }
};

// Create post
const createPost = async (data, userId) => {
  try {
    const [result] = await sequelize.query(
      `INSERT INTO ms_post_master (
        post_name, post_name_mr, description, description_mr,
        min_qualification, min_experience_months, required_domains,
        experience_domain_id,
        min_age, max_age, min_education_level_id, max_education_level_id,
        opening_date, closing_date,
        total_positions, filled_positions, district_specific, is_state_level,
        is_active, created_by, created_at, updated_at
      )
      VALUES (
        :post_name, :post_name_mr, :description, :description_mr,
        :min_qualification, :min_experience_months, :required_domains,
        :experience_domain_id,
        :min_age, :max_age, :min_education_level_id, :max_education_level_id,
        :opening_date, :closing_date,
        :total_positions, 0, :district_specific, :is_state_level,
        :is_active, :created_by, NOW(), NOW()
      )
      RETURNING *`,
      {
        replacements: {
          post_name: data.post_name,
          post_name_mr: data.post_name_mr || null,
          description: data.description || null,
          description_mr: data.description_mr || null,
          min_qualification: data.min_qualification || null,
          min_experience_months: data.min_experience_months || 0,
          required_domains: data.required_domains || null,
          experience_domain_id: data.experience_domain_id === '' || data.experience_domain_id === undefined || data.experience_domain_id === null
            ? null
            : Number(data.experience_domain_id),
          min_age: data.min_age || 18,
          max_age: data.max_age || 65,
          min_education_level_id: data.min_education_level_id || null,
          max_education_level_id: data.max_education_level_id || null,
          opening_date: data.opening_date,
          closing_date: data.closing_date,
          total_positions: data.total_positions || 1,
          district_specific: data.district_specific || false,
          is_state_level: data.is_state_level !== undefined ? data.is_state_level : true,
          is_active: data.is_active !== undefined ? data.is_active : true,
          created_by: userId
        }
      }
    );

    const postId = result[0].post_id;

    logger.info(`Post created: ${postId} by user ${userId}`);
    return result[0];
  } catch (error) {
    logger.error('Error creating post:', error);
    throw error;
  }
};

// Update post
const updatePost = async (postId, data, userId) => {
  try {
    // Build dynamic SET clause to allow null values (not using COALESCE)
    const setClauses = [];
    const replacements = { postId, updated_by: userId };

    // Helper to add field if provided in data
    const addField = (fieldName, value, allowNull = true) => {
      if (value !== undefined) {
        setClauses.push(`${fieldName} = :${fieldName}`);
        replacements[fieldName] = allowNull && (value === null || value === '') ? null : value;
      }
    };

    addField('post_name', data.post_name, false);
    addField('post_name_mr', data.post_name_mr);
    addField('description', data.description);
    addField('description_mr', data.description_mr);
    addField('min_qualification', data.min_qualification);
    addField('min_experience_months', data.min_experience_months !== undefined ? (data.min_experience_months === '' ? 0 : Number(data.min_experience_months)) : undefined);
    addField('required_domains', data.required_domains);
    addField('min_age', data.min_age !== undefined ? (data.min_age === '' ? null : Number(data.min_age)) : undefined);
    addField('max_age', data.max_age !== undefined ? (data.max_age === '' ? null : Number(data.max_age)) : undefined);
    addField('min_education_level_id', data.min_education_level_id !== undefined ? (data.min_education_level_id === '' || data.min_education_level_id === null ? null : Number(data.min_education_level_id)) : undefined);
    addField('max_education_level_id', data.max_education_level_id !== undefined ? (data.max_education_level_id === '' || data.max_education_level_id === null ? null : Number(data.max_education_level_id)) : undefined);
    addField('experience_domain_id', data.experience_domain_id !== undefined ? (data.experience_domain_id === '' || data.experience_domain_id === null ? null : Number(data.experience_domain_id)) : undefined);
    addField('opening_date', data.opening_date);
    addField('closing_date', data.closing_date);
    addField('total_positions', data.total_positions !== undefined ? (data.total_positions === '' ? 1 : Number(data.total_positions)) : undefined);
    addField('district_specific', data.district_specific);
    addField('is_state_level', data.is_state_level);
    addField('is_active', data.is_active);

    if (setClauses.length === 0) {
      // Nothing to update
      const existing = await getPostById(postId);
      return existing;
    }

    setClauses.push('updated_by = :updated_by');
    setClauses.push('updated_at = NOW()');

    const [result] = await sequelize.query(
      `UPDATE ms_post_master 
       SET ${setClauses.join(', ')}
       WHERE post_id = :postId AND is_deleted = false
       RETURNING *`,
      { replacements }
    );

    if (result.length === 0) {
      return null;
    }

    logger.info(`Post updated: ${postId} by user ${userId}`);
    return result[0];
  } catch (error) {
    logger.error('Error updating post:', error);
    throw error;
  }
};

// Soft delete post
const deletePost = async (postId, userId) => {
  try {
    const [result] = await sequelize.query(
      `UPDATE ms_post_master 
       SET is_active = false,
           is_deleted = true,
           deleted_by = :deleted_by,
           deleted_at = NOW(),
           updated_by = :updated_by,
           updated_at = NOW()
       WHERE post_id = :postId AND is_deleted = false
       RETURNING post_id`,
      {
        replacements: { postId, deleted_by: userId, updated_by: userId }
      }
    );

    if (result.length === 0) {
      return false;
    }

    logger.info(`Post deleted: ${postId} by user ${userId}`);
    return true;
  } catch (error) {
    logger.error('Error deleting post:', error);
    throw error;
  }
};

// Publish post (activate)
const publishPost = async (postId, userId) => {
  try {
    const [result] = await sequelize.query(
      `UPDATE ms_post_master 
       SET is_active = true, updated_by = :updated_by, updated_at = NOW()
       WHERE post_id = :postId AND is_deleted = false
       RETURNING post_id, post_name, is_active`,
      {
        replacements: { postId, updated_by: userId }
      }
    );

    if (result.length === 0) {
      return null;
    }

    logger.info(`Post published: ${postId} by user ${userId}`);
    return result[0];
  } catch (error) {
    logger.error('Error publishing post:', error);
    throw error;
  }
};

// Close post (deactivate)
const closePost = async (postId, userId) => {
  try {
    const [result] = await sequelize.query(
      `UPDATE ms_post_master 
       SET is_active = false, updated_by = :updated_by, updated_at = NOW()
       WHERE post_id = :postId AND is_deleted = false
       RETURNING post_id, post_name, is_active`,
      {
        replacements: { postId, updated_by: userId }
      }
    );

    if (result.length === 0) {
      return null;
    }

    logger.info(`Post closed: ${postId} by user ${userId}`);
    return result[0];
  } catch (error) {
    logger.error('Error closing post:', error);
    throw error;
  }
};

// Check if post is open for applications
const isPostOpen = async (postId) => {
  try {
    const [result] = await sequelize.query(
      `SELECT 
        CASE 
          WHEN is_active = true 
          AND closing_date >= CURRENT_DATE 
          AND (total_positions - filled_positions) > 0
          THEN true
          ELSE false
        END as is_open
      FROM ms_post_master
      WHERE post_id = :postId AND is_deleted = false`,
      { replacements: { postId } }
    );

    return result.length > 0 ? result[0].is_open : false;
  } catch (error) {
    logger.error('Error checking if post is open:', error);
    throw error;
  }
};

// ==================== POST DOCUMENT REQUIREMENTS ====================

// Get document requirements for a post
const getDocumentRequirements = async (postId) => {
  try {
    const [requirements] = await sequelize.query(
      `SELECT 
        pdr.id,
        pdr.post_id,
        pdr.doc_type_id,
        pdr.requirement_type,
        pdr.mandatory_at_application,
        pdr.mandatory_before_engagement,
        pdr.remarks,
        pdr.is_active,
        dt.doc_code,
        dt.doc_type_name,
        dt.doc_type_name_mr,
        dt.allowed_file_types AS allowed_extensions,
        dt.max_file_size_mb
      FROM ms_post_document_requirements pdr
      JOIN ms_document_types dt ON pdr.doc_type_id = dt.doc_type_id
      WHERE pdr.post_id = :postId AND pdr.is_active = true
      ORDER BY pdr.requirement_type DESC, dt.doc_type_name ASC`,
      { replacements: { postId } }
    );

    return requirements.map(r => ({
      id: r.id,
      post_id: r.post_id,
      doc_type_id: r.doc_type_id,
      doc_code: r.doc_code,
      doc_name: r.doc_type_name,
      doc_name_mr: r.doc_type_name_mr,
      requirement_type: r.requirement_type,
      requirement_label: r.requirement_type === 'M' ? 'Mandatory' : (r.requirement_type === 'O' ? 'Optional' : 'Not Applicable'),
      mandatory_at_application: r.mandatory_at_application,
      mandatory_before_engagement: r.mandatory_before_engagement,
      remarks: r.remarks,
      allowed_extensions: r.allowed_extensions,
      max_file_size_mb: r.max_file_size_mb
    }));
  } catch (error) {
    logger.error('Error fetching document requirements:', error);
    throw error;
  }
};

// Set/update document requirements for a post (bulk replace)
const setDocumentRequirements = async (postId, requirements, userId) => {
  try {
    // Deactivate existing requirements
    await sequelize.query(
      `UPDATE ms_post_document_requirements SET is_active = false, updated_at = NOW() WHERE post_id = :postId`,
      { replacements: { postId } }
    );

    // Insert/update new requirements
    for (const req of requirements) {
      const reqType = req.requirement_type || 'O';
      const isMandatory = reqType === 'M';
      const mandatory_at_application = isMandatory ? !!req.mandatory_at_application : false;
      const mandatory_before_engagement = isMandatory ? !!req.mandatory_before_engagement : false;

      await sequelize.query(
        `INSERT INTO ms_post_document_requirements (
          post_id, doc_type_id, requirement_type, mandatory_at_application, 
          mandatory_before_engagement, remarks, is_active, created_at, updated_at
        )
        VALUES (
          :postId, :doc_type_id, :requirement_type, :mandatory_at_application,
          :mandatory_before_engagement, :remarks, true, NOW(), NOW()
        )
        ON CONFLICT (post_id, doc_type_id) 
        DO UPDATE SET 
          requirement_type = :requirement_type,
          mandatory_at_application = :mandatory_at_application,
          mandatory_before_engagement = :mandatory_before_engagement,
          remarks = :remarks,
          is_active = true,
          updated_at = NOW()`,
        {
          replacements: {
            postId,
            doc_type_id: req.doc_type_id,
            requirement_type: reqType,
            mandatory_at_application,
            mandatory_before_engagement,
            remarks: req.remarks || null
          }
        }
      );
    }

    logger.info(`Document requirements updated for post ${postId} by user ${userId}`);
    return getDocumentRequirements(postId);
  } catch (error) {
    logger.error('Error setting document requirements:', error);
    throw error;
  }
};

// Add single document requirement
const addDocumentRequirement = async (postId, data, userId) => {
  try {
    const reqType = data.requirement_type || 'O';
    const isMandatory = reqType === 'M';
    const mandatory_at_application = isMandatory ? !!data.mandatory_at_application : false;
    const mandatory_before_engagement = isMandatory ? !!data.mandatory_before_engagement : false;

    const [result] = await sequelize.query(
      `INSERT INTO ms_post_document_requirements (
        post_id, doc_type_id, requirement_type, mandatory_at_application, 
        mandatory_before_engagement, remarks, is_active, created_at, updated_at
      )
      VALUES (
        :postId, :doc_type_id, :requirement_type, :mandatory_at_application,
        :mandatory_before_engagement, :remarks, true, NOW(), NOW()
      )
      ON CONFLICT (post_id, doc_type_id) 
      DO UPDATE SET 
        requirement_type = :requirement_type,
        mandatory_at_application = :mandatory_at_application,
        mandatory_before_engagement = :mandatory_before_engagement,
        remarks = :remarks,
        is_active = true,
        updated_at = NOW()
      RETURNING *`,
      {
        replacements: {
          postId,
          doc_type_id: data.doc_type_id,
          requirement_type: reqType,
          mandatory_at_application,
          mandatory_before_engagement,
          remarks: data.remarks || null
        }
      }
    );

    logger.info(`Document requirement added for post ${postId}, doc_type ${data.doc_type_id} by user ${userId}`);
    return result[0];
  } catch (error) {
    logger.error('Error adding document requirement:', error);
    throw error;
  }
};

// Remove document requirement
const removeDocumentRequirement = async (postId, docTypeId, userId) => {
  try {
    await sequelize.query(
      `UPDATE ms_post_document_requirements 
       SET is_active = false, updated_at = NOW()
       WHERE post_id = :postId AND doc_type_id = :docTypeId`,
      { replacements: { postId, docTypeId } }
    );

    logger.info(`Document requirement removed for post ${postId}, doc_type ${docTypeId} by user ${userId}`);
    return true;
  } catch (error) {
    logger.error('Error removing document requirement:', error);
    throw error;
  }
};

module.exports = {
  getAllPosts,
  getPostById,
  createPost,
  updatePost,
  deletePost,
  publishPost,
  closePost,
  isPostOpen,
  getDocumentRequirements,
  setDocumentRequirements,
  addDocumentRequirement,
  removeDocumentRequirement
};
