// ai/supportAgent.js
// AI Support Agent — replies to known client queries on WhatsApp and Email
// Uses live compliance + document data as context

const { chat } = require('../services/groqService');
const { Compliance, Documents } = require('../services/sheetsService');
const { keys } = require('../config/keys');

// Simple in-memory conversation history per phone/email session
// (resets on server restart — good enough for a WhatsApp chat window)
const memory = {};
const MAX_HISTORY = 12;

async function reply(client) {
  const sessionKey = `wa-support-${client.from_phone || client.client_id}`;

  // Build live context from sheets
  const [complianceRows, docRows] = await Promise.all([
    Compliance.getAll(),
    Documents.getAll(),
  ]);

  const clientCompliance = complianceRows.filter((r) => r.client_id === client.client_id);
  const clientDocs       = docRows.filter((r) => r.client_id === client.client_id);

  const complianceLines = clientCompliance.length
    ? clientCompliance.map((r) => `- ${r.compliance_type}: due ${r.due_date}, status ${r.status}`).join('\n')
    : '- No compliance records on file.';

  const docLines = clientDocs.length
    ? clientDocs.map((r) => `- ${r.document_name} (${r.compliance_type}): ${r.status}`).join('\n')
    : '- No documents currently requested.';

  const today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  const systemPrompt = `You are the AI support assistant for ${keys.FIRM_NAME}, a Chartered Accountancy firm in India. Today is ${today}.
Client: ${client.name || client.client_name} (Client ID: ${client.client_id || 'N/A'}).

Client's compliance calendar:
${complianceLines}

Client's document status:
${docLines}

Rules:
- Answer questions about GST, ITR, TDS, ROC, and general tax/compliance in simple, clear language.
- Hindi-English mix is fine if the client writes that way.
- Use the compliance/document data above to answer specifics about THIS client's due dates and pending documents.
- Never invent a due date or document status not listed above.
- For anything requiring judgment or you are not fully certain about, tell the client a CA from the team will personally follow up.
- Keep replies short and WhatsApp-appropriate (2-4 lines max).
- Never share other clients' data.`;

  // Get or init session history
  if (!memory[sessionKey]) memory[sessionKey] = [];
  const history = memory[sessionKey];

  // Get AI reply
  const aiReply = await chat(systemPrompt, history, client.message_text);

  // Update history
  history.push({ role: 'user', content: client.message_text });
  history.push({ role: 'assistant', content: aiReply });

  // Trim to max window
  if (history.length > MAX_HISTORY * 2) {
    memory[sessionKey] = history.slice(-MAX_HISTORY * 2);
  }

  return aiReply;
}

// Email version (same logic, professional tone)
async function replyEmail(client) {
  const sessionKey = `email-support-${client.sender_email}`;

  const [complianceRows, docRows] = await Promise.all([
    Compliance.getAll(),
    Documents.getAll(),
  ]);

  const clientCompliance = complianceRows.filter((r) => r.client_id === client.client_id);
  const clientDocs       = docRows.filter((r) => r.client_id === client.client_id);

  const complianceLines = clientCompliance.length
    ? clientCompliance.map((r) => `- ${r.compliance_type}: due ${r.due_date}, status ${r.status}`).join('\n')
    : '- No compliance records on file.';

  const docLines = clientDocs.length
    ? clientDocs.map((r) => `- ${r.document_name} (${r.compliance_type}): ${r.status}`).join('\n')
    : '- No documents currently requested.';

  const today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

  const systemPrompt = `You are the AI support assistant (email channel) for ${keys.FIRM_NAME}, a Chartered Accountancy firm in India. Today is ${today}.
Client: ${client.client_name}.
Compliance calendar:\n${complianceLines}
Document status:\n${docLines}
Rules: Answer clearly and professionally (email tone). Use only the data above for this client's specifics. For anything uncertain, say a CA from the team will follow up personally. Sign off as "${keys.FIRM_NAME} Team".`;

  if (!memory[sessionKey]) memory[sessionKey] = [];
  const history = memory[sessionKey];
  const userMessage = client.subject + '\n\n' + client.body_text;
  const aiReply = await chat(systemPrompt, history, userMessage);
  history.push({ role: 'user', content: userMessage });
  history.push({ role: 'assistant', content: aiReply });
  if (history.length > MAX_HISTORY * 2) memory[sessionKey] = history.slice(-MAX_HISTORY * 2);

  return aiReply;
}

module.exports = { reply, replyEmail };
