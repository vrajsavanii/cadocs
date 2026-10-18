/**
 * File: /Users/kachhadiyamanthanhareshbhai/Downloads/PROJECTS/CA automation/backend/routes/noticeRoutes.js
 * Purpose: Notice Inbox CRUD API
 */
const express = require('express');
const router = express.Router();
const sheetsService = require('../services/sheetsService');
const { requireAuth } = require('../middleware/auth');

function computeNoticeInfo(response_deadline) {
  if (!response_deadline) return { daysUntilDeadline: 0, urgency: 'normal' };
  const deadlineDate = new Date(response_deadline);
  const today = new Date();
  const diffTime = deadlineDate - today;
  const daysUntilDeadline = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  let urgency = 'normal';
  if (daysUntilDeadline < 0) {
    urgency = 'overdue';
  } else if (daysUntilDeadline <= 2) {
    urgency = 'critical';
  } else if (daysUntilDeadline <= 7) {
    urgency = 'urgent';
  }
  
  return { daysUntilDeadline, urgency };
}

const memoryNotices = [
  {
    notice_id: 'NTC-001',
    client_id: 'CLIENT-001',
    client_name: 'Mehta Textiles Pvt Ltd',
    notice_type: 'ASMT-10 (GST Scrutiny)',
    portal: 'GST',
    notice_date: '2026-09-01',
    response_deadline: '2026-09-25',
    reference_number: 'ZA270926001234M',
    tax_period: 'FY 2024-25',
    amount_in_dispute: 145000,
    status: 'open',
    notes: 'Difference between ITC claimed in GSTR-3B vs GSTR-2B table 4A.',
  },
  {
    notice_id: 'NTC-002',
    client_id: 'CLIENT-002',
    client_name: 'Aditya Infotech LLP',
    notice_type: '143(1) (IT Intimation)',
    portal: 'IncomeTax',
    notice_date: '2026-08-20',
    response_deadline: '2026-09-30',
    reference_number: 'CPC/2526/1431/0987',
    tax_period: 'AY 2025-26',
    amount_in_dispute: 28400,
    status: 'open',
    notes: 'TDS mismatch between Schedule TDS and Form 26AS.',
  }
];

// GET all notices
router.get('/', requireAuth, async (req, res) => {
  try {
    let records = [];
    try {
      records = await sheetsService.readSheet('Notices');
    } catch (e) {
      records = memoryNotices;
    }
    if (!Array.isArray(records) || records.length === 0) records = memoryNotices;

    const enhanced = records.map(record => {
      const { daysUntilDeadline, urgency } = computeNoticeInfo(record.response_deadline);
      return { ...record, daysUntilDeadline, urgency };
    });
    res.json(enhanced);
  } catch (error) {
    res.json(memoryNotices.map(r => ({ ...r, ...computeNoticeInfo(r.response_deadline) })));
  }
});

// GET stats
router.get('/stats', requireAuth, async (req, res) => {
  try {
    const records = await sheetsService.readSheet('Notices');
    const stats = {
      statusCount: {},
      overdueCount: 0
    };
    
    records.forEach(record => {
      const status = record.status || 'open';
      stats.statusCount[status] = (stats.statusCount[status] || 0) + 1;
      
      const { urgency } = computeNoticeInfo(record.response_deadline);
      if (urgency === 'overdue' && status !== 'closed' && status !== 'response_filed') {
        stats.overdueCount++;
      }
    });
    
    res.json(stats);
  } catch (error) {
    console.error('Error fetching notice stats:', error);
    res.status(500).json({ error: 'Failed to fetch notice stats' });
  }
});

// POST add notice
router.post('/', requireAuth, async (req, res) => {
  try {
    const { client_id, client_name, notice_type, portal, notice_date, response_deadline, reference_number, tax_period, amount_in_dispute, notes } = req.body;
    const records = await sheetsService.readSheet('Notices');
    const newId = `NTC-${String(records.length + 1).padStart(3, '0')}`;
    
    const newRecord = {
      notice_id: newId,
      client_id,
      client_name,
      notice_type,
      portal,
      notice_date,
      response_deadline,
      reference_number,
      tax_period,
      amount_in_dispute,
      notes,
      status: 'open',
      created_at: new Date().toISOString()
    };
    
    await sheetsService.appendRow('Notices', newRecord);
    res.status(201).json(newRecord);
  } catch (error) {
    console.error('Error creating notice:', error);
    res.status(500).json({ error: 'Failed to create notice' });
  }
});

// PUT update status
router.put('/:noticeId/status', requireAuth, async (req, res) => {
  try {
    const { noticeId } = req.params;
    const { status } = req.body;
    
    if (!['open', 'response_filed', 'closed', 'escalated'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    
    await sheetsService.updateRow('Notices', 'notice_id', noticeId, { status });
    res.json({ message: 'Notice status updated successfully' });
  } catch (error) {
    console.error('Error updating notice status:', error);
    res.status(500).json({ error: 'Failed to update notice status' });
  }
});

// PUT update full notice
router.put('/:noticeId', requireAuth, async (req, res) => {
  try {
    const { noticeId } = req.params;
    const data = req.body;
    await sheetsService.updateRow('Notices', 'notice_id', noticeId, data);
    res.json({ message: 'Notice updated successfully' });
  } catch (error) {
    console.error('Error updating notice:', error);
    res.status(500).json({ error: 'Failed to update notice' });
  }
});

module.exports = router;
