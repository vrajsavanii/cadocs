// setup-sheets.js
// Run this ONCE to create all 7 tabs with correct headers in your Google Sheet
// Usage: node setup-sheets.js

require('dotenv').config();
const { google } = require('googleapis');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY
  ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n')
  : null;

// All 7 tabs with their exact column headers as per Master Build Plan
const TABS = [
  {
    name: 'Clients',
    headers: ['client_id', 'name', 'phone', 'email', 'entity_type', 'gst_number', 'pan', 'created_at'],
    sample: ['CLIENT-001', 'Mehta Textiles Pvt Ltd', '919876543210', 'mehta@example.com', 'Private Limited', '27AABCM1234F1Z5', 'AABCM1234F', new Date().toISOString()],
  },
  {
    name: 'Leads',
    headers: ['lead_id', 'name', 'phone', 'email', 'source', 'requirement', 'business_type', 'urgency', 'qualification_score', 'status', 'followup_date', 'followup_attempts', 'created_at', 'notes'],
    sample: ['LEAD-001', 'Sunita Agarwal', '919812345678', 'sunita@example.com', 'WhatsApp', 'GST Registration', 'Proprietorship', 'High', 'Hot', 'New', '', '0', new Date().toISOString(), 'Wants GST done urgently for Amazon seller account'],
  },
  {
    name: 'Compliance_Calendar',
    headers: ['compliance_id', 'client_id', 'client_name', 'phone', 'email', 'compliance_type', 'due_date', 'status', 'reminder_count', 'last_reminder_date'],
    sample: ['COMP-001', 'CLIENT-001', 'Mehta Textiles Pvt Ltd', '919876543210', 'mehta@example.com', 'GSTR-3B', '2026-09-20', 'Pending', '0', ''],
  },
  {
    name: 'Documents_Tracker',
    headers: ['doc_id', 'client_id', 'client_name', 'phone', 'email', 'compliance_type', 'document_name', 'requested_date', 'status', 'received_date', 'followup_count', 'last_followup_date'],
    sample: ['DOC-001', 'CLIENT-001', 'Mehta Textiles Pvt Ltd', '919876543210', 'mehta@example.com', 'GSTR-3B', 'Monthly Bank Statement', new Date().toISOString(), 'Pending', '', '0', ''],
  },
  {
    name: 'Invoices',
    headers: ['invoice_id', 'client_id', 'client_name', 'phone', 'email', 'amount', 'currency', 'due_date', 'status', 'reminder_count', 'last_reminder_date', 'escalated'],
    sample: ['INV-001', 'CLIENT-001', 'Mehta Textiles Pvt Ltd', '919876543210', 'mehta@example.com', '25000', 'INR', '2026-09-30', 'Unpaid', '0', '', 'No'],
  },
  {
    name: 'Query_Log',
    headers: ['log_id', 'client_id', 'phone', 'email', 'channel', 'query_text', 'ai_response', 'timestamp'],
    sample: [],
  },
  {
    name: 'Error_Log',
    headers: ['error_id', 'workflow_name', 'node_name', 'error_message', 'timestamp'],
    sample: [],
  },
];

async function setup() {
  console.log('\n🚀 CA Firm — Google Sheets Setup');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  if (!SHEET_ID || !SERVICE_ACCOUNT_EMAIL || !PRIVATE_KEY) {
    console.error('❌ Missing keys in .env! Check GOOGLE_SHEET_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY');
    process.exit(1);
  }

  const auth = new google.auth.JWT(SERVICE_ACCOUNT_EMAIL, null, PRIVATE_KEY, [
    'https://www.googleapis.com/auth/spreadsheets',
  ]);
  const sheets = google.sheets({ version: 'v4', auth });

  console.log('🔑 Testing Google Sheets connection...');
  let spreadsheet;
  try {
    const res = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
    spreadsheet = res.data;
    console.log(`✅ Connected! Sheet: "${spreadsheet.properties.title}"\n`);
  } catch (err) {
    console.error('❌ Connection FAILED:', err.message);
    process.exit(1);
  }

  const existingTabs = spreadsheet.sheets.map((s) => s.properties.title);
  console.log('📋 Existing tabs:', existingTabs.join(', ') || '(none)');
  console.log('');

  for (const tab of TABS) {
    process.stdout.write(`⚙️  Setting up "${tab.name}"... `);

    try {
      if (!existingTabs.includes(tab.name)) {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: SHEET_ID,
          requestBody: {
            requests: [{ addSheet: { properties: { title: tab.name } } }],
          },
        });
      }

      // Write headers in Row 1
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${tab.name}!A1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [tab.headers] },
      });

      console.log('✅ Ready');
    } catch (err) {
      console.log(`❌ Error: ${err.message}`);
    }
  }

  console.log('\n🎉 Setup complete! All 7 tabs initialized with standard headers.\n');
}

if (require.main === module) {
  setup();
}

module.exports = { setup, TABS };
