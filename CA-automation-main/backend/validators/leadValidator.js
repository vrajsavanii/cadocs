// backend/validators/leadValidator.js
// Joi validation for Leads
// CA Firm Automation Suite

const Joi = require('joi');

const leadSchema = Joi.object({
  lead_id: Joi.string().trim().optional(),
  name: Joi.string().trim().min(2).max(100).required().messages({
    'string.empty': 'Lead contact or company name is required',
  }),
  company_name: Joi.string().trim().allow('', null).optional(),
  entity_type: Joi.string().valid('Pvt Ltd', 'LLP', 'Partnership', 'Proprietorship', 'Individual', 'Other').optional(),
  phone: Joi.string().trim().pattern(/^[+0-9\s-]{10,15}$/).required().messages({
    'string.empty': 'Phone number is required',
    'string.pattern.base': 'Valid 10-15 digit phone number is required',
  }),
  email: Joi.string().trim().email().allow('', null).optional(),
  services_required: Joi.alternatives().try(Joi.string(), Joi.array().items(Joi.string())).optional(),
  turnover: Joi.string().allow('', null).optional(),
  lead_score: Joi.number().min(0).max(100).optional(),
  lead_category: Joi.string().valid('Hot', 'Warm', 'Cold').optional(),
  stage: Joi.string().valid('New', 'Contacted', 'Qualified', 'Proposal Sent', 'Won', 'Lost').default('New'),
  source: Joi.string().allow('', null).optional(),
  notes: Joi.string().allow('', null).optional(),
});

function validateLead(data) {
  return leadSchema.validate(data, { abortEarly: false, stripUnknown: true });
}

module.exports = { leadSchema, validateLead };
