// webhooks/paymentWebhook.js
// Flow 5 — Payment confirmation from payment gateway or manual trigger

const express = require('express');
const router = express.Router();
const { Invoices } = require('../services/sheetsService');
const { sendText } = require('../services/whatsappService');
const { sendEmail } = require('../services/emailService');
const { paymentThankYou } = require('../ai/draftMessages');
const { nowISO } = require('../utils/helpers');
const { logError } = require('../utils/errorHandler');

router.post('/', async (req, res) => {
  const b = req.body || {};
  const invoice_id   = (b.invoice_id || '').toString().trim();
  const amount_paid  = b.amount_paid || b.amount || '';
  const payment_date = b.payment_date || nowISO();

  if (!invoice_id) {
    return res.status(400).json({ error: 'bad_request', message: 'invoice_id required' });
  }

  res.status(200).json({ status: 'received' });

  try {
    // Find invoice
    const invoices = await Invoices.getAll();
    const inv = invoices.find((i) => i.invoice_id === invoice_id);

    if (!inv) {
      console.warn(`⚠️ Payment webhook: invoice ${invoice_id} not found`);
      return;
    }

    // Mark as Paid
    await Invoices.update('invoice_id', invoice_id, {
      status: 'Paid',
      payment_date,
    });

    // Draft thank-you message
    const message = await paymentThankYou({
      client_name: inv.client_name,
      invoice_id: inv.invoice_id,
      amount: amount_paid || inv.amount,
      currency: inv.currency || 'INR',
    });

    // Send via WhatsApp + Email
    if (inv.phone) await sendText(inv.phone, message);
    if (inv.email) await sendEmail(inv.email, 'Payment received — thank you!', message);

    console.log(`✅ Payment confirmed: ${invoice_id} for ${inv.client_name}`);
  } catch (err) {
    logError('Payment Webhook', 'POST handler', err.message);
  }
});

module.exports = router;
