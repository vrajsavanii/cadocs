/**
 * File: /Users/kachhadiyamanthanhareshbhai/Downloads/PROJECTS/CA automation/backend/routes/proposalRoutes.js
 * Purpose: Proposal Generator API
 */
const express = require('express');
const router = express.Router();
const sheetsService = require('../services/sheetsService');
const proposalGenerator = require('../ai/proposalGenerator');
const { requireAuth } = require('../middleware/auth');
const { keys } = require('../config/keys');
const fs = require('fs');
const path = require('path');

// POST /api/proposals/generate
router.post('/generate', requireAuth, async (req, res) => {
  try {
    const { leadId, customFee, customServices } = req.body;
    
    const leads = await sheetsService.getAllLeads();
    const lead = leads.find(l => l.lead_id === leadId || l.leadId === leadId || l.id === leadId);
    
    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }
    
    const proposalText = await proposalGenerator.generateProposal({
      firmName: keys.FIRM_NAME,
      partnerName: keys.PARTNER_NAME || 'Managing Partner',
      membershipNo: '012345',
      firmAddress: `${keys.FIRM_CITY}, India`,
      firmPhone: keys.FIRM_PHONE,
      firmEmail: keys.FIRM_EMAIL,
      prospectName: lead.name,
      companyName: lead.company_name || lead.name,
      entityType: lead.entity_type || 'Private Limited',
      turnover: lead.turnover || '1–5 crore',
      servicesRequired: customServices || lead.services_required || 'GST & Statutory Audit',
      proposedFee: customFee || '₹15,000 / month',
    });
    
    res.json({ success: true, proposalText, leadId });
  } catch (error) {
    console.error('Error generating proposal:', error);
    res.status(500).json({ error: 'Failed to generate proposal' });
  }
});

// POST /api/proposals/generate-pdf
router.post('/generate-pdf', requireAuth, async (req, res) => {
  try {
    const { leadId, customFee, customServices } = req.body;
    
    const leads = await sheetsService.getAllLeads();
    const lead = leads.find(l => l.lead_id === leadId || l.leadId === leadId || l.id === leadId);
    
    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }
    
    const proposalText = await proposalGenerator.generateProposal({
      firmName: keys.FIRM_NAME,
      partnerName: keys.PARTNER_NAME || 'Managing Partner',
      membershipNo: '012345',
      firmAddress: `${keys.FIRM_CITY}, India`,
      firmPhone: keys.FIRM_PHONE,
      firmEmail: keys.FIRM_EMAIL,
      prospectName: lead.name,
      companyName: lead.company_name || lead.name,
      entityType: lead.entity_type || 'Private Limited',
      turnover: lead.turnover || '1–5 crore',
      servicesRequired: customServices || lead.services_required || 'GST & Statutory Audit',
      proposedFee: customFee || '₹15,000 / month',
    });
    
    const uploadsDir = path.join(__dirname, '..', 'uploads', 'proposals');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    
    const filePath = path.join(uploadsDir, `${leadId}.pdf`);
    await proposalGenerator.generateProposalPDF(proposalText, filePath);
    
    const downloadUrl = `/uploads/proposals/${leadId}.pdf`;
    res.json({ success: true, downloadUrl, leadId, proposalText });
  } catch (error) {
    console.error('Error generating proposal PDF:', error);
    res.status(500).json({ error: 'Failed to generate proposal PDF' });
  }
});

module.exports = router;
