// services/whatsappService.js
// Meta WhatsApp Cloud API v21.0 Engine
// CA Firm Automation Suite

const axios = require('axios');
const { keys } = require('../config/keys');

function isWAConfigured() {
  return Boolean(
    keys.WHATSAPP_PHONE_NUMBER_ID &&
    keys.WHATSAPP_ACCESS_TOKEN &&
    !keys.WHATSAPP_PHONE_NUMBER_ID.includes('your_') &&
    !keys.WHATSAPP_ACCESS_TOKEN.includes('your_')
  );
}

function cleanPhone(phone) {
  let cleaned = String(phone || '').replace(/\D/g, '');
  if (cleaned.length === 10) cleaned = '91' + cleaned;
  return cleaned;
}

/**
 * Send text message via Meta Cloud API
 */
async function sendTextMessage(toPhone, messageText, retries = 3) {
  const target = cleanPhone(toPhone);
  if (!target) return false;

  if (!isWAConfigured()) {
    console.log(`[WA-OUT-MOCK] 📱 To: +${target} | Msg: "${messageText.replace(/[\n\r]+/g, ' ')}"`);
    return { messageId: `mock-wa-${Date.now()}`, status: 'sent' };
  }

  const url = `https://graph.facebook.com/v21.0/${keys.WHATSAPP_PHONE_NUMBER_ID}/messages`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await axios.post(
        url,
        {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: target,
          type: 'text',
          text: { preview_url: false, body: String(messageText) },
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${keys.WHATSAPP_ACCESS_TOKEN}`,
          },
          timeout: 15000,
        }
      );

      const msgId = res.data?.messages?.[0]?.id;
      console.log(`[WA-OUT] ✅ Sent to ${target} (ID: ${msgId})`);
      return { messageId: msgId, status: 'sent' };
    } catch (err) {
      const errMsg = err.response?.data?.error?.message || err.message;
      const status = err.response?.status;
      console.error(`[WA-ERR] ❌ Attempt ${attempt}/${retries} to ${target} failed:`, errMsg);

      if (status === 429 && attempt < retries) {
        await new Promise((r) => setTimeout(r, 4000));
      } else if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }
  return false;
}

/**
 * Send interactive quick-reply buttons (up to 3)
 */
async function sendInteractiveButtons(toPhone, bodyText, buttons = []) {
  const target = cleanPhone(toPhone);
  if (!target || !buttons.length) return false;

  if (!isWAConfigured()) {
    console.log(`[WA-BUTTONS-MOCK] 📱 To: +${target} | "${bodyText}" | [${buttons.map((b) => b.title).join(', ')}]`);
    return true;
  }

  const url = `https://graph.facebook.com/v21.0/${keys.WHATSAPP_PHONE_NUMBER_ID}/messages`;

  const formattedButtons = buttons.slice(0, 3).map((b, idx) => ({
    type: 'reply',
    reply: {
      id: b.id || `btn_${idx + 1}`,
      title: String(b.title).slice(0, 20),
    },
  }));

  try {
    await axios.post(
      url,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: target,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: bodyText },
          action: { buttons: formattedButtons },
        },
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${keys.WHATSAPP_ACCESS_TOKEN}`,
        },
        timeout: 15000,
      }
    );
    console.log(`[WA-OUT] ✅ Interactive buttons sent to ${target}`);
    return true;
  } catch (err) {
    console.error('[WA-ERR] ❌ sendInteractiveButtons error:', err.response?.data?.error?.message || err.message);
    return false;
  }
}

/**
 * Mark incoming message as read (blue ticks)
 */
async function markAsRead(messageId) {
  if (!isWAConfigured() || !messageId) return false;

  const url = `https://graph.facebook.com/v21.0/${keys.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  try {
    await axios.post(
      url,
      {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${keys.WHATSAPP_ACCESS_TOKEN}`,
        },
      }
    );
    return true;
  } catch (err) {
    // Non-critical
    return false;
  }
}

/**
 * Download media sent by a client (PDF, Image)
 */
async function downloadMediaFile(mediaId) {
  if (!isWAConfigured() || !mediaId) {
    return {
      buffer: Buffer.from('%PDF-1.4 Mock Document Content for Testing'),
      mimeType: 'application/pdf',
      fileName: 'client_document.pdf',
    };
  }

  try {
    // Step 1: Query media URL
    const metaRes = await axios.get(`https://graph.facebook.com/v21.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${keys.WHATSAPP_ACCESS_TOKEN}` },
    });

    const mediaUrl = metaRes.data?.url;
    const mimeType = metaRes.data?.mime_type || 'application/pdf';

    if (!mediaUrl) throw new Error('No media download URL returned by Meta');

    // Step 2: Download binary data
    const fileRes = await axios.get(mediaUrl, {
      headers: { Authorization: `Bearer ${keys.WHATSAPP_ACCESS_TOKEN}` },
      responseType: 'arraybuffer',
    });

    const ext = mimeType.includes('pdf') ? '.pdf' : mimeType.includes('png') ? '.png' : '.jpg';
    const fileName = `wa_doc_${Date.now()}${ext}`;

    return {
      buffer: Buffer.from(fileRes.data),
      mimeType,
      fileName,
    };
  } catch (err) {
    console.error('[WA-ERR] ❌ downloadMediaFile error:', err.message);
    return null;
  }
}

// Backward-compatible alias
const sendText = sendTextMessage;

module.exports = {
  sendTextMessage,
  sendText,
  sendInteractiveButtons,
  markAsRead,
  downloadMediaFile,
  cleanPhone,
  isWAConfigured,
};
