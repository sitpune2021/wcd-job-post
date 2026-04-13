/**
 * HRM Excel Utilities
 * Handles Excel template generation and parsing for employee import/export
 */

const ExcelJS = require('exceljs');
const db = require('../../../models');
const { ApiError } = require('../../../middleware/errorHandler');
const logger = require('../../../config/logger');

/**
 * Fetch lookup data for dropdowns
 */
async function fetchLookups() {
  const [districts, hubs, components, posts] = await Promise.all([
    db.DistrictMaster.scope('onlyActive').findAll({ 
      attributes: ['district_id', 'district_name'], 
      order: [['district_name', 'ASC']] 
    }),
    db.Hub.scope('withDeleted').findAll({ 
      attributes: ['hub_id', 'hub_name'], 
      where: { is_deleted: false }, 
      order: [['hub_name', 'ASC']] 
    }),
    db.Component.scope('onlyActive').findAll({ 
      attributes: ['component_id', 'component_name'], 
      order: [['component_name', 'ASC']] 
    }),
    db.PostMaster.findAll({ 
      attributes: ['post_id', 'post_name', 'post_code'], 
      where: { is_deleted: false }, 
      order: [['post_name', 'ASC']] 
    })
  ]);

  return { districts, hubs, components, posts };
}

/**
 * Generate Excel template for employee import
 */
async function generateTemplate(res) {
  try {
    const lookups = await fetchLookups();

    // Create workbook
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Onboarding');
    const dataSheet = wb.addWorksheet('Data');
    dataSheet.state = 'hidden';

    // Add validation lists to hidden sheet
    // Column 1: District names only (for dropdown display)
    dataSheet.getColumn(1).values = ['Districts', ...lookups.districts.map(d => d.district_name)];
    // Column 2: Hub names only (for dropdown display)
    dataSheet.getColumn(2).values = ['Hubs', ...lookups.hubs.map(h => h.hub_name)];
    // Column 3: OSC names only (for dropdown display)
    dataSheet.getColumn(3).values = ['OSCs', ...lookups.components.map(c => c.component_name)];
    // Column 4: Post names only (for dropdown display)
    dataSheet.getColumn(4).values = ['Posts', ...lookups.posts.map(p => {
      return p.post_code ? `${p.post_name} (${p.post_code})` : p.post_name;
    })];
    
    // Columns 5-8: Hidden ID mappings (for lookup during import)
    dataSheet.getColumn(5).values = ['District_IDs', ...lookups.districts.map(d => d.district_id)];
    dataSheet.getColumn(6).values = ['Hub_IDs', ...lookups.hubs.map(h => h.hub_id)];
    dataSheet.getColumn(7).values = ['OSC_IDs', ...lookups.components.map(c => c.component_id)];
    dataSheet.getColumn(8).values = ['Post_IDs', ...lookups.posts.map(p => p.post_id)];

    // Helper function to build range
    const listRange = (colLetter, list) => {
      const lastRow = list.length + 1;
      return `Data!$${colLetter}$2:$${colLetter}$${lastRow}`;
    };

    // Header row
    const headers = [
      'District',
      'Hub',
      'OSC',
      'Post',
      'Monthly Pay',
      'Start Date (DD/MM/YYYY)',
      'End Date (DD/MM/YYYY)',
      'Full Name',
      'Email',
      'Date of Birth (DD/MM/YYYY)',
      'Gender (Male/Female/Other)'
    ];

    // Instructions row
    ws.mergeCells('A1:K1');
    ws.getCell('A1').value = 'Instructions: Select values from dropdowns. Monthly Pay: Enter numeric value (e.g., 25000). Start Date, End Date & DOB format: DD/MM/YYYY. Gender: Male/Female/Other. One row per employee. IDs are hidden for security - just select names from dropdowns.';
    ws.getCell('A1').alignment = { wrapText: true };
    ws.getRow(1).height = 30;

    // Add headers
    ws.addRow(headers);
    ws.getRow(2).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };

    // Apply dropdown validation for first 100 rows
    const maxRows = 100;
    const districtRange = listRange('A', lookups.districts);
    const hubRange = listRange('B', lookups.hubs);
    const oscRange = listRange('C', lookups.components);
    const postRange = listRange('D', lookups.posts);

    for (let i = 3; i < 3 + maxRows; i++) {
      ws.getCell(`A${i}`).dataValidation = { type: 'list', allowBlank: false, formulae: [districtRange] };
      ws.getCell(`B${i}`).dataValidation = { type: 'list', allowBlank: false, formulae: [hubRange] };
      ws.getCell(`C${i}`).dataValidation = { type: 'list', allowBlank: false, formulae: [oscRange] };
      ws.getCell(`D${i}`).dataValidation = { type: 'list', allowBlank: false, formulae: [postRange] };
      
      // Gender dropdown (moved to column K)
      ws.getCell(`K${i}`).dataValidation = { 
        type: 'list', 
        allowBlank: false, 
        formulae: ['"Male,Female,Other"'] 
      };
    }

    // Column widths
    ws.columns = [
      { width: 25 }, // District
      { width: 25 }, // Hub
      { width: 25 }, // OSC
      { width: 35 }, // Post
      { width: 18 }, // Monthly Pay
      { width: 20 }, // Start Date
      { width: 20 }, // End Date
      { width: 30 }, // Full Name
      { width: 30 }, // Email
      { width: 20 }, // DOB
      { width: 18 }  // Gender
    ];

    // Set response headers
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=employee_onboarding_template.xlsx');

    // Write to response
    await wb.xlsx.write(res);
    res.end();
  } catch (error) {
    logger.error('Error generating Excel template:', error);
    throw error;
  }
}

/**
 * Parse Excel file and extract employee data
 */
async function parseExcelFile(buffer) {
  try {
    // Load workbook
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    
    // Get worksheets
    const ws = wb.getWorksheet('Onboarding');
    const dataSheet = wb.getWorksheet('Data');
    
    if (!ws) {
      throw ApiError.badRequest('Invalid template: Onboarding sheet not found');
    }
    if (!dataSheet) {
      throw ApiError.badRequest('Invalid template: Data sheet not found');
    }

    // Parse data
    const employees = [];
    let startRow = 3; // Data starts from row 3

    for (let rowNum = startRow; rowNum <= ws.rowCount; rowNum++) {
      const row = ws.getRow(rowNum);
      
      // Skip empty rows
      if (!row.getCell(1).value) continue;

      // Helper to lookup ID by name from data sheet
      const lookupIdByName = (name, dataColumn, idColumn) => {
        if (!name) return null;
        const nameStr = name.toString().trim();
        
        // Find the name in the data sheet
        for (let i = 2; i <= dataSheet.rowCount; i++) {
          if (dataSheet.getCell(i, dataColumn).value === nameStr) {
            return dataSheet.getCell(i, idColumn).value;
          }
        }
        
        logger.warn(`Name not found: ${nameStr}`);
        return null;
      };

      // Helper to extract email text (handle hyperlinks)
      const extractEmail = (cell) => {
        if (!cell || !cell.value) return null;
        
        // If it's a hyperlink object, extract the text
        if (cell.value && typeof cell.value === 'object' && cell.value.text) {
          return cell.value.text;
        }
        
        // Otherwise return the string value
        return cell.value.toString();
      };

      // Helper to parse Yes/No to boolean
      const parseYesNo = (value) => {
        if (!value) return null;
        const str = value.toString().toLowerCase();
        return str === 'yes' || str === 'true' || str === '1';
      };

      const employee = {
        district_id: lookupIdByName(row.getCell(1).value, 1, 5), // Name from col 1, ID from col 5
        hub_id: lookupIdByName(row.getCell(2).value, 2, 6), // Name from col 2, ID from col 6
        component_id: lookupIdByName(row.getCell(3).value, 3, 7), // Name from col 3, ID from col 7
        post_id: lookupIdByName(row.getCell(4).value, 4, 8), // Name from col 4, ID from col 8
        employee_pay: row.getCell(5).value ? parseFloat(row.getCell(5).value) : null, // Monthly Pay
        contract_start_date: row.getCell(6).value, // Start Date
        contract_end_date: row.getCell(7).value, // End Date
        full_name: row.getCell(8).value,
        email: extractEmail(row.getCell(9)),
        dob: row.getCell(10).value, // Date of Birth
        gender: row.getCell(11).value // Gender
      };

      // Validate required fields
      if (!employee.district_id || !employee.post_id || !employee.contract_start_date || !employee.full_name || !employee.email || !employee.dob || !employee.gender) {
        const missingFields = [];
        if (!employee.district_id) missingFields.push('District (select from dropdown)');
        if (!employee.post_id) missingFields.push('Post (select from dropdown)');
        if (!employee.hub_id && !employee.component_id) missingFields.push('Hub or OSC (select from dropdown)');
        if (!employee.contract_start_date) missingFields.push('Start Date');
        if (!employee.full_name) missingFields.push('Full Name');
        if (!employee.email) missingFields.push('Email');
        if (!employee.dob) missingFields.push('Date of Birth');
        if (!employee.gender) missingFields.push('Gender');
        
        throw ApiError.badRequest(`Row ${rowNum}: Missing or invalid fields: ${missingFields.join(', ')}. Please ensure all dropdown values are selected correctly.`);
      }

      // Validate either hub_id or component_id is provided
      if (!employee.hub_id && !employee.component_id) {
        throw ApiError.badRequest(`Row ${rowNum}: Either Hub or OSC must be selected from dropdown`);
      }

      employees.push(employee);
    }

    if (employees.length === 0) {
      throw ApiError.badRequest('No employee data found in the Excel file');
    }

    return employees;
  } catch (error) {
    logger.error('Error parsing Excel file:', error);
    throw error;
  }
}

/**
 * Validate employee data against HRM scope
 */
function validateHRMScope(employees, hrmScope) {
  if (!hrmScope || !hrmScope.filters) return;

  employees.forEach(emp => {
    Object.keys(hrmScope.filters).forEach(key => {
      if (hrmScope.filters[key] && emp[key] !== hrmScope.filters[key]) {
        throw ApiError.forbidden(`Employee data outside your access scope: ${key}`);
      }
    });
  });
}

/**
 * Configure multer for Excel uploads
 */
const multer = require('multer');
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    // Accept only Excel files
    if (file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || 
        file.mimetype === 'application/vnd.ms-excel') {
      cb(null, true);
    } else {
      cb(new Error('Only Excel files are allowed'), false);
    }
  },
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  }
});

module.exports = {
  generateTemplate,
  parseExcelFile,
  validateHRMScope,
  upload
};
