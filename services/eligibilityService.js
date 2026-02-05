/**
 * Eligibility Service
 * Checks applicant eligibility against post requirements
 */
const db = require('../models');
const { Op } = require('sequelize');
const logger = require('../config/logger');
const applicantDocumentService = require('./applicant/documentService');

class EligibilityService {

  /**
   * Check if applicant is eligible for a specific post
   * SIMPLIFIED: Only checks age range, education level range (display_order), and total experience months
   * @param {number} applicantId - Applicant ID
   * @param {number} postId - Post ID
   * @returns {Promise<Object>} - Eligibility result with details
   */
  async checkEligibility(applicantId, postId) {
    const result = {
      isEligible: true,
      checks: [],
      failedChecks: [],
      warnings: []
    };

    try {
      // Get post requirements with education levels and allowed categories
      const post = await db.PostMaster.findByPk(postId, {
        include: [
          { model: db.EducationLevel, as: 'minEducationLevel', required: false },
          { model: db.EducationLevel, as: 'maxEducationLevel', required: false },
          { model: db.Component, as: 'component', required: false }
        ]
      });

      if (!post) {
        return { isEligible: false, error: 'Post not found', checks: [], failedChecks: ['Post not found'] };
      }

      // Get applicant profile with education and experience
      const applicant = await db.ApplicantMaster.findByPk(applicantId, {
        include: [
          { model: db.ApplicantPersonal, as: 'personal', required: false },
          {
            model: db.ApplicantEducation,
            as: 'education',
            required: false,
            include: [{ model: db.EducationLevel, as: 'educationLevel', required: false }]
          },
          { model: db.ApplicantExperience, as: 'experience', required: false }
        ]
      });

      if (!applicant) {
        return { isEligible: false, error: 'Applicant not found', checks: [], failedChecks: ['Applicant not found'] };
      }

      // ========== 1. CATEGORY CHECK (DISABLED - category stored but not used for eligibility) ==========
      // Category is now stored for data purposes only, not used in eligibility logic
      // const categoryCheck = this.checkCategorySimple(applicant.personal, post);
      // result.checks.push(categoryCheck);

      // ========== 2. AGE CHECK ==========
      const ageCheck = this.checkAgeSimple(applicant.personal, post);
      result.checks.push(ageCheck);
      if (!ageCheck.passed) {
        result.isEligible = false;
        result.failedChecks.push(ageCheck.message);
      }

      // ========== 3. EDUCATION LEVEL CHECK (using display_order as ranking) ==========
      const educationCheck = await this.checkEducationSimple(applicant.education, post);
      result.checks.push(educationCheck);
      if (!educationCheck.passed) {
        result.isEligible = false;
        result.failedChecks.push(educationCheck.message);
      }

      // ========== 4. EXPERIENCE CHECK (total months from all experiences) ==========
      const experienceCheck = this.checkExperienceSimple(applicant.experience, post);
      result.checks.push(experienceCheck);
      if (!experienceCheck.passed) {
        result.isEligible = false;
        result.failedChecks.push(experienceCheck.message);
      }

      result.postName = post.post_name;
      result.postCode = post.post_code;
      result.componentName = post.component?.component_name;

      logger.info(`Eligibility check for applicant ${applicantId} on post ${postId}: ${result.isEligible ? 'ELIGIBLE' : 'NOT ELIGIBLE'}`);

      return result;

    } catch (error) {
      logger.error('Eligibility check error:', error);
      throw error;
    }
  }

  /**
   * OPTIMIZED: Inline eligibility check using pre-fetched applicant data
   * Returns boolean only (no detailed checks) for performance
   * Used in getEligiblePosts to avoid N database queries
   * boosted performance inste do f calculation every tim eit does onec and show final output ture fase 
   */
  checkEligibilityInline(applicant, post) {
    if (!applicant || !post) return false;

    const personal = applicant.personal;
    const education = applicant.education || [];
    const experience = applicant.experience || [];

    // 1. Age check
    if (personal?.dob) {
      const today = new Date();
      const birthDate = new Date(personal.dob);
      let age = today.getFullYear() - birthDate.getFullYear();
      const monthDiff = today.getMonth() - birthDate.getMonth();
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        age--;
      }
      const minAge = post.min_age || 18;
      const maxAge = post.max_age || 65;
      if (age < minAge || age > maxAge) return false;
    } else {
      return false; // DOB required
    }

    // 2. Education check (using display_order)
    const minEduLevel = post.minEducationLevel;
    const maxEduLevel = post.maxEducationLevel;
    
    if (minEduLevel || maxEduLevel) {
      const minDisplayOrder = minEduLevel?.display_order || 0;
      const maxDisplayOrder = maxEduLevel?.display_order || 999;

      let highestApplicantOrder = 0;
      for (const edu of education) {
        const eduOrder = edu.educationLevel?.display_order || 0;
        if (eduOrder > highestApplicantOrder) {
          highestApplicantOrder = eduOrder;
        }
      }

      if (highestApplicantOrder < minDisplayOrder || highestApplicantOrder > maxDisplayOrder) {
        return false;
      }
    }

    // 3. Experience check
    const minRequired = post.min_experience_months || 0;
    if (minRequired > 0) {
      let totalMonths = 0;
      for (const exp of experience) {
        if (exp.total_months) {
          totalMonths += exp.total_months;
        } else if (exp.start_date) {
          const startDate = new Date(exp.start_date);
          const endDate = exp.is_current || !exp.end_date ? new Date() : new Date(exp.end_date);
          const months = (endDate.getFullYear() - startDate.getFullYear()) * 12 + (endDate.getMonth() - startDate.getMonth());
          totalMonths += Math.max(0, months);
        }
      }
      if (totalMonths < minRequired) return false;
    }

    return true; // All checks passed
  }

  /**
   * Simple category check - applicant's category must be in post's allowed categories
   */
  checkCategorySimple(personal, post) {
    const allowedCategories = post.allowedCategories || [];

    const check = {
      criterion: 'Category',
      required: allowedCategories.length > 0
        ? allowedCategories.map(c => c.category_name).join(', ')
        : 'All categories allowed',
      actual: 'Not specified',
      passed: true,
      message: ''
    };

    // If no categories specified for post, all categories are allowed
    if (allowedCategories.length === 0) {
      check.actual = personal?.category_id ? `Category ID: ${personal.category_id}` : 'Not specified';
      return check;
    }

    // Get applicant's category_id
    const applicantCategoryId = personal?.category_id;

    if (!applicantCategoryId) {
      check.actual = 'Not specified';
      check.passed = false;
      check.message = 'Applicant category not specified';
      return check;
    }

    // Check if applicant's category is in allowed list
    const categoryMatch = allowedCategories.some(c => c.category_id === applicantCategoryId);
    const matchedCategory = allowedCategories.find(c => c.category_id === applicantCategoryId);

    check.actual = matchedCategory
      ? matchedCategory.category_name
      : `Category ID: ${applicantCategoryId}`;

    if (!categoryMatch) {
      check.passed = false;
      check.message = `Applicant category (ID: ${applicantCategoryId}) is not in allowed categories: ${check.required}`;
    }

    return check;
  }

  /**
   * Simple age check - applicant age must be between post min_age and max_age
   */
  checkAgeSimple(personal, post) {
    const check = {
      criterion: 'Age',
      required: `${post.min_age || 18} - ${post.max_age || 65} years`,
      actual: 'Not calculated',
      passed: true,
      message: ''
    };

    if (!personal?.dob) {
      check.actual = 'DOB not provided';
      check.passed = false;
      check.message = 'Date of birth not provided';
      return check;
    }

    // Calculate age
    const today = new Date();
    const birthDate = new Date(personal.dob);
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }

    check.actual = `${age} years`;

    const minAge = post.min_age || 18;
    const maxAge = post.max_age || 65;

    if (age < minAge) {
      check.passed = false;
      check.message = `Age ${age} is below minimum required age of ${minAge}`;
    } else if (age > maxAge) {
      check.passed = false;
      check.message = `Age ${age} exceeds maximum allowed age of ${maxAge}`;
    }

    return check;
  }

  /**
   * Simple education check - applicant's highest education display_order must be >= post's min and <= max (if set)
   */
  async checkEducationSimple(educationRecords, post) {
    const check = {
      criterion: 'Education',
      required: 'Not specified',
      actual: 'No education records',
      passed: true,
      message: ''
    };

    // Build required string
    if (post.minEducationLevel) {
      check.required = `Min: ${post.minEducationLevel.level_name} (rank ${post.minEducationLevel.display_order})`;
      if (post.maxEducationLevel) {
        check.required += `, Max: ${post.maxEducationLevel.level_name} (rank ${post.maxEducationLevel.display_order})`;
      }
    } else if (post.min_education_level_id) {
      check.required = `Min Level ID: ${post.min_education_level_id}`;
    } else {
      // No education requirement
      check.required = 'No minimum education required';
      return check;
    }

    if (!educationRecords || educationRecords.length === 0) {
      check.passed = false;
      check.message = 'No education records found';
      return check;
    }

    // Find applicant's highest education level by display_order
    let highestLevel = null;
    let highestOrder = -1;

    for (const edu of educationRecords) {
      if (edu.educationLevel && edu.educationLevel.display_order > highestOrder) {
        highestOrder = edu.educationLevel.display_order;
        highestLevel = edu.educationLevel;
      } else if (edu.education_level_id && !edu.educationLevel) {
        // Fetch education level if not included
        const level = await db.EducationLevel.findByPk(edu.education_level_id);
        if (level && level.display_order > highestOrder) {
          highestOrder = level.display_order;
          highestLevel = level;
        }
      }
    }

    if (!highestLevel) {
      check.actual = 'Education level not linked to master data';
      check.passed = false;
      check.message = 'Education records not linked to education level master';
      return check;
    }

    check.actual = `${highestLevel.level_name} (rank ${highestOrder})`;

    // Check minimum education level
    const minRequired = post.minEducationLevel?.display_order;
    if (minRequired && highestOrder < minRequired) {
      check.passed = false;
      check.message = `Education level ${highestLevel.level_name} (rank ${highestOrder}) is below required ${post.minEducationLevel.level_name} (rank ${minRequired})`;
      return check;
    }

    // Check maximum education level (if set)
    const maxAllowed = post.maxEducationLevel?.display_order;
    if (maxAllowed && highestOrder > maxAllowed) {
      check.passed = false;
      check.message = `Education level ${highestLevel.level_name} (rank ${highestOrder}) exceeds maximum allowed ${post.maxEducationLevel.level_name} (rank ${maxAllowed})`;
      return check;
    }

    return check;
  }

  /**
   * Simple experience check - total experience months from all records must be >= post's min_experience_months
   */
  checkExperienceSimple(experienceRecords, post) {
    const minRequired = post.min_experience_months || 0;

    const check = {
      criterion: 'Experience',
      required: minRequired > 0 ? `${minRequired} months minimum` : 'No minimum experience required',
      actual: '0 months',
      passed: true,
      message: ''
    };

    // If no minimum required, pass
    if (minRequired === 0) {
      return check;
    }

    if (!experienceRecords || experienceRecords.length === 0) {
      check.actual = '0 months (no records)';
      check.passed = false;
      check.message = `No experience records found. Minimum ${minRequired} months required.`;
      return check;
    }

    // Calculate total experience in months from all records
    let totalMonths = 0;
    for (const exp of experienceRecords) {
      // Use pre-calculated total_months if available
      if (exp.total_months) {
        totalMonths += exp.total_months;
      } else if (exp.start_date) {
        // Calculate from start_date and end_date
        const startDate = new Date(exp.start_date);
        const endDate = exp.is_current || !exp.end_date ? new Date() : new Date(exp.end_date);

        // Calculate months between dates
        const months = (endDate.getFullYear() - startDate.getFullYear()) * 12 + (endDate.getMonth() - startDate.getMonth());
        totalMonths += Math.max(0, months);
      }
    }

    check.actual = `${totalMonths} months`;

    if (totalMonths < minRequired) {
      check.passed = false;
      check.message = `Total experience ${totalMonths} months is below required ${minRequired} months`;
    }

    return check;
  }

  /**
   * Check gender eligibility
   */
  checkGender(personal, post) {
    const check = {
      criterion: 'Gender',
      required: post.female_only ? 'Female Only' : 'Any',
      actual: personal?.gender || 'Not specified',
      passed: true,
      message: ''
    };

    if (post.female_only) {
      if (!personal || personal.gender?.toLowerCase() !== 'female') {
        check.passed = false;
        check.message = 'This post is for female candidates only';
      }
    }

    return check;
  }

  /**
   * Check category eligibility
   * Validates if applicant's category is in the list of allowed categories for the post
   */
  checkCategory(personal, post) {
    const check = {
      criterion: 'Category',
      required: 'Not specified',
      actual: 'Not specified',
      passed: true,
      message: ''
    };

    // Get allowed categories for the post
    const allowedCategories = post.allowedCategories || [];

    // If no categories are specified for the post, all categories are allowed
    if (allowedCategories.length === 0) {
      check.required = 'All categories allowed';
      check.actual = personal?.categoryMaster?.category_name || personal?.category || 'Not specified';
      return check;
    }

    // Build required categories string
    check.required = allowedCategories.map(c => c.category_name).join(', ');

    // Get applicant's category
    const applicantCategoryId = personal?.category_id;
    const applicantCategoryName = personal?.categoryMaster?.category_name || personal?.category;
    check.actual = applicantCategoryName || 'Not specified';

    if (!applicantCategoryId && !personal?.category) {
      check.passed = false;
      check.message = 'Applicant category not specified';
      return check;
    }

    // Check if applicant's category is in allowed list
    let categoryMatch = false;

    if (applicantCategoryId) {
      // Check by category_id (preferred)
      categoryMatch = allowedCategories.some(c => c.category_id === applicantCategoryId);
    } else if (personal?.category) {
      // Fallback: Check by category name/code for backward compatibility
      const applicantCategoryUpper = personal.category.toUpperCase();
      categoryMatch = allowedCategories.some(c =>
        c.category_code === applicantCategoryUpper ||
        c.category_name.toUpperCase() === applicantCategoryUpper ||
        (applicantCategoryUpper === 'GENERAL' && c.category_code === 'GEN')
      );
    }

    if (!categoryMatch) {
      check.passed = false;
      check.message = `Applicant category '${applicantCategoryName}' is not eligible for this post. Allowed categories: ${check.required}`;
    }

    return check;
  }

  /**
   * Check age eligibility
   */
  checkAge(personal, post) {
    const check = {
      criterion: 'Age',
      required: `${post.min_age || 18} - ${post.max_age || 65} years`,
      actual: 'Not calculated',
      passed: true,
      message: ''
    };

    if (!personal?.dob) {
      check.actual = 'DOB not provided';
      check.passed = false;
      check.message = 'Date of birth not provided';
      return check;
    }

    const today = new Date();
    const birthDate = new Date(personal.dob);
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }

    check.actual = `${age} years`;

    const minAge = post.min_age || 18;
    const maxAge = post.max_age || 65;

    if (age < minAge) {
      check.passed = false;
      check.message = `Age ${age} is below minimum required age of ${minAge}`;
    } else if (age > maxAge) {
      check.passed = false;
      check.message = `Age ${age} exceeds maximum allowed age of ${maxAge}`;
    }

    return check;
  }

  /**
   * Check education eligibility
   */
  async checkEducation(educationRecords, post) {
    const check = {
      criterion: 'Education',
      required: post.education_text || `Min Level ID: ${post.min_education_level_id}`,
      actual: 'No education records',
      passed: false,
      message: ''
    };

    if (!educationRecords || educationRecords.length === 0) {
      check.message = 'No education records found';
      return check;
    }

    // If no minimum education level required, pass
    if (!post.min_education_level_id) {
      check.passed = true;
      check.actual = `${educationRecords.length} education record(s)`;
      return check;
    }

    // Get the required education level's display_order
    const requiredLevel = await db.EducationLevel.findByPk(post.min_education_level_id);
    if (!requiredLevel) {
      check.passed = true; // Can't validate, assume pass
      check.actual = 'Required level not found in system';
      return check;
    }

    // Check if applicant has any education at or above required level
    let highestLevel = null;
    let highestOrder = -1;

    for (const edu of educationRecords) {
      if (edu.education_level_id) {
        const level = edu.educationLevel || await db.EducationLevel.findByPk(edu.education_level_id);
        if (level && level.display_order > highestOrder) {
          highestOrder = level.display_order;
          highestLevel = level;
        }
      }
    }

    if (highestLevel) {
      check.actual = highestLevel.level_name;
      if (highestOrder >= requiredLevel.display_order) {
        check.passed = true;
      } else {
        check.message = `Education level ${highestLevel.level_name} is below required ${requiredLevel.level_name}`;
      }
    } else {
      check.actual = educationRecords[0]?.qualification_level || 'Unknown';
      check.message = 'Education level not linked to master data';
    }

    // Check stream/subject if required
    if (check.passed && post.required_stream_group) {
      const streamCheck = this.checkStreamGroup(educationRecords, post.required_stream_group);
      if (!streamCheck.passed) {
        check.passed = false;
        check.message = streamCheck.message;
      }
    }

    return check;
  }

  /**
   * Check stream/subject group
   * Validates if applicant's education stream matches the required stream group
   * @param {Array} educationRecords - Applicant's education records
   * @param {string} requiredStreamGroup - Required stream group code (e.g., 'LAW', 'SOCIAL_WORK')
   * @returns {Object} - { passed: boolean, message: string }
   */
  checkStreamGroup(educationRecords, requiredStreamGroup) {
    if (!requiredStreamGroup || requiredStreamGroup === 'ANY') {
      return { passed: true, message: '' };
    }

    if (!educationRecords || educationRecords.length === 0) {
      return {
        passed: false,
        message: `Stream group '${requiredStreamGroup}' required but no education records found`
      };
    }

    // Stream group mappings based on csv.md documentation
    const streamGroupMappings = {
      'LAW': ['law', 'llb', 'llm', 'legal', 'advocate', 'judiciary'],
      'SOCIAL_WORK': ['social work', 'msw', 'bsw', 'sociology', 'social science'],
      'PSYCHOLOGY': ['psychology', 'clinical psychology', 'counselling', 'mental health'],
      'WOMEN_STUDIES': ['women studies', 'gender studies', 'women empowerment'],
      'CHILD_DEV': ['child development', 'child psychology', 'early childhood', 'hdfs'],
      'MANAGEMENT': ['management', 'mba', 'bba', 'administration', 'hr', 'human resource'],
      'COMPUTER': ['computer', 'it', 'information technology', 'software', 'bca', 'mca'],
      'ACCOUNTS': ['accounts', 'commerce', 'finance', 'ca', 'icwa', 'accounting'],
      'NURSING': ['nursing', 'anm', 'gnm', 'bsc nursing'],
      'MEDICAL': ['medical', 'mbbs', 'md', 'health', 'medicine']
    };

    const requiredStreams = streamGroupMappings[requiredStreamGroup.toUpperCase()] || [];

    // If no mapping found, try direct match
    if (requiredStreams.length === 0) {
      requiredStreams.push(requiredStreamGroup.toLowerCase());
    }

    // Check if any education record matches the required stream
    for (const edu of educationRecords) {
      const streamSubject = (edu.stream_subject || '').toLowerCase();
      const specialization = (edu.specialization || '').toLowerCase();
      const degreeName = (edu.degree_name || '').toLowerCase();

      for (const stream of requiredStreams) {
        if (streamSubject.includes(stream) ||
          specialization.includes(stream) ||
          degreeName.includes(stream)) {
          return { passed: true, message: '' };
        }
      }
    }

    return {
      passed: false,
      message: `Required stream group '${requiredStreamGroup}' not found in education records`
    };
  }

  /**
   * Check experience eligibility
   */
  checkExperience(experienceRecords, post) {
    const check = {
      criterion: 'Experience',
      required: post.experience_text || `${post.min_experience_years || 0} years`,
      actual: '0 months',
      passed: true,
      message: ''
    };

    const requiredYears = post.min_experience_years || 0;
    const requiredMonths = requiredYears * 12;

    if (requiredMonths === 0) {
      check.actual = 'Not required';
      return check;
    }

    if (!experienceRecords || experienceRecords.length === 0) {
      if (requiredMonths > 0) {
        check.passed = false;
        check.message = `${requiredYears} year(s) experience required, but no experience records found`;
      }
      return check;
    }

    // Calculate total relevant experience
    let totalMonths = 0;
    let relevantMonths = 0;

    for (const exp of experienceRecords) {
      const months = exp.total_months || this.calculateMonths(exp.start_date, exp.end_date, exp.is_current);
      totalMonths += months;

      // Check if experience is in required domain
      if (post.experience_domain_id && exp.domain_id === post.experience_domain_id) {
        relevantMonths += months;
      } else if (!post.experience_domain_id) {
        relevantMonths += months; // Any domain counts
      }
    }

    const totalYears = Math.floor(totalMonths / 12);
    const remainingMonths = totalMonths % 12;
    check.actual = `${totalYears} years ${remainingMonths} months (total)`;

    // Check if domain-specific experience is required
    if (post.experience_domain_id) {
      const relevantYears = Math.floor(relevantMonths / 12);
      if (relevantMonths < requiredMonths) {
        check.passed = false;
        check.message = `${requiredYears} year(s) experience in specific domain required, but only ${relevantYears} year(s) found`;
      }
    } else {
      if (totalMonths < requiredMonths) {
        check.passed = false;
        check.message = `${requiredYears} year(s) experience required, but only ${totalYears} year(s) found`;
      }
    }

    return check;
  }

  /**
   * Calculate months between dates
   */
  calculateMonths(startDate, endDate, isCurrent) {
    if (!startDate) return 0;
    const start = new Date(startDate);
    const end = isCurrent ? new Date() : (endDate ? new Date(endDate) : new Date());
    const months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
    return Math.max(0, months);
  }

  /**
   * Check local residency
   */
  checkResidency(address, personal, post) {
    const check = {
      criterion: 'Local Residency',
      required: post.local_resident_required ? 'Required' : (post.local_resident_preferred ? 'Preferred' : 'Not required'),
      actual: 'Not verified',
      passed: true,
      message: ''
    };

    if (!post.local_resident_required && !post.local_resident_preferred) {
      check.actual = 'Not applicable';
      return check;
    }

    // Check domicile
    if (personal?.domicile_maharashtra) {
      check.actual = 'Maharashtra domicile';
      check.passed = true;
    } else {
      check.actual = 'Non-Maharashtra or not specified';
      check.passed = false;
      check.message = 'Local residency/domicile not confirmed';
    }

    return check;
  }

  /**
   * Check computer proficiency
   */
  checkComputerProficiency(applicant) {
    // This would check for computer-related education or certifications
    return {
      criterion: 'Computer Proficiency',
      required: 'Required',
      actual: 'Not verified',
      passed: true, // Default to pass, can be verified during document check
      message: 'Computer proficiency to be verified from certificates'
    };
  }

  /**
   * Check counselling experience
   */
  checkCounsellingExperience(experienceRecords) {
    const check = {
      criterion: 'Counselling Experience',
      required: 'Required',
      actual: 'Not found',
      passed: false,
      message: 'Counselling experience required but not found'
    };

    if (!experienceRecords || experienceRecords.length === 0) {
      return check;
    }

    // Check for counselling-related domain
    const counsellingDomains = ['COUNSELLING', 'WOMEN_RELATED', 'HEALTH'];
    for (const exp of experienceRecords) {
      if (exp.domain?.domain_code && counsellingDomains.includes(exp.domain.domain_code)) {
        check.passed = true;
        check.actual = `${exp.domain.domain_name} experience found`;
        check.message = '';
        break;
      }
    }

    return check;
  }

  /**
   * Get all eligible posts for an applicant
   * @param {number} applicantId - Applicant ID
   * @param {boolean} onlyEligible - If true, return only eligible posts
   * @returns {Promise<Array>} - List of posts with eligibility status
   */
  async getEligiblePosts(applicantId, options = {}, legacyIncludeLocked) {
    try {
      let normalizedOptions = {};
      if (typeof options === 'boolean' || typeof legacyIncludeLocked === 'boolean') {
        normalizedOptions = {
          onlyEligible: typeof options === 'boolean' ? options : false,
          includeLocked: typeof legacyIncludeLocked === 'boolean' ? legacyIncludeLocked : false
        };
      } else {
        normalizedOptions = options || {};
      }

      const {
        onlyEligible = false,
        includeLocked = false,
        page = 1,
        limit = 20,
        search = '',
        districtId = null
      } = normalizedOptions;

      const pageNumber = Math.max(1, parseInt(page, 10) || 1);
      const limitNumber = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));
      const searchTerm = search ? search.toString().trim().toLowerCase() : '';
      const districtFilterId = Number.isFinite(parseInt(districtId, 10)) ? parseInt(districtId, 10) : null;

      logger.info('getEligiblePosts request', {
        applicantId,
        onlyEligible,
        includeLocked,
        page: pageNumber,
        limit: limitNumber,
        search: searchTerm || null,
        districtId: districtFilterId
      });

      // Do not show posts for which the applicant already has a locked application
      // (prevents re-apply attempts for submitted/finalized applications)
      const lockedApps = await db.Application.findAll({
        where: {
          applicant_id: applicantId,
          is_locked: true,
          is_deleted: false
        },
        attributes: ['post_id']
      });

      const lockedPostIds = new Set(lockedApps.map((a) => a.post_id));

      logger.info('getEligiblePosts locked posts', {
        applicantId,
        locked_count: lockedPostIds.size,
        locked_post_ids: Array.from(lockedPostIds)
      });

      const postWhereClause = {
        is_active: true,
        is_deleted: false
      };

      if (districtFilterId) {
        postWhereClause.district_id = districtFilterId;
      }

      // Get all active posts (filtered by district if applicable)
      const posts = await db.PostMaster.findAll({
        where: postWhereClause,
        include: [
          { model: db.Component, as: 'component', required: false },
          { model: db.EducationLevel, as: 'minEducationLevel', required: false },
          {
            model: db.DistrictMaster,
            as: 'district',
            required: false,
            attributes: ['district_id', 'district_name', 'district_name_mr']
          }
        ],
        order: [['updated_at', 'DESC'], ['created_at', 'DESC'], ['post_id', 'DESC']]
      });

      logger.info('getEligiblePosts active posts fetched', {
        applicantId,
        active_posts_count: posts.length,
        post_ids: posts.slice(0, 50).map((p) => p.post_id)
      });

      let availablePosts = includeLocked
        ? posts
        : (lockedPostIds.size > 0
          ? posts.filter((p) => !lockedPostIds.has(p.post_id))
          : posts);

      if (searchTerm) {
        availablePosts = availablePosts.filter((post) => {
          const haystack = [
            post.post_name,
            post.post_name_mr,
            post.post_code,
            post.component?.component_name,
            post.component?.component_name_mr,
            post.component?.component_code,
            post.district?.district_name,
            post.district?.district_name_mr
          ].filter(Boolean).map((value) => value.toString().toLowerCase());

          return haystack.some((value) => value.includes(searchTerm));
        });
      }

      logger.info('getEligiblePosts available posts', {
        applicantId,
        available_posts_count: availablePosts.length
      });

      // Fetch post-specific document requirements in bulk
      const postIds = availablePosts.map(p => p.post_id);
      const postDocRows = postIds.length === 0 ? [] : await db.PostDocumentRequirement.findAll({
        where: {
          post_id: { [Op.in]: postIds },
          is_active: true
        },
        include: [{
          model: db.DocumentType,
          as: 'documentType',
          required: true,
          where: {
            // Only return post-specific "extra" docs (exclude global mandatory)
            is_mandatory: false
          },
          attributes: ['doc_type_id', 'doc_code', 'doc_type_code', 'doc_type_name']
        }],
        order: [['post_id', 'ASC'], ['requirement_type', 'DESC'], ['id', 'ASC']]
      });

      // ========== PERFORMANCE OPTIMIZATION: Fetch applicant data ONCE ==========
      // Instead of fetching applicant data for each post in checkEligibility loop,
      // fetch it once here and reuse for all eligibility checks
      const applicant = await db.ApplicantMaster.findByPk(applicantId, {
        include: [
          { model: db.ApplicantPersonal, as: 'personal', required: false },
          {
            model: db.ApplicantEducation,
            as: 'education',
            required: false,
            include: [{ model: db.EducationLevel, as: 'educationLevel', required: false }]
          },
          { model: db.ApplicantExperience, as: 'experience', required: false }
        ]
      });

      if (!applicant) {
        throw new Error('Applicant not found');
      }

      // ========== BULK ELIGIBILITY CHECK ==========
      const results = [];
      for (const post of availablePosts) {
        // Perform inline eligibility check using already-fetched applicant data
        const isEligible = this.checkEligibilityInline(applicant, post);

        // Skip non-eligible posts if requested
        if (onlyEligible && !isEligible) {
          continue;
        }

        const component = post.component || {};
        const district = post.district || {};

        // Return only fields used by frontend (removed eligibility_checks, failed_checks, warnings, post_document_requirements)
        results.push({
          post_id: post.post_id,
          post_code: post.post_code,
          post_name: post.post_name,
          post_name_mr: post.post_name_mr,
          district_id: post.district_id || null,
          district_name: district?.district_name || null,
          district_name_mr: district?.district_name_mr || null,
          component: component?.component_name,
          component_name_mr: component?.component_name_mr,
          component_code: component?.component_code,
          is_eligible: isEligible
        });
      }

      const eligibleCount = results.filter((r) => r.is_eligible).length;
      const total = results.length;
      const totalPages = total === 0 ? 0 : Math.ceil(total / limitNumber);
      const startIndex = (pageNumber - 1) * limitNumber;
      const paginatedResults = results.slice(startIndex, startIndex + limitNumber);

      return {
        posts: paginatedResults,
        pagination: {
          total,
          page: pageNumber,
          limit: limitNumber,
          totalPages
        },
        total,
        total_posts: total,
        eligible_count: eligibleCount,
        filters: {
          only_eligible: !!onlyEligible,
          include_locked: !!includeLocked,
          search: searchTerm || null,
          district_id: districtFilterId
        }
      };

    } catch (error) {
      logger.error('Get eligible posts error:', error);
      throw error;
    }
  }

  /**
   * Calculate profile completion percentage
   * @param {number} applicantId - Applicant ID
   * @returns {Promise<Object>} - Completion details
   */
  async getProfileCompletion(applicantId) {
    try {
      logger.info('getProfileCompletion applicantId =', applicantId);
      const applicant = await db.ApplicantMaster.findByPk(applicantId, {
        include: [
          { model: db.ApplicantPersonal, as: 'personal' },
          { model: db.ApplicantAddress, as: 'address' },
          // Education and experience must NOT be required joins, otherwise
          // applicants with no records will disappear from the result.
          { model: db.ApplicantEducation, as: 'education', required: false },
          { model: db.ApplicantExperience, as: 'experience', required: false },
          { model: db.ApplicantDocument, as: 'documents' }
        ]
      });

      if (!applicant) {
        throw new Error('Applicant not found');
      }

      const sections = {
        personal: {
          weight: 25,
          completed: false,
          fields: []
        },
        address: {
          weight: 20,
          completed: false,
          fields: []
        },
        education: {
          weight: 25,
          completed: false,
          fields: []
        },
        experience: {
          weight: 15,
          completed: true, // defaults to complete; adjusted below based on preference
          fields: []
        },
        documents: {
          weight: 15,
          completed: false,
          fields: []
        }
      };

      // Check personal details
      if (applicant.personal) {
        const p = applicant.personal;
        const requiredFields = ['full_name', 'dob', 'gender'];
        const missingFields = requiredFields.filter(f => !p[f]);

        // Category is no longer required for profile completion
        sections.personal.completed = missingFields.length === 0;
        sections.personal.fields = missingFields;
      }

      // Check address
      if (applicant.address) {
        const a = applicant.address;
        const requiredFields = ['address_line', 'district_id', 'pincode'];
        const missingFields = requiredFields.filter(f => !a[f]);
        sections.address.completed = missingFields.length === 0;
        sections.address.fields = missingFields;
      }

      // Check education (at least one record required)
      if (applicant.education && applicant.education.length > 0) {
        sections.education.completed = true;
      } else {
        sections.education.fields = ['At least one education record required'];
      }

      // Experience completion based on preference
      const wantsExperience = applicant.personal?.has_experience;
      if (wantsExperience === true) {
        sections.experience.completed = Array.isArray(applicant.experience) && applicant.experience.length > 0;
        if (!sections.experience.completed) {
          sections.experience.fields = ['At least one experience record required'];
        }
      } else if (wantsExperience === false) {
        sections.experience.completed = true;
      } else {
        // legacy behavior: require at least one unless explicitly opted out
        sections.experience.completed = Array.isArray(applicant.experience) && applicant.experience.length > 0;
        if (!sections.experience.completed) {
          sections.experience.fields = ['Add experience or mark No experience'];
        }
      }

      // Check documents (dynamic: based on globally mandatory document types)
      const requiredDocTypes = await applicantDocumentService.getRequiredDocumentTypes(applicantId);

      const uploadedDocs = Array.isArray(applicant.documents) ? applicant.documents : [];
      const uploadedDocTypeIds = uploadedDocs.map((d) => d.doc_type_id).filter(Boolean);
      const uploadedDocCodes = uploadedDocs
        .map((d) => d.doc_type)
        .filter(Boolean)
        .map((c) => c.toString().toUpperCase());

      const missingDocs = [];
      for (const req of requiredDocTypes) {
        const requiredId = req.doc_type_id;
        const requiredCode = (req.doc_code || '').toString().toUpperCase();

        const satisfied =
          (requiredId && uploadedDocTypeIds.includes(requiredId)) ||
          (requiredCode && uploadedDocCodes.includes(requiredCode));

        if (!satisfied) {
          missingDocs.push(req);
        }
      }

      sections.documents.completed = missingDocs.length === 0;
      sections.documents.fields = missingDocs.map((d) => `${d.doc_type_name} required`);

      // Calculate total percentage
      let totalPercentage = 0;
      for (const [key, section] of Object.entries(sections)) {
        if (section.completed) {
          totalPercentage += section.weight;
        }
      }

      return {
        percentage: totalPercentage,
        isComplete: totalPercentage === 100,
        canApply: totalPercentage === 100, // Must be 100% to apply
        sections
      };

    } catch (error) {
      logger.error('Get profile completion error:', error);
      throw error;
    }
  }

  /**
   * Check if applicant has uploaded all required documents for a post
   * @param {number} applicantId - Applicant ID
   * @param {number} postId - Post ID
   * @returns {Promise<Object>} - Document check result
   */
  async checkRequiredDocuments(applicantId, postId) {
    try {
      const postIdInt = postId ? parseInt(postId, 10) : null;
      const requiredDocTypes = await applicantDocumentService.getRequiredDocumentTypes(applicantId, {
        post_id: postIdInt
      });

      // Get applicant's uploaded documents
      const uploadedDocs = await db.ApplicantDocument.findAll({
        where: {
          applicant_id: applicantId,
          is_deleted: false
        },
        include: [{
          model: db.DocumentType,
          as: 'documentType',
          attributes: ['doc_type_id', 'doc_code', 'doc_type_name']
        }]
      });

      const uploadedDocTypeIds = uploadedDocs.map(d => d.doc_type_id).filter(Boolean);
      const uploadedDocCodes = uploadedDocs
        .map(d => d.documentType?.doc_code || d.doc_type)
        .filter(Boolean)
        .map(c => c.toString().toUpperCase());

      const missing = [];
      const satisfied = [];

      for (const req of requiredDocTypes) {
        const requiredId = req.doc_type_id;
        const requiredCode = (req.doc_code || '').toString().toUpperCase();

        if ((requiredId && uploadedDocTypeIds.includes(requiredId)) ||
          (requiredCode && uploadedDocCodes.includes(requiredCode))) {
          satisfied.push({
            doc_type_id: requiredId,
            doc_code: req.doc_code,
            doc_name: req.doc_type_name
          });
        } else {
          missing.push({
            doc_type_id: requiredId,
            doc_code: req.doc_code,
            doc_name: req.doc_type_name
          });
        }
      }

      return {
        complete: missing.length === 0,
        missing,
        uploaded: uploadedDocs.map(d => ({
          document_id: d.document_id,
          doc_type: d.doc_type,
          doc_code: d.documentType?.doc_code,
          doc_name: d.documentType?.doc_type_name,
          file_path: d.file_path,
          uploaded_at: d.created_at
        })),
        satisfied,
        totalRequired: requiredDocTypes.length,
        totalUploaded: uploadedDocs.length
      };

    } catch (error) {
      logger.error('Check required documents error:', error);
      throw error;
    }
  }
}

module.exports = new EligibilityService();
