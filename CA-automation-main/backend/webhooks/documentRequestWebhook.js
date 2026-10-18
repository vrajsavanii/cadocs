// webhooks/documentRequestWebhook.js
// Flow 4 — Partner initiates a document request for a client

const express = require('express');
const router = express.Router();
const { Clients, Documents } = require('../services/sheetsService');
const { sendText } = require('../services/whatsappService');
const { sendEmail } = require('../services/emailService');
const { documentRequest } = require('../ai/draftMessages');
const { makeId, nowISO } = require('../utils/helpers');
const { logError } = require('../utils/errorHandler');

router.post('/', async (req, res) => {
  const b = req.body || {};
  const client_id      = (b.client_id || '').toString().trim();
  const compliance_type = (b.compliance_type || 'General').toString().trim();
  const documents      = Array.isArray(b.documents) ? b.documents.filter((d) => d && String(d).trim()) : [];

  if (!client_id || !documents.length) {
    return res.status(400).json({ error: 'bad_request', message: 'client_id and non-empty documents[] required' });
  }

  res.status(200).json({ status: 'received' });

  try {
    // Get client details
    const clients = await Clients.getAll();
    const client = clients.find((c) => c.client_id === client_id) || {};

    // Create Pending rows for each document
    for (let i = 0; i < documents.length; i++) {
      await Documents.append({
        doc_id: makeId('DOC') + '-' + i,
        client_id,
        client_name: client.name || 'Client',
        phone: client.phone || '',
        email: client.email || '',
        compliance_type,
        document_name: String(documents[i]).trim(),
        requested_date: nowISO(),
        status: 'Pending',
        followup_count: 0,
      });
    }

    // Build doc list for AI
    const doc_list = documents.map((d, i) => `${i + 1}. ${d}`).join('\n');

    // Draft AI request message
    const message = await documentRequest({
      client_name: client.name || 'Client',
      compliance_type,
      doc_list,
    });

    // Send via WhatsApp + Email
    if (client.phone) await sendText(client.phone, message);
    if (client.email) await sendEmail(
      client.email,
      `Documents needed — ${compliance_type}`,
      message
    );

    console.log(`✅ Document request sent to ${client.name} for ${documents.length} doc(s)`);
  } catch (err) {
    logError('Document Request Webhook', 'POST handler', err.message);
  }
});

module.exports = router;
