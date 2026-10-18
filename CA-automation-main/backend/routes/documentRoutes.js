// routes/documentRoutes.js
// Smart Document Collection & Verification Hub API
// CA Firm Automation Suite

const express = require('express');
const router = express.Router();
const sheetsService = require('../services/sheetsService');
const whatsappService = require('../services/whatsappService');
const emailService = require('../services/emailService');
const groqService = require('../services/groqService');
const { nowISO } = require('../utils/helpers');
const { keys } = require('../config/keys');

// GET /api/documents — List all document records
router.get('/', async (req, res) => {
  try {
    const docs = await sheetsService.getAllDocuments();
    res.json(docs);
  } catch (err) {
    res.status(500).json({ error: 'Could not load documents' });
  }
});

// PUT /api/documents/:docId/mark-received — Mark document as received/verified
router.put('/:docId/mark-received', async (req, res) => {
  try {
    const { status = 'Received' } = req.body;
    await sheetsService.updateDocumentStatus(req.params.docId, status, nowISO());
    res.json({ success: true, message: `Document marked as ${status}` });
  } catch (err) {
    res.status(500).json({ error: 'Could not mark document received' });
  }
});

// POST /api/documents/:clientId/chase — 1-click chase for all pending documents of a client
router.post('/:clientId/chase', async (req, res) => {
  try {
    const clientId = req.params.clientId;
    const clientDocs = await sheetsService.getDocumentsForClient(clientId);
    const pending = clientDocs.filter((d) => d.status === 'Pending');

    if (!pending.length) {
      return res.json({ success: true, message: 'No pending documents for this client' });
    }

    const first = pending[0];
    const docList = pending.map((d, i) => `${i + 1}. ${d.document_name}`).join('\n');

    const message = await groqService.draftMessage('document_request', {
      clientName: first.client_name,
      complianceType: first.compliance_type,
      documentList: docList,
      firmName: keys.FIRM_NAME,
    });

    if (first.phone) {
      await whatsappService.sendTextMessage(first.phone, message);
    }
    if (first.email) {
      await emailService.sendEmail(
        first.email,
        `Pending Documents Needed — ${first.compliance_type}`,
        message
      );
    }

    // Increment follow-up counts
    for (const d of pending) {
      await sheetsService.Documents.update('doc_id', d.doc_id, {
        followup_count: (parseInt(d.followup_count) || 0) + 1,
        last_followup_date: nowISO(),
      });
    }

    res.json({
      success: true,
      message: `Chased ${pending.length} pending document(s) via WhatsApp/Email`,
    });
  } catch (err) {
    console.error('[DOCS] Error sending document chase:', err.message);
    res.status(500).json({ error: 'Could not send document chase' });
  }
});

module.exports = router;
