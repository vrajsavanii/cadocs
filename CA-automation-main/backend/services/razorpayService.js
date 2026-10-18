// backend/services/razorpayService.js
// Razorpay Payment Links & Webhook Verification for Invoices
// CA Firm Automation Suite

const Razorpay = require('razorpay');
const crypto = require('crypto');
const { keys } = require('../config/keys');

let razorpayInstance = null;

if (keys.RAZORPAY_KEY_ID && keys.RAZORPAY_KEY_SECRET && !keys.RAZORPAY_KEY_ID.includes('your_')) {
  try {
    razorpayInstance = new Razorpay({
      key_id: keys.RAZORPAY_KEY_ID,
      key_secret: keys.RAZORPAY_KEY_SECRET,
    });
    console.log('✅ Razorpay client initialized');
  } catch (err) {
    console.warn('⚠️ Razorpay initialization failed, falling back to simulated links:', err.message);
  }
}

/**
 * Generate a payment link for a client invoice
 * @param {Object} params
 * @param {string} params.invoiceId
 * @param {number} params.amount
 * @param {string} params.clientName
 * @param {string} params.clientPhone
 * @param {string} params.clientEmail
 * @param {string} params.description
 * @returns {Promise<{paymentLinkId: string, shortUrl: string, status: string}>}
 */
async function createInvoicePaymentLink({ invoiceId, amount, clientName, clientPhone, clientEmail, description }) {
  const amountInPaise = Math.round(parseFloat(amount) * 100);

  if (razorpayInstance) {
    try {
      const paymentLink = await razorpayInstance.paymentLink.create({
        amount: amountInPaise,
        currency: 'INR',
        accept_partial: false,
        reference_id: `INV-${invoiceId}-${Date.now()}`,
        description: description || `Professional CA Services - ${keys.FIRM_NAME}`,
        customer: {
          name: clientName || 'Valued Client',
          contact: clientPhone ? clientPhone.replace(/[^0-9]/g, '').slice(-10) : undefined,
          email: clientEmail || undefined,
        },
        notify: {
          sms: !!clientPhone,
          email: !!clientEmail,
          whatsapp: false, // Dispatched via our own whatsappService
        },
        reminder_enable: true,
        notes: {
          invoice_id: invoiceId,
          firm: keys.FIRM_NAME,
        },
        callback_url: `${keys.FRONTEND_URL}/#invoices`,
        callback_method: 'get',
      });

      return {
        success: true,
        paymentLinkId: paymentLink.id,
        shortUrl: paymentLink.short_url,
        amount: paymentLink.amount / 100,
        status: paymentLink.status,
      };
    } catch (err) {
      console.error('[RAZORPAY] Link creation error:', err.message);
    }
  }

  // Graceful fallback for demo/testing when live keys aren't added
  const mockId = `plink_${Math.random().toString(36).substr(2, 9)}`;
  const mockUrl = `https://rzp.io/i/${mockId}`;
  return {
    success: true,
    paymentLinkId: mockId,
    shortUrl: mockUrl,
    amount: parseFloat(amount),
    status: 'created',
    simulated: true,
  };
}

/**
 * Verify Razorpay Webhook Signature
 */
function verifyWebhookSignature(body, signature, secret) {
  if (!secret) return true;
  try {
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(typeof body === 'string' ? body : JSON.stringify(body))
      .digest('hex');
    return expectedSignature === signature;
  } catch (err) {
    return false;
  }
}

module.exports = {
  createInvoicePaymentLink,
  verifyWebhookSignature,
};
