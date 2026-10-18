/**
 * File: /Users/kachhadiyamanthanhareshbhai/Downloads/PROJECTS/CA automation/backend/routes/udinRoutes.js
 * Purpose: UDIN Register CRUD API using sheetsService
 */
const express = require('express');
const router = express.Router();
const sheetsService = require('../services/sheetsService');
const { requireAuth } = require('../middleware/auth');

const memoryUdin = [
  {
    udin_id: 'UDIN-001',
    client_id: 'CLIENT-001',
    client_name: 'Mehta Textiles Pvt Ltd',
    udin: '24012345AAAAAA1234',
    ca_member_no: '012345',
    document_type: 'Tax Audit Report (Form 3CA/3CB)',
    financial_year: '2024-25',
    generated_date: '2026-09-10',
    report_type: 'Independent Auditor Report',
    status: 'active',
  },
  {
    udin_id: 'UDIN-002',
    client_id: 'CLIENT-002',
    client_name: 'Aditya Infotech LLP',
    udin: '24012345BBBBBB5678',
    ca_member_no: '012345',
    document_type: 'Statutory Audit Report',
    financial_year: '2024-25',
    generated_date: '2026-09-15',
    report_type: 'Statutory Audit Opinion',
    status: 'active',
  }
];

// GET all UDIN records
router.get('/', requireAuth, async (req, res) => {
  try {
    const { client_id } = req.query;
    let records = [];
    try {
      records = await sheetsService.readSheet('UDIN_Register');
    } catch (e) {
      records = memoryUdin;
    }
    if (!Array.isArray(records) || records.length === 0) records = memoryUdin;

    if (client_id) {
      const filtered = records.filter(r => r.client_id === client_id && r.status !== 'deleted');
      return res.json(filtered);
    }
    res.json(records.filter(r => r.status !== 'deleted'));
  } catch (error) {
    res.json(memoryUdin);
  }
});

// GET stats
router.get('/stats', requireAuth, async (req, res) => {
  try {
    const records = await sheetsService.readSheet('UDIN_Register');
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    
    let monthCount = 0;
    let yearCount = 0;
    
    records.forEach(r => {
      if (r.status === 'deleted') return;
      const createdAt = new Date(r.created_at || Date.now());
      if (createdAt.getFullYear() === currentYear) {
        yearCount++;
        if (createdAt.getMonth() === currentMonth) {
          monthCount++;
        }
      }
    });
    
    res.json({ monthCount, yearCount });
  } catch (error) {
    console.error('Error fetching UDIN stats:', error);
    res.status(500).json({ error: 'Failed to fetch UDIN stats' });
  }
});

// POST add UDIN record
router.post('/', requireAuth, async (req, res) => {
  try {
    const { client_id, ca_member_no, udin, document_type, financial_year, report_type, notes } = req.body;
    
    if (!udin || udin.length !== 18 || !/^\d/.test(udin)) {
      return res.status(400).json({ error: 'Invalid UDIN format. Must be 18 chars and start with digits' });
    }
    
    const records = await sheetsService.readSheet('UDIN_Register');
    const newId = `UDIN-${String(records.length + 1).padStart(3, '0')}`;
    
    const newRecord = {
      udin_id: newId,
      client_id,
      ca_member_no,
      udin,
      document_type,
      financial_year,
      report_type,
      notes,
      status: 'active',
      created_at: new Date().toISOString()
    };
    
    await sheetsService.appendRow('UDIN_Register', newRecord);
    res.status(201).json(newRecord);
  } catch (error) {
    console.error('Error creating UDIN:', error);
    res.status(500).json({ error: 'Failed to create UDIN record' });
  }
});

// PUT update a record
router.put('/:udinId', requireAuth, async (req, res) => {
  try {
    const { udinId } = req.params;
    const data = req.body;
    await sheetsService.updateRow('UDIN_Register', 'udin_id', udinId, data);
    res.json({ message: 'UDIN record updated successfully' });
  } catch (error) {
    console.error('Error updating UDIN:', error);
    res.status(500).json({ error: 'Failed to update UDIN record' });
  }
});

// DELETE mark as deleted
router.delete('/:udinId', requireAuth, async (req, res) => {
  try {
    const { udinId } = req.params;
    await sheetsService.updateRow('UDIN_Register', 'udin_id', udinId, { status: 'deleted' });
    res.json({ message: 'UDIN record deleted successfully' });
  } catch (error) {
    console.error('Error deleting UDIN:', error);
    res.status(500).json({ error: 'Failed to delete UDIN record' });
  }
});

module.exports = router;
