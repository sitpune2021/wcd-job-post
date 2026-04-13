const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;
const logger = require('../config/logger');

const sanitizePathSegment = (value, fallback = 'DOCUMENT') => {
  const str = String(value || '').trim();
  if (!str) return fallback;
  const sanitized = str
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
  return sanitized || fallback;
};

/**
 * File Upload Utility with Image Compression
 * Supports PDF, JPEG, PNG with organized folder structure
 */

// Ensure upload directory exists
const ensureDir = async (dirPath) => {
  try {
    await fs.access(dirPath);
  } catch {
    await fs.mkdir(dirPath, { recursive: true });
  }
};

// Configure storage
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      const applicantId =
        req?.body?.applicantId ||
        req?.body?.applicant_id ||
        req?.user?.applicant_id ||
        req?.user?.id;

      let docType =
        req?.uploadDocType ||
        req?.body?.docType ||
        req?.body?.doc_type ||
        req?.body?.doc_code ||
        req?.body?.doc_type_code ||
        null;

      // If this is an "extra documents" upload, the client typically sends doc_type_id.
      // Resolve to stable folder name using DocumentType.doc_type_code server-side.
      if (!docType && req?.body?.doc_type_id) {
        try {
          // Lazy require to avoid any module load-order issues
          const { DocumentType } = require('../models');
          const row = await DocumentType.findByPk(req.body.doc_type_id, {
            attributes: ['doc_type_code', 'doc_code', 'doc_type_name']
          });
          docType = row?.doc_type_code || row?.doc_code || row?.doc_type_name || null;
        } catch (e) {
          // Fallback to default folder
          docType = null;
        }
      }

      docType = sanitizePathSegment(docType, 'DOCUMENT');

      if (!applicantId) {
        return cb(new Error('applicantId is required'));
      }

      // Create folder structure: uploads/applicants/{applicant_id}/{doc_type}/
      const uploadPath = path.join(
        __dirname,
        '..',
        'uploads',
        'applicants',
        applicantId.toString(),
        docType
      );

      await ensureDir(uploadPath);
      cb(null, uploadPath);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    // Generate unique filename: timestamp_originalname
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    const nameWithoutExt = path.basename(file.originalname, ext);
    cb(null, `${nameWithoutExt}_${uniqueSuffix}${ext}`);
  }
});

// Get allowed file types from environment or use defaults
// Supports ALLOWED_FILE_TYPES for backward compatibility
const getAllowedMimes = () => {
  const envMimes = process.env.ALLOWED_FILE_TYPES;
  if (envMimes) {
    return envMimes.split(',').map(mime => mime.trim());
  }
  
  // Default allowed MIME types
  return [
    'application/pdf',
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/bmp',
    'image/webp',
    'image/tiff'
  ];
};

// Get file size limit from environment or use default (2MB)
// Supports both MAX_FILE_SIZE (bytes) and MAX_FILE_SIZE_MB (MB) for backward compatibility
const getFileSizeLimit = () => {
  // First check for MAX_FILE_SIZE_MB (MB format)
  const envLimitMB = process.env.MAX_FILE_SIZE_MB;
  if (envLimitMB && !isNaN(envLimitMB)) {
    return parseInt(envLimitMB) * 1024 * 1024; // Convert MB to bytes
  }
  
  // Then check for MAX_FILE_SIZE (bytes format) - for backward compatibility
  const envLimitBytes = process.env.MAX_FILE_SIZE;
  if (envLimitBytes && !isNaN(envLimitBytes)) {
    return parseInt(envLimitBytes);
  }
  
  return 2 * 1024 * 1024; // Default 2MB
};

// File filter
const fileFilter = (req, file, cb) => {
  const allowedMimes = getAllowedMimes();
  const mimeList = allowedMimes.join(', ');

  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type. Only ${mimeList} are allowed.`), false);
  }
};

// Multer configuration
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: getFileSizeLimit()
  }
});

/**
 * Create a single-file upload middleware targeting a fixed folder under /uploads
 * @param {string} fieldName - Form field name for the file
 * @param {string} folderName - Folder under uploads where the file should be stored
 * @returns {Function} - Multer single upload middleware
 */
const uploadSingle = (fieldName, folderName = 'misc') => {
  const folder = sanitizePathSegment(folderName, 'MISC');
  const fixedStorage = multer.diskStorage({
    destination: async (_req, _file, cb) => {
      try {
        const uploadPath = path.join(__dirname, '..', 'uploads', folder);
        await ensureDir(uploadPath);
        cb(null, uploadPath);
      } catch (err) {
        cb(err);
      }
    },
    filename: (_req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      const ext = path.extname(file.originalname);
      const nameWithoutExt = path.basename(file.originalname, ext);
      cb(null, `${nameWithoutExt}_${uniqueSuffix}${ext}`);
    }
  });

  return multer({
    storage: fixedStorage,
    fileFilter,
    limits: { fileSize: getFileSizeLimit() }
  }).single(fieldName);
};

/**
 * Create HRM upload middleware with employee folder and duplicate prevention
 * @param {string} fieldName - Form field name for the file
 * @param {string} docType - Document type (attendance, leave, etc.)
 * @returns {Function} - Multer upload middleware with employee folder structure
 */
const uploadHrmFile = (fieldName, docType) => {
  const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
      try {
        // Get employee code from request (should be set by middleware)
        const employeeCode = req.employee?.employee_code || req.user?.employee_code;
        
        if (!employeeCode) {
          return cb(new Error('Employee code is required for HRM file uploads'));
        }

        // Create systematic folder structure: uploads/hrm/{docType}/{employee_code}/
        const folder = `hrm/${docType}/${sanitizePathSegment(employeeCode, 'EMP')}`;
        const uploadPath = path.join(__dirname, '..', 'uploads', folder);
        
        await ensureDir(uploadPath);
        cb(null, uploadPath);
      } catch (error) {
        cb(error);
      }
    },
    filename: (req, file, cb) => {
      try {
        // Get employee code and doc type for folder path
        const employeeCode = req.employee?.employee_code || req.user?.employee_code;
        
        // Generate unique filename with timestamp
        const timestamp = Date.now();
        const randomSuffix = Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        const nameWithoutExt = path.basename(file.originalname, ext);
        
        cb(null, `${nameWithoutExt}_${timestamp}_${randomSuffix}${ext}`);
      } catch (error) {
        cb(error);
      }
    }
  });

  return multer({
    storage,
    fileFilter,
    limits: { fileSize: getFileSizeLimit() }
  }).single(fieldName);
};

/**
 * Compress image file
 * @param {string} filePath - Path to original image
 * @param {number} quality - Compression quality (1-100)
 * @returns {Promise<string>} - Path to compressed image
 */
const compressImage = async (filePath, quality = 80) => {
  try {
    const ext = path.extname(filePath).toLowerCase();
    
    // Only compress images, not PDFs
    if (!['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff', '.tif'].includes(ext)) {
      return filePath;
    }

    const dir = path.dirname(filePath);
    const filename = path.basename(filePath, ext);
    const compressedPath = path.join(dir, `${filename}_compressed.jpg`); // Always output as JPG for compression

    await sharp(filePath)
      .resize(1920, 1920, {
        fit: 'inside',
        withoutEnlargement: true
      })
      .jpeg({ quality, mozjpeg: true })
      .toFile(compressedPath);

    logger.info(`Image compressed: ${filePath} -> ${compressedPath}`);
    return compressedPath;
  } catch (error) {
    logger.error('Error compressing image:', error);
    throw error;
  }
};

/**
 * Generate thumbnail for image
 * @param {string} filePath - Path to original image
 * @param {number} width - Thumbnail width
 * @param {number} height - Thumbnail height
 * @returns {Promise<string>} - Path to thumbnail
 */
const generateThumbnail = async (filePath, width = 200, height = 200) => {
  try {
    const ext = path.extname(filePath).toLowerCase();
    
    // Only generate thumbnails for images
    if (!['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff', '.tif'].includes(ext)) {
      return null;
    }

    const dir = path.dirname(filePath);
    const filename = path.basename(filePath, ext);
    const thumbnailPath = path.join(dir, `${filename}_thumb.jpg`); // Always output as JPG

    await sharp(filePath)
      .resize(width, height, {
        fit: 'cover',
        position: 'center'
      })
      .jpeg({ quality: 70 })
      .toFile(thumbnailPath);

    logger.info(`Thumbnail generated: ${thumbnailPath}`);
    return thumbnailPath;
  } catch (error) {
    logger.error('Error generating thumbnail:', error);
    return null;
  }
};

/**
 * Delete file and its variants (compressed, thumbnail)
 * @param {string} filePath - Path to file
 */
const deleteFile = async (filePath) => {
  try {
    const ext = path.extname(filePath);
    const dir = path.dirname(filePath);
    const filename = path.basename(filePath, ext);

    // Delete original file
    await fs.unlink(filePath).catch(() => {});

    // Delete compressed version
    const compressedPath = path.join(dir, `${filename}_compressed${ext}`);
    await fs.unlink(compressedPath).catch(() => {});

    // Delete thumbnail
    const thumbnailPath = path.join(dir, `${filename}_thumb${ext}`);
    await fs.unlink(thumbnailPath).catch(() => {});

    logger.info(`File deleted: ${filePath}`);
  } catch (error) {
    logger.error('Error deleting file:', error);
    throw error;
  }
};

/**
 * Get relative path for database storage
 * @param {string} absolutePath - Absolute file path
 * @returns {string} - Relative path from uploads folder
 */
const getRelativePath = (absolutePath) => {
  const uploadsIndex = absolutePath.indexOf('uploads');
  if (uploadsIndex === -1) return absolutePath;
  return absolutePath.substring(uploadsIndex);
};

/**
 * Get absolute path from relative path
 * @param {string} relativePath - Relative path from database
 * @returns {string} - Absolute file path
 */
const getAbsolutePath = (relativePath) => {
  return path.join(__dirname, '..', relativePath);
};

/**
 * Validate file exists
 * @param {string} filePath - Path to file
 * @returns {Promise<boolean>}
 */
const fileExists = async (filePath) => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

/**
 * Get file size in bytes
 * @param {string} filePath - Path to file
 * @returns {Promise<number>}
 */
const getFileSize = async (filePath) => {
  try {
    const stats = await fs.stat(filePath);
    return stats.size;
  } catch (error) {
    logger.error('Error getting file size:', error);
    return 0;
  }
};

module.exports = {
  upload,
  uploadSingle,
  uploadHrmFile,
  compressImage,
  generateThumbnail,
  deleteFile,
  getRelativePath,
  getAbsolutePath,
  fileExists,
  getFileSize,
  ensureDir
};
