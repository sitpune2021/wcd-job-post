/**
 * Logs API Endpoint
 * Provides access to log files with reverse chronological order and filtering
 */

const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const { ApiError } = require('../middleware/errorHandler');
const ApiResponse = require('../utils/ApiResponse');
const logger = require('../config/logger');

/**
 * Get list of available log files
 */
router.get('/files', async (req, res, next) => {
  try {
    const logsDir = path.join(process.cwd(), 'logs');
    
    const files = await fs.readdir(logsDir);
    
    // Filter only .log files and sort by modification time (newest first)
    const logFiles = [];
    for (const file of files) {
      if (file.endsWith('.log')) {
        const filePath = path.join(logsDir, file);
        const stats = await fs.stat(filePath);
        logFiles.push({
          name: file,
          size: stats.size,
          modified: stats.mtime,
          modified_formatted: stats.mtime.toISOString(),
          path: filePath
        });
      }
    }
    
    logFiles.sort((a, b) => b.modified - a.modified); // Reverse chronological order
    
    return ApiResponse.success(res, logFiles, 'Log files retrieved successfully');
  } catch (error) {
    logger.error('Error listing log files:', error);
    next(error);
  }
});

/**
 * Get log file content with pagination and filtering
 */
router.get('/file/:filename', async (req, res, next) => {
  try {
    const { filename } = req.params;
    const { 
      page = 1, 
      limit = 100, 
      search = '', 
      level = '',
      startDate = '',
      endDate = '' 
    } = req.query;
    
    const logsDir = path.join(process.cwd(), 'logs');
    const filePath = path.join(logsDir, filename);
    
    // Validate file exists and is a .log file
    if (!filename.endsWith('.log')) {
      throw ApiError.badRequest('Only .log files are supported');
    }
    
    try {
      await fs.access(filePath, fs.constants.R_OK);
    } catch (error) {
      throw ApiError.notFound(`Log file not found: ${filename}`);
    }
    
    // Read file stats
    const stats = await fs.stat(filePath);
    const fileSize = stats.size;
    
    const limitNum = parseInt(limit) || 100;
    const pageNum = parseInt(page) || 1;
    const offset = (pageNum - 1) * limitNum;
    
    // Read file in chunks (reverse order for latest first)
    const buffer = await fs.readFile(filePath, 'utf8');
    const lines = buffer.split('\n').filter(line => line.trim().length > 0);
    
    // Apply filters
    let filteredLines = lines;
    
    // Search filter
    if (search) {
      const searchLower = search.toLowerCase();
      filteredLines = filteredLines.filter(line => 
        line.toLowerCase().includes(searchLower)
      );
    }
    
    // Level filter
    if (level) {
      const levelUpper = level.toUpperCase();
      filteredLines = filteredLines.filter(line => 
        line.toUpperCase().includes(`[${levelUpper}]`)
      );
    }
    
    // Date range filter
    if (startDate || endDate) {
      filteredLines = filteredLines.filter(line => {
        const lineDate = extractDateFromLogLine(line);
        if (!lineDate) return true;
        
        const start = startDate ? new Date(startDate) : new Date('1970-01-01');
        const end = endDate ? new Date(endDate) : new Date('2099-12-31');
        
        return lineDate >= start && lineDate <= end;
      });
    }
    
    // Apply pagination (reverse order, so we need to reverse the filtered array)
    const startIndex = Math.max(0, filteredLines.length - offset - limitNum);
    const endIndex = Math.min(filteredLines.length, filteredLines.length - offset);
    const paginatedLines = filteredLines.slice(startIndex, endIndex);
    
    // Get total count after filtering
    const totalCount = filteredLines.length;
    const totalPages = Math.ceil(totalCount / limitNum);
    
    return ApiResponse.success(res, {
      filename,
      total_lines: totalCount,
      current_page: pageNum,
      total_pages: totalPages,
      lines_per_page: limitNum,
      file_size: fileSize,
      last_modified: stats.mtime.toISOString(),
      lines: paginatedLines.reverse(), // Reverse to show latest first
      filters: { search, level, startDate, endDate }
    }, 'Log file content retrieved successfully');
    
  } catch (error) {
    logger.error('Error reading log file:', error);
    next(error);
  }
});

/**
 * Get last N lines from log file (tail functionality)
 */
router.get('/tail/:filename', async (req, res, next) => {
  try {
    const { filename } = req.params;
    const { lines = 20 } = req.query;
    
    const logsDir = path.join(process.cwd(), 'logs');
    const filePath = path.join(logsDir, filename);
    
    if (!filename.endsWith('.log')) {
      throw ApiError.badRequest('Only .log files are supported');
    }
    
    try {
      await fs.access(filePath, fs.constants.R_OK);
    } catch (error) {
      throw ApiError.notFound(`Log file not found: ${filename}`);
    }
    
    const linesNum = parseInt(lines) || 20;
    
    // Read file
    const buffer = await fs.readFile(filePath, 'utf8');
    const allLines = buffer.split('\n').filter(line => line.trim().length > 0);
    
    // Get last N lines
    const tailLines = allLines.slice(-linesNum);
    
    return ApiResponse.success(res, {
      filename,
      total_lines: allLines.length,
      tail_lines: tailLines.length,
      lines: tailLines,
      timestamp: new Date().toISOString()
    }, 'Log tail retrieved successfully');
    
  } catch (error) {
    logger.error('Error tailing log file:', error);
    next(error);
  }
});

/**
 * Extract date from log line
 */
function extractDateFromLogLine(line) {
  // Common log date formats:
  // 2026-04-20T12:30:15.123+05:30
  // [2026-04-20 12:30:15.123 +05:30]
  // 2026-04-20 12:30:15.123 IST
  const dateRegex = /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3})/;
  const match = line.match(dateRegex);
  return match ? new Date(match[1]) : null;
}

module.exports = router;
