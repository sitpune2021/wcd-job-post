const i18next = require('i18next');
const path = require('path');
const fs = require('fs');

/**
 * i18n Utility for Multi-language Support
 * Supports English (en) and Marathi (mr)
 */

// Load translation files
const loadTranslations = () => {
  const localesPath = path.join(__dirname, '..', 'locales');
  const translations = {};

  ['en', 'mr'].forEach(lang => {
    const filePath = path.join(localesPath, `${lang}.json`);
    if (fs.existsSync(filePath)) {
      translations[lang] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  });

  return translations;
};

// Initialize i18next
i18next.init({
  lng: 'en', // default language
  fallbackLng: 'en',
  resources: loadTranslations(),
  interpolation: {
    escapeValue: false
  }
});

/**
 * Get translation for key
 * @param {string} key - Translation key
 * @param {string} lang - Language code (en/mr)
 * @param {Object} params - Interpolation parameters
 * @returns {string}
 */
const t = (key, lang = 'en', params = {}) => {
  return i18next.t(key, { lng: lang, ...params });
};

/**
 * Get translation with fallback
 * @param {string} key - Translation key
 * @param {string} lang - Language code
 * @param {string} fallback - Fallback text
 * @returns {string}
 */
const translate = (key, lang = 'en', fallback = '') => {
  const translation = i18next.t(key, { lng: lang });
  return translation !== key ? translation : fallback;
};

/**
 * Get localized field from object
 * @param {Object} obj - Object with localized fields
 * @param {string} field - Field name (without language suffix)
 * @param {string} lang - Language code
 * @returns {string}
 */
const getLocalizedField = (obj, field, lang = 'en') => {
  if (!obj) return '';
  
  if (lang === 'mr' && obj[`${field}_mr`]) {
    return obj[`${field}_mr`];
  }
  
  return obj[field] || '';
};

/**
 * Middleware to set language from request
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Next middleware
 */
const languageMiddleware = (req, res, next) => {
  // Get language from query, header, or default to 'en'
  const lang = req.query.lang || req.headers['accept-language'] || 'en';
  req.language = ['en', 'mr'].includes(lang) ? lang : 'en';
  
  // Add translation helper to request
  req.t = (key, params) => t(key, req.language, params);
  
  next();
};

/**
 * Format date based on language
 * @param {Date} date - Date to format
 * @param {string} lang - Language code
 * @returns {string}
 */
const formatDate = (date, lang = 'en') => {
  if (!date) return '';
  
  const options = { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  };
  
  const locale = lang === 'mr' ? 'mr-IN' : 'en-IN';
  return new Date(date).toLocaleDateString(locale, options);
};

/**
 * Format number based on language
 * @param {number} number - Number to format
 * @param {string} lang - Language code
 * @returns {string}
 */
const formatNumber = (number, lang = 'en') => {
  if (number === null || number === undefined) return '';
  
  const locale = lang === 'mr' ? 'mr-IN' : 'en-IN';
  return new Intl.NumberFormat(locale).format(number);
};

/**
 * Get available languages
 * @returns {Array}
 */
const getAvailableLanguages = () => {
  return [
    { code: 'en', name: 'English', nativeName: 'English' },
    { code: 'mr', name: 'Marathi', nativeName: 'मराठी' }
  ];
};

module.exports = {
  t,
  translate,
  getLocalizedField,
  languageMiddleware,
  formatDate,
  formatNumber,
  getAvailableLanguages,
  i18next
};
