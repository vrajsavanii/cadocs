const express = require('express');
const router = express.Router();
const sheetsService = require('../services/sheetsService');
const { nowISO } = require('../utils/helpers');
const { validateClient } = require('../validators/clientValidator');
const { logAudit } = require('../middleware/auditLogger');
const { generateTasksForClient } = require('../ai/complianceTaskGen');

// GET /api/clients — List all clients
router.get('/', async (req, res) => {
  try {
    const clients = await sheetsService.getAllClients();
    res.json(clients);
  } catch (err) {
    console.error('[CLIENTS] Error fetching clients:', err.message);
    res.status(500).json({ error: 'Could not load clients' });
  }
});

// GET /api/clients/:clientId — Get single client profile
router.get('/:clientId', async (req, res) => {
  try {
    const client = await sheetsService.getClientById(req.params.clientId);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    res.json(client);
  } catch (err) {
    res.status(500).json({ error: 'Could not load client details' });
  }
});

// POST /api/clients — Instant Onboarding with Joi validation & auto-compliance task generation
router.post('/', async (req, res) => {
  try {
    const { error, value } = validateClient(req.body);
    if (error) {
      return res.status(400).json({ error: error.details.map((d) => d.message).join(', ') });
    }

    const allClients = await sheetsService.getAllClients();
    const nextNum = allClients.length + 1;
    const clientId = `CLIENT-${String(nextNum).padStart(3, '0')}`;

    const newClient = {
      client_id: clientId,
      name: value.name.trim(),
      contact_person: value.contact_person || value.name.trim(),
      phone: String(value.phone).replace(/\D/g, ''),
      email: (value.email || '').trim(),
      entity_type: value.entity_type || 'Private Limited',
      gst_number: (value.gst_number || '').trim().toUpperCase(),
      pan: (value.pan || '').trim().toUpperCase(),
      services_opted: value.services_opted || 'GST Filing, Tax Audit, ITR',
      city: value.city || 'Mumbai',
      state: value.state || 'Maharashtra',
      created_at: nowISO(),
    };

    await sheetsService.addClient(newClient);
    console.log(`[CLIENTS] ✅ New client onboarded: ${newClient.name} (${clientId})`);

    // Audit log
    await logAudit({
      userId: req.user?.id,
      userName: req.user?.name,
      action: 'CREATE',
      entityType: 'client',
      entityId: clientId,
      newValue: newClient,
      ipAddress: req.ip,
    });

    // Auto-generate compliance tasks in background
    setImmediate(async () => {
      try {
        const tasks = await generateTasksForClient({
          entityType: newClient.entity_type,
          hasGST: !!newClient.gst_number,
          hasTDS: true,
          hasIncomeTax: true,
          clientId: newClient.client_id,
          financialYear: '2025-26',
        });
        if (Array.isArray(tasks) && tasks.length > 0) {
          for (const t of tasks.slice(0, 5)) {
            await sheetsService.appendRow(sheetsService.TABS.COMPLIANCE, {
              compliance_id: `CMP-${Date.now().toString().slice(-4)}-${Math.floor(Math.random() * 90 + 10)}`,
              client_id: newClient.client_id,
              client_name: newClient.name,
              compliance_type: t.compliance_type || t.task_type || 'GSTR-3B',
              due_date: t.due_date || '2026-10-20',
              status: 'Pending',
              reminder_count: 0,
            }).catch(() => {});
          }
        }
      } catch (e) {
        console.warn('[ONBOARDING] Auto task generation warning:', e.message);
      }
    });

    res.status(201).json({ success: true, client: newClient });
  } catch (err) {
    console.error('[CLIENTS] Error creating client:', err.message);
    res.status(500).json({ error: 'Could not create client in Google Sheets' });
  }
});


module.exports = router;
