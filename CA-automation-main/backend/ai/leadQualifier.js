// ai/leadQualifier.js
// AI Lead Qualification — handles unknown WhatsApp senders and new email leads

const { chat, classifyToJSON } = require('../services/groqService');
const { Leads } = require('../services/sheetsService');
const { sendText } = require('../services/whatsappService');
const { sendAlert } = require('../services/telegramService');
const { makeId, nowISO, addDays } = require('../utils/helpers');
const { keys } = require('../config/keys');

// In-memory conversation history for lead sessions
const memory = {};
const MAX_HISTORY = 12;

// ── WhatsApp Lead Handler ─────────────────────────────────────────────────────
async function handleWhatsApp(sender) {
  const { from_phone, contact_name, message_text } = sender;
  const sessionKey = `wa-lead-${from_phone}`;

  // System prompt for lead qualification
  const systemPrompt = `You are the lead-qualification assistant for ${keys.FIRM_NAME}, a Chartered Accountancy firm in India, chatting with a NEW prospective client on WhatsApp who is not yet a client.
Your job:
1. Warmly acknowledge their message.
2. Ask 1-2 short questions at a time to understand: what service they need (GST registration, ITR filing, company incorporation, tax audit, bookkeeping, ROC compliance, etc.), their business type (individual/proprietorship/partnership/company), and urgency/timeline.
3. Once you have enough info, tell them a CA from the team will call/message them shortly with next steps, and thank them.
Keep messages short and WhatsApp-appropriate (2-4 lines). Hindi-English mix is fine. Never quote pricing — say the team will share a quote.`;

  if (!memory[sessionKey]) memory[sessionKey] = [];
  const history = memory[sessionKey];

  // Create or update lead record
  const existingLeads = await Leads.getAll();
  const existingLead = existingLeads.find((l) => l.phone === from_phone);

  if (!existingLead) {
    await Leads.append({
      lead_id: makeId('LEAD-WA'),
      name: contact_name || 'WhatsApp Lead',
      phone: from_phone,
      email: '',
      source: 'WhatsApp',
      requirement: '',
      business_type: '',
      urgency: '',
      qualification_score: '',
      status: 'New',
      followup_date: addDays(2),
      followup_attempts: 0,
      created_at: nowISO(),
      notes: message_text,
    });
  }

  // Get AI reply
  const aiReply = await chat(systemPrompt, history, message_text);
  history.push({ role: 'user', content: message_text });
  history.push({ role: 'assistant', content: aiReply });
  if (history.length > MAX_HISTORY * 2) memory[sessionKey] = history.slice(-MAX_HISTORY * 2);

  // Send WhatsApp reply
  await sendText(from_phone, aiReply);

  // Classify the lead
  const classification = await classifyToJSON(
    `You are a classification assistant for a CA firm's lead pipeline. Based on this WhatsApp message, output STRICT JSON only:
{"requirement":"<GST Registration/ITR Filing/Company Incorporation/Tax Audit/Bookkeeping/ROC Compliance/Other/Unclear>","business_type":"<Individual/Proprietorship/Partnership/Company/Unclear>","urgency":"<High/Medium/Low/Unclear>","score":"<Hot/Warm/Cold>"}
Score as Hot if urgency is high or they explicitly want to proceed soon.
Message: ${message_text}`,
    { requirement: 'Unclear', business_type: 'Unclear', urgency: 'Unclear', score: 'Warm' }
  );

  // Update lead with qualification
  await Leads.update('phone', from_phone, {
    requirement: classification.requirement,
    business_type: classification.business_type,
    urgency: classification.urgency,
    qualification_score: classification.score,
    status: 'Qualifying',
  });

  // Alert partner if Hot lead
  if (classification.score === 'Hot') {
    await sendAlert(
      `🔥 *Hot Lead (WhatsApp)*\nName: ${contact_name || 'Unknown'}\nPhone: ${from_phone}\nRequirement: ${classification.requirement}\nUrgency: ${classification.urgency}`
    );
  }
}

module.exports = { handleWhatsApp };
