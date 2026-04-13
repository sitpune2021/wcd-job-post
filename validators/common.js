const Joi = require('joi');

// Regex for Devanagari (Marathi) characters plus common punctuation/whitespace
const DEVANAGARI_PATTERN = /^[\u0900-\u097F\s.,-]+$/;

// Reusable Joi helper for Marathi text fields (allows empty/null)
const marathiString = () =>
  Joi.string()
    .trim()
    .allow('', null)
    .custom((value, helpers) => {
      if (!value) return value;
      if (!DEVANAGARI_PATTERN.test(value)) {
        return helpers.error('string.pattern.name', { name: 'Devanagari (Marathi) text' });
      }
      return value;
    })
    .messages({
      'string.pattern.name': 'must contain only Marathi (Devanagari) characters'
    });

module.exports = {
  DEVANAGARI_PATTERN,
  marathiString
};
