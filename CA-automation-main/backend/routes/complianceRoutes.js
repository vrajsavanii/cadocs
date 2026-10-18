// routes/complianceRoutes.js
// Statutory Compliance Calendar & Tracking API
// CA Firm Automation Suite

const express = require('express');
const router = express.Router();
const sheetsService = require('../services/sheetsService');
const whatsappService = require('../services/whatsappService');
const emailService = require('../services/emailService');
const groqService = require('../services/groqService');
const penaltyCalc = require('../utils/penaltyCalc');
const { daysFromToday, nowISO } = require('../utils/helpers');
const { keys } = require('../config/keys');

// GET /api/compliance — List all compliance records
router.get('/', async (req, res) => {
  try {
    const items = await sheetsService.getAllCompliance();
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: 'Could not load compliance data' });
  }
});

// PUT /api/compliance/:complianceId/status — Update status (e.g. 'Filed')
router.put('/:complianceId/status', async (req, res) => {
  try {
    const { status } = req.body;
    await sheetsService.updateComplianceStatus(req.params.complianceId, status || 'Filed');
    res.json({ success: true, message: `Status updated to ${status || 'Filed'}` });
  } catch (err) {
    res.status(500).json({ error: 'Could not update compliance status' });
  }
});

// POST /api/compliance/:complianceId/remind — 1-click manual dispatch from dashboard
router.post('/:complianceId/remind', async (req, res) => {
  try {
    const { channel = 'whatsapp' } = req.body;
    const all = await sheetsService.getAllCompliance();
    const item = all.find((c) => c.compliance_id === req.params.complianceId);
    if (!item) return res.status(404).json({ error: 'Compliance record not found' });

    const days = daysFromToday(item.due_date);
    const penalty = days < 0 ? penaltyCalc.getPenaltySummary(item.compliance_type, Math.abs(days), 0) : '';

    const message = await groqService.draftMessage(
      days < 0 ? 'compliance_overdue' : days <= 3 ? 'compliance_3d' : 'compliance_7d',
      {
        clientName: item.client_name,
        complianceType: item.compliance_type,
        dueDate: item.due_date,
        daysLeft: days,
        penalty,
        firmName: keys.FIRM_NAME,
      }
    );

    if (channel === 'whatsapp' && item.phone) {
      await whatsappService.sendTextMessage(item.phone, message);
    } else if (channel === 'email' && item.email) {
      await emailService.sendEmail(
        item.email,
        `Reminder: ${item.compliance_type} due on ${item.due_date}`,
        message
      );
    }

    await sheetsService.Compliance.update('compliance_id', item.compliance_id, {
      reminder_count: (parseInt(item.reminder_count) || 0) + 1,
      last_reminder_date: nowISO(),
    });

    res.json({ success: true, message: `${channel} reminder sent successfully` });
  } catch (err) {
    console.error('[COMPLIANCE] Error sending manual reminder:', err.message);
    res.status(500).json({ error: 'Failed to send compliance reminder' });
  }
});

module.exports = router;
