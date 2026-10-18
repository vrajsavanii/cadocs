// routes/dashboardRoutes.js
// Executive KPI Aggregation, Upcoming Deadlines, and Telemetry API
// CA Firm Automation Suite

const express = require('express');
const router = express.Router();
const sheetsService = require('../services/sheetsService');
const penaltyCalc = require('../utils/penaltyCalc');
const { daysFromToday } = require('../utils/helpers');
const { keys } = require('../config/keys');

// Schedulers for manual triggers
const complianceReminder = require('../schedulers/complianceReminder');
const documentFollowup = require('../schedulers/documentFollowup');
const leadFollowup = require('../schedulers/leadFollowup');
const invoiceFollowup = require('../schedulers/invoiceFollowup');

/**
 * GET /api/dashboard — Full aggregated dashboard payload (Prompt 12 specification)
 */
router.get('/', async (req, res) => {
  try {
    const [clients, leads, compliance, documents, invoices, queryLogs] = await Promise.all([
      sheetsService.getAllClients(),
      sheetsService.getAllLeads(),
      sheetsService.getAllCompliance(),
      sheetsService.getAllDocuments(),
      sheetsService.getAllInvoices(),
      sheetsService.readSheet(sheetsService.TABS.QUERY_LOG),
    ]);

    // Active Clients
    const activeClients = clients.length;

    // Pending Documents
    const pendingDocuments = documents.filter((d) => d.status === 'Pending').length;

    // Compliance Due This Week (0 <= days <= 7, not filed)
    const complianceDueThisWeek = compliance.filter((c) => {
      if (c.status === 'Filed') return false;
      const d = daysFromToday(c.due_date);
      return d !== null && d >= 0 && d <= 7;
    }).length;

    // Financials
    const totalBilled = invoices.reduce((acc, i) => acc + (parseFloat(i.amount) || 0), 0);
    const paidInvoices = invoices.filter((i) => i.status === 'Paid');
    const totalCollected = paidInvoices.reduce((acc, i) => acc + (parseFloat(i.amount) || 0), 0);
    const collectionRate = totalBilled > 0 ? Math.round((totalCollected / totalBilled) * 1000) / 10 : 0;

    const overdueInvoicesList = invoices.filter((i) => {
      if (i.status === 'Paid') return false;
      const d = daysFromToday(i.due_date);
      return d !== null && d < 0;
    });
    const overdueFees = overdueInvoicesList.reduce((acc, i) => acc + (parseFloat(i.amount) || 0), 0);

    // Urgent Compliance (top 5 nearest deadlines)
    const urgentCompliance = compliance
      .filter((c) => c.status !== 'Filed')
      .map((c) => {
        const days = daysFromToday(c.due_date);
        let urgencyLevel = 'on_track';
        if (days < 0) urgencyLevel = 'overdue';
        else if (days <= 3) urgencyLevel = 'urgent';
        else if (days <= 7) urgencyLevel = 'warning';

        return {
          complianceId: c.compliance_id,
          clientName: c.client_name,
          complianceType: c.compliance_type,
          dueDate: c.due_date,
          daysUntilDue: days,
          status: c.status,
          urgencyLevel,
          penaltyNotice: days < 0 ? penaltyCalc.getPenaltySummary(c.compliance_type, Math.abs(days), 0) : '',
        };
      })
      .sort((a, b) => a.daysUntilDue - b.daysUntilDue)
      .slice(0, 5);

    // Recent Activity (last 10 query logs)
    const recentActivity = queryLogs
      .slice(-10)
      .reverse()
      .map((q) => ({
        timestamp: q.timestamp,
        clientId: q.client_id,
        phone: q.phone,
        channel: q.channel,
        querySummary: (q.query_text || '').length > 60 ? q.query_text.slice(0, 60) + '...' : q.query_text,
      }));

    // Overdue Invoices > 15 days
    const severeOverdueInvoices = overdueInvoicesList
      .filter((i) => {
        const d = daysFromToday(i.due_date);
        return d !== null && -d > 15;
      })
      .map((i) => ({
        invoiceId: i.invoice_id,
        clientName: i.client_name,
        amount: parseFloat(i.amount) || 0,
        daysOverdue: Math.abs(daysFromToday(i.due_date)),
      }));

    res.json({
      kpis: {
        activeClients,
        pendingDocuments,
        complianceDueThisWeek,
        overdueFees,
        totalBilled,
        totalCollected,
        collectionRate,
      },
      urgentCompliance,
      recentActivity,
      overdueInvoices: severeOverdueInvoices,
    });
  } catch (err) {
    console.error('[DASHBOARD] Error building dashboard:', err.message);
    res.status(500).json({ error: 'Could not load dashboard telemetry' });
  }
});

/**
 * GET /api/dashboard/stats — Backward compatible endpoint for app.js
 */
router.get('/stats', async (req, res) => {
  try {
    const [clients, leads, compliance, documents, invoices] = await Promise.all([
      sheetsService.getAllClients(),
      sheetsService.getAllLeads(),
      sheetsService.getAllCompliance(),
      sheetsService.getAllDocuments(),
      sheetsService.getAllInvoices(),
    ]);

    const totalClients = clients.length;
    const closedStatuses = ['Converted', 'Lost', 'Cold-Closed'];
    const openLeads = leads.filter((l) => !closedStatuses.includes(l.status));
    const hotLeads = leads.filter((l) => l.qualification_score === 'Hot');

    const upcomingDeadlines = compliance.filter((c) => {
      if (c.status === 'Filed') return false;
      const d = daysFromToday(c.due_date);
      return d !== null && d >= 0 && d <= 7;
    });
    const overdueCompliance = compliance.filter((c) => {
      if (c.status === 'Filed') return false;
      const d = daysFromToday(c.due_date);
      return d !== null && d < 0;
    });

    const pendingDocs = documents.filter((d) => d.status === 'Pending');
    const unpaidInvoices = invoices.filter((i) => i.status !== 'Paid');
    const unpaidAmount = unpaidInvoices.reduce((sum, i) => sum + parseFloat(i.amount || 0), 0);
    const overdueInvoices = invoices.filter((i) => {
      if (i.status === 'Paid') return false;
      const d = daysFromToday(i.due_date);
      return d !== null && d < 0;
    });

    res.json({
      clients: { total: totalClients },
      leads: { open: openLeads.length, hot: hotLeads.length },
      compliance: { upcoming: upcomingDeadlines.length, overdue: overdueCompliance.length },
      documents: { pending: pendingDocs.length },
      invoices: {
        unpaidCount: unpaidInvoices.length,
        unpaidAmount: unpaidAmount.toFixed(2),
        overdue: overdueInvoices.length,
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Could not load dashboard stats' });
  }
});

/**
 * GET /api/dashboard/upcoming-deadlines — Backward compatible endpoint for app.js
 */
router.get('/upcoming-deadlines', async (req, res) => {
  try {
    const compliance = await sheetsService.getAllCompliance();
    const upcoming = compliance
      .filter((c) => {
        if (c.status === 'Filed') return false;
        const d = daysFromToday(c.due_date);
        return d !== null && d >= -5 && d <= 14;
      })
      .map((c) => ({
        ...c,
        days_until_due: daysFromToday(c.due_date),
      }))
      .sort((a, b) => a.days_until_due - b.days_until_due)
      .slice(0, 10);

    res.json(upcoming);
  } catch (err) {
    res.status(500).json({ error: 'Could not load upcoming deadlines' });
  }
});

/**
 * GET /api/dashboard/health — Connectivity Telemetry
 */
router.get('/health', async (req, res) => {
  const isPlaceholder = (val) => !val || String(val).includes('your_') || String(val).includes('xxxx');

  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    channels: {
      sheets: !isPlaceholder(keys.GOOGLE_SHEET_ID) && !isPlaceholder(keys.GOOGLE_SERVICE_ACCOUNT_EMAIL),
      groq: !isPlaceholder(keys.GROQ_API_KEY),
      whatsapp: !isPlaceholder(keys.WHATSAPP_PHONE_NUMBER_ID) && !isPlaceholder(keys.WHATSAPP_ACCESS_TOKEN),
      email: !isPlaceholder(keys.EMAIL_FROM) && !isPlaceholder(keys.EMAIL_APP_PASSWORD),
      telegram: !isPlaceholder(keys.TELEGRAM_BOT_TOKEN) && !isPlaceholder(keys.TELEGRAM_PARTNER_CHAT_ID),
      gemini: !isPlaceholder(keys.GEMINI_API_KEY),
      r2: !isPlaceholder(keys.R2_ACCESS_KEY_ID) && !isPlaceholder(keys.R2_SECRET_ACCESS_KEY),
    },
  });
});

/**
 * POST /api/dashboard/run-scheduler/:name — Manual scheduler triggers
 */
router.post('/run-scheduler/:name', async (req, res) => {
  const name = req.params.name;
  try {
    if (name === 'compliance') {
      await complianceReminder.runComplianceReminder();
      return res.json({ success: true, message: 'Compliance Reminders triggered' });
    }
    if (name === 'document') {
      await documentFollowup.runDocumentFollowup();
      return res.json({ success: true, message: 'Document Follow-ups triggered' });
    }
    if (name === 'lead') {
      await leadFollowup.runLeadFollowup();
      return res.json({ success: true, message: 'Lead Follow-ups triggered' });
    }
    if (name === 'invoice') {
      await invoiceFollowup.runInvoiceFollowup();
      return res.json({ success: true, message: 'Invoice Reminders triggered' });
    }
    res.status(400).json({ error: 'Unknown scheduler name' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
