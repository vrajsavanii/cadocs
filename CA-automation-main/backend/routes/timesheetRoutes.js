// backend/routes/timesheetRoutes.js
// Staff Attendance & Billable Hours Timesheet Tracking
// CA Firm Automation Suite

const express = require('express');
const router = express.Router();
const sheetsService = require('../services/sheetsService');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logAudit } = require('../middleware/auditLogger');

const TIMESHEET_TAB = 'Timesheets';

// In-memory fallback if sheet tab is not yet created
let memoryTimesheets = [
  {
    timesheet_id: 'TS-101',
    user_id: 'usr-003',
    user_name: 'Article Assistant',
    client_id: 'CLIENT-001',
    client_name: 'Mehta Textiles Pvt Ltd',
    date: new Date().toISOString().slice(0, 10),
    task_type: 'GST Reconciliation',
    task_description: 'GSTR-2B vs Purchase Register invoice matching for August 2026',
    hours: 3.5,
    billable: true,
    status: 'Approved',
    created_at: new Date().toISOString(),
  },
  {
    timesheet_id: 'TS-102',
    user_id: 'usr-002',
    user_name: 'Audit Manager',
    client_id: 'CLIENT-002',
    client_name: 'Aditya Infotech LLP',
    date: new Date().toISOString().slice(0, 10),
    task_type: 'Statutory Audit',
    task_description: 'Review of fixed assets register and depreciation schedules',
    hours: 4.0,
    billable: true,
    status: 'Pending',
    created_at: new Date().toISOString(),
  }
];

/**
 * GET /api/timesheets
 * Query: ?userId=xxx&clientId=xxx&from=YYYY-MM-DD&to=YYYY-MM-DD
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    let rows = [];
    try {
      rows = await sheetsService.readSheet(TIMESHEET_TAB);
    } catch (e) {
      rows = memoryTimesheets;
    }

    if (!Array.isArray(rows) || rows.length === 0) {
      rows = memoryTimesheets;
    }

    // Article assistants only see their own timesheets
    if (req.user.role === 'article') {
      rows = rows.filter(r => r.user_id === req.user.id || r.user_name === req.user.name);
    } else if (req.query.userId) {
      rows = rows.filter(r => r.user_id === req.query.userId);
    }

    if (req.query.clientId) {
      rows = rows.filter(r => r.client_id === req.query.clientId);
    }

    res.json(rows);
  } catch (err) {
    console.error('Error fetching timesheets:', err.message);
    res.status(500).json({ error: 'Failed to fetch timesheet entries' });
  }
});

/**
 * POST /api/timesheets
 * Log a new task / billable hours
 */
router.post('/', requireAuth, async (req, res) => {
  try {
    const {
      client_id,
      client_name,
      task_type,
      task_description,
      hours,
      billable = true,
      date = new Date().toISOString().slice(0, 10),
    } = req.body;

    if (!task_description || !hours) {
      return res.status(400).json({ error: 'Task description and hours are required' });
    }

    const timesheetEntry = {
      timesheet_id: `TS-${Date.now().toString().slice(-5)}`,
      user_id: req.user.id,
      user_name: req.user.name,
      client_id: client_id || 'GENERAL',
      client_name: client_name || 'General Office / Internal',
      date,
      task_type: task_type || 'General Compliance',
      task_description,
      hours: parseFloat(hours) || 1,
      billable: billable === true || billable === 'true',
      status: req.user.role === 'partner' ? 'Approved' : 'Pending',
      created_at: new Date().toISOString(),
    };

    try {
      await sheetsService.appendRow(TIMESHEET_TAB, timesheetEntry);
    } catch (e) {
      memoryTimesheets.unshift(timesheetEntry);
    }

    await logAudit({
      userId: req.user.id,
      userName: req.user.name,
      action: 'CREATE',
      entityType: 'timesheet',
      entityId: timesheetEntry.timesheet_id,
      newValue: timesheetEntry,
      ipAddress: req.ip,
    });

    res.status(201).json({ success: true, entry: timesheetEntry });
  } catch (err) {
    console.error('Error creating timesheet:', err.message);
    res.status(500).json({ error: 'Could not log timesheet' });
  }
});

/**
 * GET /api/timesheets/stats
 * Aggregate metrics: total hours, billable ratio, staff breakdown
 */
router.get('/stats', requireAuth, requireRole(['partner', 'manager']), async (req, res) => {
  try {
    let rows = memoryTimesheets;
    try {
      const sheetRows = await sheetsService.readSheet(TIMESHEET_TAB);
      if (Array.isArray(sheetRows) && sheetRows.length > 0) rows = sheetRows;
    } catch (e) {
      // fallback
    }

    const totalHours = rows.reduce((s, r) => s + (parseFloat(r.hours) || 0), 0);
    const billableHours = rows
      .filter(r => r.billable === true || r.billable === 'true' || r.billable === 'TRUE')
      .reduce((s, r) => s + (parseFloat(r.hours) || 0), 0);

    const pendingApproval = rows.filter(r => r.status === 'Pending').length;

    res.json({
      totalHours: totalHours.toFixed(1),
      billableHours: billableHours.toFixed(1),
      nonBillableHours: (totalHours - billableHours).toFixed(1),
      billablePercentage: totalHours > 0 ? Math.round((billableHours / totalHours) * 100) : 0,
      totalEntries: rows.length,
      pendingApproval,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to compute stats' });
  }
});

/**
 * PUT /api/timesheets/:id/approve
 * Partner or Manager approval
 */
router.put('/:id/approve', requireAuth, requireRole(['partner', 'manager']), async (req, res) => {
  const { id } = req.params;
  const idx = memoryTimesheets.findIndex(t => t.timesheet_id === id);
  if (idx !== -1) {
    memoryTimesheets[idx].status = 'Approved';
  }
  try {
    await sheetsService.updateRow(TIMESHEET_TAB, 'timesheet_id', id, { status: 'Approved' });
  } catch (e) {}

  res.json({ success: true, message: 'Timesheet approved' });
});

module.exports = router;
