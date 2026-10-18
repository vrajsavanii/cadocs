/**
 * File: /Users/kachhadiyamanthanhareshbhai/Downloads/PROJECTS/CA automation/backend/routes/blastRoutes.js
 * Purpose: Bulk Communication Blast API
 */
const express = require('express');
const router = express.Router();
const sheetsService = require('../services/sheetsService');
const whatsappService = require('../services/whatsappService');
const emailService = require('../services/emailService');
const groqService = require('../services/groqService');
const { requireAuth, requireRole } = require('../middleware/auth');

// POST /api/blast
router.post('/', requireAuth, requireRole(['partner', 'manager']), async (req, res) => {
  try {
    const { complianceType, statusFilter, channel = 'whatsapp', customMessage } = req.body;
    const dryRun = req.query.dryRun === 'true';
    
    // Fetch matching clients
    const clients = await sheetsService.getAllClients();
    
    // Filter logic
    const recipients = clients.filter(client => {
      if (statusFilter && client.status !== statusFilter) return false;
      return true;
    }).slice(0, 200); // Rate limit to 200 recipients
    
    if (dryRun) {
      return res.json({ sent: 0, failed: 0, count: recipients.length, recipients: recipients.map(r => r.name || r.client_name) });
    }
    
    let sent = 0;
    let failed = 0;
    
    for (const recipient of recipients) {
      try {
        const clientName = recipient.name || recipient.client_name || 'Client';
        const msg = customMessage || `Dear ${clientName},\n\nThis is an urgent reminder from ${keys.FIRM_NAME} regarding upcoming statutory compliance: ${complianceType || 'GSTR / ITR Filing'}. Please ensure all required bank statements and invoices are submitted on time to avoid late fees.\n\nThank you,\n${keys.FIRM_NAME}`;
        
        if (channel === 'whatsapp' && recipient.phone) {
          await whatsappService.sendTextMessage(recipient.phone, msg);
          sent++;
        } else if (channel === 'email' && recipient.email) {
          await emailService.sendEmail(recipient.email, `Important Compliance Notice: ${complianceType || 'Statutory Filing'}`, msg);
          sent++;
        } else {
          failed++;
        }
      } catch (err) {
        console.error(`Failed to send to ${recipient.name || recipient.client_name}:`, err.message);
        failed++;
      }
    }
    
    res.json({ sent, failed, recipients: recipients.map(r => r.client_name) });
  } catch (error) {
    console.error('Error processing blast:', error);
    res.status(500).json({ error: 'Failed to process blast' });
  }
});

module.exports = router;
