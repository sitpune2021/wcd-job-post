const Joi = require('joi');
const { marathiString } = require('../common');

// Fully relaxed fields (accept anything)
const postFields = {
  post_code: Joi.any(),
  post_name: Joi.any(),
  post_name_mr: Joi.any(),
  post_type: Joi.any(),

  component_id: Joi.any(),
  hub_id: Joi.any(),

  district_id: Joi.any(),

  female_only: Joi.any(),
  male_only: Joi.any(),
  is_active: Joi.any(),
  is_open: Joi.any(),

  description: Joi.any(),
  description_mr: Joi.any(),

  qualification: Joi.any(),
  qualification_mr: Joi.any(),

  experience_required_months: Joi.any(),
  age_limit_min: Joi.any(),
  age_limit_max: Joi.any(),

  display_order: Joi.any()
};

// Create schema (no required fields, allow everything)
const createPost = Joi.object(postFields).unknown(true);

// Update schema (at least 1 field, but anything allowed)
const updatePost = Joi.object(postFields)
  .min(1)
  .unknown(true);

// Params schema (also relaxed)
const postIdParam = Joi.object({
  id: Joi.any()
}).unknown(true);

module.exports = {
  createPost,
  updatePost,
  postIdParam
};