const Joi = require('joi');

const selfEvaluation = Joi.object({
  review_period: Joi.string().max(100).required(),
  period_start: Joi.date().iso().required(),
  period_end: Joi.date().iso().min(Joi.ref('period_start')).required(),
  self_rating: Joi.number().min(1).max(5).precision(1).required(),
  key_achievements: Joi.string().max(2000).required(),
  challenges_faced: Joi.string().max(2000).allow('', null),
  improvement_plan: Joi.string().max(2000).allow('', null)
});

const appraiserReview = Joi.object({
  appraiser_rating: Joi.number().min(1).max(5).precision(1).required(),
  appraiser_remarks: Joi.string().max(2000).required(),
  grade: Joi.string().valid('A', 'B', 'B+', 'C', 'D', 'F').required(),
  score: Joi.number().integer().min(0).max(100).required()
});

const performanceQuery = Joi.object({
  status: Joi.string().valid('PENDING', 'SELF_SUBMITTED', 'REVIEWED', 'COMPLETED'),
  period: Joi.string().max(100),
  employee_id: Joi.number().integer().min(1),
  district_id: Joi.number().integer().min(1),
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100)
});

module.exports = {
  selfEvaluationSchema: selfEvaluation,
  appraiserReviewSchema: appraiserReview,
  performanceQuerySchema: performanceQuery
};
