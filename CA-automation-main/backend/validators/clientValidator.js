// backend/validators/clientValidator.js
// Joi validation for Client entity
// CA Firm Automation Suite

const Joi = require('joi');

const clientSchema = Joi.object({
  client_id: Joi.string().trim().optional(),
  name: Joi.string().trim().min(2).max(100).required().messages({
    'string.empty': 'Client/Firm name is required',
    'string.min': 'Client name must have at least 2 characters',
  }),
  contact_person: Joi.string().trim().max(100).allow('', null).optional(),
  email: Joi.string().trim().email().allow('', null).optional().messages({
    'string.email': 'Please provide a valid email address',
  }),
  phone: Joi.string().trim().pattern(/^[+0-9\s-]{10,15}$/).required().messages({
    'string.empty': 'Valid phone number is required',
    'string.pattern.base': 'Phone must be a valid 10-15 digit phone number',
  }),
  entity_type: Joi.string().valid('Private Limited', 'LLP', 'Partnership', 'Proprietorship', 'Individual', 'Trust', 'HUF', 'Other').default('Private Limited'),
  gst_number: Joi.string().trim().uppercase().pattern(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/).allow('', null).optional().messages({
    'string.pattern.base': 'Invalid Indian GSTIN format (15 characters alphanumeric)',
  }),
  pan: Joi.string().trim().uppercase().pattern(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/).allow('', null).optional().messages({
    'string.pattern.base': 'Invalid Indian PAN format (e.g. ABCDE1234F)',
  }),
  services_opted: Joi.string().allow('', null).optional(),
  city: Joi.string().trim().allow('', null).optional(),
  state: Joi.string().trim().allow('', null).optional(),
  gst_filing_type: Joi.string().valid('monthly', 'qrmp', 'nil', 'none').optional(),
  status: Joi.string().valid('Active', 'Inactive', 'Onboarding', 'Suspended').default('Active'),
});

function validateClient(data) {
  return clientSchema.validate(data, { abortEarly: false, stripUnknown: true });
}

module.exports = { clientSchema, validateClient };
