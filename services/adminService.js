const db = require('../models');
const {
  AdminUser,
  Role,
  Permission,
  RolePermission,
  Application,
  ApplicantMaster,
  ApplicantPersonal,
  ApplicantEducation,
  ApplicantExperience,
  ApplicantDocument,
  PostMaster,
  DistrictMaster,
  EligibilityResult
} = db;
const bcrypt = require('bcryptjs');
const logger = require('../config/logger');
const { ApiError } = require('../middleware/errorHandler');
const { Op } = require('sequelize');
const { getRelativePath } = require('../utils/fileUpload');

/**
 * Admin Service
 * Handles admin user management, dashboard, and application management
 */
class AdminService {

  // ==================== USER MANAGEMENT ====================

  /**
   * Create a new admin user
   * @param {Object} data - User data
   * @param {Object} currentUser - Current logged in user
   * @returns {Promise<Object>} - Created user
   */
  async createUser(data, currentUser) {
    const { username, password, full_name, email, mobile_no, role_id } = data;

    try {
      // Check if username already exists
      const existingUser = await AdminUser.findOne({ where: { username } });
      if (existingUser) {
        throw new ApiError(400, 'Username already exists');
      }

      // Check if email already exists
      if (email) {
        const existingEmail = await AdminUser.findOne({ where: { email } });
        if (existingEmail) {
          throw new ApiError(400, 'Email already exists');
        }
      }

      // Validate role exists
      const role = await Role.findByPk(role_id);
      if (!role) {
        throw new ApiError(400, 'Invalid role');
      }

      // Hash password
      const { getBcryptRounds } = require('../config/security');
      const password_hash = await bcrypt.hash(password, getBcryptRounds());

      // Create user (state-level system, no ZP)
      const user = await AdminUser.create({
        username,
        password_hash,
        full_name,
        email,
        mobile_no,
        role_id,
        created_by: currentUser.id,
        is_active: true
      });

      logger.info(`Admin user created: ${username} by ${currentUser.username || currentUser.id}`);

      // Fetch user with role
      const createdUser = await AdminUser.findByPk(user.admin_id, {
        attributes: { exclude: ['password_hash'] },
        include: [{ model: Role, as: 'role' }]
      });

      return createdUser;
    } catch (error) {
      logger.error('Create user error:', error);
      throw error;
    }
  }

  /**
   * Get all admin users with filters
   * @param {Object} filters - Query filters
   * @param {Object} currentUser - Current logged in user
   * @returns {Promise<Array>} - List of users
   */
  async getUsers(filters, currentUser) {
    const { role_id, district_id, is_active, search, page = 1, limit = 20 } = filters;

    try {
      const where = { is_deleted: false };

      // District admins can only see users in their district
      if (currentUser.role === 'DISTRICT_ADMIN' && currentUser.district_id) {
        where.district_id = currentUser.district_id;
      } else if (district_id) {
        where.district_id = district_id;
      }

      if (role_id) where.role_id = role_id;
      if (typeof is_active === 'boolean') where.is_active = is_active;

      if (search) {
        where[Op.or] = [
          { username: { [Op.iLike]: `%${search}%` } },
          { full_name: { [Op.iLike]: `%${search}%` } },
          { email: { [Op.iLike]: `%${search}%` } }
        ];
      }

      const offset = (page - 1) * limit;

      const { count, rows } = await AdminUser.findAndCountAll({
        where,
        attributes: { exclude: ['password_hash'] },
        include: [
          { model: Role, as: 'role' }
        ],
        order: [['created_at', 'DESC']],
        limit,
        offset
      });

      return {
        users: rows,
        pagination: {
          total: count,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(count / limit)
        }
      };
    } catch (error) {
      logger.error('Get users error:', error);
      throw error;
    }
  }

  /**
   * Get user by ID
   * @param {number} userId - User ID
   * @param {Object} currentUser - Current logged in user
   * @returns {Promise<Object>} - User details
   */
  async getUserById(userId, currentUser) {
    try {
      const user = await AdminUser.findOne({
        where: { admin_id: userId, is_deleted: false },
        attributes: { exclude: ['password_hash'] },
        include: [
          { model: Role, as: 'role' }
        ]
      });

      if (!user) {
        throw new ApiError(404, 'User not found');
      }

      // District admins can only view users in their district
      if (currentUser.role === 'DISTRICT_ADMIN' && currentUser.district_id) {
        if (user.district_id !== currentUser.district_id) {
          throw new ApiError(403, 'Access denied');
        }
      }

      return user;
    } catch (error) {
      logger.error('Get user error:', error);
      throw error;
    }
  }

  /**
   * Update admin user
   * @param {number} userId - User ID
   * @param {Object} data - Update data
   * @param {Object} currentUser - Current logged in user
   * @returns {Promise<Object>} - Updated user
   */
  async updateUser(userId, data, currentUser) {
    const { full_name, email, mobile_no, role_id, district_id, is_active } = data;

    try {
      const user = await AdminUser.findOne({
        where: { admin_id: userId, is_deleted: false }
      });

      if (!user) {
        throw new ApiError(404, 'User not found');
      }

      // District admins can only update users in their district
      if (currentUser.role === 'DISTRICT_ADMIN' && currentUser.district_id) {
        if (user.district_id !== currentUser.district_id) {
          throw new ApiError(403, 'Access denied');
        }
      }

      // Check email uniqueness if changed
      if (email && email !== user.email) {
        const existingEmail = await AdminUser.findOne({
          where: { email, admin_id: { [Op.ne]: userId } }
        });
        if (existingEmail) {
          throw new ApiError(400, 'Email already exists');
        }
      }

      // Update user
      await user.update({
        full_name: full_name || user.full_name,
        email: email || user.email,
        mobile_no: mobile_no !== undefined ? mobile_no : user.mobile_no,
        role_id: role_id || user.role_id,
        district_id: district_id !== undefined ? district_id : user.district_id,
        is_active: is_active !== undefined ? is_active : user.is_active
      });

      logger.info(`Admin user updated: ${user.username} by ${currentUser.username || currentUser.id}`);

      // Fetch updated user with role
      return await this.getUserById(userId, currentUser);
    } catch (error) {
      logger.error('Update user error:', error);
      throw error;
    }
  }

  /**
   * Delete (soft) admin user
   * @param {number} userId - User ID
   * @param {Object} currentUser - Current logged in user
   * @returns {Promise<Object>} - Result
   */
  async deleteUser(userId, currentUser) {
    try {
      const user = await AdminUser.findOne({
        where: { admin_id: userId, is_deleted: false }
      });

      if (!user) {
        throw new ApiError(404, 'User not found');
      }

      // Cannot delete yourself
      if (user.admin_id === currentUser.id) {
        throw new ApiError(400, 'Cannot delete your own account');
      }

      // District admins can only delete users in their district
      if (currentUser.role === 'DISTRICT_ADMIN' && currentUser.district_id) {
        if (user.district_id !== currentUser.district_id) {
          throw new ApiError(403, 'Access denied');
        }
      }

      // Soft delete
      await user.update({
        is_deleted: true,
        deleted_at: new Date(),
        is_active: false
      });

      logger.info(`Admin user deleted: ${user.username} by ${currentUser.username || currentUser.id}`);

      return { message: 'User deleted successfully' };
    } catch (error) {
      logger.error('Delete user error:', error);
      throw error;
    }
  }

  /**
   * Reset user password
   * @param {number} userId - User ID
   * @param {string} newPassword - New password
   * @param {Object} currentUser - Current logged in user
   * @returns {Promise<Object>} - Result
   */
  async resetPassword(userId, newPassword, currentUser) {
    try {
      const user = await AdminUser.findOne({
        where: { admin_id: userId, is_deleted: false }
      });

      if (!user) {
        throw new ApiError(404, 'User not found');
      }

      // District admins can only reset passwords for users in their district
      if (currentUser.role === 'DISTRICT_ADMIN' && currentUser.district_id) {
        if (user.district_id !== currentUser.district_id) {
          throw new ApiError(403, 'Access denied');
        }
      }

      // Hash new password
      const password_hash = await bcrypt.hash(newPassword, getBcryptRounds());
      await user.update({ password_hash });

      logger.info(`Password reset for: ${user.username} by ${currentUser.username || currentUser.id}`);

      return { message: 'Password reset successfully' };
    } catch (error) {
      logger.error('Reset password error:', error);
      throw error;
    }
  }

  // ==================== ROLE MANAGEMENT ====================

  /**
   * Get all roles with optional pagination and search
   * @param {Object} filters - Query filters
   * @returns {Promise<Object>} - Roles with pagination
   */
  async getRoles(filters = {}) {
    const { search, is_active = true, page = 1, limit = 20 } = filters;

    try {
      const where = {};

      if (typeof is_active === 'boolean') {
        where.is_active = is_active;
      }

      if (search) {
        where[Op.or] = [
          { role_name: { [Op.iLike]: `%${search}%` } },
          { role_code: { [Op.iLike]: `%${search}%` } },
          { description: { [Op.iLike]: `%${search}%` } }
        ];
      }

      const offset = (page - 1) * limit;

      // FIX: Count roles separately to avoid join issues
      const total = await Role.count({
        where,
        distinct: true,
        col: 'role_id'  // Explicitly count distinct role_ids
      });

      const roles = await Role.findAll({
        where,
        include: [{
          model: Permission,
          as: 'permissions',
          through: { attributes: [] },
          required: false  // Make it a LEFT JOIN
        }],
        order: [['role_id', 'ASC']],
        limit: parseInt(limit),
        offset
      });

      const { count, rows } = await Role.findAndCountAll({
        where,
        include: [{
          model: Permission,
          as: 'permissions',
          through: { attributes: [] }
        }],
        order: [['role_id', 'ASC']],
        limit: parseInt(limit),
        offset
      });

      return {
        roles,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      logger.error('Get roles error:', error);
      throw error;
    }
  }

  /**
   * Get all permissions
   * @returns {Promise<Array>} - List of permissions
   */
  async getPermissions() {
    try {
      const permissions = await Permission.findAll({
        where: { is_active: true },
        order: [['module', 'ASC'], ['permission_name', 'ASC']]
      });

      return permissions;
    } catch (error) {
      logger.error('Get permissions error:', error);
      throw error;
    }
  }

  /**
   * Update role permissions
   * @param {number} roleId - Role ID
   * @param {Array} permissionIds - Array of permission IDs
   * @returns {Promise<Object>} - Updated role
   */
  async updateRolePermissions(roleId, permissionIds) {
    try {
      const role = await Role.findByPk(roleId);
      if (!role) {
        throw new ApiError(404, 'Role not found');
      }

      // Cannot modify system roles
      if (role.is_system_role) {
        throw new ApiError(400, 'Cannot modify system role permissions');
      }

      // Delete existing permissions
      await RolePermission.destroy({ where: { role_id: roleId } });

      // Add new permissions
      if (permissionIds && permissionIds.length > 0) {
        const rolePermissions = permissionIds.map(permissionId => ({
          role_id: roleId,
          permission_id: permissionId
        }));
        await RolePermission.bulkCreate(rolePermissions);
      }

      // Fetch updated role with permissions
      const updatedRole = await Role.findByPk(roleId, {
        include: [{
          model: Permission,
          as: 'permissions',
          through: { attributes: [] }
        }]
      });

      logger.info(`Role permissions updated: ${role.role_name}`);

      return updatedRole;
    } catch (error) {
      logger.error('Update role permissions error:', error);
      throw error;
    }
  }

  // ==================== DASHBOARD ====================

  /**
   * Get dashboard statistics
   * @param {Object} currentUser - Current logged in user
   * @returns {Promise<Object>} - Dashboard stats
   */
  async getDashboardStats(currentUser) {
    try {
      const where = {};

      // Exclude soft-deleted applications
      where.is_deleted = false;

      const userRole = currentUser?.dataValues?.role_code || currentUser?.dataValues?.role || currentUser?.role;

      // District-scoped filtering for district admins
      if (userRole === 'DISTRICT_ADMIN' && currentUser.district_id) {
        where.district_id = currentUser.district_id;
      }

      // Get application counts
      const totalApplications = await Application.count({ where });

      const statusCounts = await Application.findAll({
        where,
        attributes: [
          'status',
          [db.sequelize.fn('COUNT', db.sequelize.col('application_id')), 'count']
        ],
        group: ['status'],
        raw: true
      });

      // Get applicant count (all applicants for state-level)
      const totalApplicants = await ApplicantMaster.count({
        where: { is_deleted: false }
      });

      // Get post count (all active posts)
      const totalPosts = await PostMaster.count({
        where: { is_active: true, is_deleted: false }
      });

      // Format status counts
      const statusMap = {};
      statusCounts.forEach(s => {
        statusMap[s.status] = parseInt(s.count);
      });

      return {
        totalApplications,
        totalApplicants,
        totalPosts,
        applicationsByStatus: {
          draft: statusMap['DRAFT'] || 0,
          submitted: statusMap['SUBMITTED'] || 0,
          underReview: statusMap['UNDER_REVIEW'] || 0,
          eligible: statusMap['ELIGIBLE'] || 0,
          notEligible: statusMap['NOT_ELIGIBLE'] || 0,
          selected: statusMap['SELECTED'] || 0
        }
      };
    } catch (error) {
      logger.error('Get dashboard stats error:', error);
      throw error;
    }
  }

  // ==================== APPLICATION MANAGEMENT ====================

  /**
   * Get all applications with filters (district-scoped for district admins)
   * @param {Object} filters - Query filters
   * @param {Object} currentUser - Current logged in user
   * @returns {Promise<Object>} - Applications with pagination
   */
  async getApplications(filters, currentUser) {
    const { status, post_id, district_id, search, page = 1, limit = 20 } = filters;

    try {
      const where = {};

      // District scoping for district admins
      if (currentUser.role === 'DISTRICT_ADMIN' && currentUser.district_id) {
        where.district_id = currentUser.district_id;
      } else if (district_id) {
        where.district_id = district_id;
      }

      if (status) where.status = status;
      if (post_id) where.post_id = post_id;

      if (search) {
        where[Op.or] = [
          { application_no: { [Op.iLike]: `%${search}%` } }
        ];
      }

      const offset = (page - 1) * limit;

      const { count, rows } = await Application.findAndCountAll({
        where,
        include: [
          {
            model: ApplicantMaster,
            as: 'applicant',
            include: [{ model: ApplicantPersonal, as: 'personal' }]
          },
          { model: PostMaster, as: 'post' },
          { model: DistrictMaster, as: 'district' }
        ],
        order: [['created_at', 'DESC']],
        limit: parseInt(limit),
        offset
      });

      return {
        applications: rows,
        pagination: {
          total: count,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(count / limit)
        }
      };
    } catch (error) {
      logger.error('Get applications error:', error);
      throw error;
    }
  }

  /**
   * Get application by ID
   * @param {number} applicationId - Application ID
   * @param {Object} currentUser - Current logged in user
   * @returns {Promise<Object>} - Application details
   */
  async getApplicationById(applicationId, currentUser) {
    try {
      const where = { application_id: applicationId };

      // District scoping for district admins
      if (currentUser.role === 'DISTRICT_ADMIN' && currentUser.district_id) {
        where.district_id = currentUser.district_id;
      }

      const application = await Application.findOne({
        where,
        include: [
          {
            model: ApplicantMaster,
            as: 'applicant',
            include: [
              { model: ApplicantPersonal, as: 'personal' },
              { model: ApplicantEducation, as: 'education' },
              { model: ApplicantExperience, as: 'experience' },
              { model: ApplicantDocument, as: 'documents' }
            ]
          },
          { model: PostMaster, as: 'post' },
          { model: DistrictMaster, as: 'district' },
          { model: EligibilityResult, as: 'eligibility' }
        ]
      });

      if (!application) {
        throw new ApiError(404, 'Application not found');
      }

      // Normalize document file paths to /uploads/... for frontend
      const applicant = application.applicant;
      if (applicant && Array.isArray(applicant.documents)) {
        applicant.documents.forEach((doc) => {
          if (doc.file_path) {
            const rel = getRelativePath(doc.file_path).replace(/\\/g, '/');
            doc.file_path = '/' + rel.replace(/^\/+/, '');
          }

          if (doc.compressed_path) {
            const rel = getRelativePath(doc.compressed_path).replace(/\\/g, '/');
            doc.compressed_path = '/' + rel.replace(/^\/+/, '');
          }

          if (doc.thumbnail_path) {
            const rel = getRelativePath(doc.thumbnail_path).replace(/\\/g, '/');
            doc.thumbnail_path = '/' + rel.replace(/^\/+/, '');
          }
        });
      }

      return application;
    } catch (error) {
      logger.error('Get application error:', error);
      throw error;
    }
  }

  /**
   * Update application status
   * @param {number} applicationId - Application ID
   * @param {string} status - New status
   * @param {string} remarks - Optional remarks
   * @param {Object} currentUser - Current logged in user
   * @returns {Promise<Object>} - Updated application
   */
  async updateApplicationStatus(applicationId, status, remarks, currentUser) {
    try {
      const application = await Application.findByPk(applicationId);

      if (!application) {
        throw new ApiError(404, 'Application not found');
      }

      // District scoping for district admins
      if (currentUser.role === 'DISTRICT_ADMIN' && currentUser.district_id) {
        if (application.district_id !== currentUser.district_id) {
          throw new ApiError(403, 'Access denied');
        }
      }

      await application.update({
        status,
        remarks: remarks || application.remarks,
        reviewed_by: currentUser.id,
        reviewed_at: new Date()
      });

      logger.info(`Application ${applicationId} status updated to ${status} by ${currentUser.id}`);
      return application;
    } catch (error) {
      logger.error('Update application status error:', error);
      throw error;
    }
  }

  /**
   * Check eligibility for an application
   * @param {number} applicationId - Application ID
   * @param {Object} currentUser - Current logged in user
   * @returns {Promise<Object>} - Eligibility result
   */
  async checkEligibility(applicationId, currentUser) {
    try {
      const application = await this.getApplicationById(applicationId, currentUser);
      const post = application.post;
      const applicant = application.applicant;
      const personal = applicant?.personal;

      const eligibilityChecks = [];
      let isEligible = true;

      // Age check
      if (personal?.dob && post) {
        const age = Math.floor((new Date() - new Date(personal.dob)) / (365.25 * 24 * 60 * 60 * 1000));
        const ageCheck = age >= (post.min_age || 18) && age <= (post.max_age || 65);
        eligibilityChecks.push({
          criterion: 'Age',
          required: `${post.min_age || 18} - ${post.max_age || 65} years`,
          actual: `${age} years`,
          passed: ageCheck
        });
        if (!ageCheck) isEligible = false;
      }

      // Qualification check (simplified)
      const hasEducation = applicant?.education && applicant.education.length > 0;
      eligibilityChecks.push({
        criterion: 'Education',
        required: post?.min_qualification || 'Any',
        actual: hasEducation ? 'Provided' : 'Not provided',
        passed: hasEducation
      });
      if (!hasEducation) isEligible = false;

      // Experience check
      if (post?.min_experience_months > 0) {
        let totalExperience = 0;
        if (applicant?.experience) {
          applicant.experience.forEach(exp => {
            const start = new Date(exp.start_date);
            const end = exp.is_current ? new Date() : new Date(exp.end_date);
            totalExperience += Math.floor((end - start) / (30 * 24 * 60 * 60 * 1000));
          });
        }
        const expCheck = totalExperience >= post.min_experience_months;
        eligibilityChecks.push({
          criterion: 'Experience',
          required: `${post.min_experience_months} months`,
          actual: `${totalExperience} months`,
          passed: expCheck
        });
        if (!expCheck) isEligible = false;
      }

      // Save eligibility result
      let eligibilityResult = await EligibilityResult.findOne({
        where: { application_id: applicationId }
      });

      if (eligibilityResult) {
        await eligibilityResult.update({
          is_eligible: isEligible,
          eligibility_criteria: JSON.stringify(eligibilityChecks),
          checked_by: currentUser.id,
          checked_at: new Date()
        });
      } else {
        eligibilityResult = await EligibilityResult.create({
          application_id: applicationId,
          is_eligible: isEligible,
          eligibility_criteria: JSON.stringify(eligibilityChecks),
          checked_by: currentUser.id,
          checked_at: new Date()
        });
      }

      // Update application status
      await application.update({
        status: isEligible ? 'Eligible' : 'Not Eligible'
      });

      logger.info(`Eligibility checked for application ${applicationId}: ${isEligible ? 'Eligible' : 'Not Eligible'}`);

      return {
        application_id: applicationId,
        is_eligible: isEligible,
        checks: eligibilityChecks
      };
    } catch (error) {
      logger.error('Check eligibility error:', error);
      throw error;
    }
  }

  /**
   * Generate merit list for a post (optionally filtered by district)
   * @param {number} districtId - District ID (optional, null for state-level)
   * @param {number} postId - Post ID
   * @param {Object} currentUser - Current logged in user
   * @returns {Promise<Object>} - Merit list
   */
  async generateMeritList(districtId, postId, currentUser) {
    try {
      // District scoping for district admins
      if (currentUser.role === 'DISTRICT_ADMIN' && currentUser.district_id) {
        if (districtId && currentUser.district_id !== parseInt(districtId)) {
          throw new ApiError(403, 'Access denied');
        }
        districtId = currentUser.district_id;
      }

      // Build where clause for applications
      const whereClause = {
        post_id: postId,
        status: 'ELIGIBLE'
      };

      if (districtId) {
        whereClause.district_id = districtId;
      }

      // Get all eligible applications for this post (and district if specified)
      const applications = await Application.findAll({
        where: whereClause,
        include: [
          {
            model: ApplicantMaster,
            as: 'applicant',
            include: [
              { model: ApplicantPersonal, as: 'personal' },
              { model: ApplicantEducation, as: 'education' },
              { model: ApplicantExperience, as: 'experience' }
            ]
          }
        ]
      });

      if (applications.length === 0) {
        throw new ApiError(400, 'No eligible applications found for merit list generation');
      }

      // Calculate scores and rank
      const scoredApplications = applications.map(app => {
        let score = 0;
        const applicant = app.applicant;

        // Education score (max 40 points)
        if (applicant?.education) {
          const highestPercentage = Math.max(...applicant.education.map(e => e.percentage || 0));
          score += Math.min(highestPercentage * 0.4, 40);
        }

        // Experience score (max 30 points)
        if (applicant?.experience) {
          let totalMonths = 0;
          applicant.experience.forEach(exp => {
            const start = new Date(exp.start_date);
            const end = exp.is_current ? new Date() : new Date(exp.end_date);
            totalMonths += Math.floor((end - start) / (30 * 24 * 60 * 60 * 1000));
          });
          score += Math.min(totalMonths * 0.5, 30);
        }

        // Age preference (max 10 points - younger gets more)
        if (applicant?.personal?.dob) {
          const age = Math.floor((new Date() - new Date(applicant.personal.dob)) / (365.25 * 24 * 60 * 60 * 1000));
          score += Math.max(0, 10 - (age - 21) * 0.5);
        }

        return {
          application: app,
          score: Math.round(score * 100) / 100
        };
      });

      // Sort by score descending
      scoredApplications.sort((a, b) => b.score - a.score);

      // Delete existing merit entries for this district/post combination
      const deleteWhere = { post_id: postId };
      if (districtId) {
        deleteWhere.district_id = districtId;
      }
      await MeritList.destroy({ where: deleteWhere });

      // Create merit list entries
      const meritEntries = await Promise.all(
        scoredApplications.map((item, index) =>
          MeritList.create({
            application_id: item.application.application_id,
            district_id: districtId || null,
            post_id: postId,
            rank: index + 1,
            score: item.score,
            generated_by: currentUser.id,
            generated_at: new Date()
          })
        )
      );

      logger.info(`Merit list generated for District ${districtId || 'ALL'}, Post ${postId} with ${meritEntries.length} entries`);

      return {
        district_id: districtId,
        post_id: postId,
        total_entries: meritEntries.length,
        generated_at: new Date(),
        merit_list: scoredApplications.map((item, index) => ({
          rank: index + 1,
          application_no: item.application.application_no,
          applicant_name: item.application.applicant?.personal?.full_name,
          score: item.score
        }))
      };
    } catch (error) {
      logger.error('Generate merit list error:', error);
      throw error;
    }
  }

  /**
   * Get merit list for a post (optionally filtered by district)
   * @param {number} districtId - District ID (optional, null for state-level)
   * @param {number} postId - Post ID
   * @param {Object} currentUser - Current logged in user
   * @returns {Promise<Array>} - Merit list
   */
  async getMeritList(districtId, postId, currentUser) {
    try {
      // District scoping for district admins
      if (currentUser.role === 'DISTRICT_ADMIN' && currentUser.district_id) {
        if (districtId && currentUser.district_id !== parseInt(districtId)) {
          throw new ApiError(403, 'Access denied');
        }
        districtId = currentUser.district_id;
      }

      // Build where clause
      const whereClause = { post_id: postId };
      if (districtId) {
        whereClause.district_id = districtId;
      }

      const meritList = await MeritList.findAll({
        where: whereClause,
        include: [{
          model: Application,
          as: 'application',
          include: [
            {
              model: ApplicantMaster,
              as: 'applicant',
              include: [{ model: ApplicantPersonal, as: 'personal' }]
            },
            { model: DistrictMaster, as: 'district' }
          ]
        }],
        order: [['rank', 'ASC']]
      });

      return meritList;
    } catch (error) {
      logger.error('Get merit list error:', error);
      throw error;
    }
  }
}

module.exports = new AdminService();
