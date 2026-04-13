// ============================================================================
// OPENAI VISION API CLIENT
// ============================================================================
// Purpose: Centralized OpenAI API client for OCR document verification
// Dependencies: openai (^4.28.0)
// 
// This file is part of the OCR verification module and can be safely removed
// if OCR functionality is no longer needed.
// ============================================================================

const OpenAI = require('openai');
const logger = require('../../config/logger');
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

// Initialize OpenAI client (lazy initialization)
let openaiClient = null;

/**
 * Get or create OpenAI client instance
 * @returns {OpenAI} OpenAI client instance
 */
const getOpenAIClient = () => {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    
    if (!apiKey || apiKey === 'your_openai_api_key_here') {
      throw new Error('OPENAI_API_KEY is not configured in environment variables');
    }

    openaiClient = new OpenAI({
      apiKey: apiKey,
      timeout: 60000, // 60 seconds timeout
      maxRetries: 2
    });

    logger.info('OpenAI client initialized successfully');
  }

  return openaiClient;
};

/**
 * Convert PDF to images using ImageMagick or pdf-poppler
 * @param {string} pdfPath - Path to PDF file
 * @returns {Promise<string[]>} Array of image file paths
 */
const convertPdfToImages = async (pdfPath) => {
  try {
    const tempDir = path.join(path.dirname(pdfPath), 'temp_images');
    await fs.mkdir(tempDir, { recursive: true });
    
    const baseName = path.basename(pdfPath, '.pdf');
    const outputPath = path.join(tempDir, `${baseName}-%d.png`);
    
    // Try ImageMagick first (more reliable)
    try {
      await execAsync(`magick "${pdfPath}" "${outputPath}"`);
    } catch (magickError) {
      // Fallback to pdf-poppler if ImageMagick is not available
      logger.warn('ImageMagick not available, trying pdf-poppler');
      const pdf2img = require('pdf-poppler');
      const options = {
        format: 'png',
        out_dir: tempDir,
        out_prefix: baseName,
        page: null // Convert all pages
      };
      
      await pdf2img.convert(pdfPath, options);
    }
    
    // Get all generated images
    const files = await fs.readdir(tempDir);
    const imageFiles = files
      .filter(file => file.startsWith(baseName) && file.endsWith('.png'))
      .sort()
      .map(file => path.join(tempDir, file));
    
    return imageFiles;
  } catch (error) {
    logger.error('Error converting PDF to images:', error);
    throw new Error('Failed to convert PDF to images. Please ensure ImageMagick is installed or pdf-poppler is available.');
  }
};

/**
 * Clean up temporary image files
 * @param {string[]} imagePaths - Array of image file paths
 */
const cleanupTempImages = async (imagePaths) => {
  try {
    for (const imagePath of imagePaths) {
      await fs.unlink(imagePath);
    }
    // Try to remove temp directory if empty
    const tempDir = path.dirname(imagePaths[0]);
    await fs.rmdir(tempDir).catch(() => {}); // Ignore if directory not empty
  } catch (error) {
    logger.warn('Error cleaning up temp images:', error);
  }
};

/**
 * Convert file to base64 for OpenAI Vision API
 * @param {string} filePath - Absolute path to file
 * @returns {Promise<string>} Base64 encoded file
 */
const fileToBase64 = async (filePath) => {
  try {
    const fileBuffer = await fs.readFile(filePath);
    return fileBuffer.toString('base64');
  } catch (error) {
    logger.error('Error converting file to base64:', error);
    throw new Error('Failed to read document file');
  }
};

/**
 * Get MIME type from file extension
 * @param {string} filePath - File path
 * @returns {string} MIME type
 */
const getMimeType = (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
    '.webp': 'image/webp',
    '.tiff': 'image/tiff',
    '.tif': 'image/tiff',
    '.pdf': 'application/pdf'
  };
  return mimeTypes[ext] || 'application/octet-stream';
};

/**
 * Analyze education document using OpenAI Vision API
 * @param {string} filePath - Path to the document file
 * @returns {Promise<Object>} Extracted data with confidence scores
 */
const analyzeEducationDocument = async (filePath) => {
  let tempImages = [];
  try {
    const client = getOpenAIClient();
    const mimeType = getMimeType(filePath);
    
    let imageFiles = [];
    
    // Handle PDF conversion
    if (mimeType === 'application/pdf') {
      logger.info(`Converting PDF to images: ${path.basename(filePath)}`);
      tempImages = await convertPdfToImages(filePath);
      imageFiles = tempImages;
    } else {
      // Direct image file
      imageFiles = [filePath];
    }

    const model = process.env.OPENAI_MODEL || 'gpt-4o';
    const maxTokens = parseInt(process.env.OPENAI_MAX_TOKENS || '2000', 10);
    const temperature = parseFloat(process.env.OPENAI_TEMPERATURE || '0.1');

    // Structured prompt for education certificate extraction
    const prompt = `You are an expert document analyzer specializing in Indian & Maharashtra education certificates.
Analyze the provided education certificate image and extract the following information:

1. Candidate Name (Full name of the student as written on certificate)
2. Qualification Level (e.g., Diploma, Graduate, Post-Graduate, 10th, 12th)
3. Degree/Certificate Name (e.g., SSC, HSC, Science, Commerce, Arts, B.Sc, B.Com, etc.)
4. Board/University Name (full official name, State board or University)
5. Seat Number / PRN Number
6. Year of Passing
7. Percentage / CGPA / Grade (convert CGPA to percentage if needed)

Additionally, assess:
- Document authenticity (check for signs of tampering, blank backgrounds, inconsistent fonts, image artifacts)
- Document type (Marksheet, Certificate, Provisional Certificate, Degree, etc.)

IMPORTANT: Return ONLY a valid JSON object with this exact structure (no markdown, no code blocks):
{
  "candidate_name": { "value": "string or null", "confidence": 0.0 },
  "qualification": { "value": "string or null", "confidence": 0.0 },
  "degree_name": { "value": "string or null", "confidence": 0.0 },
  "board_university": { "value": "string or null", "confidence": 0.0 },
  "seat_number": { "value": "string or null", "confidence": 0.0 },
  "year_of_passing": { "value": number or null, "confidence": 0.0 },
  "percentage": { "value": number or null, "confidence": 0.0 },
  "document_type": "string",
  "tampering_indicators": {
    "blank_background": false,
    "inconsistent_fonts": false,
    "image_artifacts": false,
    "overall_assessment": "string"
  }
}

Confidence should be between 0.0 and 1.0. If any field is not found or unclear, set confidence to 0.0 and value to null.`;

    // Enforce percentage normalization: non-negative, max 2 decimal places
    const percentageGuardrail = "Rules for percentage field: (1) If a percentage is negative, convert it to its absolute value. (2) Always round/format to exactly 2 decimal places (e.g., 71.67). (3) If only 1 decimal is found (e.g., 71.6), return 71.60. (4) If percentage is missing, set value to null and confidence to 0.0.";

    const fullPrompt = `${prompt}\n\n${percentageGuardrail}`;

    logger.info(`Analyzing document with OpenAI Vision API: ${path.basename(filePath)}`);

    // Prepare content for all images
    const content = [
      { type: 'text', text: fullPrompt }
    ];

    // Add all images to the content
    for (const imageFile of imageFiles) {
      const base64File = await fileToBase64(imageFile);
      const imageMimeType = getMimeType(imageFile);
      
      content.push({
        type: 'image_url',
        image_url: {
          url: `data:${imageMimeType};base64,${base64File}`,
          detail: 'high' // Use high detail for better OCR accuracy
        }
      });
    }

    const response = await client.chat.completions.create({
      model: model,
      messages: [
        {
          role: 'user',
          content: content
        }
      ],
      max_tokens: maxTokens,
      temperature: temperature,
      response_format: { type: 'json_object' } // Force JSON response
    });

    const contentResponse = response.choices[0]?.message?.content;
    
    if (!contentResponse) {
      throw new Error('Empty response from OpenAI API');
    }

    // Parse JSON response
    let extractedData;
    try {
      extractedData = JSON.parse(contentResponse);
    } catch (parseError) {
      logger.error('Failed to parse OpenAI response as JSON:', contentResponse);
      throw new Error('Invalid JSON response from OpenAI');
    }

    logger.info('Document analysis completed successfully');
    
    return {
      success: true,
      data: extractedData,
      rawResponse: response,
      tokensUsed: response.usage?.total_tokens || 0,
      pagesAnalyzed: imageFiles.length
    };

  } catch (error) {
    logger.error('OpenAI Vision API error:', error);
    
    // Handle specific OpenAI errors
    if (error.status === 401) {
      throw new Error('Invalid OpenAI API key');
    } else if (error.status === 429) {
      throw new Error('OpenAI API rate limit exceeded. Please try again later.');
    } else if (error.status === 500 || error.status === 503) {
      throw new Error('OpenAI service is temporarily unavailable');
    }
    
    throw new Error(`OpenAI API error: ${error.message}`);
  } finally {
    // Clean up temporary images
    if (tempImages.length > 0) {
      await cleanupTempImages(tempImages);
    }
  }
};

module.exports = {
  analyzeEducationDocument,
  getOpenAIClient
};
