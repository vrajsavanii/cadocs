// webhooks/whatsappWebhook.js
// Meta WhatsApp Cloud API Webhook — The Smart Omnichannel Inbox
// CA Firm Automation Suite

const express = require('express');
const router = express.Router();
const { keys } = require('../config/keys');
const sheetsService = require('../services/sheetsService');
const whatsappService = require('../services/whatsappService');
const telegramService = require('../services/telegramService');
const groqService = require('../services/groqService');
const r2Service = require('../services/r2Service');
const ocrParser = require('../ai/ocrParser');
const { logError } = require('../utils/errorHandler');
const { phonesMatch, makeId, nowISO, addDays } = require('../utils/helpers');

// Simple in-memory deduplication cache for Meta webhooks
const processedMessages = new Set();

// ── GET — Meta Webhook Verification ──────────────────────────────────────────
router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === keys.WHATSAPP_VERIFY_TOKEN) {
    console.log('[WA-WEBHOOK] ✅ Webhook verified by Meta');
    return res.status(200).send(challenge);
  }
  console.warn('[WA-WEBHOOK] ⚠️ Verification failed — token mismatch');
  return res.status(403).json({ error: 'forbidden', message: 'verify token mismatch' });
});

// ── POST — Incoming WhatsApp Message ─────────────────────────────────────────
router.post('/', async (req, res) => {
  // Step 1: ACK Meta immediately (<1 second requirement)
  res.status(200).json({ status: 'received' });

  try {
    const body = req.body || {};
    const entry = (body.entry && body.entry[0]) || {};
    const change = (entry.changes && entry.changes[0]) || {};
    const value = change.value || {};
    const messages = value.messages || [];
    const contacts = value.contacts || [];

    if (!messages.length) return; // Status updates or delivery receipts

    const msg = messages[0];
    const messageId = msg.id;

    // Idempotency check: avoid double replies
    if (messageId && processedMessages.has(messageId)) {
      return;
    }
    if (messageId) {
      processedMessages.add(messageId);
      if (processedMessages.size > 2000) {
        const first = processedMessages.values().next().value;
        processedMessages.delete(first);
      }
    }

    const contact = contacts[0] || {};
    const fromPhone = msg.from || '';
    const msgType = msg.type || 'text';
    const isMedia = msgType === 'document' || msgType === 'image';
    const textBody = msgType === 'text' ? (msg.text?.body || '') : '';
    const mediaId = isMedia ? (msg[msgType]?.id || '') : '';
    const mediaFileName = isMedia ? (msg[msgType]?.filename || `${msgType}_${Date.now()}`) : '';

    console.log(`[WA-WEBHOOK] 📱 Inbound from ${fromPhone} [${msgType}]: ${textBody || mediaFileName}`);

    // Mark as read in WhatsApp
    if (messageId) {
      whatsappService.markAsRead(messageId).catch(() => {});
    }

    // Step 2: Check if sender is a registered client
    const client = await sheetsService.getClientByPhone(fromPhone);

    if (client) {
      // ────────────────────────────────────────────────────────────────────────
      // SCENARIO A: KNOWN CLIENT
      // ────────────────────────────────────────────────────────────────────────
      if (isMedia) {
        // Client sent a document / photo of bills
        await handleKnownClientMedia(client, fromPhone, mediaId, mediaFileName, msgType);
      } else {
        // Client sent a text query
        await handleKnownClientText(client, fromPhone, textBody);
      }
    } else {
      // ────────────────────────────────────────────────────────────────────────
      // SCENARIO B: UNKNOWN SENDER (Inbound Prospect / Lead)
      // ────────────────────────────────────────────────────────────────────────
      await handleInboundLead(fromPhone, contact?.profile?.name || '', textBody);
    }
  } catch (err) {
    console.error('[WA-WEBHOOK] ❌ Processing error:', err.message);
    logError('WhatsApp Webhook', 'POST handler', err.message);
  }
});

/**
 * Handle document/image upload from a known client
 */
async function handleKnownClientMedia(client, fromPhone, mediaId, fileName, msgType) {
  try {
    const downloaded = await whatsappService.downloadMediaFile(mediaId);
    const clientDocs = await sheetsService.getDocumentsForClient(client.client_id);
    const pendingDoc = clientDocs.find((d) => d.status === 'Pending');

    let storageLocation = null;
    if (downloaded?.buffer) {
      const ext = downloaded.fileName ? downloaded.fileName.split('.').pop() : 'pdf';
      const keyPath = `clients/${client.client_id}/${Date.now()}_${fileName || 'document.' + ext}`;
      const uploadResult = await r2Service.uploadDocument(
        downloaded.buffer,
        fileName || 'client_document',
        downloaded.mimeType,
        keyPath
      );
      storageLocation = uploadResult.location;
    }

    if (pendingDoc) {
      // Advance status of pending document
      await sheetsService.updateDocumentStatus(pendingDoc.doc_id, 'Received', nowISO());

      await whatsappService.sendTextMessage(
        fromPhone,
        `✅ *Document Received!*\nThank you ${client.name}. We have logged your *${pendingDoc.document_name}* for ${pendingDoc.compliance_type}. Our audit team will verify it shortly. 🙏`
      );

      // Async OCR pipeline trigger (non-blocking)
      if (downloaded?.buffer) {
        setImmediate(async () => {
          try {
            console.log(`[OCR] 🔍 Running background OCR verification for ${pendingDoc.document_name}...`);
            const classified = await ocrParser.classifyDocument(downloaded.buffer, downloaded.mimeType);
            if (classified === 'gst_invoice') {
              const invData = await ocrParser.extractGSTInvoice(downloaded.buffer, downloaded.mimeType);
              console.log(`[OCR] ✅ Extracted GST Invoice #${invData.invoiceNumber} (Amount: ₹${invData.totalAmount})`);
            } else if (classified === 'bank_statement') {
              const stmtData = await ocrParser.extractBankStatement(downloaded.buffer, downloaded.mimeType);
              console.log(`[OCR] ✅ Extracted Bank Statement: ${stmtData.bankName} (${stmtData.transactionsCount || 0} txn)`);
            }
          } catch (ocrErr) {
            console.warn('[OCR] Background parse note:', ocrErr.message);
          }
        });
      }
    } else {
      // General upload
      await whatsappService.sendTextMessage(
        fromPhone,
        `✅ Thank you ${client.name}! We have received your file (${fileName || 'document'}). It has been safely archived in your practice vault. 🙏`
      );
    }
  } catch (err) {
    console.error('[WA-MEDIA] Error handling media:', err.message);
  }
}

/**
 * Handle text queries from a registered client
 */
async function handleKnownClientText(client, fromPhone, textBody) {
  try {
    const [compliance, documents] = await Promise.all([
      sheetsService.getComplianceForClient(client.client_id),
      sheetsService.getDocumentsForClient(client.client_id),
    ]);

    const clientContext = {
      clientName: client.name,
      compliance,
      documents,
      firmName: keys.FIRM_NAME,
    };

    const aiReply = await groqService.answerClientQuery(textBody, clientContext);

    await whatsappService.sendTextMessage(fromPhone, aiReply);

    // Log query in Query_Log tab
    await sheetsService.logQuery({
      log_id: makeId('LOG'),
      client_id: client.client_id,
      phone: fromPhone,
      email: client.email || '',
      channel: 'whatsapp',
      query_text: textBody,
      ai_response: aiReply,
      timestamp: nowISO(),
    });
  } catch (err) {
    console.error('[WA-TEXT] Error handling query:', err.message);
    const fallback = groqService.getSmartFallbackReply(textBody);
    await whatsappService.sendTextMessage(fromPhone, fallback);
  }
}

/**
 * Handle new prospective leads texting the firm
 */
async function handleInboundLead(fromPhone, contactName, textBody) {
  try {
    const existingLeads = await sheetsService.getAllLeads();
    const cleanFrom = fromPhone.replace(/\D/g, '');
    const matchedLead = existingLeads.find((l) => phonesMatch(l.phone, cleanFrom));

    // AI Lead classification
    const classification = await groqService.classifyLead(textBody);

    if (!matchedLead) {
      const newLead = {
        lead_id: makeId('LEAD-WA'),
        name: contactName || 'WhatsApp Lead',
        phone: fromPhone,
        email: '',
        source: 'WhatsApp',
        requirement: classification.requirement,
        business_type: classification.business_type,
        urgency: classification.urgency,
        qualification_score: classification.qualification_score,
        status: 'New',
        followup_date: addDays(2),
        followup_attempts: '0',
        created_at: nowISO(),
        notes: textBody,
      };

      await sheetsService.addLead(newLead);

      // Welcome response
      const welcomeMsg = `🙏 Namaste! Main ${keys.FIRM_NAME} ki taraf se hoon.\nAapka message receive ho gaya hai regarding ${classification.requirement || 'CA services'}. Hamari team jald hi aapse contact karegi. Kya aap apna registered business name aur preferred call time share kar sakte hain? ✨`;
      await whatsappService.sendTextMessage(fromPhone, welcomeMsg);

      // Alert partner immediately if Hot Lead
      if (classification.qualification_score === 'Hot' || classification.urgency === 'High') {
        await telegramService.sendHotLeadAlert({
          name: contactName || 'WhatsApp Prospect',
          phone: fromPhone,
          requirement: classification.requirement,
          urgency: classification.urgency,
          summary: classification.summary,
        });
      }
    } else {
      // Continuing conversation from existing lead
      await sheetsService.updateLeadStatus(matchedLead.lead_id, 'Qualifying');
      const ackMsg = `Namaste! We have added your requirement (${classification.requirement}) to your enquiry file. Our partner will connect with you shortly. 🙏`;
      await whatsappService.sendTextMessage(fromPhone, ackMsg);
    }
  } catch (err) {
    console.error('[WA-LEAD] Error handling inbound lead:', err.message);
  }
}

module.exports = router;
