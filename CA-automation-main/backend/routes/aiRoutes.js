// routes/aiRoutes.js
// Live AI Client Support Agent + CA & Team Operations Co-Pilot
// Powered by Groq LLaMA 3.3 70B & Live Google Sheets Database Engine

const express = require('express');
const router = express.Router();
const { chat } = require('../services/groqService');
const sheetsService = require('../services/sheetsService');
const { keys } = require('../config/keys');

// Fallback helper for generic inquiries when no client context is passed
function getSmartFallbackReply(query) {
  const q = (query || '').toLowerCase();
  if (q.includes('gstr') || q.includes('gst')) {
    return '🙏 Namaste! August 2026 ke GSTR-3B ki due date 20 September 2026 hai aur GSTR-1 ki 11 September 2026 thi. Kripya apna monthly bank statement aur sales invoice register is WhatsApp number par PDF format mein share kar dein taaki filing samay par ho sake.';
  }
  if (q.includes('audit') || q.includes('44ab')) {
    return 'Tax Audit Section 44AB ke antargat financial year 2025-26 (AY 2026-27) ki audit report file karne ki statutory deadline 30 September 2026 hai. Kripya audited balance sheet, P&L, aur bank confirmation letters jald bhej dein.';
  }
  if (q.includes('advance tax') || q.includes('advance')) {
    return 'Advance Tax Q2 (AY 2026-27) ki second installment (45% of total estimated liability) pay karne ki last date 15 September 2026 hai. Agar aapko challan payment link ya estimated calculation sheet chahiye toh bataiye, hum turant provide kar denge.';
  }
  if (q.includes('itr') || q.includes('income tax') || q.includes('return')) {
    return 'Individual non-audit taxpayers ke liye ITR filing complete ho chuki hai, jabki business audit cases ke liye deadline 31 October 2026 hai. Aapka Form 16 aur Form 26AS receive ho gaya hai, verification ke baad draft bhejenge. Shukriya! ✨';
  }
  if (q.includes('tds') || q.includes('26q') || q.includes('24q')) {
    return 'Quarter 2 (July to September 2026) ke TDS Returns (Form 24Q aur 26Q) file karne ki due date 31 October 2026 hai. Monthly TDS challans hume verify karne ke liye forward kar dein.';
  }
  if (q.includes('fee') || q.includes('bill') || q.includes('invoice') || q.includes('payment')) {
    return 'Aapke account ka active invoice summary practice dashboard par updated hai. Aap UPI (GPay/PhonePe) ya direct NEFT ke dwara payment kar sakte hain. Payment hote hi auto-receipt generate ho jayegi.';
  }
  return '🙏 Namaste! Aapka query receive ho gaya hai. Hum aapke account aur statutory filings ka record check kar rahe hain. Hamare tax expert CA partner se review karwake hum aapko turant update karte hain.';
}

// ── 1. CLIENT-FACING AI BOT (WhatsApp & AI Client Desk) ──────────────────────
// Looks up the specific client's live row in Google Sheets and answers with their exact data!
router.post('/chat', async (req, res) => {
  try {
    const { message, history = [], clientId, phone } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    let client = null;
    if (clientId) {
      client = await sheetsService.getClientById(clientId);
    } else if (phone) {
      client = await sheetsService.getClientByPhone(phone);
    }

    // If client not found by exact ID, try to match by ID or phone in allClients
    if (!client && (clientId || phone)) {
      const allClients = await sheetsService.getAllClients();
      client = allClients.find(c => c.client_id === clientId || c.phone === phone);
    }

    let systemPrompt = `You are the elite AI Client Support Executive for "${keys.FIRM_NAME || 'Sharma & Associates'}", a premier Chartered Accountancy practice in India. Today's date is September 19, 2026.
Tone: Warm, polite, authoritative, and helpful. You can speak in professional English or natural professional Hinglish matching the client's query.
Keep responses crisp (2 to 4 sentences), actionable, and reassure them that their compliance is safely handled.`;

    if (client) {
      const [clientCompliance, clientDocs, allInvoices] = await Promise.all([
        sheetsService.getComplianceForClient(client.client_id),
        sheetsService.getDocumentsForClient(client.client_id),
        sheetsService.getAllInvoices()
      ]);

      const clientInvoices = allInvoices.filter(i => i.client_id === client.client_id);
      const pendingInvoices = clientInvoices.filter(i => i.status !== 'Paid');
      const unpaidTotal = pendingInvoices.reduce((sum, i) => sum + (parseFloat(i.amount) || 0), 0);

      const complianceSummary = clientCompliance.length > 0
        ? clientCompliance.map(c => `- ${c.compliance_type}: Due on ${c.due_date} [Status: ${c.status}]`).join('\n')
        : 'All standard filings up to date.';

      const pendingDocs = clientDocs.filter(d => d.status === 'Pending');
      const docSummary = pendingDocs.length > 0
        ? pendingDocs.map(d => `- Missing/Pending: ${d.document_name} (${d.compliance_type})`).join('\n')
        : 'All required documents verified & on file.';

      systemPrompt += `\n\nCLIENT LIVE PROFILE FROM GOOGLE SHEETS:
- Client Name: ${client.name} (${client.client_id})
- Authorized Contact: ${client.contact_person || client.name}
- WhatsApp Number: ${client.phone}
- Entity Type: ${client.entity_type || 'Private Limited'}
- GSTIN: ${client.gst_number || 'N/A'}
- PAN: ${client.pan || 'N/A'}

COMPLIANCE SCHEDULE:
${complianceSummary}

DOCUMENT REQUIREMENTS:
${docSummary}

FINANCIAL LEDGER & BILLING:
- Total Unpaid Fees: ₹${unpaidTotal.toLocaleString('en-IN')}
${pendingInvoices.map(i => `  • Invoice #${i.invoice_id}: ₹${i.amount} (Due: ${i.due_date}, Status: ${i.status})`).join('\n') || '  • No outstanding fee balance.'}

CRITICAL RULES FOR CLIENT REPLIES:
1. Address the client respectfully by name (e.g. "Namaste Ramesh ji" or "Hello Dr. Rajesh").
2. Answer specifically based on THEIR real GSTIN, PAN, compliance due dates, missing documents, or fee balances shown above.
3. Never guess or hallucinate statutory dates or missing files not in their record.
4. If they ask about pending documents, list the exact missing documents above.
5. If they ask about penalties or legal notices (like DRC-01A), assure them our CA Partner is reviewing it to ensure zero penalty.`;
    }

    let reply = '';
    try {
      reply = await chat(systemPrompt, history, message);
    } catch (e) {
      console.warn('Groq call failed, using smart CA fallback:', e.message);
    }

    if (!reply || reply.includes("I'm sorry, I couldn't process that right now")) {
      reply = getSmartFallbackReply(message);
    }

    res.json({
      success: true,
      reply,
      client: client ? {
        clientId: client.client_id,
        name: client.name,
        gstin: client.gst_number,
        pan: client.pan,
        phone: client.phone
      } : null,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
  } catch (err) {
    console.error('AI chat route error:', err.message);
    res.json({
      success: true,
      reply: getSmartFallbackReply(req.body.message || ''),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
  }
});

// ── 2. INTERNAL CA & TEAM OPERATIONS CO-PILOT ────────────────────────────────
// Queries real-time data across ALL 20 clients in Google Sheets to give CA & team instant practice intelligence!
router.post('/team-copilot', async (req, res) => {
  try {
    const message = req.body.message || req.body.query;
    const history = req.body.history || [];
    if (!message) {
      return res.status(400).json({ error: 'Question or message is required' });
    }

    // Load entire firm database in parallel from Google Sheets
    const [clients, compliance, docs, invoices, leads] = await Promise.all([
      sheetsService.getAllClients(),
      sheetsService.getAllCompliance(),
      sheetsService.getAllDocuments(),
      sheetsService.getAllInvoices(),
      sheetsService.getAllLeads()
    ]);

    // Compute key practice metrics
    const totalClients = clients.length;
    const pendingCompliance = compliance.filter(c => c.status === 'Pending');
    const overdueCompliance = compliance.filter(c => {
      if (c.status !== 'Pending') return false;
      const due = new Date(c.due_date);
      const today = new Date('2026-09-19');
      return due < today;
    });

    const pendingDocs = docs.filter(d => d.status === 'Pending');
    const unpaidInvoices = invoices.filter(i => i.status !== 'Paid');
    const totalUnpaidAmount = unpaidInvoices.reduce((sum, inv) => sum + (parseFloat(inv.amount) || 0), 0);

    const copilotSystemPrompt = `You are the executive Internal Practice Operations AI Co-Pilot for CA Manthan K. (Managing Partner) and the professional team at Sharma & Associates (Chartered Accountants).
Today's Date: September 19, 2026.
Your purpose: Provide rapid, authoritative, data-backed operational intelligence to the CA and staff using the firm's live Google Sheets database across all 20 clients.

LIVE PRACTICE DATABASE STATE (20 CLIENTS IN GOOGLE SHEETS):
• Total Active Clients: ${totalClients}
• Total Unpaid Client Fees: ₹${totalUnpaidAmount.toLocaleString('en-IN')} across ${unpaidInvoices.length} invoices
• Total Pending Filings: ${pendingCompliance.length} (${overdueCompliance.length} overdue)
• Total Missing Audit Documents: ${pendingDocs.length}

1. CLIENT MASTER DIRECTORY (20 CLIENTS):
${clients.map(c => `[${c.client_id}] ${c.name} | Contact: ${c.contact_person} | Phone: ${c.phone} | Entity: ${c.entity_type} | GSTIN: ${c.gst_number} | PAN: ${c.pan}`).join('\n')}

2. STATUTORY COMPLIANCE SCHEDULE (ALL CLIENTS):
${compliance.map(c => `• ${c.client_name} (${c.client_id}) -> ${c.compliance_type} | Due: ${c.due_date} | Status: ${c.status} | Reminders: ${c.reminder_count}`).join('\n')}

3. DOCUMENTS TRACKER (AUDIT PAPERS & MISSING FILES):
${docs.map(d => `• ${d.client_name} (${d.client_id}) -> ${d.document_name} (${d.compliance_type}) | Status: ${d.status} | Followups: ${d.followup_count}`).join('\n')}

4. INVOICES & FEE RECOVERY:
${invoices.map(i => `• ${i.client_name} (${i.client_id}) -> Inv #${i.invoice_id}: ₹${i.amount} | Due: ${i.due_date} | Status: ${i.status} | Escalated: ${i.escalated}`).join('\n')}

CO-PILOT INSTRUCTIONS:
1. Answer the CA's or team member's question directly with exact client names, figures, and dates from the real data above.
2. Structure your answers with clean markdown: clear headings, bullet points, bold keywords, and exact amounts in ₹ INR.
3. If asked about due dates or overdue filings, highlight the penalty risks under Section 50(1) (18% interest) or Section 234F / AOC-4 penalties.
4. If asked about fee recovery, list the top overdue clients and calculate total recoverable amount.
5. If asked to summarize a specific client, compile their complete dossier (Entity, GSTIN, PAN, Contact, Filing Status, Missing Docs, Unpaid Fees).
6. If asked to draft a notice or message, draft a professional, ready-to-send communication with statutory section citations.
7. Be proactive: suggest next operational actions (e.g. "Recommendation: Chase these 3 clients on WhatsApp before 20th Sep").`;

    let reply = '';
    try {
      reply = await chat(copilotSystemPrompt, history, message);
    } catch (e) {
      console.warn('[TEAM-COPILOT] Groq error:', e.message);
      reply = `**Practice Summary (Fallback Mode)**:\n• Total Clients: ${totalClients}\n• Pending Filings: ${pendingCompliance.length}\n• Missing Documents: ${pendingDocs.length}\n• Outstanding Fees: ₹${totalUnpaidAmount.toLocaleString('en-IN')}`;
    }

    res.json({
      success: true,
      reply,
      metrics: {
        totalClients,
        pendingComplianceCount: pendingCompliance.length,
        missingDocsCount: pendingDocs.length,
        unpaidInvoicesCount: unpaidInvoices.length,
        totalUnpaidAmount
      },
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
  } catch (err) {
    console.error('Team Co-Pilot route error:', err.message);
    res.status(500).json({ error: 'Could not execute Team Co-Pilot query', message: err.message });
  }
});

// ── 3. AI TAX CO-PILOT (Indian Law & Compliance Assistant) ────────────────────
const coPilot = require('../ai/coPilot');
router.post('/copilot', async (req, res) => {
  try {
    const { query, clientId } = req.body;
    if (!query) return res.status(400).json({ error: 'Query is required' });

    let clientContext = null;
    if (clientId) {
      try {
        const client = await sheetsService.getClientById(clientId);
        if (client) {
          const [compliance, docs] = await Promise.all([
            sheetsService.getComplianceForClient(clientId),
            sheetsService.getDocumentsForClient(clientId),
          ]);
          clientContext = { client, compliance, docs };
        }
      } catch (e) {}
    }

    const reply = await coPilot.chat(
      query,
      clientContext,
      req.user?.role || 'staff',
      new Date().toISOString().slice(0, 10)
    );

    res.json({ success: true, reply });
  } catch (err) {
    console.error('[AI] Co-Pilot error:', err.message);
    res.status(500).json({ error: 'Co-Pilot query failed', message: err.message });
  }
});

// ── 4. STATUTORY PENALTY EXPLAINER ───────────────────────────────────────────
const penaltyExplainer = require('../ai/penaltyExplainer');
router.post('/penalty-explain', async (req, res) => {
  try {
    const { complianceType, dueDate, filingDate, entityType, turnover, taxLiability, state } = req.body;
    if (!complianceType || !dueDate) {
      return res.status(400).json({ error: 'complianceType and dueDate are required' });
    }

    const explanation = await penaltyExplainer.explainPenalty({
      complianceType,
      dueDate,
      filingDate: filingDate || new Date().toISOString().slice(0, 10),
      entityType: entityType || 'Private Limited',
      turnover: turnover || '1–5 crore',
      taxLiability: taxLiability || '0',
      state: state || 'Maharashtra',
    });

    res.json({ success: true, explanation });
  } catch (err) {
    console.error('[AI] Penalty explainer error:', err.message);
    res.status(500).json({ error: 'Could not explain penalty', message: err.message });
  }
});

// ── 5. COMPLIANCE TASK AUTO-GENERATOR ────────────────────────────────────────
const complianceTaskGen = require('../ai/complianceTaskGen');
router.post('/task-gen', async (req, res) => {
  try {
    const tasks = await complianceTaskGen.generateTasksForClient(req.body);
    res.json({ success: true, tasks });
  } catch (err) {
    console.error('[AI] Task gen error:', err.message);
    res.status(500).json({ error: 'Could not generate compliance tasks' });
  }
});

module.exports = router;

