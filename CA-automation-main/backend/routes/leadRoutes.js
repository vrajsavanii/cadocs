const express = require('express');
const router = express.Router();
const sheetsService = require('../services/sheetsService');
const { nowISO } = require('../utils/helpers');
const { validateLead } = require('../validators/leadValidator');
const { logAudit } = require('../middleware/auditLogger');
const { qualifyLead } = require('../ai/leadQualifier');

// GET /api/leads — List all leads
router.get('/', async (req, res) => {
  try {
    const leads = await sheetsService.getAllLeads();
    res.json(leads);
  } catch (err) {
    res.status(500).json({ error: 'Could not load leads' });
  }
});

// POST /api/leads — Create new inbound lead with validation & AI scoring
router.post('/', async (req, res) => {
  try {
    const { error, value } = validateLead(req.body);
    if (error) {
      return res.status(400).json({ error: error.details.map((d) => d.message).join(', ') });
    }

    const allLeads = await sheetsService.getAllLeads();
    const leadId = `LEAD-${String(allLeads.length + 1).padStart(3, '0')}`;

    const newLead = {
      lead_id: leadId,
      name: value.name.trim(),
      company_name: value.company_name || value.name.trim(),
      entity_type: value.entity_type || 'Pvt Ltd',
      phone: String(value.phone).replace(/\D/g, ''),
      email: value.email || '',
      services_required: Array.isArray(value.services_required) ? value.services_required.join(', ') : (value.services_required || 'GST, Tax Audit'),
      turnover: value.turnover || '1–5 crore',
      lead_score: value.lead_score || 75,
      lead_category: value.lead_category || 'Hot',
      stage: value.stage || 'New',
      source: value.source || 'Website',
      created_at: nowISO(),
    };

    await sheetsService.appendRow(sheetsService.TABS.LEADS, newLead);

    await logAudit({
      userId: req.user?.id,
      userName: req.user?.name,
      action: 'CREATE',
      entityType: 'lead',
      entityId: leadId,
      newValue: newLead,
      ipAddress: req.ip,
    });

    res.status(201).json({ success: true, lead: newLead });
  } catch (err) {
    console.error('[LEADS] Error creating lead:', err.message);
    res.status(500).json({ error: 'Could not create lead' });
  }
});

// PUT /api/leads/:leadId/status — Advance stage
router.put('/:leadId/status', async (req, res) => {
  try {
    const { status } = req.body;
    await sheetsService.updateLeadStatus(req.params.leadId, status);
    res.json({ success: true, message: `Lead stage updated to ${status}` });
  } catch (err) {
    res.status(500).json({ error: 'Could not update lead status' });
  }
});

// PUT /api/leads/:leadId/stage — Alias for status
router.put('/:leadId/stage', async (req, res) => {
  try {
    const { status, stage } = req.body;
    const targetStage = stage || status;
    await sheetsService.updateLeadStatus(req.params.leadId, targetStage);
    res.json({ success: true, message: `Lead stage updated to ${targetStage}` });
  } catch (err) {
    res.status(500).json({ error: 'Could not update lead stage' });
  }
});

// POST /api/leads/:leadId/convert — 1-click Convert Lead to Practice Client
router.post('/:leadId/convert', async (req, res) => {
  try {
    const allLeads = await sheetsService.getAllLeads();
    const lead = allLeads.find((l) => l.lead_id === req.params.leadId);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const allClients = await sheetsService.getAllClients();
    const nextNum = allClients.length + 1;
    const clientId = `CLIENT-${String(nextNum).padStart(3, '0')}`;

    const newClient = {
      client_id: clientId,
      name: lead.name,
      phone: lead.phone,
      email: lead.email || '',
      entity_type: lead.business_type || 'Private Limited',
      gst_number: '',
      pan: '',
      created_at: nowISO(),
    };

    await sheetsService.addClient(newClient);
    await sheetsService.updateLeadStatus(lead.lead_id, 'Converted');

    console.log(`[LEADS] 🎉 Converted lead ${lead.name} to ${clientId}`);
    res.json({ success: true, client: newClient, message: `${lead.name} converted to Client!` });
  } catch (err) {
    console.error('[LEADS] Error converting lead:', err.message);
    res.status(500).json({ error: 'Could not convert lead to client' });
  }
});

module.exports = router;
