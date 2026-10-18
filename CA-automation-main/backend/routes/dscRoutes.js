/**
 * File: /Users/kachhadiyamanthanhareshbhai/Downloads/PROJECTS/CA automation/backend/routes/dscRoutes.js
 * Purpose: DSC Expiry Tracker CRUD API
 */
const express = require('express');
const router = express.Router();
const sheetsService = require('../services/sheetsService');
const { requireAuth } = require('../middleware/auth');

function computeExpiryInfo(valid_until) {
  if (!valid_until) return { daysUntilExpiry: 0, expiryStatus: 'unknown' };
  const validUntilDate = new Date(valid_until);
  const today = new Date();
  const diffTime = validUntilDate - today;
  const daysUntilExpiry = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  let expiryStatus = 'active';
  if (daysUntilExpiry < 0) {
    expiryStatus = 'expired';
  } else if (daysUntilExpiry <= 30) {
    expiryStatus = 'expiring_soon';
  }
  
  return { daysUntilExpiry, expiryStatus };
}

const memoryDsc = [
  {
    dsc_id: 'DSC-001',
    client_id: 'CLIENT-001',
    client_name: 'Mehta Textiles Pvt Ltd',
    dsc_holder_name: 'Ramesh Mehta (Director)',
    class_type: 'Class 3',
    valid_from: '2024-10-01',
    valid_until: '2026-10-05',
    token_serial: 'EM-2024-88991',
    issuing_ca: 'eMudhra',
    purpose: 'GST, MCA (ROC)',
    is_active: true,
  },
  {
    dsc_id: 'DSC-002',
    client_id: 'CLIENT-002',
    client_name: 'Aditya Infotech LLP',
    dsc_holder_name: 'Priya Sharma (Partner)',
    class_type: 'Class 3',
    valid_from: '2024-11-15',
    valid_until: '2026-11-20',
    token_serial: 'NSDL-2024-11223',
    issuing_ca: 'NSDL',
    purpose: 'Income Tax, GST',
    is_active: true,
  }
];

// GET all DSC records
router.get('/', requireAuth, async (req, res) => {
  try {
    let records = [];
    try {
      records = await sheetsService.readSheet('DSC_Records');
    } catch (e) {
      records = memoryDsc;
    }
    if (!Array.isArray(records) || records.length === 0) records = memoryDsc;

    const enhanced = records.map(record => {
      const { daysUntilExpiry, expiryStatus } = computeExpiryInfo(record.valid_until);
      return { ...record, daysUntilExpiry, expiryStatus };
    });
    res.json(enhanced);
  } catch (error) {
    res.json(memoryDsc.map(r => ({ ...r, ...computeExpiryInfo(r.valid_until) })));
  }
});

// GET expiring DSCs
router.get('/expiring', requireAuth, async (req, res) => {
  try {
    const daysLimit = parseInt(req.query.days) || 30;
    const records = await sheetsService.readSheet('DSC_Records');
    const enhanced = records.map(record => {
      const { daysUntilExpiry, expiryStatus } = computeExpiryInfo(record.valid_until);
      return { ...record, daysUntilExpiry, expiryStatus };
    }).filter(record => record.daysUntilExpiry >= 0 && record.daysUntilExpiry <= daysLimit);
    
    res.json(enhanced);
  } catch (error) {
    console.error('Error fetching expiring DSCs:', error);
    res.status(500).json({ error: 'Failed to fetch expiring DSC records' });
  }
});

// POST add DSC record
router.post('/', requireAuth, async (req, res) => {
  try {
    const { client_id, client_name, dsc_holder_name, class_type, valid_from, valid_until, token_serial, issuing_ca, purpose } = req.body;
    const records = await sheetsService.readSheet('DSC_Records');
    const newId = `DSC-${String(records.length + 1).padStart(3, '0')}`;
    
    const newRecord = {
      dsc_id: newId,
      client_id,
      client_name,
      dsc_holder_name,
      class_type,
      valid_from,
      valid_until,
      token_serial,
      issuing_ca,
      purpose,
      created_at: new Date().toISOString()
    };
    
    await sheetsService.appendRow('DSC_Records', newRecord);
    res.status(201).json(newRecord);
  } catch (error) {
    console.error('Error creating DSC record:', error);
    res.status(500).json({ error: 'Failed to create DSC record' });
  }
});

// PUT update record
router.put('/:dscId', requireAuth, async (req, res) => {
  try {
    const { dscId } = req.params;
    const data = req.body;
    await sheetsService.updateRow('DSC_Records', 'dsc_id', dscId, data);
    res.json({ message: 'DSC record updated successfully' });
  } catch (error) {
    console.error('Error updating DSC record:', error);
    res.status(500).json({ error: 'Failed to update DSC record' });
  }
});

module.exports = router;
