const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const logger = require('../../config/logger');
const { ApiError } = require('../../middleware/errorHandler');
const db = require('../../models');

const truthy = (value) => ['true', '1', 'yes', 'on'].includes(String(value || '').toLowerCase());

const isGlobalOcrEnabled = async () => {
  const portalSetting = await db.PortalSetting.findOne({
    where: { setting_key: 'ocr_enabled' }
  });

  if (portalSetting?.setting_value === true || portalSetting?.setting_value === false) {
    return portalSetting.setting_value === true;
  }

  return truthy(process.env.OCR_ENABLED || process.env.OCR_VERIFICATION_ENABLED);
};

const getOcrApiUrl = () => process.env.OCR_API_URL || 'http://103.39.134.85:8000/ocr';

const getTimeoutMs = () => {
  const configured = Number(process.env.OCR_TIMEOUT_MS || 120000);
  return Number.isFinite(configured) && configured > 0 ? configured : 120000;
};

const getTokenSecret = () => (
  process.env.OCR_TOKEN_SECRET ||
  process.env.JWT_SECRET ||
  process.env.SESSION_SECRET ||
  'ocr-development-secret'
);

const normalizeText = (value) => String(value || '')
  .toLowerCase()
  .replace(/[^\p{L}\p{N}\s.]/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const normalizeCode = (value) => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const normalizeNumberText = (value) => String(value || '').replace(/[^0-9.]/g, '');

const hashFile = async (filePath) => {
  const buffer = await fs.promises.readFile(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
};

const normalizeVerificationInput = (userData = {}) => ({
  full_name: normalizeText(userData.full_name),
  degree_name: normalizeText(userData.degree_name || userData.degreeName),
  university_board: normalizeText(userData.university_board || userData.board),
  seat_number: normalizeCode(userData.seat_number || userData.seatNumber || userData.seatnumber),
  passing_year: userData.passing_year || userData.yearOfPassing ? String(userData.passing_year || userData.yearOfPassing) : null,
  percentage: userData.percentage === undefined || userData.percentage === null || userData.percentage === ''
    ? null
    : Number(userData.percentage).toFixed(2),
  cgpa: userData.cgpa === undefined || userData.cgpa === null || userData.cgpa === ''
    ? null
    : Number(userData.cgpa).toFixed(2)
});

const signPayload = (payload) => {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', getTokenSecret())
    .update(body)
    .digest('base64url');
  return `${body}.${signature}`;
};

const readSignedPayload = (token) => {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, signature] = token.split('.');
  const expected = crypto
    .createHmac('sha256', getTokenSecret())
    .update(body)
    .digest('base64url');
  if (signature.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
};

const createVerificationToken = async ({ applicantId, filePath, userData }) => {
  const fileHash = await hashFile(filePath);
  return signPayload({
    purpose: 'education_ocr_verified',
    applicant_id: Number(applicantId),
    file_hash: fileHash,
    input: normalizeVerificationInput(userData),
    exp: Date.now() + (15 * 60 * 1000)
  });
};

const isVerificationTokenValid = async ({ token, applicantId, filePath, userData }) => {
  const payload = readSignedPayload(token);
  if (!payload || payload.purpose !== 'education_ocr_verified') return false;
  if (payload.exp < Date.now()) return false;
  if (Number(payload.applicant_id) !== Number(applicantId)) return false;
  const fileHash = await hashFile(filePath);
  if (payload.file_hash !== fileHash) return false;
  return JSON.stringify(payload.input) === JSON.stringify(normalizeVerificationInput(userData));
};

const fieldValue = (fields, key) => {
  const raw = fields?.[key];
  if (raw && typeof raw === 'object' && Object.prototype.hasOwnProperty.call(raw, 'value')) {
    return raw.value;
  }
  return raw;
};

const buildCorpus = (ocrResponse) => {
  const fields = ocrResponse?.fields || {};
  return normalizeText([
    ...Object.values(fields).flatMap((value) => {
      if (Array.isArray(value)) return value;
      if (value && typeof value === 'object') return [value.value];
      return [value];
    }),
    ocrResponse?.search_text
  ].filter(Boolean).join(' '));
};

const tokens = (value) => normalizeText(value).split(' ').filter((token) => token.length >= 3);

const tokenMatch = (expected, actualText, minMatches = 1) => {
  const expectedTokens = tokens(expected);
  if (expectedTokens.length === 0) return false;
  const actual = ` ${normalizeText(actualText)} `;
  const matches = expectedTokens.filter((token) => actual.includes(` ${token} `));
  return matches.length >= Math.min(minMatches, expectedTokens.length);
};

const numberAppears = (expected, corpus) => {
  if (expected === undefined || expected === null || expected === '') return false;
  const expectedNumber = Number(expected);
  if (!Number.isFinite(expectedNumber)) return false;
  const fixed = expectedNumber.toFixed(2);
  const compactFixed = fixed.replace('.', '');
  const integer = String(Math.trunc(expectedNumber));
  const normalizedCorpus = normalizeNumberText(corpus);
  return (
    normalizedCorpus.includes(fixed) ||
    normalizedCorpus.includes(compactFixed) ||
    normalizedCorpus.includes(integer)
  );
};

const compareOcr = (userData, ocrResponse) => {
  const fields = ocrResponse?.fields || {};
  const corpus = buildCorpus(ocrResponse);
  const matches = [];
  const reasonCodes = [];
  const fieldResults = [];
  const supportingFields = new Set(['university_board']);

  const addMatch = (field, reason, source = 'ocr', details = {}) => {
    matches.push({ field, source });
    reasonCodes.push(reason);
    fieldResults.push({ field, matched: true, reason, ...details });
  };

  const addMiss = (field, details = {}) => {
    fieldResults.push({ field, matched: false, ...details });
  };

  const year = userData.passing_year || userData.yearOfPassing;
  if (year) {
    const yearText = String(year);
    const ocrYear = [
      fieldValue(fields, 'year'),
      fieldValue(fields, 'exam_month_year')
    ].filter(Boolean).join(' ');
    if (normalizeText(ocrYear).includes(yearText) || corpus.includes(yearText)) {
      addMatch('passing_year', 'year_found', 'ocr', { expected: yearText, actual: ocrYear || corpus });
    } else {
      addMiss('passing_year', { expected: yearText, actual: ocrYear || null });
    }
  }

  const seatNumber = userData.seat_number || userData.seatNumber || userData.seatnumber;
  if (seatNumber) {
    const expected = normalizeCode(seatNumber);
    const fieldSeat = normalizeCode(fieldValue(fields, 'seat_roll_no'));
    const corpusCode = normalizeCode(corpus);
    if (expected && (
      (fieldSeat && (fieldSeat.includes(expected) || expected.includes(fieldSeat))) ||
      corpusCode.includes(expected)
    )) {
      addMatch('seat_number', 'seat_roll_number_match', 'ocr', { expected, actual: fieldSeat || null });
    } else {
      addMiss('seat_number', { expected, actual: fieldSeat || null });
    }
  }

  const percentage = userData.percentage;
  if (percentage !== undefined && percentage !== null && percentage !== '') {
    const ocrPercentage = fieldValue(fields, 'percentage');
    if (numberAppears(percentage, `${ocrPercentage || ''} ${corpus}`)) {
      addMatch('percentage', 'percentage_found', 'ocr', { expected: Number(percentage).toFixed(2), actual: ocrPercentage || null });
    } else {
      addMiss('percentage', { expected: Number(percentage).toFixed(2), actual: ocrPercentage || null });
    }
  }

  const cgpa = userData.cgpa;
  if (cgpa !== undefined && cgpa !== null && cgpa !== '') {
    const ocrCgpa = fieldValue(fields, 'cgpa');
    if (numberAppears(cgpa, `${ocrCgpa || ''} ${corpus}`)) {
      addMatch('cgpa', 'cgpa_found', 'ocr', { expected: Number(cgpa).toFixed(2), actual: ocrCgpa || null });
    } else {
      addMiss('cgpa', { expected: Number(cgpa).toFixed(2), actual: ocrCgpa || null });
    }
  }

  const board = userData.university_board || userData.board;
  if (board) {
    const ocrBoard = fieldValue(fields, 'board_university');
    if (tokenMatch(board, `${ocrBoard || ''} ${corpus}`, 1)) {
      addMatch('university_board', 'board_university_token_match', 'ocr', { expected: board, actual: ocrBoard || null });
    } else {
      addMiss('university_board', { expected: board, actual: ocrBoard || null });
    }
  }

  const degree = userData.degree_name || userData.degreeName;
  if (degree) {
    const ocrExam = [fieldValue(fields, 'exam'), fieldValue(fields, 'exam_month_year')].filter(Boolean).join(' ');
    if (tokenMatch(degree, `${ocrExam} ${corpus}`, 1)) {
      addMatch('degree_name', 'degree_exam_token_match', 'ocr', { expected: degree, actual: ocrExam || null });
    } else {
      addMiss('degree_name', { expected: degree, actual: ocrExam || null });
    }
  }

  const fullName = userData.full_name;
  if (fullName) {
    const ocrName = fieldValue(fields, 'name');
    if (tokenMatch(fullName, `${ocrName || ''} ${corpus}`, 1)) {
      addMatch('full_name', 'name_token_match', 'ocr', { expected: fullName, actual: ocrName || null });
    } else {
      addMiss('full_name', { expected: fullName, actual: ocrName || null });
    }
  }

  const hasStrongMatch = matches.some((item) => !supportingFields.has(item.field));

  return {
    passed: hasStrongMatch,
    has_strong_match: hasStrongMatch,
    matches,
    reason_codes: reasonCodes,
    field_results: fieldResults,
    normalized: {
      provided: {
        full_name: normalizeText(userData.full_name),
        degree_name: normalizeText(degree),
        university_board: normalizeText(board),
        seat_number: normalizeCode(seatNumber),
        passing_year: year ? String(year) : null,
        percentage: percentage ?? null,
        cgpa: cgpa ?? null
      },
      ocr_fields: fields
    }
  };
};

const callOcrApi = async (filePath) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getTimeoutMs());
  const startedAt = Date.now();

  try {
    const form = new FormData();
    const buffer = await fs.promises.readFile(filePath);
    const blob = new Blob([buffer]);
    form.append('image', blob, path.basename(filePath));
    form.append('return_text', 'false');

    const response = await fetch(getOcrApiUrl(), {
      method: 'POST',
      body: form,
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`OCR API returned ${response.status}`);
    }
    const data = await response.json();
    logger.info('OCR API response received', {
      fileName: path.basename(filePath),
      durationMs: Date.now() - startedAt,
      isLikelyDocument: data?.is_likely_document,
      confidence: data?.ocr_confidence,
      fields: {
        name: fieldValue(data?.fields, 'name'),
        year: fieldValue(data?.fields, 'year'),
        board_university: fieldValue(data?.fields, 'board_university'),
        percentage: fieldValue(data?.fields, 'percentage'),
        cgpa: fieldValue(data?.fields, 'cgpa'),
        seat_roll_no: fieldValue(data?.fields, 'seat_roll_no')
      }
    });
    return data;
  } finally {
    clearTimeout(timeout);
  }
};

const getEffectiveOcrEnabled = async (applicantId) => {
  if (!(await isGlobalOcrEnabled())) {
    return { enabled: false, global_enabled: false, applicant_disabled: false };
  }

  const applicant = await db.ApplicantMaster.findByPk(applicantId, {
    attributes: ['applicant_id', 'ocr_disabled']
  });

  return {
    enabled: !!applicant && applicant.ocr_disabled !== true,
    global_enabled: true,
    applicant_disabled: applicant?.ocr_disabled === true
  };
};

const verifyEducationDocument = async (userData, documentPath, applicantId, options = {}) => {
  const startedAt = Date.now();
  if (options.preverifiedToken) {
    const isPreverified = await isVerificationTokenValid({
      token: options.preverifiedToken,
      applicantId,
      filePath: documentPath,
      userData
    });
    if (isPreverified) {
      return {
        passed: true,
        decision: 'preverified',
        preverified: true,
        ocr_enabled: true,
        message: 'Education document already verified for this card.',
        matches: [],
        reason_codes: ['preverified_token_valid']
      };
    }
  }

  const effective = options.skipApplicantCheck
    ? { enabled: await isGlobalOcrEnabled(), global_enabled: await isGlobalOcrEnabled(), applicant_disabled: false }
    : await getEffectiveOcrEnabled(applicantId);

  if (!effective.enabled) {
    return {
      passed: true,
      decision: 'bypassed',
      bypassed: true,
      ocr_enabled: false,
      message: effective.global_enabled
        ? 'OCR verification is disabled for this applicant.'
        : 'OCR verification is disabled globally.',
      matches: [],
      reason_codes: [effective.global_enabled ? 'applicant_ocr_disabled' : 'global_ocr_disabled']
    };
  }

  let ocrResponse;
  let comparison;
  try {
    logger.info('Starting education OCR verification', {
      applicantId,
      fileName: path.basename(documentPath),
      timeoutMs: getTimeoutMs(),
      ocrEnabled: effective.enabled,
      userInput: normalizeVerificationInput(userData)
    });

    ocrResponse = await callOcrApi(documentPath);

    if (ocrResponse?.is_likely_document !== true) {
      logger.warn('OCR document check failed', {
        applicantId,
        fileName: path.basename(documentPath),
        durationMs: Date.now() - startedAt,
        isLikelyDocument: ocrResponse?.is_likely_document
      });
      throw new ApiError(400, 'Uploaded file does not look like a valid education document. Please upload a clear marksheet/certificate.');
    }

    comparison = compareOcr(userData, ocrResponse);
    logger.info('Education OCR comparison completed', {
      applicantId,
      fileName: path.basename(documentPath),
      durationMs: Date.now() - startedAt,
      matchedFields: comparison.matches.map((item) => item.field),
      reasonCodes: comparison.reason_codes,
      fieldResults: comparison.field_results
    });

    if (!comparison.passed) {
      const summary = comparison.field_results
        .filter((item) => !item.matched)
        .slice(0, 3)
        .map((item) => `${item.field}: expected "${item.expected ?? '-'}", found "${item.actual ?? 'not detected'}"`)
        .join('; ');
      throw new ApiError(400, `Could not verify the entered education details from the uploaded document. ${summary || 'Please upload a clearer document or check year, seat number, board, percentage/CGPA.'}`);
    }

    logger.info('Education OCR verification passed', {
      applicantId,
      fileName: path.basename(documentPath),
      durationMs: Date.now() - startedAt,
      matchedFields: comparison.matches.map((item) => item.field)
    });

    return {
      passed: true,
      decision: 'passed',
      ocr_enabled: true,
      message: 'Education document verified successfully.',
      matches: comparison.matches,
      reason_codes: comparison.reason_codes,
      ocr_response: ocrResponse,
      verification_token: await createVerificationToken({ applicantId, filePath: documentPath, userData })
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    logger.error('Education OCR verification failed', {
      applicantId,
      documentPath,
      durationMs: Date.now() - startedAt,
      message: error.message,
      name: error.name
    });
    throw new ApiError(502, 'OCR verification service is taking too long or unavailable. It can take up to 1 minute. Please wait and try again with a clear document if needed.');
  }
};

module.exports = {
  isGlobalOcrEnabled,
  getEffectiveOcrEnabled,
  verifyEducationDocument,
  compareOcr,
  createVerificationToken,
  isVerificationTokenValid
};
