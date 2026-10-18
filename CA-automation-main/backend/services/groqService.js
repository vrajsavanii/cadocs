// services/groqService.js
// Groq AI Engine — High-Speed LPU Inference
// CA Firm Automation Suite

const Groq = require('groq-sdk');
const { keys } = require('../config/keys');

let groqClient = null;

function getClient() {
  if (!groqClient) {
    groqClient = new Groq({ apiKey: keys.GROQ_API_KEY });
  }
  return groqClient;
}

/**
 * Chat completion with model fallback and exponential backoff
 */
async function chat(messagesOrSystem, historyOrOptions = [], userMessage = null, options = {}) {
  let messages = [];
  let opts = options;

  if (Array.isArray(messagesOrSystem)) {
    messages = messagesOrSystem;
    opts = (historyOrOptions && typeof historyOrOptions === 'object' && !Array.isArray(historyOrOptions)) ? historyOrOptions : options;
  } else {
    // Called as chat(systemPrompt, history, userMessage, options)
    if (messagesOrSystem) {
      messages.push({ role: 'system', content: String(messagesOrSystem) });
    }
    if (Array.isArray(historyOrOptions)) {
      messages.push(...historyOrOptions);
    }
    if (userMessage) {
      messages.push({ role: 'user', content: String(userMessage) });
    }
  }

  const primaryModel = opts.model || keys.GROQ_MODEL_PRIMARY || 'llama-3.3-70b-versatile';
  const fastModel = keys.GROQ_MODEL_FAST || 'llama-3.1-8b-instant';
  const maxTokens = opts.maxTokens || 2048;
  const temperature = opts.temperature !== undefined ? opts.temperature : 0.4;

  const modelsToTry = [primaryModel];
  if (primaryModel !== fastModel) modelsToTry.push(fastModel);

  for (const model of modelsToTry) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await getClient().chat.completions.create({
          model,
          messages,
          temperature,
          max_tokens: maxTokens,
        });

        const reply = res.choices[0]?.message?.content?.trim() || '';
        return reply;
      } catch (err) {
        const isRateLimit = err.status === 429 || (err.message && err.message.includes('429'));
        console.warn(`[GROQ] ⚠️ ${model} attempt ${attempt} error: ${err.message}`);
        if (isRateLimit && attempt < 3) {
          await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
        } else {
          break; // Try next model if available
        }
      }
    }
  }

  // If all Groq attempts fail
  return '';
}

/**
 * One-shot text completion
 */
async function complete(prompt, systemPrompt = '') {
  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: prompt });
  return chat(messages);
}

/**
 * Safe JSON extraction
 */
async function classifyToJSON(prompt, fallback = {}) {
  const raw = await complete(prompt);
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    return JSON.parse(match ? match[0] : raw);
  } catch {
    return fallback;
  }
}

/**
 * Classify incoming lead into structured parameters
 */
async function classifyLead(inquiryText) {
  const systemPrompt = `You are an elite lead qualification engine for an Indian Chartered Accountancy practice.
Analyze the inbound inquiry and output STRICT JSON only (no markdown, no preamble).
Format:
{
  "requirement": "GST Registration" | "GST Filing" | "ITR Filing" | "Tax Audit" | "Company Incorporation" | "Bookkeeping" | "TDS Filing" | "ROC Compliance" | "Other",
  "business_type": "Individual" | "Proprietorship" | "Partnership" | "Company" | "Unknown",
  "urgency": "High" | "Medium" | "Low" | "Unclear",
  "qualification_score": "Hot" | "Warm" | "Cold",
  "summary": "One sentence explaining lead intent and urgency"
}
Mark as Hot if urgency is High or they explicitly want filing done immediately.`;

  const fallback = {
    requirement: 'Other',
    business_type: 'Unknown',
    urgency: 'Unclear',
    qualification_score: 'Warm',
    summary: 'Lead inquiry captured for partner review.',
  };

  return classifyToJSON(`${systemPrompt}\n\nClient Inquiry: "${inquiryText}"`, fallback);
}

/**
 * Contextual message drafting across 11 standard operational events
 */
async function draftMessage(event, context = {}) {
  const firm = context.firmName || keys.FIRM_NAME;
  const clientName = context.clientName || 'Valued Client';

  const eventPrompts = {
    compliance_7d: `Write a gentle 7-day heads-up WhatsApp message (2-3 lines) from ${firm} to ${clientName} regarding ${context.complianceType} due on ${context.dueDate}. Remind them to share pending records.`,
    compliance_3d: `Write a clear 3-day reminder WhatsApp message (3 lines) from ${firm} to ${clientName} for ${context.complianceType} due on ${context.dueDate}. Mention portal cut-off is approaching.`,
    compliance_1d: `Write an urgent 1-day reminder WhatsApp message (2-3 lines) from ${firm} to ${clientName} for ${context.complianceType} due TOMORROW (${context.dueDate}). Ask them to confirm immediately.`,
    compliance_overdue: `Write a polite but firm overdue alert (3 lines) from ${firm} to ${clientName}. ${context.complianceType} was due on ${context.dueDate}. Mention statutory penalty risk: ${context.penalty || 'late fee and interest'}.`,
    document_request: `Write a polite document request message (3-4 lines) from ${firm} to ${clientName} asking for: ${context.documentList} for ${context.complianceType}.`,
    document_followup: `Write a short WhatsApp follow-up (2-3 lines) from ${firm} to ${clientName} reminding them that ${context.documentName} for ${context.complianceType} is still pending. This is follow-up #${context.followupCount || 1}.`,
    invoice_upcoming: `Write a friendly payment reminder (2 lines) from ${firm} to ${clientName}. Invoice ${context.invoiceId} for ₹${context.amount} is due on ${context.dueDate}.`,
    invoice_due_today: `Write a polite payment message (2 lines) from ${firm} to ${clientName}. Invoice ${context.invoiceId} of ₹${context.amount} is due today. Payment UPI/bank details attached.`,
    invoice_overdue: `Write a firmer payment reminder (3 lines) from ${firm} to ${clientName}. Invoice ${context.invoiceId} for ₹${context.amount} is ${context.daysOverdue} days overdue. Please clear to keep services uninterrupted.`,
    invoice_severe: `Write a formal payment escalation notice (3 lines) from ${firm} to ${clientName}. Invoice ${context.invoiceId} of ₹${context.amount} is ${context.daysOverdue} days overdue. Note that the matter has been escalated to Senior Partner.`,
    invoice_paid: `Write a warm thank-you message (2 lines) from ${firm} to ${clientName} confirming receipt of ₹${context.amount} for Invoice ${context.invoiceId}.`,
    lead_followup: `Write a friendly follow-up message (2-3 lines) from ${firm} to prospective client ${clientName} inquiring about ${context.requirement}. Keep it polite and helpful, no hard selling.`,
    welcome_message: `Write a warm, professional WhatsApp welcome message (2-3 lines) from ${firm} to new prospect ${clientName} acknowledging their tax/compliance inquiry.`,
  };

  const instruction = eventPrompts[event] || eventPrompts.compliance_7d;
  const prompt = `${instruction}\nKeep within 300 characters. WhatsApp friendly. Sign off as "${firm} Team".`;

  const drafted = await complete(prompt);
  if (drafted) return drafted;

  // Fallback if Groq unavailable
  return `Dear ${clientName}, this is a reminder from ${firm} regarding ${context.complianceType || 'your account'}. Please check and connect with our team. Thank you!`;
}

/**
 * Intelligent deterministic fallback regex engine
 */
function getSmartFallbackReply(query) {
  const q = (query || '').toLowerCase();
  if (q.includes('gstr') || q.includes('gst')) {
    return '🙏 Namaste! GSTR-3B ki statutory due date har mahine ki 20th hoti hai aur GSTR-1 ki 11th. Kripya apna monthly bank statement aur sales invoice register is WhatsApp number par share kar dein taaki filing samay par ho sake.';
  }
  if (q.includes('audit') || q.includes('44ab')) {
    return 'Tax Audit Section 44AB ke antargat financial year audit report file karne ki statutory deadline 30 September hai. Kripya audited balance sheet, P&L, aur bank confirmation letters jald bhej dein.';
  }
  if (q.includes('advance tax') || q.includes('advance')) {
    return 'Advance Tax ki installments June 15, Sept 15, Dec 15, aur March 15 ko due hoti hain. Agar aapko tax computation sheet ya challan link chahiye toh batayein, hum turant provide kar denge.';
  }
  if (q.includes('itr') || q.includes('income tax') || q.includes('return')) {
    return 'Individual non-audit taxpayers ke liye ITR filing deadline 31 July hoti hai, jabki business audit cases ke liye 31 October. Kripya Form 16 aur 26AS verify karwake draft finalize kar lein. Shukriya! ✨';
  }
  if (q.includes('tds') || q.includes('26q') || q.includes('24q')) {
    return 'Quarterly TDS Returns (Form 24Q for salary, 26Q for vendor) file karne ki due date quarter end ke baad agle mahine ki last date (31 July, 31 Oct, 31 Jan, 31 May) hoti hai.';
  }
  if (q.includes('fee') || q.includes('bill') || q.includes('invoice') || q.includes('payment')) {
    return 'Aapke account ka active invoice summary practice dashboard par updated hai. Aap UPI (GPay/PhonePe) ya direct NEFT ke dwara payment kar sakte hain. Payment hote hi auto-receipt generate ho jayegi.';
  }
  return '🙏 Namaste! Aapka query receive ho gaya hai. Hamari expert CA team records check karke aapko turant update karegi.';
}

/**
 * Answer client WhatsApp queries with live compliance and document context
 */
async function answerClientQuery(query, clientContext = {}) {
  const firm = clientContext.firmName || keys.FIRM_NAME;
  const clientName = clientContext.clientName || 'Client';

  const complianceLines = (clientContext.compliance || []).length
    ? clientContext.compliance.map((r) => `- ${r.compliance_type}: due ${r.due_date}, status ${r.status}`).join('\n')
    : '- No compliance deadlines on file.';

  const docLines = (clientContext.documents || []).length
    ? clientContext.documents.map((r) => `- ${r.document_name} (${r.compliance_type}): ${r.status}`).join('\n')
    : '- No documents currently requested.';

  const today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  const systemPrompt = `You are the elite AI Support Assistant for ${firm}, a Chartered Accountancy practice in India. Today is ${today}.
Client: ${clientName}.
Client Compliance Status:
${complianceLines}

Client Document Status:
${docLines}

Rules:
1. Answer clearly, politely, and accurately regarding Indian taxation (GST, ITR, TDS, ROC, Advance Tax).
2. Use the client's actual compliance and document status above to answer specifics. Never invent dates or amounts.
3. Keep replies concise and WhatsApp-appropriate (2-4 lines).
4. Hindi-English (Hinglish) mix is welcome if client writes in Hindi.
5. If query requires complex subjective judgment, advise that a Senior CA from the team will follow up personally.`;

  const reply = await chat([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: query },
  ]);

  if (reply && !reply.includes("couldn't process")) {
    return reply;
  }

  return getSmartFallbackReply(query);
}

module.exports = {
  chat,
  complete,
  classifyToJSON,
  classifyLead,
  draftMessage,
  answerClientQuery,
  getSmartFallbackReply,
};
