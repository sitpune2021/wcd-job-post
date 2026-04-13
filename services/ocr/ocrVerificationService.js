// ============================================================================
// OCR DOCUMENT VERIFICATION SERVICE
// ============================================================================
// Purpose: Verify education documents by comparing OCR-extracted data with user input
// Dependencies: openai (^4.28.0), pdf-parse (^1.1.1)
// 
// This file is part of the OCR verification module and can be safely removed
// if OCR functionality is no longer needed.
// 
// Toggle Control: Set OCR_VERIFICATION_ENABLED=false in .env to bypass OCR
// and return auto-pass responses without calling OpenAI API.
// ============================================================================

const logger = require('../../config/logger');
const { analyzeEducationDocument } = require('../../utils/ocr/openaiClient');
const { ApiError } = require('../../middleware/errorHandler');
const crypto = require('crypto');
const fs = require('fs').promises;
const db = require('../../models');

/**
 * Check if OCR verification is enabled
 * @returns {boolean} True if enabled, false if disabled
 */
const isOcrEnabled = () => {
  const enabled = process.env.OCR_VERIFICATION_ENABLED;
  return enabled === 'true' || enabled === '1';
};

/**
 * Normalize text for comparison (remove extra spaces, convert to lowercase)
 * @param {string} text - Text to normalize
 * @returns {string} Normalized text
 */
const normalizeText = (text) => {
  if (!text) return '';
  return String(text).toLowerCase().trim().replace(/\s+/g, ' ');
};

/**
 * Calculate similarity between two strings (simple fuzzy matching)
 * @param {string} str1 - First string
 * @param {string} str2 - Second string
 * @returns {number} Similarity score (0.0 to 1.0)
 */
const calculateStringSimilarity = (str1, str2) => {
  const s1 = normalizeText(str1);
  const s2 = normalizeText(str2);

  if (s1 === s2) return 1.0;
  if (!s1 || !s2) return 0.0;

  // Check if one contains the other
  if (s1.includes(s2) || s2.includes(s1)) {
    return 0.8;
  }

  // Simple word overlap check
  const words1 = s1.split(' ');
  const words2 = s2.split(' ');
  const commonWords = words1.filter(w => words2.includes(w));
  
  if (commonWords.length === 0) return 0.0;
  
  const maxWords = Math.max(words1.length, words2.length);
  return commonWords.length / maxWords;
};

/**
 * Compare numeric values with tolerance (percent difference)
 * @param {number} expected - Expected value
 * @param {number} actual - Actual value
 * @param {number} tolerance - Tolerance percentage (default 0 for exact match)
 * @returns {boolean} True if values match within tolerance
 */
const compareNumericValues = (expected, actual, tolerance = 0) => {
  const exp = Number(expected);
  const act = Number(actual);
  if (Number.isNaN(exp) || Number.isNaN(act)) return false;

  const roundedExp = Number(exp.toFixed(2));
  const roundedAct = Number(act.toFixed(2));
  if (roundedExp === roundedAct) return true;

  if (roundedExp === 0) {
    return Math.abs(roundedAct) <= tolerance;
  }

  const diff = Math.abs(roundedExp - roundedAct);
  const percentDiff = (diff / Math.abs(roundedExp)) * 100;
  return percentDiff <= tolerance;
};

/**
 * Compare extracted data with user-provided data
 * @param {Object} userProvided - User-provided form data
 * @param {Object} extracted - OCR-extracted data
 * @returns {Object} Comparison result with mismatches
 */
const compareData = (userProvided, extracted) => {
  const mismatches = [];
  let matchCount = 0;
  let totalFields = 0;

  // Compare qualification
  if (userProvided.qualification) {
    totalFields++;
    if (extracted.qualification?.value) {
      const similarity = calculateStringSimilarity(
        userProvided.qualification,
        extracted.qualification.value
      );
      
      if (similarity < 0.6) {
        mismatches.push({
          field: 'qualification',
          user_provided: userProvided.qualification,
          ocr_extracted: extracted.qualification.value,
          similarity: similarity
        });
      } else {
        matchCount++;
      }
    } else {
      mismatches.push({
        field: 'qualification',
        user_provided: userProvided.qualification,
        ocr_extracted: null,
        similarity: 0
      });
    }
  }

  // Compare degree name
  if (userProvided.degreeName) {
    totalFields++;
    if (extracted.degree_name?.value) {
      const similarity = calculateStringSimilarity(
        userProvided.degreeName,
        extracted.degree_name.value
      );
      
      if (similarity < 0.6) {
        mismatches.push({
          field: 'degree_name',
          user_provided: userProvided.degreeName,
          ocr_extracted: extracted.degree_name.value,
          similarity: similarity
        });
      } else {
        matchCount++;
      }
    } else {
      mismatches.push({
        field: 'degree_name',
        user_provided: userProvided.degreeName,
        ocr_extracted: null,
        similarity: 0
      });
    }
  }

  // Compare board/university
  if (userProvided.board) {
    totalFields++;
    if (extracted.board_university?.value) {
      const similarity = calculateStringSimilarity(
        userProvided.board,
        extracted.board_university.value
      );
      
      if (similarity < 0.5) {
        mismatches.push({
          field: 'board_university',
          user_provided: userProvided.board,
          ocr_extracted: extracted.board_university.value,
          similarity: similarity
        });
      } else {
        matchCount++;
      }
    } else {
      mismatches.push({
        field: 'board_university',
        user_provided: userProvided.board,
        ocr_extracted: null,
        similarity: 0
      });
    }
  }

  // Compare year of passing (exact match)
  let isYearValid = true;
  if (userProvided.yearOfPassing) {
    totalFields++;
    if (extracted.year_of_passing?.value) {
      const expectedYear = parseInt(userProvided.yearOfPassing, 10);
      const actualYear = parseInt(extracted.year_of_passing.value, 10);
      
      if (expectedYear !== actualYear) {
        isYearValid = false;
        mismatches.push({
          field: 'year_of_passing',
          user_provided: expectedYear,
          ocr_extracted: actualYear
        });
      } else {
        matchCount++;
      }
    } else {
      isYearValid = false;
      mismatches.push({
        field: 'year_of_passing',
        user_provided: parseInt(userProvided.yearOfPassing, 10),
        ocr_extracted: null
      });
    }
  }

  // Compare percentage (exact match at 2 decimals; tolerance 0%)
  let isPercentageValid = true;
  if (userProvided.percentage) {
    totalFields++;
    if (extracted.percentage?.value !== undefined && extracted.percentage?.value !== null) {
      const expectedPercentage = parseFloat(userProvided.percentage);
      const actualPercentage = parseFloat(extracted.percentage.value);
      
      if (!compareNumericValues(expectedPercentage, actualPercentage, 0)) {
        isPercentageValid = false;
        mismatches.push({
          field: 'percentage',
          user_provided: expectedPercentage.toFixed(2),
          ocr_extracted: actualPercentage.toFixed(2)
        });
      } else {
        matchCount++;
      }
    } else {
      isPercentageValid = false;
      mismatches.push({
        field: 'percentage',
        user_provided: parseFloat(userProvided.percentage).toFixed(2),
        ocr_extracted: null
      });
    }
  }

  // Calculate overall match percentage
  const matchPercentage = totalFields > 0 ? (matchCount / totalFields) : 0;
  const verificationResult = mismatches.length === 0 ? 'MATCHED' : 'NOT_MATCHED';

  return {
    verificationResult,
    mismatches,
    isYearValid,
    isPercentageValid,
    matchPercentage
  };
};

/**
 * Calculate overall confidence score
 * @param {Object} extractedData - Extracted data with confidence scores
 * @param {number} matchPercentage - Match percentage from comparison
 * @returns {number} Overall confidence score (0.0-1.0)
 */
const calculateConfidenceScore = (extractedData, matchPercentage) => {
  const confidences = [];

  if (extractedData.qualification?.confidence) {
    confidences.push(extractedData.qualification.confidence);
  }
  if (extractedData.degree_name?.confidence) {
    confidences.push(extractedData.degree_name.confidence);
  }
  if (extractedData.board_university?.confidence) {
    confidences.push(extractedData.board_university.confidence);
  }
  if (extractedData.year_of_passing?.confidence) {
    confidences.push(extractedData.year_of_passing.confidence);
  }
  if (extractedData.percentage?.confidence) {
    confidences.push(extractedData.percentage.confidence);
  }

  // Average confidence from OCR
  const avgOcrConfidence = confidences.length > 0
    ? confidences.reduce((a, b) => a + b, 0) / confidences.length
    : 0;

  // Combine OCR confidence with match percentage (weighted average)
  const overallConfidence = (avgOcrConfidence * 0.6) + (matchPercentage * 0.4);

  return Math.round(overallConfidence * 100) / 100; // Round to 2 decimals
};

/**
 * Create bypass response when OCR is disabled
 * @param {Object} userProvided - User-provided data
 * @returns {Object} Auto-pass verification response
 */
const createBypassResponse = (userProvided) => {
  logger.info('OCR verification is disabled - returning bypass/auto-pass response');

  return {
    status: 'success',
    verification_result: 'MATCHED',
    confidence_score: 1.0,
    is_year_of_passing_valid: true,
    is_percentage_valid: true,
    extracted_data: {
      qualification: {
        value: userProvided.qualification || null,
        confidence: 1.0
      },
      degree_name: {
        value: userProvided.degreeName || null,
        confidence: 1.0
      },
      board_university: {
        value: userProvided.board || null,
        confidence: 1.0
      },
      seat_number: {
        value: userProvided.seatNumber || null,
        confidence: 1.0
      },
      year_of_passing: {
        value: userProvided.yearOfPassing ? parseInt(userProvided.yearOfPassing, 10) : null,
        confidence: 1.0
      },
      percentage: {
        value: userProvided.percentage ? parseFloat(userProvided.percentage) : null,
        confidence: 1.0
      }
    },
    mismatch_fields: [],
    document_type: 'Education Certificate',
    tampered: false,
    bypass_mode: true,
    message: 'OCR verification is disabled. Document auto-verified.'
  };
};



/**
 * Main verification function - verify education document
 * @param {Object} userProvidedData - User-provided form data
 * @param {string} documentPath - Path to uploaded document file
 * @param {number} applicantId - Applicant ID (unused for now)
 * @param {string} educationLevelName - Education level name (unused for now)
 * @returns {Promise<Object>} Verification result
 */
const verifyEducationDocument = async (userProvidedData, documentPath, applicantId = null, educationLevelName = null) => {
  try {
    // Check if OCR is enabled
    if (!isOcrEnabled()) {
      return {
        status: 'success',
        verification_result: 'MATCHED',
        confidence_score: 1,
        extracted_data: userProvidedData,
        mismatches: [],
        is_year_of_passing_valid: true,
        is_percentage_valid: true,
        document_type: 'Education Certificate',
        tampered: false,
        bypass_mode: true,
        message: 'OCR verification is disabled. Document auto-verified.'
      };
    }

    logger.info('Starting OCR verification for education document', {
      documentPath,
      userProvided: {
        qualification: userProvidedData.qualification,
        yearOfPassing: userProvidedData.yearOfPassing
      }
    });

    // Call OpenAI Vision API to extract data
    const ocrResult = await analyzeEducationDocument(documentPath);

    if (!ocrResult.success) {
      throw new Error('OCR extraction failed');
    }

    const extractedData = ocrResult.data;

    // Basic blank/empty document checks
    const hasAnyExtractedValue = [
      extractedData?.qualification?.value,
      extractedData?.degree_name?.value,
      extractedData?.board_university?.value,
      extractedData?.seat_number?.value,
      extractedData?.year_of_passing?.value,
      extractedData?.percentage?.value
    ].some(Boolean);

    // Compare extracted data with user-provided data
    const comparison = compareData(userProvidedData, extractedData);

    // Calculate overall confidence score
    const confidenceScore = calculateConfidenceScore(
      extractedData,
      comparison.matchPercentage
    );

    // Check for tampering indicators
    const tamperingIndicators = extractedData.tampering_indicators || {};
    const isTampered = 
      tamperingIndicators.blank_background ||
      tamperingIndicators.inconsistent_fonts ||
      tamperingIndicators.image_artifacts ||
      false;

    // Format percentage values to always show 2 decimals
    if (extractedData.percentage?.value !== null && extractedData.percentage?.value !== undefined) {
      extractedData.percentage.value = parseFloat(extractedData.percentage.value).toFixed(2);
    }

    // Build response
    const response = {
      status: 'success',
      verification_result: comparison.verificationResult,
      confidence_score: confidenceScore,
      is_year_of_passing_valid: comparison.isYearValid,
      is_percentage_valid: comparison.isPercentageValid,
      extracted_data: {
        candidate_name: extractedData.candidate_name || { value: null, confidence: 0 },
        qualification: extractedData.qualification || { value: null, confidence: 0 },
        degree_name: extractedData.degree_name || { value: null, confidence: 0 },
        board_university: extractedData.board_university || { value: null, confidence: 0 },
        seat_number: extractedData.seat_number || { value: null, confidence: 0 },
        year_of_passing: extractedData.year_of_passing || { value: null, confidence: 0 },
        percentage: extractedData.percentage || { value: null, confidence: 0 }
      },
      mismatch_fields: comparison.mismatches,
      document_type: extractedData.document_type || 'Education Certificate',
      tampered: isTampered || !hasAnyExtractedValue,
      tampering_details: tamperingIndicators.overall_assessment || (!hasAnyExtractedValue ? 'No recognizable content detected' : null),
      tokens_used: ocrResult.tokensUsed || 0
    };

    // If nothing meaningful was extracted, force NOT_MATCHED
    if (!hasAnyExtractedValue) {
      response.verification_result = 'NOT_MATCHED';
      response.confidence_score = 0;
    }

    logger.info('OCR verification completed', {
      result: comparison.verificationResult,
      confidence: confidenceScore,
      mismatches: comparison.mismatches.length
    });

    return response;

  } catch (error) {
    logger.error('OCR verification error:', error);

    // Return error response
    return {
      status: 'error',
      verification_result: 'ERROR',
      confidence_score: 0,
      is_year_of_passing_valid: false,
      is_percentage_valid: false,
      extracted_data: null,
      mismatch_fields: [],
      document_type: null,
      tampered: false,
      error_message: error.message || 'Verification failed',
      error_code: error.status || 'VERIFICATION_ERROR'
    };
  }
};

module.exports = {
  verifyEducationDocument,
  isOcrEnabled
};
