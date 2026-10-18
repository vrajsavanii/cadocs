// services/telegramService.js
// Partner Alert & Practice Escalation Bot
// CA Firm Automation Suite

const axios = require('axios');
const { keys } = require('../config/keys');

function isTelegramConfigured() {
  return Boolean(
    keys.TELEGRAM_BOT_TOKEN &&
    keys.TELEGRAM_PARTNER_CHAT_ID &&
    !keys.TELEGRAM_BOT_TOKEN.includes('your_') &&
    !keys.TELEGRAM_PARTNER_CHAT_ID.includes('your_')
  );
}

/**
 * Send alert to Partner Telegram chat with priority badge
 * @param {string} message - Message text (HTML or Markdown)
 * @param {'normal' | 'urgent' | 'critical'} priority
 */
async function sendAlert(message, priority = 'normal', retries = 2) {
  if (!isTelegramConfigured()) {
    console.log(`[TELEGRAM-MOCK] (${priority.toUpperCase()}) ${message.replace(/[\n\r]+/g, ' ')}`);
    return true;
  }

  const prefix = {
    normal: '📊',
    urgent: '⚠️',
    critical: '🚨',
  }[priority] || '📊';

  const fullMessage = `${prefix} ${message}`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await axios.post(
        `https://api.telegram.org/bot${keys.TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          chat_id: keys.TELEGRAM_PARTNER_CHAT_ID,
          text: fullMessage,
          parse_mode: 'HTML',
        },
        { timeout: 10000 }
      );
      console.log(`[TELEGRAM] ✅ Alert sent (${priority})`);
      return true;
    } catch (err) {
      console.error(`[TELEGRAM] ❌ Attempt ${attempt}/${retries} failed:`, err.message);
      if (attempt < retries) await new Promise((r) => setTimeout(r, 2000));
    }
  }
  return false;
}

/**
 * Daily 10:45 AM Practice Briefing to Senior Partner
 */
async function sendDailySummary(data = {}) {
  const dateStr = new Date().toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  const msg = `<b>🏛️ CA Practice Daily Brief — ${dateStr}</b>

👥 <b>Active Clients:</b> ${data.activeClients || 0}
📂 <b>Pending Documents:</b> ${data.pendingDocs || 0}
⏰ <b>Compliance Due This Week:</b> ${data.dueThisWeek || 0}
💰 <b>Outstanding Fees:</b> ₹${(data.outstandingFees || 0).toLocaleString('en-IN')}

🚨 <b>Overdue Filings:</b> ${data.overdueCount || 0}
🔥 <b>Hot Leads Tracked:</b> ${data.hotLeads || 0}

<i>— ${keys.FIRM_NAME} AI Operations</i>`;

  return sendAlert(msg, data.overdueCount > 0 ? 'urgent' : 'normal');
}

/**
 * Immediate notification when an inbound hot lead is qualified
 */
async function sendHotLeadAlert(lead = {}) {
  const msg = `<b>🔥 NEW HOT LEAD DETECTED</b>
<b>Name:</b> ${lead.name || 'Unknown'}
<b>Phone:</b> ${lead.phone || 'N/A'}
<b>Requirement:</b> ${lead.requirement || 'General'}
<b>Urgency:</b> ${lead.urgency || 'High'}
<b>Summary:</b> ${lead.summary || 'Immediate client intent registered.'}`;

  return sendAlert(msg, 'critical');
}

/**
 * Immediate escalation for invoices overdue > 15 days
 */
async function sendEscalationAlert(clientName, amount, daysOverdue, invoiceId) {
  const msg = `<b>💰 INVOICE SEVERELY OVERDUE (>15 Days)</b>
<b>Client:</b> ${clientName}
<b>Amount:</b> ₹${parseFloat(amount || 0).toLocaleString('en-IN')}
<b>Days Overdue:</b> ${daysOverdue} days
<b>Invoice #:</b> ${invoiceId}
<i>Action: Partner phone call recommended.</i>`;

  return sendAlert(msg, 'urgent');
}

/**
 * Error alert for system failures
 */
async function sendErrorAlert(errorData = {}) {
  const msg = `<b>🚨 SYSTEM RUNTIME ERROR</b>
<b>Workflow:</b> ${errorData.workflow_name || 'Backend'}
<b>Node:</b> ${errorData.node_name || 'Unknown'}
<b>Error:</b> ${errorData.error_message || 'Uncaught error'}
<b>Time:</b> ${new Date().toISOString()}`;

  return sendAlert(msg, 'critical');
}

module.exports = {
  sendAlert,
  sendDailySummary,
  sendHotLeadAlert,
  sendEscalationAlert,
  sendErrorAlert,
  isTelegramConfigured,
};
