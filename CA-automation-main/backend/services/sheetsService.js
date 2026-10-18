// services/sheetsService.js
// Google Sheets API v4 Headless Relational Database Engine
// CA Firm Automation Suite

const { google } = require('googleapis');
const { keys } = require('../config/keys');

// ── SINGLETON CLIENT & AUTH ──────────────────────────────────────────────────
let sheetsClient = null;

function getAuth() {
  return new google.auth.JWT(
    keys.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    keys.GOOGLE_PRIVATE_KEY,
    ['https://www.googleapis.com/auth/spreadsheets']
  );
}

function getSheetsClient() {
  if (!sheetsClient) {
    const auth = getAuth();
    sheetsClient = google.sheets({ version: 'v4', auth });
  }
  return sheetsClient;
}

// ── SHEET TAB NAMES ──────────────────────────────────────────────────────────
const TABS = {
  CLIENTS: 'Clients',
  LEADS: 'Leads',
  COMPLIANCE: 'Compliance_Calendar',
  DOCUMENTS: 'Documents_Tracker',
  INVOICES: 'Invoices',
  QUERY_LOG: 'Query_Log',
  ERROR_LOG: 'Error_Log',
  // Phase 1 tabs
  UDIN_REGISTER: 'UDIN_Register',
  DSC_RECORDS: 'DSC_Records',
  NOTICES: 'Notices',
  AUDIT_LOG: 'Audit_Log',
};

// Retry helper for Sheets API rate limits
async function executeWithRetry(fn, maxRetries = 3, delayMs = 1000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isRateLimit = err.code === 429 || (err.message && err.message.includes('Quota'));
      if (isRateLimit && attempt < maxRetries) {
        console.warn(`[SHEETS] Rate limit encountered. Retrying attempt ${attempt + 1}/${maxRetries} in ${delayMs}ms...`);
        await new Promise((r) => setTimeout(r, delayMs * attempt));
      } else {
        throw err;
      }
    }
  }
}

// ── UTILITY FUNCTIONS ────────────────────────────────────────────────────────

/**
 * Get headers from Row 1
 */
async function getHeaders(tabName) {
  return executeWithRetry(async () => {
    const sheets = getSheetsClient();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: keys.GOOGLE_SHEET_ID,
      range: `${tabName}!1:1`,
    });
    return (res.data.values || [[]])[0] || [];
  });
}

/**
 * Read all rows from a tab into array of key-value objects
 */
async function readSheet(tabName) {
  try {
    return await executeWithRetry(async () => {
      const sheets = getSheetsClient();
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: keys.GOOGLE_SHEET_ID,
        range: `${tabName}!A1:ZZ`,
      });

      const rows = res.data.values || [];
      if (rows.length < 2) return [];

      const headers = rows[0];
      return rows.slice(1).map((row) => {
        const obj = {};
        headers.forEach((h, i) => {
          obj[h] = row[i] !== undefined ? row[i] : '';
        });
        return obj;
      });
    });
  } catch (err) {
    console.error(`[SHEETS] ❌ readSheet(${tabName}) error:`, err.message);
    return [];
  }
}

/**
 * Append a new row with schema validation against Row 1 headers
 */
async function appendRow(tabName, data) {
  try {
    return await executeWithRetry(async () => {
      const sheets = getSheetsClient();
      const headers = await getHeaders(tabName);

      if (!headers.length) {
        console.error(`[SHEETS] ❌ appendRow(${tabName}) failed: No headers found in sheet tab`);
        return false;
      }

      // Build row array strictly matching header order
      const row = headers.map((h) => (data[h] !== undefined ? String(data[h]) : ''));

      await sheets.spreadsheets.values.append({
        spreadsheetId: keys.GOOGLE_SHEET_ID,
        range: `${tabName}!A1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [row] },
      });

      console.log(`[SHEETS] ✅ Appended row to ${tabName}`);
      return true;
    });
  } catch (err) {
    console.error(`[SHEETS] ❌ appendRow(${tabName}) error:`, err.message);
    return false;
  }
}

/**
 * Update row matching key column
 */
async function updateRow(tabName, matchCol, matchVal, data) {
  try {
    return await executeWithRetry(async () => {
      const sheets = getSheetsClient();
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: keys.GOOGLE_SHEET_ID,
        range: `${tabName}!A1:ZZ`,
      });

      const rows = res.data.values || [];
      if (rows.length < 2) return false;

      const headers = rows[0];
      const matchColIdx = headers.indexOf(matchCol);
      if (matchColIdx === -1) {
        console.warn(`[SHEETS] ⚠️ updateRow: match column "${matchCol}" not found in ${tabName}`);
        return false;
      }

      let rowIndex = -1;
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][matchColIdx] || '') === String(matchVal)) {
          rowIndex = i + 1; // 1-indexed for Sheets
          break;
        }
      }

      if (rowIndex === -1) {
        // Not found — append instead
        return await appendRow(tabName, data);
      }

      const existingRow = rows[rowIndex - 1] || [];
      const updatedRow = headers.map((h, i) => {
        if (data[h] !== undefined) return String(data[h]);
        return existingRow[i] !== undefined ? existingRow[i] : '';
      });

      await sheets.spreadsheets.values.update({
        spreadsheetId: keys.GOOGLE_SHEET_ID,
        range: `${tabName}!A${rowIndex}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [updatedRow] },
      });

      console.log(`[SHEETS] ✅ Updated row ${rowIndex} in ${tabName} (${matchCol}=${matchVal})`);
      return true;
    });
  } catch (err) {
    console.error(`[SHEETS] ❌ updateRow(${tabName}) error:`, err.message);
    return false;
  }
}

/**
 * Find single matching row
 */
async function findRow(tabName, matchCol, matchVal) {
  const rows = await readSheet(tabName);
  return rows.find((r) => String(r[matchCol] || '') === String(matchVal)) || null;
}

// ── DOMAIN-SPECIFIC FUNCTIONS ────────────────────────────────────────────────

// Clients
async function getAllClients() { return readSheet(TABS.CLIENTS); }
async function getClientByPhone(phone) {
  const clean = String(phone || '').replace(/\D/g, '');
  const clients = await getAllClients();
  return clients.find((c) => {
    const p = String(c.phone || '').replace(/\D/g, '');
    return p === clean || p.endsWith(clean) || clean.endsWith(p);
  }) || null;
}
async function getClientById(clientId) { return findRow(TABS.CLIENTS, 'client_id', clientId); }
async function addClient(clientData) { return appendRow(TABS.CLIENTS, clientData); }

// Compliance
async function getAllCompliance() { return readSheet(TABS.COMPLIANCE); }
async function getComplianceForClient(clientId) {
  const all = await getAllCompliance();
  return all.filter((c) => c.client_id === clientId);
}
async function updateComplianceStatus(complianceId, status) {
  return updateRow(TABS.COMPLIANCE, 'compliance_id', complianceId, { status });
}

// Documents
async function getAllDocuments() { return readSheet(TABS.DOCUMENTS); }
async function getDocumentsForClient(clientId) {
  const all = await getAllDocuments();
  return all.filter((d) => d.client_id === clientId);
}
async function updateDocumentStatus(docId, status, receivedDate = null) {
  const data = { status };
  if (receivedDate) data.received_date = receivedDate;
  return updateRow(TABS.DOCUMENTS, 'doc_id', docId, data);
}

// Invoices
async function getAllInvoices() { return readSheet(TABS.INVOICES); }
async function updateInvoiceStatus(invoiceId, status) {
  return updateRow(TABS.INVOICES, 'invoice_id', invoiceId, { status });
}
async function getOverdueInvoices() {
  const all = await getAllInvoices();
  const today = new Date().toISOString().slice(0, 10);
  return all.filter((i) => i.status !== 'Paid' && String(i.due_date).slice(0, 10) < today);
}

// Leads
async function getAllLeads() { return readSheet(TABS.LEADS); }
async function addLead(leadData) { return appendRow(TABS.LEADS, leadData); }
async function updateLeadStatus(leadId, status) {
  return updateRow(TABS.LEADS, 'lead_id', leadId, { status });
}

// Logging
async function logQuery(logData) { return appendRow(TABS.QUERY_LOG, logData); }
async function logError(errorData) { return appendRow(TABS.ERROR_LOG, errorData); }

// Convenience objects for backward compatibility with existing code
const Clients = {
  getAll: getAllClients,
  getByPhone: getClientByPhone,
  getById: getClientById,
  append: addClient,
};

const Leads = {
  getAll: getAllLeads,
  append: addLead,
  update: (matchCol, matchVal, d) => updateRow(TABS.LEADS, matchCol, matchVal, d),
};

const Compliance = {
  getAll: getAllCompliance,
  getForClient: getComplianceForClient,
  update: (matchCol, matchVal, d) => updateRow(TABS.COMPLIANCE, matchCol, matchVal, d),
};

const Documents = {
  getAll: getAllDocuments,
  getForClient: getDocumentsForClient,
  append: (d) => appendRow(TABS.DOCUMENTS, d),
  update: (matchCol, matchVal, d) => updateRow(TABS.DOCUMENTS, matchCol, matchVal, d),
};

const Invoices = {
  getAll: getAllInvoices,
  getOverdue: getOverdueInvoices,
  update: (matchCol, matchVal, d) => updateRow(TABS.INVOICES, matchCol, matchVal, d),
};

const QueryLog = { append: logQuery };
const ErrorLog = { append: logError };

module.exports = {
  // Primitives
  getHeaders,
  readSheet,
  appendRow,
  updateRow,
  findRow,
  TABS,

  // Domain functions
  getAllClients,
  getClientByPhone,
  getClientById,
  addClient,
  getAllCompliance,
  getComplianceForClient,
  updateComplianceStatus,
  getAllDocuments,
  getDocumentsForClient,
  updateDocumentStatus,
  getAllInvoices,
  updateInvoiceStatus,
  getOverdueInvoices,
  getAllLeads,
  addLead,
  updateLeadStatus,
  logQuery,
  logError,

  // Compatibility objects
  Clients,
  Leads,
  Compliance,
  Documents,
  Invoices,
  QueryLog,
  ErrorLog,
};
