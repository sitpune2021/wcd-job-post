const Joi = require('joi');

// how to use whne req // New option (when required) //  requiredField: marathiString(true) // else by default optional

// Enhanced regex for Devanagari (Marathi) characters with more allowed characters
// Allows: Devanagari letters, numbers, English letters (for common terms), and punctuation: , . - _ / ( ) [ ]
const DEVANAGARI_PATTERN = /^[\u0900-\u097F\s0-9A-Za-z.,\-_\/\(\)\[\]]+$/;

// Reusable Joi helper for Marathi text fields (allows empty/null and optional)
const marathiString = (required = false) => {
  const validator = Joi.string()
    .trim()
    .allow('', null)
    .custom((value, helpers) => {
      if (!value) return value;
      if (!DEVANAGARI_PATTERN.test(value)) {
        return helpers.error('string.pattern.name', { name: 'Devanagari (Marathi) text with common characters' });
      }
      return value;
    })
    .messages({
      'string.pattern.name': 'must contain only Marathi (Devanagari) characters, numbers, and common punctuation (.,-_ /())'
    });
  
  return required ? validator.required() : validator.optional();
};

module.exports = {
  DEVANAGARI_PATTERN,
  marathiString
};
