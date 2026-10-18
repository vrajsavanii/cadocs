// seed-50-clients.js
// Generates and inserts 50 realistic Indian CA Firm clients and their compliance, documents & invoices
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

// 50 realistic Indian CA practice clients
const CLIENT_NAMES = [
  'Apex BioTech Pharma Pvt Ltd',
  'Zenith Solar Systems Pvt Ltd',
  'Shree Mahavir Textiles & Fabrics',
  'Kothari Gems & Jewels LLP',
  'Nova Infotech Solutions Pvt Ltd',
  'Bhavani Steel & Hardware Corp',
  'Dr. Ananya Mukherjee (Cardiologist)',
  'Patel Express Logistics LLP',
  'Sunstone Realty & Infrastructure',
  'Royal Confectioneries Pvt Ltd',
  'Aura Diagnostic Healthcare Ltd',
  'Paramount Paper & Packaging LLP',
  'Verma & Sons Auto Components',
  'Orbit Cloud Services Pvt Ltd',
  'Falcon Polymer Chemicals Ltd',
  'Shree Ganesh Engineering Works',
  'Kavita Nambiar (Design Studio)',
  'BlueSky Agro Export Pvt Ltd',
  'Singhania Ceramic Industries LLP',
  'Arun Joshi (Architect & Associates)',
  'Vibrant Packaging Solutions',
  'Balaji Electricals & Electronics',
  'Zenith Retail Mart Pvt Ltd',
  'Pooja Sethi (Fashion Designer)',
  'Mahalaxmi Cement Traders LLP',
  'Falcon Cold Storage & Logistics',
  'Deepak Deshmukh (IT Consultant)',
  'Sterling Precision Tools Ltd',
  'Siddhivinayak Construction Co',
  'GreenField Organic Organics Ltd',
  'Navrang Silk Mills Surat',
  'Pioneer Rubber & Tyre Industries',
  'Rohan Mehra (Digital Creator)',
  'Alankar Jewellers Pvt Ltd',
  'Krishna Dairy & Agro Products',
  'Saffron Hospitality & Resorts',
  'Om Sai Automobile Spares',
  'Dr. Vikram Salunkhe (Orthopedic)',
  'Trinity Security Services LLP',
  'Swastik Wood & Plywood Traders',
  'Vanguard Aerospace Parts Ltd',
  'Sneha Roy (Corporate Counsel)',
  'Maruti Transport Carriers Co',
  'SilverLine Metal Casting LLP',
  'Prestige Printing Press Pvt Ltd',
  'Adarsh Chemical Lab & Research',
  'Surat Diamond Cutters LLP',
  'Shivaay Global Logistics Ltd',
  'Rajesh Export House Pvt Ltd',
  'Classic Garments & Apparels LLP'
];

const COMPLIANCE_TYPES = [
  { type: 'GSTR-3B (August 2026)', due: '2026-09-20', doc: 'Monthly Bank Statement' },
  { type: 'GSTR-1 (August 2026)', due: '2026-09-11', doc: 'Sales Register & Invoices' },
  { type: 'Advance Tax Q2 (AY 2027)', due: '2026-09-15', doc: 'Estimated P&L Statement' },
  { type: 'Tax Audit Sec 44AB', due: '2026-09-30', doc: 'Audited Financials & Ledger' },
  { type: 'TDS Return 26Q (Q2)', due: '2026-10-31', doc: 'TDS Deduction Challans' },
  { type: 'ROC AOC-4 (Financials)', due: '2026-10-30', doc: 'Director Report & Balance Sheet' },
  { type: 'ITR-3 / 4 (Business)', due: '2026-10-31', doc: 'Form 26AS & AIS/TIS' },
  { type: 'ROC MGT-7 (Annual Return)', due: '2026-11-30', doc: 'Shareholding Pattern List' }
];

async function seed() {
  console.log('\n🚀 Seeding 50 Realistic CA Firm Clients into Google Sheets...');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const sheets = getSheetsClient();

  const clientRows = [];
  const complianceRows = [];
  const docRows = [];
  const invoiceRows = [];

  const baseDate = new Date('2026-09-01');

  CLIENT_NAMES.forEach((name, idx) => {
    const num = idx + 2; // starting after CLIENT-001
    const clientId = `CLIENT-${String(num).padStart(3, '0')}`;
    const phone = `9198${String(10000000 + idx * 14321).slice(0, 8)}`;
    const cleanName = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const email = `${cleanName.slice(0, 10)}@example.com`;
    const createdAt = new Date(baseDate.getTime() - idx * 86400000 * 3).toISOString();

    // 1. Clients Tab
    clientRows.push([clientId, name, phone, email, createdAt]);

    // 2. Compliance Tab (assign 1 or 2 compliance items)
    const compIdx = idx % COMPLIANCE_TYPES.length;
    const compItem = COMPLIANCE_TYPES[compIdx];
    const compId = `COMP-${String(num).padStart(3, '0')}`;
    const compStatus = idx % 5 === 0 ? 'Filed' : 'Pending';
    const reminderCount = String(idx % 3);
    const lastReminder = reminderCount > 0 ? '2026-09-08' : '';

    complianceRows.push([
      compId,
      clientId,
      name,
      phone,
      email,
      compItem.type,
      compItem.due,
      compStatus,
      reminderCount,
      lastReminder
    ]);

    // 3. Documents Tracker Tab
    const docId = `DOC-${String(num).padStart(3, '0')}`;
    const docStatus = idx % 3 === 0 ? 'Received' : 'Pending';
    const recDate = docStatus === 'Received' ? '2026-09-07' : '';
    const followupCount = String(docStatus === 'Pending' ? (idx % 3) + 1 : 0);

    docRows.push([
      docId,
      clientId,
      name,
      phone,
      email,
      compItem.type,
      compItem.doc,
      createdAt,
      docStatus,
      recDate,
      followupCount,
      docStatus === 'Pending' ? '2026-09-09' : ''
    ]);

    // 4. Invoices Tab (assign retainership/audit billing)
    const invId = `INV-${String(num).padStart(3, '0')}`;
    const amounts = ['12000', '18000', '25000', '35000', '50000', '75000', '15000'];
    const amount = amounts[idx % amounts.length];
    const invStatus = idx % 4 === 0 ? 'Paid' : 'Unpaid';
    const dueDate = idx % 6 === 0 ? '2026-08-31' : '2026-09-30'; // some overdue
    const invReminders = invStatus === 'Unpaid' ? String((idx % 3) + 1) : '0';

    invoiceRows.push([
      invId,
      clientId,
      name,
      phone,
      email,
      amount,
      'INR',
      dueDate,
      invStatus,
      invReminders,
      invStatus === 'Unpaid' ? '2026-09-10' : '',
      dueDate < '2026-09-15' && invStatus === 'Unpaid' ? 'Yes' : 'No'
    ]);
  });

  // Append in batch to each tab
  console.log(`Adding ${clientRows.length} rows to "Clients"...`);
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: 'Clients!A1',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: clientRows },
  });

  console.log(`Adding ${complianceRows.length} rows to "Compliance_Calendar"...`);
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: 'Compliance_Calendar!A1',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: complianceRows },
  });

  console.log(`Adding ${docRows.length} rows to "Documents_Tracker"...`);
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: 'Documents_Tracker!A1',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: docRows },
  });

  console.log(`Adding ${invoiceRows.length} rows to "Invoices"...`);
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: 'Invoices!A1',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: invoiceRows },
  });

  console.log('\n✅ SUCCESS: 50 Clients, 50 Compliance filings, 50 Documents, and 50 Invoices added to Google Sheets!\n');
}

seed().catch(err => {
  console.error('❌ Seeding error:', err.message);
  process.exit(1);
});
