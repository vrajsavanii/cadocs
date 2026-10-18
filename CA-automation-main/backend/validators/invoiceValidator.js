// backend/validators/invoiceValidator.js
// Joi validation for Invoices
// CA Firm Automation Suite

const Joi = require('joi');

const invoiceSchema = Joi.object({
  invoice_id: Joi.string().trim().optional(),
  client_id: Joi.string().trim().required().messages({
    'any.required': 'Client ID is required for invoice creation',
  }),
  client_name: Joi.string().trim().allow('', null).optional(),
  amount: Joi.number().positive().required().messages({
    'number.base': 'Invoice amount must be a number',
    'number.positive': 'Invoice amount must be greater than zero',
    'any.required': 'Amount is required',
  }),
  service_description: Joi.string().trim().min(3).max(250).required().messages({
    'string.empty': 'Service description is required',
  }),
  due_date: Joi.string().isoDate().required().messages({
    'string.isoDate': 'Due date must be in YYYY-MM-DD format',
    'any.required': 'Due date is required',
  }),
  invoice_date: Joi.string().isoDate().optional(),
  status: Joi.string().valid('Pending', 'Paid', 'Overdue', 'Cancelled').default('Pending'),
  gst_amount: Joi.number().min(0).optional(),
  total_amount: Joi.number().positive().optional(),
  payment_link: Joi.string().uri().allow('', null).optional(),
  notes: Joi.string().allow('', null).optional(),
});

function validateInvoice(data) {
  return invoiceSchema.validate(data, { abortEarly: false, stripUnknown: true });
}

module.exports = { invoiceSchema, validateInvoice };
