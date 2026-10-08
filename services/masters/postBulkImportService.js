const ExcelJS = require('exceljs');
const { Op } = require('sequelize');
const db = require('../../models');
const { ApiError } = require('../../middleware/errorHandler');
const { createPost } = require('./postMasterService');

const TEMPLATE_SHEET_NAME = 'Post Upload';
const MAX_IMPORT_ROWS = 500;
const HEADERS = [
  'Post Code*',
  'Post Name*',
  'Post Name Marathi',
  'District Name*',
  'Scheme (District)*',
  'Min Education Code*',
  'Max Education Code',
  'Min Experience Months*',
  'Min Age*',
  'Max Age',
  'Total Positions*',
  'Monthly Amount',
  'Experience Domain Code',
  'Gender Eligibility*',
  'Description',
  'Description Marathi'
];

const normalizeText = (value) => String(value ?? '').trim();
const normalizeKey = (value) => normalizeText(value).toUpperCase();
const isBlankRow = (values) => values.every((value) => !normalizeText(value));

const parseInteger = (value, field, rowNumber, { required = false, min = 0 } = {}) => {
  const raw = normalizeText(value);
  if (!raw) {
    if (required) throw new Error(`${field} is required`);
    return null;
  }
  if (!/^\d+$/.test(raw)) throw new Error(`${field} must be a whole number`);
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < min) {
    throw new Error(`${field} must be ${min === 0 ? 'zero or greater' : `at least ${min}`}`);
  }
  return parsed;
};

const parseAmount = (value) => {
  const raw = normalizeText(value);
  if (!raw) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
    throw new Error('Monthly Amount must be a valid amount with up to two decimal places');
  }
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount < 0) throw new Error('Monthly Amount must be zero or greater');
  return amount;
};

const parseGender = (value) => {
  const normalized = normalizeKey(value);
  if (!normalized) throw new Error('Gender Eligibility is required');
  if (normalized === 'ALL') return { female_only: false, male_only: false };
  if (normalized === 'FEMALE') return { female_only: true, male_only: false };
  if (normalized === 'MALE') return { female_only: false, male_only: true };
  throw new Error('Gender Eligibility must be ALL, FEMALE, or MALE');
};

const getCellText = (row, index) => {
  const value = row.getCell(index).value;
  if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'text')) {
    return value.text;
  }
  return value ?? '';
};

const buildReferenceData = async (transaction) => {
  const [districts, schemes, educationLevels, experienceDomains] = await Promise.all([
    db.DistrictMaster.findAll({
      where: { is_active: true, is_deleted: false },
      attributes: ['district_id', 'district_name'],
      order: [['district_name', 'ASC']],
      transaction
    }),
    db.Scheme.findAll({
      where: { is_active: true, is_deleted: false },
      attributes: ['scheme_id', 'scheme_code', 'scheme_name', 'district_id'],
      order: [['scheme_name', 'ASC'], ['scheme_code', 'ASC']],
      transaction
    }),
    db.EducationLevel.findAll({
      where: { is_active: true, is_deleted: false },
      attributes: ['level_id', 'level_code', 'level_name'],
      order: [['display_order', 'ASC'], ['level_name', 'ASC']],
      transaction
    }),
    db.ExperienceDomain.findAll({
      where: { is_active: true, is_deleted: false },
      attributes: ['id', 'domain_code'],
      order: [['domain_code', 'ASC']],
      transaction
    })
  ]);

  return { districts, schemes, educationLevels, experienceDomains };
};

const validateDrive = async (recruitmentDriveId, transaction) => {
  const parsedId = Number(recruitmentDriveId);
  if (!Number.isSafeInteger(parsedId) || parsedId <= 0) {
    throw ApiError.badRequest('A recruitment drive must be selected before downloading or uploading posts');
  }
  const drive = await db.RecruitmentDrive.findByPk(parsedId, { transaction });
  if (!drive) throw ApiError.notFound('Recruitment drive not found');
  return drive;
};

const writeReferenceList = (worksheet, values, columnNumber) => {
  if (!values.length) return;
  const firstReferenceRow = 2;
  const lastReferenceRow = firstReferenceRow + values.length - 1;
  const referenceColumn = worksheet.getColumn(columnNumber);
  referenceColumn.hidden = true;
  values.forEach((value, index) => {
    worksheet.getCell(firstReferenceRow + index, referenceColumn.number).value = value;
  });
  return {
    column: referenceColumn.letter,
    firstRow: firstReferenceRow,
    lastRow: lastReferenceRow
  };
};

const addValidationList = (worksheet, address, values, columnNumber, name) => {
  const reference = writeReferenceList(worksheet, values, columnNumber);
  if (!reference) return;
  if (name) worksheet.workbook.definedNames.add(
    `'${worksheet.name}'!$${reference.column}$${reference.firstRow}:$${reference.column}$${reference.lastRow}`,
    name
  );
  worksheet.dataValidations.add(address, {
    type: 'list',
    allowBlank: true,
    formulae: [name ? name : `$${reference.column}$${reference.firstRow}:$${reference.column}$${reference.lastRow}`],
    showErrorMessage: true,
    errorTitle: 'Choose a listed value',
    error: 'Use the dropdown values supplied in this template.'
  });
};

const getSchemeLabel = (scheme, districtName, duplicateLabels) => {
  const baseName = normalizeText(scheme.scheme_name) || normalizeText(scheme.scheme_code);
  const location = normalizeText(districtName) || 'State-level';
  const baseLabel = `${baseName} (${location})`;
  return duplicateLabels.has(baseLabel) ? `${baseLabel} [${scheme.scheme_code}]` : baseLabel;
};

const getDistrictSchemeOptions = (referenceData) => {
  const districtsById = new Map(referenceData.districts.map((row) => [Number(row.district_id), row]));
  const baseLabels = referenceData.schemes.map((scheme) => {
    const district = districtsById.get(Number(scheme.district_id));
    return `${normalizeText(scheme.scheme_name) || normalizeText(scheme.scheme_code)} (${normalizeText(district?.district_name) || 'State-level'})`;
  });
  const duplicateLabels = new Set(baseLabels.filter((label, index) => baseLabels.indexOf(label) !== index));
  const schemes = referenceData.schemes.map((scheme) => {
    const district = districtsById.get(Number(scheme.district_id));
    return {
      scheme_id: scheme.scheme_id,
      scheme_code: scheme.scheme_code,
      scheme_name: scheme.scheme_name,
      district_id: scheme.district_id,
      upload_label: getSchemeLabel(scheme, district?.district_name, duplicateLabels)
    };
  });
  const byDistrict = new Map();
  referenceData.districts.forEach((district) => {
    byDistrict.set(Number(district.district_id), schemes
      .filter((scheme) => !scheme.district_id || Number(scheme.district_id) === Number(district.district_id))
      .sort((a, b) => a.upload_label.localeCompare(b.upload_label)));
  });
  return { schemes, byDistrict };
};

const downloadTemplate = async (recruitmentDriveId) => {
  const transaction = await db.sequelize.transaction({ readOnly: true });
  try {
    const [drive, referenceData] = await Promise.all([
      validateDrive(recruitmentDriveId, transaction),
      buildReferenceData(transaction)
    ]);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Mission Shakti';
    const worksheet = workbook.addWorksheet(TEMPLATE_SHEET_NAME, { views: [{ state: 'frozen', ySplit: 1 }] });
    worksheet.addRow(HEADERS);
    const districtSchemeOptions = getDistrictSchemeOptions(referenceData);
    const sampleDistrict = referenceData.districts[0];
    const sampleScheme = districtSchemeOptions.byDistrict.get(Number(sampleDistrict?.district_id))?.[0];
    worksheet.addRow([
      'REPLACE_THIS_SAMPLE',
      'Example Post Name',
      '',
      sampleDistrict?.district_name || '',
      sampleScheme?.upload_label || '',
      referenceData.educationLevels[0]?.level_code || '',
      '',
      0,
      21,
      '',
      1,
      '',
      '',
      'ALL',
      '',
      ''
    ]);

    const header = worksheet.getRow(1);
    header.font = { bold: true };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
    header.alignment = { vertical: 'middle', wrapText: true };
    worksheet.autoFilter = { from: 'A1', to: 'P1' };

    const widths = [22, 30, 28, 20, 24, 24, 24, 22, 12, 12, 18, 18, 28, 20, 36, 36];
    widths.forEach((width, index) => { worksheet.getColumn(index + 1).width = width; });

    const districtNames = referenceData.districts.map((row) => row.district_name);
    addValidationList(worksheet, 'D2:D501', districtNames, 17, 'DistrictNames');
    const districtIds = referenceData.districts.map((row) => Number(row.district_id));
    writeReferenceList(worksheet, districtIds, 18);
    worksheet.workbook.definedNames.add(
      `'${worksheet.name}'!$R$2:$R$${districtIds.length + 1}`,
      'DistrictKeys'
    );
    const districtKeyColumn = 'R';
    const districtNameColumn = 'Q';
    const districtNameCount = districtNames.length;
    referenceData.districts.forEach((district, index) => {
      const options = districtSchemeOptions.byDistrict.get(Number(district.district_id)) || [];
      const columnNumber = 19 + index;
      const reference = writeReferenceList(worksheet, options.map((scheme) => scheme.upload_label), columnNumber);
      if (reference) {
        worksheet.workbook.definedNames.add(
          `'${worksheet.name}'!$${reference.column}$${reference.firstRow}:$${reference.column}$${reference.lastRow}`,
          `SchemeDistrict_${district.district_id}`
        );
      }
    });
    const allSchemesColumn = 19 + referenceData.districts.length;
    const allSchemeReference = writeReferenceList(
      worksheet,
      districtSchemeOptions.schemes.map((scheme) => scheme.upload_label).sort((a, b) => a.localeCompare(b)),
      allSchemesColumn
    );
    if (allSchemeReference) {
      worksheet.workbook.definedNames.add(
        `'${worksheet.name}'!$${allSchemeReference.column}$${allSchemeReference.firstRow}:$${allSchemeReference.column}$${allSchemeReference.lastRow}`,
        'SchemeAll'
      );
    }
    const referenceListStart = allSchemesColumn + 1;
    addValidationList(worksheet, 'F2:F501', referenceData.educationLevels.map((row) => row.level_code), referenceListStart, 'EducationCodes');
    addValidationList(worksheet, 'G2:G501', referenceData.educationLevels.map((row) => row.level_code), referenceListStart + 1, 'MaxEducationCodes');
    addValidationList(worksheet, 'M2:M501', referenceData.experienceDomains.map((row) => row.domain_code), referenceListStart + 2, 'ExperienceDomainCodes');
    worksheet.dataValidations.add('E2:E501', {
      type: 'list',
      allowBlank: true,
      formulae: [`INDIRECT(IF($D2="","SchemeAll","SchemeDistrict_"&INDEX($${districtKeyColumn}$2:$${districtKeyColumn}$${districtNameCount + 1},MATCH($D2,$${districtNameColumn}$2:$${districtNameColumn}$${districtNameCount + 1},0))))`],
      showErrorMessage: true,
      errorTitle: 'Choose a valid scheme',
      error: 'Leave District blank to choose from all schemes, or select a district to narrow this list.'
    });
    worksheet.dataValidations.add('N2:N501', {
      type: 'list',
      allowBlank: false,
      formulae: ['"ALL,FEMALE,MALE"'],
      showErrorMessage: true,
      errorTitle: 'Choose a listed value',
      error: 'Gender Eligibility must be ALL, FEMALE, or MALE.'
    });

    worksheet.getCell('A1').note = 'Required. Must be unique. Replace the example value before upload.';
    worksheet.getCell('D1').note = 'Required. Choose a district name from the dropdown.';
    worksheet.getCell('E1').note = 'Required. Leave District blank for all schemes, or select a district to narrow this list. The value includes the scheme name and district.';
    worksheet.getCell('F1').note = 'Required. Choose an education code from the dropdown.';
    worksheet.getCell('H1').note = 'Required. Use 0 when no experience is required.';
    worksheet.getCell('K1').note = 'Required. Must be at least 1.';
    worksheet.getCell('N1').note = 'Required. ALL, FEMALE, or MALE.';

    await transaction.commit();
    return {
      buffer: await workbook.xlsx.writeBuffer(),
      fileName: `post_upload_template_${drive.drive_code || drive.recruitment_drive_id}.xlsx`
    };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};

const buildLookups = (referenceData) => ({
  districts: new Map(referenceData.districts.map((row) => [normalizeKey(row.district_name), row])),
  schemesByCode: new Map(referenceData.schemes.map((row) => [normalizeKey(row.scheme_code), row])),
  schemesByLabel: new Map(getSchemeLabelLookups(referenceData)),
  educationLevels: new Map(referenceData.educationLevels.map((row) => [normalizeKey(row.level_code), row])),
  experienceDomains: new Map(referenceData.experienceDomains.map((row) => [normalizeKey(row.domain_code), row]))
});

const getSchemeLabelLookups = (referenceData) => {
  const districtsById = new Map(referenceData.districts.map((row) => [Number(row.district_id), row]));
  const baseLabels = referenceData.schemes.map((scheme) => `${normalizeText(scheme.scheme_name) || normalizeText(scheme.scheme_code)} (${normalizeText(districtsById.get(Number(scheme.district_id))?.district_name) || 'State-level'})`);
  const duplicateLabels = new Set(baseLabels.filter((label, index) => baseLabels.indexOf(label) !== index));
  return referenceData.schemes.map((scheme) => {
    const label = getSchemeLabel(scheme, districtsById.get(Number(scheme.district_id))?.district_name, duplicateLabels);
    return [normalizeKey(label), scheme];
  });
};

const parseRow = (row, rowNumber, lookups) => {
  const values = HEADERS.map((_, index) => getCellText(row, index + 1));
  if (isBlankRow(values)) return null;

  const postCode = normalizeText(values[0]);
  const postName = normalizeText(values[1]);
  if (!postCode) throw new Error('Post Code is required');
  if (normalizeKey(postCode) === 'REPLACE_THIS_SAMPLE') {
    throw new Error('Replace or remove the sample row before uploading');
  }
  if (!postName) throw new Error('Post Name is required');

  const district = lookups.districts.get(normalizeKey(values[3]));
  if (!district) throw new Error('District Name must match an active district from the dropdown');
  const scheme = lookups.schemesByLabel.get(normalizeKey(values[4]))
    || lookups.schemesByCode.get(normalizeKey(values[4]));
  if (!scheme) throw new Error('Scheme must match an active scheme from the dropdown');
  if (scheme.district_id && Number(scheme.district_id) !== Number(district.district_id)) {
    throw new Error('Selected Scheme does not belong to the selected District Name');
  }

  const minEducation = lookups.educationLevels.get(normalizeKey(values[5]));
  if (!minEducation) throw new Error('Min Education Code must match an active education level from the dropdown');
  const maxEducationCode = normalizeText(values[6]);
  const maxEducation = maxEducationCode ? lookups.educationLevels.get(normalizeKey(maxEducationCode)) : null;
  if (maxEducationCode && !maxEducation) throw new Error('Max Education Code must match an active education level from the dropdown');

  const experienceDomainCode = normalizeText(values[12]);
  const experienceDomain = experienceDomainCode
    ? lookups.experienceDomains.get(normalizeKey(experienceDomainCode))
    : null;
  if (experienceDomainCode && !experienceDomain) {
    throw new Error('Experience Domain Code must match an active experience domain from the dropdown');
  }

  return {
    post_code: postCode,
    post_name: postName,
    post_name_mr: normalizeText(values[2]) || null,
    district_id: district.district_id,
    district_specific: true,
    scheme_id: scheme.scheme_id,
    min_education_level_id: minEducation.level_id,
    max_education_level_id: maxEducation?.level_id || null,
    min_experience_months: parseInteger(values[7], 'Min Experience Months', rowNumber, { required: true }),
    min_age: parseInteger(values[8], 'Min Age', rowNumber, { required: true }),
    max_age: parseInteger(values[9], 'Max Age', rowNumber),
    total_positions: parseInteger(values[10], 'Total Positions', rowNumber, { required: true, min: 1 }),
    amount: parseAmount(values[11]),
    experience_domain_id: experienceDomain?.id || null,
    ...parseGender(values[13]),
    description: normalizeText(values[14]) || null,
    description_mr: normalizeText(values[15]) || null
  };
};

const uploadPosts = async ({ recruitmentDriveId, fileBuffer, adminId }) => {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(fileBuffer);
  } catch (_error) {
    throw ApiError.badRequest('Invalid Excel file. Download the current template and use the .xlsx file without changing its headers.');
  }

  if (workbook.worksheets.length !== 1) {
    throw ApiError.badRequest('The post upload file must contain exactly one worksheet.');
  }
  const worksheet = workbook.getWorksheet(TEMPLATE_SHEET_NAME) || workbook.worksheets[0];
  const uploadedHeaders = HEADERS.map((_, index) => normalizeText(getCellText(worksheet.getRow(1), index + 1)));
  const invalidHeaders = HEADERS.filter((header, index) => uploadedHeaders[index] !== header);
  if (invalidHeaders.length) {
    throw ApiError.badRequest('Invalid template headers. Download a new Post Upload template before importing.');
  }

  const transaction = await db.sequelize.transaction();
  try {
    const [drive, referenceData] = await Promise.all([
      validateDrive(recruitmentDriveId, transaction),
      buildReferenceData(transaction)
    ]);
    const lookups = buildLookups(referenceData);
    const errors = [];
    const rows = [];
    const codes = new Map();

    for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      try {
        const parsed = parseRow(worksheet.getRow(rowNumber), rowNumber, lookups);
        if (!parsed) continue;
        const normalizedCode = normalizeKey(parsed.post_code);
        if (codes.has(normalizedCode)) {
          throw new Error(`Post Code duplicates row ${codes.get(normalizedCode)}`);
        }
        codes.set(normalizedCode, rowNumber);
        rows.push({ rowNumber, data: parsed });
      } catch (error) {
        errors.push({ field: `row_${rowNumber}`, message: `Row ${rowNumber}: ${error.message}` });
      }
    }

    if (rows.length > MAX_IMPORT_ROWS) {
      errors.push({ field: 'file', message: `A maximum of ${MAX_IMPORT_ROWS} posts can be imported at one time.` });
    }
    if (!rows.length && !errors.length) {
      errors.push({ field: 'file', message: 'The file has no post rows to import.' });
    }

    if (rows.length) {
      const existingPosts = await db.PostMaster.findAll({
        where: {
          [Op.or]: rows.map(({ data }) => db.sequelize.where(
            db.sequelize.fn('LOWER', db.sequelize.col('post_code')),
            normalizeKey(data.post_code)
          ))
        },
        attributes: ['post_code'],
        transaction
      });
      const existingCodes = new Set(existingPosts.map((post) => normalizeKey(post.post_code)));
      rows.forEach(({ rowNumber, data }) => {
        if (existingCodes.has(normalizeKey(data.post_code))) {
          errors.push({ field: `row_${rowNumber}`, message: `Row ${rowNumber}: Post Code already exists.` });
        }
      });
    }

    if (errors.length) {
      await transaction.rollback();
      throw ApiError.validation(errors.slice(0, 100), `Import stopped: ${errors.length} validation issue${errors.length === 1 ? '' : 's'} found. No posts were created.`);
    }

    const createdPosts = [];
    for (const { data } of rows) {
      createdPosts.push(await createPost({ ...data, recruitment_drive_id: drive.recruitment_drive_id }, adminId, { transaction }));
    }
    await transaction.commit();
    return { created_count: createdPosts.length, recruitment_drive_id: drive.recruitment_drive_id };
  } catch (error) {
    if (!transaction.finished) await transaction.rollback();
    throw error;
  }
};

module.exports = { downloadTemplate, uploadPosts };
