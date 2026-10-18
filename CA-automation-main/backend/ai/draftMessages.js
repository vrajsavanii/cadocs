// ai/draftMessages.js
// AI drafts for compliance reminders, document requests, invoice reminders, follow-ups

const { complete } = require('../services/groqService');
const { keys } = require('../config/keys');

const FIRM = keys.FIRM_NAME || 'Our CA Firm';

// ── COMPLIANCE REMINDER ───────────────────────────────────────────────────────
async function complianceReminder({ client_name, compliance_type, due_date, stage, days_overdue }) {
  return complete(
    `Write a short WhatsApp/email-friendly compliance reminder (3-5 lines) from ${FIRM}, a CA firm in India.
Client: ${client_name}
Compliance: ${compliance_type}
Due date: ${due_date}
Stage: ${stage} (friendly_7d=gentle heads-up, reminder_3d=clearer reminder, urgent_1d=urgent due tomorrow, due_today=act now, overdue=firm but polite ${days_overdue} days overdue mention penalty risk)
Tone must match stage exactly. Sign off as "Team".`
  );
}

// ── DOCUMENT REQUEST ──────────────────────────────────────────────────────────
async function documentRequest({ client_name, compliance_type, doc_list }) {
  return complete(
    `Write a short, polite document request message (4-6 lines) from ${FIRM} to a client asking them to submit documents for their ${compliance_type} work. List the documents clearly. Ask to share at earliest so filing isn't delayed.
Client name: ${client_name}
Document list:
${doc_list}
Keep it WhatsApp/email friendly. Sign off as "Team".`
  );
}

// ── DOCUMENT FOLLOW-UP ────────────────────────────────────────────────────────
async function documentFollowup({ client_name, document_name, compliance_type, followup_count }) {
  return complete(
    `Write a short WhatsApp/email-friendly follow-up (3-4 lines) from ${FIRM} reminding a client to share a still-pending document.
Client: ${client_name}
Document: ${document_name}
Related to: ${compliance_type}
This is follow-up number: ${followup_count + 1} (1st=gentle, 2nd=clearer, 3rd+=firmer mention filing delay).
Ask them to share it at earliest convenience.`
  );
}

// ── LEAD FOLLOW-UP ────────────────────────────────────────────────────────────
async function leadFollowup({ name, requirement, followup_attempts }) {
  return complete(
    `Write a short, friendly follow-up message (2-4 lines) from ${FIRM} to a prospective client who enquired about ${requirement} but hasn't responded yet. This is attempt number ${followup_attempts + 1}. Keep it light, not pushy, end with a simple question or CTA. Do not quote pricing.
Lead name: ${name}`
  );
}

// ── INVOICE REMINDER ──────────────────────────────────────────────────────────
async function invoiceReminder({ client_name, invoice_id, amount, currency, due_date, stage, days_overdue }) {
  return complete(
    `Write a short WhatsApp/email-friendly payment reminder (3-5 lines) from ${FIRM}.
Client: ${client_name}
Invoice: ${invoice_id}
Amount due: ${currency || 'INR'} ${amount}
Due date: ${due_date}
Stage: ${stage} (upcoming_3d=friendly heads-up, due_today=due today pay now, overdue_mild=polite up to 7 days, overdue_moderate=firmer 8-15 days, overdue_severe=firm professional ${days_overdue} days overdue mention team may call)
Match tone exactly to stage. Stay professional even at overdue_severe.`
  );
}

// ── PAYMENT THANK YOU ────────────────────────────────────────────────────────
async function paymentThankYou({ client_name, invoice_id, amount, currency }) {
  return complete(
    `Write a short, warm thank-you message (2-4 lines) from ${FIRM} confirming receipt of payment for invoice ${invoice_id}, amount ${currency || 'INR'} ${amount}. Client name: ${client_name}. Do not add anything else.`
  );
}

// ── WEBSITE LEAD OPENING MESSAGE ─────────────────────────────────────────────
async function websiteLeadOpening({ name, message }) {
  return complete(
    `You are the intake assistant for ${FIRM}, a CA firm in India. A visitor just submitted this enquiry on the website. Write a warm, short (3-4 lines) opening reply that thanks them, restates you understood their need in one line, and asks ONE clarifying question. Do not quote any price.
Visitor name: ${name}
Visitor message: ${message}`
  );
}

module.exports = {
  complianceReminder,
  documentRequest,
  documentFollowup,
  leadFollowup,
  invoiceReminder,
  paymentThankYou,
  websiteLeadOpening,
};
