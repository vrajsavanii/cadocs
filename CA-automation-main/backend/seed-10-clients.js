// seed-10-clients.js
// Clears all existing rows (from row 2 down) and seeds exactly 10 realistic Indian CA Firm clients
require('dotenv').config();
const { google } = require('googleapis');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY
  ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n')
  : null;

function getSheetsClient() {
  const auth = new google.auth.JWT(
    SERVICE_ACCOUNT_EMAIL,
    null,
    PRIVATE_KEY,
    ['https://www.googleapis.com/auth/spreadsheets']
  );
  return google.sheets({ version: 'v4', auth });
}

// 10 realistic Indian CA practice clients
const TEN_CLIENTS = [
  {
    id: 'CLIENT-001',
    name: 'Mehta Textiles Pvt Ltd',
    phone: '919876543210',
    email: 'ramesh@mehtatextiles.com',
    entity: 'Private Limited',
    compType: 'GSTR-3B (August 2026)',
    compDue: '2026-09-20',
    compStatus: 'Pending',
    compReminders: '2',
    compLastRem: '2026-09-12',
    docName: 'Monthly Bank Statement',
    docStatus: 'Pending',
    docFollowups: '2',
    invAmount: '25000',
    invDue: '2026-09-15',
    invStatus: 'Unpaid',
    invReminders: '2'
  },
  {
    id: 'CLIENT-002',
    name: 'Apex BioTech Pharma Pvt Ltd',
    phone: '919820011223',
    email: 'accounts@apexbiotech.in',
    entity: 'Private Limited',
    compType: 'ROC AOC-4 (Financials)',
    compDue: '2026-10-30',
    compStatus: 'Pending',
    compReminders: '0',
    compLastRem: '',
    docName: 'Audited Financials & Ledger',
    docStatus: 'Received',
    docFollowups: '0',
    invAmount: '50000',
    invDue: '2026-09-30',
    invStatus: 'Paid',
    invReminders: '0'
  },
  {
    id: 'CLIENT-003',
    name: 'Zenith Solar Systems Pvt Ltd',
    phone: '919833445566',
    email: 'finance@zenithsolar.com',
    entity: 'Private Limited',
    compType: 'Tax Audit Sec 44AB',
    compDue: '2026-09-30',
    compStatus: 'Pending',
    compReminders: '1',
    compLastRem: '2026-09-10',
    docName: 'Depreciation & Asset Register',
    docStatus: 'Pending',
    docFollowups: '1',
    invAmount: '35000',
    invDue: '2026-08-31',
    invStatus: 'Unpaid',
    invReminders: '3'
  },
  {
    id: 'CLIENT-004',
    name: 'Shree Mahavir Textiles & Fabrics',
    phone: '919844556677',
    email: 'mahavir.textiles@gmail.com',
    entity: 'Proprietorship',
    compType: 'GSTR-1 (August 2026)',
    compDue: '2026-09-11',
    compStatus: 'Filed',
    compReminders: '1',
    compLastRem: '2026-09-08',
    docName: 'Sales Register & Invoices',
    docStatus: 'Received',
    docFollowups: '0',
    invAmount: '12000',
    invDue: '2026-09-10',
    invStatus: 'Paid',
    invReminders: '0'
  },
  {
    id: 'CLIENT-005',
    name: 'Kothari Gems & Jewels LLP',
    phone: '919855667788',
    email: 'tax@kotharigems.com',
    entity: 'LLP',
    compType: 'Advance Tax Q2 (AY 2027)',
    compDue: '2026-09-15',
    compStatus: 'Pending',
    compReminders: '3',
    compLastRem: '2026-09-14',
    docName: 'Estimated P&L Statement',
    docStatus: 'Pending',
    docFollowups: '3',
    invAmount: '45000',
    invDue: '2026-09-25',
    invStatus: 'Unpaid',
    invReminders: '1'
  },
  {
    id: 'CLIENT-006',
    name: 'Nova Infotech Solutions Pvt Ltd',
    phone: '919866778899',
    email: 'billing@novainfotech.io',
    entity: 'Private Limited',
    compType: 'TDS Return 26Q (Q2)',
    compDue: '2026-10-31',
    compStatus: 'Pending',
    compReminders: '0',
    compLastRem: '',
    docName: 'TDS Challans & Salary Sheets',
    docStatus: 'Received',
    docFollowups: '0',
    invAmount: '60000',
    invDue: '2026-10-05',
    invStatus: 'Paid',
    invReminders: '0'
  },
  {
    id: 'CLIENT-007',
    name: 'Bhavani Steel & Hardware Corp',
    phone: '919877889900',
    email: 'bhavanisteel.corp@yahoo.co.in',
    entity: 'Partnership',
    compType: 'GSTR-3B (August 2026)',
    compDue: '2026-09-20',
    compStatus: 'Pending',
    compReminders: '2',
    compLastRem: '2026-09-12',
    docName: 'Monthly Bank Statement',
    docStatus: 'Pending',
    docFollowups: '2',
    invAmount: '18000',
    invDue: '2026-09-05',
    invStatus: 'Unpaid',
    invReminders: '2'
  },
  {
    id: 'CLIENT-008',
    name: 'Dr. Ananya Mukherjee',
    phone: '919888990011',
    email: 'dr.ananya.cardio@gmail.com',
    entity: 'Individual',
    compType: 'ITR-3 / 4 (Business/Prof)',
    compDue: '2026-10-31',
    compStatus: 'Pending',
    compReminders: '0',
    compLastRem: '',
    docName: 'Form 26AS & AIS/TIS Statement',
    docStatus: 'Received',
    docFollowups: '0',
    invAmount: '15000',
    invDue: '2026-09-20',
    invStatus: 'Paid',
    invReminders: '0'
  },
  {
    id: 'CLIENT-009',
    name: 'Patel Express Logistics LLP',
    phone: '919899001122',
    email: 'accounts@patelexpress.net',
    entity: 'LLP',
    compType: 'Tax Audit Sec 44AB',
    compDue: '2026-09-30',
    compStatus: 'Pending',
    compReminders: '1',
    compLastRem: '2026-09-11',
    docName: 'Stock Statement & Vehicle Ledger',
    docStatus: 'Pending',
    docFollowups: '1',
    invAmount: '30000',
    invDue: '2026-09-18',
    invStatus: 'Unpaid',
    invReminders: '1'
  },
  {
    id: 'CLIENT-010',
    name: 'Sunstone Realty & Infrastructure Pvt Ltd',
    phone: '919811223344',
    email: 'director@sunstonerealty.in',
    entity: 'Private Limited',
    compType: 'ROC MGT-7 (Annual Return)',
    compDue: '2026-11-30',
    compStatus: 'Pending',
    compReminders: '2',
    compLastRem: '2026-09-10',
    docName: 'Shareholding Pattern & Minutes',
    docStatus: 'Pending',
    docFollowups: '2',
    invAmount: '75000',
    invDue: '2026-08-25',
    invStatus: 'Unpaid',
    invReminders: '3'
  }
];

async function seed10() {
  console.log('\n🧹 Clearing old dummy rows and adding ONLY 10 clients...');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const sheets = getSheetsClient();

  // 1. Clear old data from row 2 onwards in all 4 tabs
  const tabsToClear = ['Clients', 'Compliance_Calendar', 'Documents_Tracker', 'Invoices'];
  for (const tab of tabsToClear) {
    console.log(`Clearing ${tab}!A2:Z200...`);
    try {
      await sheets.spreadsheets.values.clear({
        spreadsheetId: SHEET_ID,
        range: `${tab}!A2:Z200`,
      });
    } catch (e) {
      console.warn(`Warning clearing ${tab}:`, e.message);
    }
  }

  // 2. Prepare new rows
  const clientRows = [];
  const complianceRows = [];
  const docRows = [];
  const invoiceRows = [];

  const baseDate = new Date('2026-09-01');

  TEN_CLIENTS.forEach((c, idx) => {
    const createdAt = new Date(baseDate.getTime() - idx * 86400000 * 3).toISOString();

    // Clients tab: client_id, name, phone, email, created_at
    clientRows.push([
      c.id,
      c.name,
      c.phone,
      c.email,
      createdAt
    ]);

    // Compliance tab: compliance_id, client_id, client_name, client_phone, client_email, compliance_type, due_date, status, reminder_count, last_reminder_sent
    complianceRows.push([
      `COMP-${String(idx + 1).padStart(3, '0')}`,
      c.id,
      c.name,
      c.phone,
      c.email,
      c.compType,
      c.compDue,
      c.compStatus,
      c.compReminders,
      c.compLastRem
    ]);

    // Documents tab: doc_id, client_id, client_name, client_phone, client_email, compliance_type, document_name, requested_at, status, received_at, follow_up_count, last_followup_at
    docRows.push([
      `DOC-${String(idx + 1).padStart(3, '0')}`,
      c.id,
      c.name,
      c.phone,
      c.email,
      c.compType,
      c.docName,
      createdAt,
      c.docStatus,
      c.docStatus === 'Received' ? '2026-09-08' : '',
      c.docFollowups,
      c.docStatus === 'Pending' ? '2026-09-12' : ''
    ]);

    // Invoices tab: invoice_id, client_id, client_name, client_phone, client_email, amount, currency, due_date, status, reminder_count, last_reminder_sent, escalated
    invoiceRows.push([
      `INV-${String(idx + 1).padStart(3, '0')}`,
      c.id,
      c.name,
      c.phone,
      c.email,
      c.invAmount,
      'INR',
      c.invDue,
      c.invStatus,
      c.invReminders,
      c.invStatus === 'Unpaid' ? '2026-09-10' : '',
      c.invDue < '2026-09-15' && c.invStatus === 'Unpaid' ? 'Yes' : 'No'
    ]);
  });

  // 3. Write rows to Google Sheets
  console.log(`Writing 10 rows to "Clients"...`);
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: 'Clients!A2',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: clientRows },
  });

  console.log(`Writing 10 rows to "Compliance_Calendar"...`);
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: 'Compliance_Calendar!A2',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: complianceRows },
  });

  console.log(`Writing 10 rows to "Documents_Tracker"...`);
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: 'Documents_Tracker!A2',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: docRows },
  });

  console.log(`Writing 10 rows to "Invoices"...`);
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: 'Invoices!A2',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: invoiceRows },
  });

  console.log('\n✅ SUCCESS: Cleared old 50 records and seeded exactly 10 clients into Google Sheets!\n');
}

seed10().catch(err => {
  console.error('❌ Seeding error:', err.message);
  process.exit(1);
});
