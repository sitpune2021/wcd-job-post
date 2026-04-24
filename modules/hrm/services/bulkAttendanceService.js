const { BulkAttendance } = require('../models');
const { EmployeeMaster, Attendance } = require('../models');
const db = require('../../../models');
const { AdminUser } = db;
const { generateUniqueId } = require('../../../utils/idGenerator');
const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs').promises;
const { Op } = require('sequelize');
const { ApiError } = require('../../../middleware/errorHandler');
const logger = require('../../../config/logger');
const { getEmployeeIdsUnderAdmin, buildHierarchyFilter } = require('../utils/hrmHelpers');

/**
 * Service for managing bulk attendance with simple approval workflow
 */
class BulkAttendanceService {
  /**
   * Download attendance template with employee list based on admin's hierarchy
   * @param {Object} adminUser - Admin user object
   * @param {Object} query - Query parameters (date, month, year)
   * @returns {Promise<Object>} - Template file path and metadata
   */
  async downloadTemplate(adminUser, query) {
    try {
      const { month, year, district_id, component_id, hub_id } = query;
      
      // Validate month and year
      if (!month || !year) {
        throw ApiError.badRequest('Month and year are required');
      }
      
      const monthNum = parseInt(month);
      const yearNum = parseInt(year);
      
      if (monthNum < 1 || monthNum > 12) {
        throw ApiError.badRequest('Invalid month. Must be between 1 and 12');
      }
      
      // Get employees under admin's jurisdiction with additional filters
      const employeeIds = await getEmployeeIdsUnderAdmin(adminUser, EmployeeMaster);
      
      if (employeeIds.length === 0) {
        throw ApiError.notFound('No employees found under your jurisdiction');
      }

      // Build additional filter conditions
      const additionalFilters = {};
      if (district_id) additionalFilters.district_id = parseInt(district_id);
      if (component_id) additionalFilters.component_id = parseInt(component_id);
      if (hub_id) additionalFilters.hub_id = parseInt(hub_id);

      // Get employee details with filters
      const employeeWhere = {
        employee_id: { [Op.in]: employeeIds },
        ...additionalFilters,
        is_deleted: false,
        is_active: true
      };
      const employees = await EmployeeMaster.findAll({
        where: employeeWhere,
        include: [
          { model: db.PostMaster, as: 'post', attributes: ['post_name'], where: { is_deleted: false }, required: false },
          { model: db.DistrictMaster, as: 'district', attributes: ['district_name'], where: { is_deleted: false }, required: false },
          { model: db.Component, as: 'component', attributes: ['component_name'], where: { is_deleted: false }, required: false },
          { model: db.Hub, as: 'hub', attributes: ['hub_name'], where: { is_deleted: false }, required: false },
          {
            model: db.ApplicantMaster,
            as: 'applicant',
            attributes: ['email'],
            where: { is_deleted: false },
            required: false,
            include: [
              {
                model: db.ApplicantPersonal,
                as: 'personal',
                attributes: ['full_name'],
                where: { is_deleted: false },
                required: false
              }
            ]
          }
        ],
        order: [['employee_code', 'ASC']]
      });

      if (employees.length === 0) {
        throw ApiError.notFound('No employees found with the specified filters');
      }

      // Create Excel workbook
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet(`Attendance - ${month}-${year}`);

      // Get days in month
      const daysInMonth = new Date(yearNum, monthNum, 0).getDate();
      
      // Create header row
      const headers = [
        'Employee Code', 'Employee Name', 'Post', 'District', 'OSC/Component', 'Hub'
      ];
      
      // Add date columns for each day of the month
      const sundayDates = [];
      for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(yearNum, monthNum - 1, day);
        const dayOfWeek = date.getDay();
        const isSunday = dayOfWeek === 0;
        
        if (isSunday) {
          headers.push(`${day} (SUN)`);
          sundayDates.push(day);
        } else {
          headers.push(`${day}`);
        }
      }
      
      // Add summary columns
      headers.push('Total Present', 'Total Absent', 'Total Half Day', 'Total Leave', 'Remarks');
      
      worksheet.columns = headers.map(header => ({ header, width: 12 }));
      
      // Set wider columns for employee info
      worksheet.getColumn(1).width = 15; // Employee Code
      worksheet.getColumn(2).width = 25; // Employee Name
      worksheet.getColumn(3).width = 20; // Post
      worksheet.getColumn(4).width = 15; // District
      worksheet.getColumn(5).width = 20; // OSC/Component
      worksheet.getColumn(6).width = 15; // Hub
      worksheet.getColumn(headers.length).width = 30; // Remarks

      // Add dropdown validation for status cells
      const statusValidation = {
        type: 'list',
        allowBlank: true,
        formulae: ['"P,A,L,H"'] // P=Present, A=Absent, L=Leave, H=Half Day
      };

      // Fill employee data
      employees.forEach((employee, index) => {
        const row = [];
        
        // Employee info
        row.push(employee.employee_code);
        row.push(employee.applicant?.personal?.full_name || '');
        row.push(employee.post?.post_name || '');
        row.push(employee.district?.district_name || '');
        row.push(employee.component?.component_name || '');
        row.push(employee.hub?.hub_name || '');
        
        // Attendance columns for each day
        for (let day = 1; day <= daysInMonth; day++) {
          if (sundayDates.includes(day)) {
            row.push('SUN'); // Mark Sundays
          } else {
            row.push(''); // Empty for manual entry
          }
        }
        
        // Summary columns (formulas will be added)
        row.push(0); // Total Present
        row.push(0); // Total Absent
        row.push(0); // Total Half Day
        row.push(0); // Total Leave
        row.push(''); // Remarks
        
        worksheet.addRow(row);
        
        // Add dropdown validation to attendance cells (except Sundays)
        let currentCol = 7; // Column 7 is first date column
        for (let day = 1; day <= daysInMonth; day++) {
          const cell = worksheet.getCell(index + 2, currentCol);
          
          if (sundayDates.includes(day)) {
            // Style Sunday cells
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFF0F0F0' } // Light gray
            };
            cell.font = { color: { argb: 'FF999999' } }; // Gray text
            cell.value = 'SUN';
          } else {
            // Add dropdown validation for non-Sunday cells
            cell.dataValidation = statusValidation;
          }
          
          currentCol++;
        }
      });

      // Add formulas for summary columns
      const startRow = 2; // Data starts from row 2
      const endRow = startRow + employees.length - 1;
      
      for (let i = startRow; i <= endRow; i++) {
        // Total Present (count of 'P')
        worksheet.getCell(i, 7 + daysInMonth).value = {
          formula: `=COUNTIF(${worksheet.getCell(i, 7).address}:${worksheet.getCell(i, 6 + daysInMonth).address},"P")`,
          result: 0
        };
        
        // Total Absent (count of 'A')
        worksheet.getCell(i, 8 + daysInMonth).value = {
          formula: `=COUNTIF(${worksheet.getCell(i, 7).address}:${worksheet.getCell(i, 6 + daysInMonth).address},"A")`,
          result: 0
        };
        
        // Total Half Day (count of 'H')
        worksheet.getCell(i, 9 + daysInMonth).value = {
          formula: `=COUNTIF(${worksheet.getCell(i, 7).address}:${worksheet.getCell(i, 6 + daysInMonth).address},"H")`,
          result: 0
        };
        
        // Total Leave (count of 'L')
        worksheet.getCell(i, 10 + daysInMonth).value = {
          formula: `=COUNTIF(${worksheet.getCell(i, 7).address}:${worksheet.getCell(i, 6 + daysInMonth).address},"L")`,
          result: 0
        };
      }

      // Add instructions sheet
      const instructionSheet = workbook.addWorksheet('Instructions');
      instructionSheet.addRow(['Attendance Register - Instructions']);
      instructionSheet.addRow(['']);
      instructionSheet.addRow(['Status Codes:']);
      instructionSheet.addRow(['P = Present']);
      instructionSheet.addRow(['A = Absent']);
      instructionSheet.addRow(['L = Leave']);
      instructionSheet.addRow(['H = Half Day']);
      instructionSheet.addRow(['']);
      instructionSheet.addRow(['How to use:']);
      instructionSheet.addRow(['1. Fill employee names in column B']);
      instructionSheet.addRow(['2. Mark attendance for each day using dropdown (P/A/L/H)']);
      instructionSheet.addRow(['3. Summary columns will auto-calculate']);
      instructionSheet.addRow(['4. Add remarks in the last column if needed']);
      instructionSheet.addRow(['']);
      instructionSheet.addRow(['Generated for:']);
      instructionSheet.addRow([`Month: ${month}/${year}`]);
      if (district_id) instructionSheet.addRow([`District: ${employees[0]?.district?.district_name || 'All'}`]);
      if (component_id) instructionSheet.addRow([`OSC: ${employees[0]?.component?.component_name || 'All'}`]);
      if (hub_id) instructionSheet.addRow([`Hub: ${employees[0]?.hub?.hub_name || 'All'}`]);
      instructionSheet.addRow([`Total Employees: ${employees.length}`]);
      instructionSheet.addRow(['6. Save the file and upload it through the system']);

      // Style the headers
      worksheet.getRow(1).font = { bold: true };
      worksheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE6E6FA' }
      };
      
      // Style Sunday header columns
      let currentCol = 7;
      for (let day = 1; day <= daysInMonth; day++) {
        if (sundayDates.includes(day)) {
          const headerCell = worksheet.getCell(1, currentCol);
          headerCell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF0F0F0' } // Light gray
          };
          headerCell.font = { bold: true, color: { argb: 'FF999999' } }; // Gray text
        }
        currentCol++;
      }

      // Generate filename
      const fileName = `attendance_template_${adminUser.admin_id}_${new Date().toISOString().split('T')[0]}.xlsx`;
      const filePath = path.join(process.cwd(), 'uploads', 'hrm', 'attendance_templates', fileName);

      // Ensure directory exists
      await fs.mkdir(path.dirname(filePath), { recursive: true });

      // Save file
      await workbook.xlsx.writeFile(filePath);

      logger.info(`Attendance template generated for admin ${adminUser.admin_id}`, {
        filePath,
        employeeCount: employees.length
      });

      return {
        filePath,
        fileName,
        employeeCount: employees.length,
        month,
        year
      };
    } catch (error) {
      logger.error('Error generating attendance template:', error);
      throw error;
    }
  }

  /**
   * Upload bulk attendance from Excel file
   * @param {Object} adminUser - Admin user object
   * @param {Object} fileData - Uploaded file data
   * @param {Object} uploadData - Additional upload data
   * @returns {Promise<Object>} - Created bulk details
   */
  async uploadBulkAttendance(adminUser, fileData, uploadData) {
    const transaction = await db.sequelize.transaction();
    
    try {
      const { remarks, month, year } = uploadData;
      const filePath = fileData.path;
      
      logger.info('Processing bulk attendance upload:', {
        filePath,
        originalName: fileData.originalname,
        size: fileData.size,
        month,
        year
      });
      
      // Read Excel file
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(filePath);
      
      // Try to find the main attendance worksheet
      let worksheet = workbook.getWorksheet(/Attendance/i);
      if (!worksheet) {
        worksheet = workbook.getWorksheet(1); // First worksheet
      }
      
      if (!worksheet) {
        throw ApiError.badRequest('Invalid template format. Please download the latest template.');
      }

      // Validate and parse attendance records
      const attendanceRecords = [];
      const errors = [];
      const uploadDate = new Date();

      for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) {
        const row = worksheet.getRow(rowNumber);
        
        try {
          const records = this.parseAttendanceRow(row, rowNumber, month, year);
          if (records && records.length > 0) {
            attendanceRecords.push(...records);
          }
        } catch (error) {
          errors.push({
            row: rowNumber,
            error: error.message
          });
        }
      }

      if (errors.length > 0) {
        throw ApiError.badRequest(`Validation errors found: ${JSON.stringify(errors.slice(0, 5))}`);
      }

      // Generate bulk number
      const bulkNo = await generateUniqueId('ATTENDANCE_BATCH');

      // Create bulk attendance record
      const bulk = await BulkAttendance.create({
        bulk_no: bulkNo,
        uploaded_by: adminUser.admin_id,
        upload_date: uploadDate,
        month,
        year,
        total_records: attendanceRecords.length,
        pending_records: attendanceRecords.length,
        file_path: filePath,
        remarks
      });

      // Create attendance records with bulk_id and pending status
      const records = [];
      for (const recordData of attendanceRecords) {
        // Find employee
        const employee = await EmployeeMaster.findOne({
          where: {
            employee_code: recordData.employee_code,
            is_deleted: false,
            is_active: true
          },
          include: [{
            model: db.ApplicantMaster,
            as: 'applicant',
            attributes: ['email'],
            where: { is_deleted: false },
            required: false
          }]
        });

        if (!employee) {
          throw new Error(`Employee with code ${recordData.employee_code} not found`);
        }

        // Check if employee is under admin's jurisdiction
        const hierarchyFilter = buildHierarchyFilter(adminUser);
        if (hierarchyFilter.district_id && employee.district_id !== hierarchyFilter.district_id) {
          throw new Error(`Employee ${recordData.employee_code} is not under your jurisdiction`);
        }
        if (hierarchyFilter.component_id && employee.component_id !== hierarchyFilter.component_id) {
          throw new Error(`Employee ${recordData.employee_code} is not under your jurisdiction`);
        }
        if (hierarchyFilter.hub_id && employee.hub_id !== hierarchyFilter.hub_id) {
          throw new Error(`Employee ${recordData.employee_code} is not under your jurisdiction`);
        }

        // Check for existing attendance record
        const existingRecord = await Attendance.findOne({
          where: {
            employee_id: employee.employee_id,
            attendance_date: recordData.attendance_date,
            is_deleted: false
          },
          transaction
        });

        if (existingRecord) {
          throw new Error(`Attendance already exists for employee ${recordData.employee_code} on ${recordData.attendance_date.toISOString().split('T')[0]}`);
        }

        const record = await Attendance.create({
          employee_id: employee.employee_id,
          attendance_date: recordData.attendance_date,
          status: recordData.status,
          half_day_type: recordData.half_day_type || null,
          remarks: recordData.remarks || null,
          bulk_id: bulk.bulk_id,
          approval_status: 'PENDING',
          created_by: adminUser.admin_id
        }, { transaction });
        
        records.push(record);
      }

      logger.info(`Bulk attendance uploaded successfully`, {
        bulkId: bulk.bulk_id,
        bulkNo: bulk.bulk_no,
        uploadedBy: adminUser.admin_id,
        totalRecords: attendanceRecords.length
      });

      // Commit transaction
      await transaction.commit();

      return {
        bulk,
        records,
        totalRecords: attendanceRecords.length
      };
    } catch (error) {
      // Rollback transaction on error
      await transaction.rollback();
      logger.error('Error uploading bulk attendance:', error);
      throw error;
    }
  }

  /**
   * Parse attendance row from Excel
   * @param {Object} row - Excel row
   * @param {number} rowNumber - Row number for error reporting
   * @returns {Object|null} - Parsed record or null if empty
   */
  parseAttendanceRow(row, rowNumber, month, year) {
    const values = row.values;
    
    // Skip empty rows
    if (!values[1] || !values[1].toString().trim()) {
      return null;
    }

    // Status codes: P=Present, A=Absent, L=Leave, H=Half Day
    const validStatuses = ['P', 'A', 'L', 'H'];
    const statusMap = {
      'P': 'PRESENT',
      'A': 'ABSENT', 
      'L': 'ON_LEAVE',
      'H': 'HALF_DAY'
    };
    
    const employeeCode = values[1]?.toString().trim();
    const employeeName = values[2]?.toString().trim() || '';
    
    // Validate required fields
    if (!employeeCode) {
      throw new Error(`Row ${rowNumber}: Employee Code is required`);
    }

    // Parse attendance for each day of the month
    const attendanceRecords = [];
    const daysInMonth = new Date(year, month, 0).getDate();
    
    // Date columns start from column 7 (index 7)
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month - 1, day);
      const isSunday = date.getDay() === 0;
      
      // Skip Sundays
      if (isSunday) {
        continue;
      }
      
      const statusCell = values[6 + day]?.toString().trim().toUpperCase();
      
      if (statusCell && validStatuses.includes(statusCell)) {
        const attendanceDate = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
        
        let record = {
          employee_code: employeeCode,
          employee_name: employeeName,
          attendance_date: attendanceDate,
          status: statusMap[statusCell],
          remarks: ''
        };
        
        // For half day, we need to determine which half (default to FIRST_HALF)
        if (statusCell === 'H') {
          record.half_day_type = 'FIRST_HALF';
          record.remarks = 'Half Day attendance';
        }
        
        attendanceRecords.push(record);
      }
    }
    
    return attendanceRecords;
  }

  /**
   * Get pending bulk attendance for an admin to approve
   * @param {Object} adminUser - Admin user object
   * @param {Object} query - Query parameters
   * @returns {Promise<Object>} - Pending bulks with details
   */
  async getPendingBulks(adminUser, query) {
    const { page = 1, limit = 10, status } = query;
    const offset = (page - 1) * limit;

    try {
      // Get bulks uploaded by admins under current admin's hierarchy
      const uploaderIds = await this.getUploaderIdsUnderJurisdiction(adminUser);

      const whereClause = {
        uploaded_by: { [Op.in]: uploaderIds },
        is_deleted: false
      };

      // Add status filter if provided
      if (status && status !== 'all') {
        whereClause.status = status;
      } else {
        // Default to showing all statuses for history view
        whereClause.status = ['PENDING', 'APPROVED', 'REJECTED', 'PARTIALLY_APPROVED'];
      }

      const { count, rows: bulks } = await BulkAttendance.findAndCountAll({
        where: whereClause,
        include: [
          {
            model: AdminUser,
            as: 'uploader',
            attributes: ['admin_id', 'username', 'full_name']
          }
        ],
        order: [['created_at', 'DESC']],
        limit: parseInt(limit),
        offset
      });

      // Get sample records for each bulk
      const bulksWithSampleRecords = await Promise.all(
        bulks.map(async (bulk) => {
          const sampleRecords = await Attendance.findAll({
            where: {
              bulk_id: bulk.bulk_id,
              approval_status: 'PENDING'
            },
            include: [
              {
                model: EmployeeMaster,
                as: 'employee',
                attributes: ['employee_code'],
                where: { is_deleted: false },
                required: false,
                include: [{
                  model: db.ApplicantMaster,
                  as: 'applicant',
                  attributes: ['email'],
                  where: { is_deleted: false },
                  required: false
                }]
              }
            ],
            limit: 5,
            order: [['created_at', 'DESC']]
          });

          return {
            ...bulk.toJSON(),
            sample_records: sampleRecords
          };
        })
      );

      return {
        bulks: bulksWithSampleRecords,
        pagination: {
          total: count,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(count / limit)
        }
      };
    } catch (error) {
      logger.error('Error getting pending bulks:', error);
      throw error;
    }
  }

  /**
   * Get uploader IDs under admin's jurisdiction (hierarchy below)
   * @param {Object} adminUser - Admin user object
   * @returns {Promise<Array>} - Array of uploader admin IDs
   */
  async getUploaderIdsUnderJurisdiction(adminUser) {
    try {
      const uploaderIds = [adminUser.admin_id]; // Can approve own uploads

      // Get admins under current admin's hierarchy
      const role = adminUser.role?.role_code || adminUser.role;

      if (['SUPER_ADMIN', 'STATE_ADMIN'].includes(role)) {
        // Can approve all uploads
        const allAdmins = await AdminUser.findAll({
          where: { is_active: true, is_deleted: false },
          attributes: ['admin_id']
        });
        uploaderIds.push(...allAdmins.map(a => a.admin_id));
      } else if (role === 'DISTRICT_ADMIN' && adminUser.district_id) {
        // Can approve uploads from same district
        const districtAdmins = await AdminUser.findAll({
          where: {
            district_id: adminUser.district_id,
            is_active: true,
            is_deleted: false
          },
          attributes: ['admin_id']
        });
        uploaderIds.push(...districtAdmins.map(a => a.admin_id));
      }

      return [...new Set(uploaderIds)];
    } catch (error) {
      logger.error('Error getting uploader IDs:', error);
      return [adminUser.admin_id];
    }
  }

  /**
   * Approve or reject bulk attendance
   * @param {Object} adminUser - Admin user object
   * @param {number} bulkId - Bulk ID
   * @param {Object} actionData - Approval action data
   * @returns {Promise<Object>} - Result of approval action
   */
  async processBulkApproval(adminUser, bulkId, actionData) {
    const transaction = await db.sequelize.transaction();
    
    try {
      const { action, remarks, record_ids } = actionData; // action: 'APPROVE' or 'REJECT'
      
      // Find the bulk record
      const bulk = await BulkAttendance.findOne({
        where: {
          bulk_id: bulkId,
          is_deleted: false
        },
        transaction
      });

      if (!bulk) {
        throw ApiError.notFound('Bulk attendance not found');
      }

      // Check if admin can approve this bulk
      const uploaderIds = await this.getUploaderIdsUnderJurisdiction(adminUser);
      if (!uploaderIds.includes(bulk.uploaded_by)) {
        throw ApiError.forbidden('You do not have permission to approve this bulk attendance');
      }

      // Update attendance records
      const whereClause = {
        bulk_id: bulkId,
        approval_status: 'PENDING'
      };

      if (record_ids && record_ids.length > 0) {
        whereClause.attendance_id = { [Op.in]: record_ids };
      }

      const updateData = {
        approval_status: action === 'APPROVE' ? 'APPROVED' : 'REJECTED',
        approved_by: adminUser.admin_id,
        approved_at: new Date()
      };

      if (action === 'REJECT') {
        updateData.remarks = remarks;
      }

      const [updatedCount] = await Attendance.update(updateData, {
        where: whereClause,
        transaction
      });

      // Update bulk status
      await this.updateBulkStatus(bulkId, transaction);

      // Update bulk approval info if fully approved
      if (action === 'APPROVE') {
        const updatedBulk = await BulkAttendance.findByPk(bulkId, { transaction });
        if (updatedBulk.status === 'APPROVED') {
          await updatedBulk.update({
            approved_by: adminUser.admin_id,
            approved_at: new Date()
          }, { transaction });
        }
      }

      await transaction.commit();

      logger.info(`Bulk ${action} processed`, {
        bulkId,
        approverId: adminUser.admin_id,
        action,
        recordsUpdated: updatedCount
      });

      return {
        success: true,
        action,
        recordsUpdated: updatedCount,
        bulkStatus: bulk.status
      };
    } catch (error) {
      await transaction.rollback();
      logger.error('Error processing bulk approval:', error);
      throw error;
    }
  }

  /**
   * Update bulk status based on record approvals
   * @param {number} bulkId - Bulk ID
   * @param {Object} transaction - Sequelize transaction
   */
  async updateBulkStatus(bulkId, transaction) {
    // Get all attendance records for this bulk
    const records = await Attendance.findAll({
      where: { bulk_id: bulkId },
      attributes: ['approval_status'],
      transaction
    });

    const total = records.length;
    const approved = records.filter(r => r.approval_status === 'APPROVED').length;
    const rejected = records.filter(r => r.approval_status === 'REJECTED').length;
    const pending = records.filter(r => r.approval_status === 'PENDING').length;

    let status = 'PENDING';
    if (approved > 0 && pending === 0) {
      status = 'APPROVED';
    } else if (approved > 0 && pending > 0) {
      status = 'PARTIALLY_APPROVED';
    } else if (rejected === total) {
      status = 'REJECTED';
    }

    await BulkAttendance.update({
      status,
      approved_records: approved,
      rejected_records: rejected,
      pending_records: pending
    }, {
      where: { bulk_id: bulkId },
      transaction
    });
  }

  /**
   * Get bulk details with all records
   * @param {number} bulkId - Bulk ID
   * @param {Object} adminUser - Admin user object
   * @returns {Promise<Object>} - Bulk details
   */
  async getBulkDetails(bulkId, adminUser) {
    try {
      const bulk = await BulkAttendance.findOne({
        where: { bulk_id: bulkId, is_deleted: false },
        include: [
          {
            model: AdminUser,
            as: 'uploader',
            attributes: ['admin_id', 'username', 'full_name'],
            where: { is_deleted: false },
            required: false
          }
        ]
      });

      if (!bulk) {
        throw ApiError.notFound('Bulk not found');
      }

      // Get attendance records
      const records = await Attendance.findAll({
        where: { bulk_id: bulkId, is_deleted: false },
        include: [
          {
            model: EmployeeMaster,
            as: 'employee',
            attributes: ['employee_code'],
            where: { is_deleted: false },
            required: false,
            include: [{
              model: db.ApplicantMaster,
              as: 'applicant',
              attributes: ['email'],
              where: { is_deleted: false },
              required: false
            }]
          }
        ],
        order: [['created_at', 'ASC']]
      });

      return {
        bulk,
        records
      };
    } catch (error) {
      logger.error('Error getting bulk details:', error);
      throw error;
    }
  }
}

module.exports = new BulkAttendanceService();
