// webhooks/websiteLeadWebhook.js
// Flow 2 — Receives website contact form submissions

const express = require('express');
const router = express.Router();
const { Leads } = require('../services/sheetsService');
const { sendText } = require('../services/whatsappService');
const { sendEmail } = require('../services/emailService');
const { sendAlert } = require('../services/telegramService');
const { classifyToJSON } = require('../services/groqService');
const { websiteLeadOpening } = require('../ai/draftMessages');
const { makeId, nowISO, addDays } = require('../utils/helpers');
const { logError } = require('../utils/errorHandler');

router.post('/', async (req, res) => {
  const b = req.body || {};
  const name    = (b.name    || '').toString().trim();
  const phone   = (b.phone   || '').toString().trim();
  const email   = (b.email   || '').toString().trim();
  const message = (b.message || b.requirement || '').toString().trim();

  if (!name || (!phone && !email)) {
    return res.status(400).json({ error: 'bad_request', message: 'name and (phone or email) required' });
  }

  // ACK immediately
  res.status(200).json({ status: 'received' });

  try {
    // Save lead
    const leadData = {
      lead_id: makeId('LEAD-WEB'),
      name,
      phone,
      email,
      source: b.source || 'Website',
      status: 'New',
      followup_date: addDays(2),
      followup_attempts: 0,
      created_at: nowISO(),
      notes: message || 'No message provided.',
    };
    await Leads.append(leadData);

    // Classify + draft opening message
    const [classification, opening] = await Promise.all([
      classifyToJSON(
        `Classify this CA-firm enquiry. Output STRICT JSON only:
{"requirement":"<GST Registration/ITR Filing/Company Incorporation/Tax Audit/Bookkeeping/ROC Compliance/Other/Unclear>","urgency":"<High/Medium/Low/Unclear>"}
Message: ${message}`,
        { requirement: 'Unclear', urgency: 'Unclear' }
      ),
      websiteLeadOpening({ name, message }),
    ]);

    // Update lead classification
    await Leads.update('phone', phone || email, {
      requirement: classification.requirement,
      urgency: classification.urgency,
      status: 'Qualifying',
    });

    // Send via WhatsApp if phone available
    if (phone) await sendText(phone, opening);

    // Send via Email if email available
    if (email) await sendEmail(
      email,
      `Thanks for reaching out to ${require('../config/keys').keys.FIRM_NAME}`,
      opening
    );

    // Alert partner if urgent
    if (classification.urgency === 'High') {
      await sendAlert(
        `🌐 *Urgent Website Lead*\nName: ${name}\nPhone: ${phone}\nEmail: ${email}\nRequirement: ${classification.requirement}`
      );
    }

    console.log(`✅ Website lead processed: ${name} (${classification.requirement})`);
  } catch (err) {
    logError('Website Lead Webhook', 'POST handler', err.message);
  }
});

module.exports = router;
