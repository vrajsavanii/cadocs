// backend/scripts/seedGoogleSheets.js
// Seeds 20 authentic Indian CA clients + linked Compliance, Documents, and Invoices directly to Google Sheets

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
require('dotenv').config();
const { google } = require('googleapis');

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID;

if (!SPREADSHEET_ID) {
  console.error('❌ GOOGLE_SHEET_ID is missing from environment');
  process.exit(1);
}

const auth = new google.auth.JWT(
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  null,
  process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  ['https://www.googleapis.com/auth/spreadsheets']
);

const sheets = google.sheets({ version: 'v4', auth });

const CLIENTS_DATA = [
  {
    client_id: 'CLIENT-001',
    name: 'Mehta Textiles Pvt Ltd',
    phone: '919876543210',
    email: 'ramesh@mehtatextiles.com',
    entity_type: 'Private Limited',
    gst_number: '27AABCM1234F1Z5',
    pan: 'AABCM1234F',
    contact_person: 'Ramesh Mehta (Director)',
    created_at: '2026-08-01T10:00:00.000Z'
  },
  {
    client_id: 'CLIENT-002',
    name: 'Apex BioTech Pharma Pvt Ltd',
    phone: '919820011223',
    email: 'accounts@apexbiotech.in',
    entity_type: 'Private Limited',
    gst_number: '27AAACA5678B1Z2',
    pan: 'AAACA5678B',
    contact_person: 'Dr. Rajesh Patel (MD)',
    created_at: '2026-08-03T11:30:00.000Z'
  },
  {
    client_id: 'CLIENT-003',
    name: 'Zenith Solar Systems Pvt Ltd',
    phone: '919833445566',
    email: 'finance@zenithsolar.com',
    entity_type: 'Private Limited',
    gst_number: '24AABCZ9012K1Z9',
    pan: 'AABCZ9012K',
    contact_person: 'Sameer Joshi (CFO)',
    created_at: '2026-08-05T09:15:00.000Z'
  },
  {
    client_id: 'CLIENT-004',
    name: 'Shree Mahavir Textiles & Fabrics',
    phone: '919844556677',
    email: 'mahavir.textiles@gmail.com',
    entity_type: 'Proprietorship',
    gst_number: '24AAYPS4512A1ZQ',
    pan: 'AAYPS4512A',
    contact_person: 'Bhavesh Shah (Proprietor)',
    created_at: '2026-08-07T14:20:00.000Z'
  },
  {
    client_id: 'CLIENT-005',
    name: 'Kothari Gems & Jewels LLP',
    phone: '919855667788',
    email: 'tax@kotharigems.com',
    entity_type: 'LLP',
    gst_number: '27AAAFK8821N1Z3',
    pan: 'AAAFK8821N',
    contact_person: 'Suresh Kothari (Designated Partner)',
    created_at: '2026-08-09T16:45:00.000Z'
  },
  {
    client_id: 'CLIENT-006',
    name: 'Nova Infotech Solutions Pvt Ltd',
    phone: '919866778899',
    email: 'billing@novainfotech.io',
    entity_type: 'Private Limited',
    gst_number: '29AAACN3412L1Z8',
    pan: 'AAACN3412L',
    contact_person: 'Amitava Roy (Director)',
    created_at: '2026-08-11T12:00:00.000Z'
  },
  {
    client_id: 'CLIENT-007',
    name: 'Bhavani Steel & Hardware Corp',
    phone: '919877889900',
    email: 'bhavanisteel.corp@yahoo.co.in',
    entity_type: 'Proprietorship',
    gst_number: '27AAUPB9102K1ZP',
    pan: 'AAUPB9102K',
    contact_person: 'Naresh Agarwal (Proprietor)',
    created_at: '2026-08-13T10:10:00.000Z'
  },
  {
    client_id: 'CLIENT-008',
    name: 'Dr. Ananya Mukherjee',
    phone: '919888990011',
    email: 'dr.ananya.cardio@gmail.com',
    entity_type: 'Individual / Consultant',
    gst_number: 'Exempt (Healthcare Services)',
    pan: 'ABMPM5521R',
    contact_person: 'Dr. Ananya Mukherjee (Cardiologist)',
    created_at: '2026-08-15T15:30:00.000Z'
  },
  {
    client_id: 'CLIENT-009',
    name: 'Patel Express Logistics LLP',
    phone: '919899001122',
    email: 'accounts@patelexpress.net',
    entity_type: 'LLP',
    gst_number: '24AAAFP7120G1ZX',
    pan: 'AAAFP7120G',
    contact_person: 'Ketan Patel (Managing Partner)',
    created_at: '2026-08-17T09:40:00.000Z'
  },
  {
    client_id: 'CLIENT-010',
    name: 'Sunstone Realty & Infrastructure Pvt Ltd',
    phone: '919811223344',
    email: 'director@sunstonerealty.in',
    entity_type: 'Private Limited',
    gst_number: '27AAACS1890D1Z1',
    pan: 'AAACS1890D',
    contact_person: 'Vikram Deshmukh (Managing Director)',
    created_at: '2026-08-19T11:00:00.000Z'
  },
  {
    client_id: 'CLIENT-011',
    name: 'Nexus FinTech Technologies LLP',
    phone: '919711033490',
    email: 'vikram@nexusfintech.co',
    entity_type: 'LLP',
    gst_number: '24AAACN9876E1Z2',
    pan: 'AAACN9876E',
    contact_person: 'Vikram Mehta (Designated Partner)',
    created_at: '2026-08-21T13:20:00.000Z'
  },
  {
    client_id: 'CLIENT-012',
    name: 'Agarwal Tex-Fab',
    phone: '919821099881',
    email: 'sunita@agarwaltexfab.in',
    entity_type: 'Proprietorship',
    gst_number: '27AEEPA9923H1Z4',
    pan: 'AEEPA9923H',
    contact_person: 'Sunita Agarwal (Proprietor)',
    created_at: '2026-08-23T14:45:00.000Z'
  },
  {
    client_id: 'CLIENT-013',
    name: 'Sharma Consulting Services',
    phone: '919930278120',
    email: 'priya@sharmaconsulting.co',
    entity_type: 'Individual / Consultant',
    gst_number: '27BPYPS4412K1Z6',
    pan: 'BPYPS4412K',
    contact_person: 'Priya Sharma (Principal Consultant)',
    created_at: '2026-08-25T10:30:00.000Z'
  },
  {
    client_id: 'CLIENT-014',
    name: 'Gupta Hardware & Sanitary Ware',
    phone: '919845011982',
    email: 'harish@guptahardware.in',
    entity_type: 'Proprietorship',
    gst_number: '29AAACG5521L1Z9',
    pan: 'AAACG5521L',
    contact_person: 'Harish Gupta (Proprietor)',
    created_at: '2026-08-27T16:00:00.000Z'
  },
  {
    client_id: 'CLIENT-015',
    name: 'BlueOcean Hospitality & Resorts LLP',
    phone: '919822334455',
    email: 'finance@blueoceanresorts.com',
    entity_type: 'LLP',
    gst_number: '27AAAFB4432Q1ZY',
    pan: 'AAAFB4432Q',
    contact_person: 'Tarun Singhania (Partner)',
    created_at: '2026-08-29T11:15:00.000Z'
  },
  {
    client_id: 'CLIENT-016',
    name: 'GreenField Agro Chemicals Pvt Ltd',
    phone: '919833221100',
    email: 'accounts@greenfieldagro.com',
    entity_type: 'Private Limited',
    gst_number: '24AAACG3312J1ZK',
    pan: 'AAACG3312J',
    contact_person: 'Mohanlal Choudhary (Director)',
    created_at: '2026-08-31T12:40:00.000Z'
  },
  {
    client_id: 'CLIENT-017',
    name: 'Royal Heritage Caterers & Banquets',
    phone: '919871122334',
    email: 'jaspreet@royalheritagebanquets.com',
    entity_type: 'Partnership',
    gst_number: '07AABFR9988M1Z7',
    pan: 'AABFR9988M',
    contact_person: 'Jaspreet Singh (Managing Partner)',
    created_at: '2026-09-02T14:10:00.000Z'
  },
  {
    client_id: 'CLIENT-018',
    name: 'Aura Architecture & Interior Studio',
    phone: '919890123456',
    email: 'neha@aurastudio.in',
    entity_type: 'Partnership',
    gst_number: '27AAKFA7766B1Z0',
    pan: 'AAKFA7766B',
    contact_person: 'Ar. Neha Kulkarni (Principal Architect)',
    created_at: '2026-09-04T15:00:00.000Z'
  },
  {
    client_id: 'CLIENT-019',
    name: 'SwiftLogix Cold Chain Solutions Pvt Ltd',
    phone: '919840987654',
    email: 'ops@swiftlogix.in',
    entity_type: 'Private Limited',
    gst_number: '33AAACS6655P1ZB',
    pan: 'AAACS6655P',
    contact_person: 'Rakesh Nambiar (COO)',
    created_at: '2026-09-06T10:00:00.000Z'
  },
  {
    client_id: 'CLIENT-020',
    name: 'Vanguard Precision Engineering Pvt Ltd',
    phone: '919810554433',
    email: 'dverma@vanguardprecision.in',
    entity_type: 'Private Limited',
    gst_number: '06AAACV1298N1ZV',
    pan: 'AAACV1298N',
    contact_person: 'Deepak Verma (Managing Director)',
    created_at: '2026-09-08T11:45:00.000Z'
  }
];

const COMPLIANCE_DATA = [
  { compliance_id: 'COMP-001', client_id: 'CLIENT-001', client_name: 'Mehta Textiles Pvt Ltd', phone: '919876543210', email: 'ramesh@mehtatextiles.com', compliance_type: 'GSTR-3B (August 2026)', due_date: '2026-09-20', status: 'Pending', reminder_count: '2', last_reminder_date: '2026-09-17' },
  { compliance_id: 'COMP-002', client_id: 'CLIENT-001', client_name: 'Mehta Textiles Pvt Ltd', phone: '919876543210', email: 'ramesh@mehtatextiles.com', compliance_type: 'DRC-01A Notice Reply', due_date: '2026-09-25', status: 'Pending', reminder_count: '1', last_reminder_date: '2026-09-18' },
  { compliance_id: 'COMP-003', client_id: 'CLIENT-002', client_name: 'Apex BioTech Pharma Pvt Ltd', phone: '919820011223', email: 'accounts@apexbiotech.in', compliance_type: 'GSTR-3B (August 2026)', due_date: '2026-09-20', status: 'Pending', reminder_count: '1', last_reminder_date: '2026-09-16' },
  { compliance_id: 'COMP-004', client_id: 'CLIENT-002', client_name: 'Apex BioTech Pharma Pvt Ltd', phone: '919820011223', email: 'accounts@apexbiotech.in', compliance_type: 'Tax Audit Sec 44AB', due_date: '2026-09-30', status: 'Pending', reminder_count: '2', last_reminder_date: '2026-09-15' },
  { compliance_id: 'COMP-005', client_id: 'CLIENT-003', client_name: 'Zenith Solar Systems Pvt Ltd', phone: '919833445566', email: 'finance@zenithsolar.com', compliance_type: 'Advance Tax Q2 (AY 2027)', due_date: '2026-09-15', status: 'Pending', reminder_count: '3', last_reminder_date: '2026-09-17' },
  { compliance_id: 'COMP-006', client_id: 'CLIENT-003', client_name: 'Zenith Solar Systems Pvt Ltd', phone: '919833445566', email: 'finance@zenithsolar.com', compliance_type: 'GSTR-3B (August 2026)', due_date: '2026-09-20', status: 'Pending', reminder_count: '1', last_reminder_date: '2026-09-16' },
  { compliance_id: 'COMP-007', client_id: 'CLIENT-004', client_name: 'Shree Mahavir Textiles & Fabrics', phone: '919844556677', email: 'mahavir.textiles@gmail.com', compliance_type: 'GSTR-3B (August 2026)', due_date: '2026-09-20', status: 'Filed', reminder_count: '1', last_reminder_date: '2026-09-12' },
  { compliance_id: 'COMP-008', client_id: 'CLIENT-005', client_name: 'Kothari Gems & Jewels LLP', phone: '919855667788', email: 'tax@kotharigems.com', compliance_type: 'Tax Audit Sec 44AB', due_date: '2026-09-30', status: 'Pending', reminder_count: '2', last_reminder_date: '2026-09-14' },
  { compliance_id: 'COMP-009', client_id: 'CLIENT-005', client_name: 'Kothari Gems & Jewels LLP', phone: '919855667788', email: 'tax@kotharigems.com', compliance_type: 'Advance Tax Q2 (AY 2027)', due_date: '2026-09-15', status: 'Filed', reminder_count: '1', last_reminder_date: '2026-09-10' },
  { compliance_id: 'COMP-010', client_id: 'CLIENT-006', client_name: 'Nova Infotech Solutions Pvt Ltd', phone: '919866778899', email: 'billing@novainfotech.io', compliance_type: 'TDS Return Form 26Q (Q2)', due_date: '2026-10-31', status: 'Pending', reminder_count: '0', last_reminder_date: '' },
  { compliance_id: 'COMP-011', client_id: 'CLIENT-006', client_name: 'Nova Infotech Solutions Pvt Ltd', phone: '919866778899', email: 'billing@novainfotech.io', compliance_type: 'GSTR-3B (August 2026)', due_date: '2026-09-20', status: 'Filed', reminder_count: '1', last_reminder_date: '2026-09-15' },
  { compliance_id: 'COMP-012', client_id: 'CLIENT-007', client_name: 'Bhavani Steel & Hardware Corp', phone: '919877889900', email: 'bhavanisteel.corp@yahoo.co.in', compliance_type: 'GSTR-3B (August 2026)', due_date: '2026-09-20', status: 'Pending', reminder_count: '2', last_reminder_date: '2026-09-17' },
  { compliance_id: 'COMP-013', client_id: 'CLIENT-008', client_name: 'Dr. Ananya Mukherjee', phone: '919888990011', email: 'dr.ananya.cardio@gmail.com', compliance_type: 'ITR-3 Professional AY 2026-27', due_date: '2026-10-31', status: 'Pending', reminder_count: '1', last_reminder_date: '2026-09-10' },
  { compliance_id: 'COMP-014', client_id: 'CLIENT-009', client_name: 'Patel Express Logistics LLP', phone: '919899001122', email: 'accounts@patelexpress.net', compliance_type: 'GSTR-3B (August 2026)', due_date: '2026-09-20', status: 'Pending', reminder_count: '1', last_reminder_date: '2026-09-16' },
  { compliance_id: 'COMP-015', client_id: 'CLIENT-010', client_name: 'Sunstone Realty & Infrastructure Pvt Ltd', phone: '919811223344', email: 'director@sunstonerealty.in', compliance_type: 'ROC Form AOC-4 (FY26)', due_date: '2026-10-30', status: 'Pending', reminder_count: '1', last_reminder_date: '2026-09-12' },
  { compliance_id: 'COMP-016', client_id: 'CLIENT-011', client_name: 'Nexus FinTech Technologies LLP', phone: '919711033490', email: 'vikram@nexusfintech.co', compliance_type: 'Form 11 Annual Return', due_date: '2026-10-15', status: 'Pending', reminder_count: '1', last_reminder_date: '2026-09-14' },
  { compliance_id: 'COMP-017', client_id: 'CLIENT-012', client_name: 'Agarwal Tex-Fab', phone: '919821099881', email: 'sunita@agarwaltexfab.in', compliance_type: 'New GST Registration', due_date: '2026-09-25', status: 'Pending', reminder_count: '1', last_reminder_date: '2026-09-18' },
  { compliance_id: 'COMP-018', client_id: 'CLIENT-013', client_name: 'Sharma Consulting Services', phone: '919930278120', email: 'priya@sharmaconsulting.co', compliance_type: 'ITR-1 AY 2026-27', due_date: '2026-07-31', status: 'Filed', reminder_count: '1', last_reminder_date: '2026-07-24' },
  { compliance_id: 'COMP-019', client_id: 'CLIENT-014', client_name: 'Gupta Hardware & Sanitary Ware', phone: '919845011982', email: 'harish@guptahardware.in', compliance_type: 'GSTR-3B (August 2026)', due_date: '2026-09-20', status: 'Pending', reminder_count: '2', last_reminder_date: '2026-09-17' },
  { compliance_id: 'COMP-020', client_id: 'CLIENT-015', client_name: 'BlueOcean Hospitality & Resorts LLP', phone: '919822334455', email: 'finance@blueoceanresorts.com', compliance_type: 'GSTR-3B (August 2026)', due_date: '2026-09-20', status: 'Pending', reminder_count: '1', last_reminder_date: '2026-09-16' },
  { compliance_id: 'COMP-021', client_id: 'CLIENT-016', client_name: 'GreenField Agro Chemicals Pvt Ltd', phone: '919833221100', email: 'accounts@greenfieldagro.com', compliance_type: 'Tax Audit Sec 44AB', due_date: '2026-09-30', status: 'Pending', reminder_count: '1', last_reminder_date: '2026-09-15' },
  { compliance_id: 'COMP-022', client_id: 'CLIENT-017', client_name: 'Royal Heritage Caterers & Banquets', phone: '919871122334', email: 'jaspreet@royalheritagebanquets.com', compliance_type: 'GSTR-3B (August 2026)', due_date: '2026-09-20', status: 'Filed', reminder_count: '1', last_reminder_date: '2026-09-15' },
  { compliance_id: 'COMP-023', client_id: 'CLIENT-018', client_name: 'Aura Architecture & Interior Studio', phone: '919890123456', email: 'neha@aurastudio.in', compliance_type: 'Advance Tax Q2 (AY 2027)', due_date: '2026-09-15', status: 'Filed', reminder_count: '1', last_reminder_date: '2026-09-12' },
  { compliance_id: 'COMP-024', client_id: 'CLIENT-019', client_name: 'SwiftLogix Cold Chain Solutions Pvt Ltd', phone: '919840987654', email: 'ops@swiftlogix.in', compliance_type: 'GSTR-3B (August 2026)', due_date: '2026-09-20', status: 'Pending', reminder_count: '1', last_reminder_date: '2026-09-16' },
  { compliance_id: 'COMP-025', client_id: 'CLIENT-020', client_name: 'Vanguard Precision Engineering Pvt Ltd', phone: '919810554433', email: 'dverma@vanguardprecision.in', compliance_type: 'ROC AOC-4 & MGT-7', due_date: '2026-10-30', status: 'Pending', reminder_count: '1', last_reminder_date: '2026-09-10' }
];

const DOCUMENTS_DATA = [
  { doc_id: 'DOC-001', client_id: 'CLIENT-001', client_name: 'Mehta Textiles Pvt Ltd', phone: '919876543210', email: 'ramesh@mehtatextiles.com', compliance_type: 'GSTR-3B', document_name: 'Vendor Purchase Invoice (Shreeji Fab)', requested_date: '2026-09-14', status: 'Pending', received_date: '', followup_count: '2', last_followup_date: '2026-09-17' },
  { doc_id: 'DOC-002', client_id: 'CLIENT-001', client_name: 'Mehta Textiles Pvt Ltd', phone: '919876543210', email: 'ramesh@mehtatextiles.com', compliance_type: 'GSTR-3B', document_name: 'August Bank Statement (HDFC Bank)', requested_date: '2026-09-05', status: 'Received', received_date: '2026-09-08', followup_count: '1', last_followup_date: '2026-09-07' },
  { doc_id: 'DOC-003', client_id: 'CLIENT-002', client_name: 'Apex BioTech Pharma Pvt Ltd', phone: '919820011223', email: 'accounts@apexbiotech.in', compliance_type: 'Tax Audit', document_name: 'Fixed Assets Register & Depreciation Sheet', requested_date: '2026-09-08', status: 'Pending', received_date: '', followup_count: '2', last_followup_date: '2026-09-16' },
  { doc_id: 'DOC-004', client_id: 'CLIENT-002', client_name: 'Apex BioTech Pharma Pvt Ltd', phone: '919820011223', email: 'accounts@apexbiotech.in', compliance_type: 'GSTR-3B', document_name: 'August Sales Register (Excel)', requested_date: '2026-09-05', status: 'Received', received_date: '2026-09-09', followup_count: '1', last_followup_date: '2026-09-07' },
  { doc_id: 'DOC-005', client_id: 'CLIENT-003', client_name: 'Zenith Solar Systems Pvt Ltd', phone: '919833445566', email: 'finance@zenithsolar.com', compliance_type: 'Advance Tax', document_name: 'Estimated P&L Statement (Q2)', requested_date: '2026-09-01', status: 'Pending', received_date: '', followup_count: '3', last_followup_date: '2026-09-15' },
  { doc_id: 'DOC-006', client_id: 'CLIENT-004', client_name: 'Shree Mahavir Textiles & Fabrics', phone: '919844556677', email: 'mahavir.textiles@gmail.com', compliance_type: 'GSTR-3B', document_name: 'August Bank Statement (SBI)', requested_date: '2026-09-05', status: 'Received', received_date: '2026-09-07', followup_count: '1', last_followup_date: '2026-09-06' },
  { doc_id: 'DOC-007', client_id: 'CLIENT-005', client_name: 'Kothari Gems & Jewels LLP', phone: '919855667788', email: 'tax@kotharigems.com', compliance_type: 'Tax Audit', document_name: 'Foreign Currency Export Realization (BRC)', requested_date: '2026-09-10', status: 'Pending', received_date: '', followup_count: '1', last_followup_date: '2026-09-16' },
  { doc_id: 'DOC-008', client_id: 'CLIENT-006', client_name: 'Nova Infotech Solutions Pvt Ltd', phone: '919866778899', email: 'billing@novainfotech.io', compliance_type: 'TDS 26Q', document_name: 'Contractor Payment Challans (August)', requested_date: '2026-09-12', status: 'Received', received_date: '2026-09-15', followup_count: '1', last_followup_date: '2026-09-14' },
  { doc_id: 'DOC-009', client_id: 'CLIENT-007', client_name: 'Bhavani Steel & Hardware Corp', phone: '919877889900', email: 'bhavanisteel.corp@yahoo.co.in', compliance_type: 'GSTR-3B', document_name: 'E-Way Bill Reconciliation Summary', requested_date: '2026-09-06', status: 'Pending', received_date: '', followup_count: '2', last_followup_date: '2026-09-17' },
  { doc_id: 'DOC-010', client_id: 'CLIENT-008', client_name: 'Dr. Ananya Mukherjee', phone: '919888990011', email: 'dr.ananya.cardio@gmail.com', compliance_type: 'ITR-3', document_name: 'Hospital Form 16A & Professional Receipts', requested_date: '2026-09-05', status: 'Received', received_date: '2026-09-11', followup_count: '1', last_followup_date: '2026-09-08' },
  { doc_id: 'DOC-011', client_id: 'CLIENT-009', client_name: 'Patel Express Logistics LLP', phone: '919899001122', email: 'accounts@patelexpress.net', compliance_type: 'GSTR-3B', document_name: 'Diesel Expense & Fastag Statement', requested_date: '2026-09-08', status: 'Pending', received_date: '', followup_count: '2', last_followup_date: '2026-09-16' },
  { doc_id: 'DOC-012', client_id: 'CLIENT-010', client_name: 'Sunstone Realty & Infrastructure Pvt Ltd', phone: '919811223344', email: 'director@sunstonerealty.in', compliance_type: 'ROC AOC-4', document_name: 'Signed Directors Report & Auditor Report', requested_date: '2026-09-11', status: 'Pending', received_date: '', followup_count: '1', last_followup_date: '2026-09-14' },
  { doc_id: 'DOC-013', client_id: 'CLIENT-011', client_name: 'Nexus FinTech Technologies LLP', phone: '919711033490', email: 'vikram@nexusfintech.co', compliance_type: 'ROC Form 11', document_name: 'Bank Statement FY23-24 (Q4)', requested_date: '2026-09-10', status: 'Pending', received_date: '', followup_count: '2', last_followup_date: '2026-09-16' },
  { doc_id: 'DOC-014', client_id: 'CLIENT-012', client_name: 'Agarwal Tex-Fab', phone: '919821099881', email: 'sunita@agarwaltexfab.in', compliance_type: 'GST Reg', document_name: 'Shop Electricity Bill & Cancelled Cheque', requested_date: '2026-09-16', status: 'Pending', received_date: '', followup_count: '1', last_followup_date: '2026-09-18' },
  { doc_id: 'DOC-015', client_id: 'CLIENT-014', client_name: 'Gupta Hardware & Sanitary Ware', phone: '919845011982', email: 'harish@guptahardware.in', compliance_type: 'GSTR-3B', document_name: 'September GSTR-1 Sales Register', requested_date: '2026-09-08', status: 'Pending', received_date: '', followup_count: '2', last_followup_date: '2026-09-17' },
  { doc_id: 'DOC-016', client_id: 'CLIENT-015', client_name: 'BlueOcean Hospitality & Resorts LLP', phone: '919822334455', email: 'finance@blueoceanresorts.com', compliance_type: 'GSTR-3B', document_name: 'Room Booking & Restaurant POS Summary', requested_date: '2026-09-07', status: 'Pending', received_date: '', followup_count: '1', last_followup_date: '2026-09-15' },
  { doc_id: 'DOC-017', client_id: 'CLIENT-016', client_name: 'GreenField Agro Chemicals Pvt Ltd', phone: '919833221100', email: 'accounts@greenfieldagro.com', compliance_type: 'Tax Audit', document_name: 'Raw Material Inventory Valuation Report', requested_date: '2026-09-09', status: 'Pending', received_date: '', followup_count: '2', last_followup_date: '2026-09-16' },
  { doc_id: 'DOC-018', client_id: 'CLIENT-020', client_name: 'Vanguard Precision Engineering Pvt Ltd', phone: '919810554433', email: 'dverma@vanguardprecision.in', compliance_type: 'ROC Filing', document_name: 'Audited Financial Statements FY25-26', requested_date: '2026-09-05', status: 'Pending', received_date: '', followup_count: '2', last_followup_date: '2026-09-14' }
];

const INVOICES_DATA = [
  { invoice_id: 'INV-001', client_id: 'CLIENT-001', client_name: 'Mehta Textiles Pvt Ltd', phone: '919876543210', email: 'ramesh@mehtatextiles.com', amount: '14500', currency: 'INR', due_date: '2026-09-10', status: 'Pending', reminder_count: '2', last_reminder_date: '2026-09-15', escalated: 'NO' },
  { invoice_id: 'INV-002', client_id: 'CLIENT-002', client_name: 'Apex BioTech Pharma Pvt Ltd', phone: '919820011223', email: 'accounts@apexbiotech.in', amount: '25000', currency: 'INR', due_date: '2026-09-05', status: 'Pending', reminder_count: '3', last_reminder_date: '2026-09-16', escalated: 'NO' },
  { invoice_id: 'INV-003', client_id: 'CLIENT-003', client_name: 'Zenith Solar Systems Pvt Ltd', phone: '919833445566', email: 'finance@zenithsolar.com', amount: '35000', currency: 'INR', due_date: '2026-08-31', status: 'Pending', reminder_count: '4', last_reminder_date: '2026-09-16', escalated: 'YES' },
  { invoice_id: 'INV-004', client_id: 'CLIENT-004', client_name: 'Shree Mahavir Textiles & Fabrics', phone: '919844556677', email: 'mahavir.textiles@gmail.com', amount: '12000', currency: 'INR', due_date: '2026-09-12', status: 'Paid', reminder_count: '1', last_reminder_date: '2026-09-11', escalated: 'NO' },
  { invoice_id: 'INV-005', client_id: 'CLIENT-005', client_name: 'Kothari Gems & Jewels LLP', phone: '919855667788', email: 'tax@kotharigems.com', amount: '45000', currency: 'INR', due_date: '2026-09-08', status: 'Paid', reminder_count: '1', last_reminder_date: '2026-09-07', escalated: 'NO' },
  { invoice_id: 'INV-006', client_id: 'CLIENT-006', client_name: 'Nova Infotech Solutions Pvt Ltd', phone: '919866778899', email: 'billing@novainfotech.io', amount: '22000', currency: 'INR', due_date: '2026-09-15', status: 'Paid', reminder_count: '1', last_reminder_date: '2026-09-14', escalated: 'NO' },
  { invoice_id: 'INV-007', client_id: 'CLIENT-007', client_name: 'Bhavani Steel & Hardware Corp', phone: '919877889900', email: 'bhavanisteel.corp@yahoo.co.in', amount: '15000', currency: 'INR', due_date: '2026-09-10', status: 'Pending', reminder_count: '2', last_reminder_date: '2026-09-15', escalated: 'NO' },
  { invoice_id: 'INV-008', client_id: 'CLIENT-008', client_name: 'Dr. Ananya Mukherjee', phone: '919888990011', email: 'dr.ananya.cardio@gmail.com', amount: '18000', currency: 'INR', due_date: '2026-08-25', status: 'Paid', reminder_count: '0', last_reminder_date: '', escalated: 'NO' },
  { invoice_id: 'INV-009', client_id: 'CLIENT-009', client_name: 'Patel Express Logistics LLP', phone: '919899001122', email: 'accounts@patelexpress.net', amount: '28000', currency: 'INR', due_date: '2026-09-02', status: 'Pending', reminder_count: '3', last_reminder_date: '2026-09-15', escalated: 'NO' },
  { invoice_id: 'INV-010', client_id: 'CLIENT-010', client_name: 'Sunstone Realty & Infrastructure Pvt Ltd', phone: '919811223344', email: 'director@sunstonerealty.in', amount: '50000', currency: 'INR', due_date: '2026-09-01', status: 'Pending', reminder_count: '3', last_reminder_date: '2026-09-16', escalated: 'YES' },
  { invoice_id: 'INV-011', client_id: 'CLIENT-011', client_name: 'Nexus FinTech Technologies LLP', phone: '919711033490', email: 'vikram@nexusfintech.co', amount: '18000', currency: 'INR', due_date: '2026-09-20', status: 'Paid', reminder_count: '0', last_reminder_date: '', escalated: 'NO' },
  { invoice_id: 'INV-012', client_id: 'CLIENT-012', client_name: 'Agarwal Tex-Fab', phone: '919821099881', email: 'sunita@agarwaltexfab.in', amount: '6500', currency: 'INR', due_date: '2026-09-25', status: 'Pending', reminder_count: '0', last_reminder_date: '', escalated: 'NO' },
  { invoice_id: 'INV-013', client_id: 'CLIENT-013', client_name: 'Sharma Consulting Services', phone: '919930278120', email: 'priya@sharmaconsulting.co', amount: '8000', currency: 'INR', due_date: '2026-07-25', status: 'Paid', reminder_count: '0', last_reminder_date: '', escalated: 'NO' },
  { invoice_id: 'INV-014', client_id: 'CLIENT-014', client_name: 'Gupta Hardware & Sanitary Ware', phone: '919845011982', email: 'harish@guptahardware.in', amount: '4200', currency: 'INR', due_date: '2026-09-10', status: 'Pending', reminder_count: '2', last_reminder_date: '2026-09-16', escalated: 'NO' },
  { invoice_id: 'INV-015', client_id: 'CLIENT-015', client_name: 'BlueOcean Hospitality & Resorts LLP', phone: '919822334455', email: 'finance@blueoceanresorts.com', amount: '32000', currency: 'INR', due_date: '2026-09-05', status: 'Pending', reminder_count: '2', last_reminder_date: '2026-09-14', escalated: 'NO' },
  { invoice_id: 'INV-016', client_id: 'CLIENT-016', client_name: 'GreenField Agro Chemicals Pvt Ltd', phone: '919833221100', email: 'accounts@greenfieldagro.com', amount: '40000', currency: 'INR', due_date: '2026-09-12', status: 'Pending', reminder_count: '1', last_reminder_date: '2026-09-15', escalated: 'NO' },
  { invoice_id: 'INV-017', client_id: 'CLIENT-017', client_name: 'Royal Heritage Caterers & Banquets', phone: '919871122334', email: 'jaspreet@royalheritagebanquets.com', amount: '20000', currency: 'INR', due_date: '2026-09-15', status: 'Paid', reminder_count: '0', last_reminder_date: '', escalated: 'NO' },
  { invoice_id: 'INV-018', client_id: 'CLIENT-018', client_name: 'Aura Architecture & Interior Studio', phone: '919890123456', email: 'neha@aurastudio.in', amount: '16000', currency: 'INR', due_date: '2026-09-14', status: 'Paid', reminder_count: '0', last_reminder_date: '', escalated: 'NO' },
  { invoice_id: 'INV-019', client_id: 'CLIENT-019', client_name: 'SwiftLogix Cold Chain Solutions Pvt Ltd', phone: '919840987654', email: 'ops@swiftlogix.in', amount: '38000', currency: 'INR', due_date: '2026-09-08', status: 'Pending', reminder_count: '2', last_reminder_date: '2026-09-16', escalated: 'NO' },
  { invoice_id: 'INV-020', client_id: 'CLIENT-020', client_name: 'Vanguard Precision Engineering Pvt Ltd', phone: '919810554433', email: 'dverma@vanguardprecision.in', amount: '65000', currency: 'INR', due_date: '2026-09-01', status: 'Pending', reminder_count: '3', last_reminder_date: '2026-09-15', escalated: 'YES' }
];

async function seedSheet() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🌱 SEEDING GOOGLE SHEETS: 20 AUTHENTIC CA CLIENTS');
  console.log(`   Spreadsheet ID: ${SPREADSHEET_ID}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // 1. Clear and Populate Clients
  console.log('⏳ Updating "Clients" tab...');
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Clients!A1:ZZ'
  });

  const clientHeaders = ['client_id', 'name', 'phone', 'email', 'entity_type', 'gst_number', 'pan', 'contact_person', 'created_at'];
  const clientRows = CLIENTS_DATA.map(c => clientHeaders.map(h => c[h] || ''));
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Clients!A1',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [clientHeaders, ...clientRows] }
  });
  console.log(`✅ Clients tab populated: ${CLIENTS_DATA.length} clients`);

  // 2. Clear and Populate Compliance Calendar
  console.log('⏳ Updating "Compliance_Calendar" tab...');
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Compliance_Calendar!A1:ZZ'
  });

  const compHeaders = ['compliance_id', 'client_id', 'client_name', 'phone', 'email', 'compliance_type', 'due_date', 'status', 'reminder_count', 'last_reminder_date'];
  const compRows = COMPLIANCE_DATA.map(c => compHeaders.map(h => c[h] || ''));
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Compliance_Calendar!A1',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [compHeaders, ...compRows] }
  });
  console.log(`✅ Compliance_Calendar tab populated: ${COMPLIANCE_DATA.length} filings`);

  // 3. Clear and Populate Documents Tracker
  console.log('⏳ Updating "Documents_Tracker" tab...');
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Documents_Tracker!A1:ZZ'
  });

  const docHeaders = ['doc_id', 'client_id', 'client_name', 'phone', 'email', 'compliance_type', 'document_name', 'requested_date', 'status', 'received_date', 'followup_count', 'last_followup_date'];
  const docRows = DOCUMENTS_DATA.map(d => docHeaders.map(h => d[h] || ''));
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Documents_Tracker!A1',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [docHeaders, ...docRows] }
  });
  console.log(`✅ Documents_Tracker tab populated: ${DOCUMENTS_DATA.length} tracking items`);

  // 4. Clear and Populate Invoices
  console.log('⏳ Updating "Invoices" tab...');
  await sheets.spreadsheets.values.clear({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Invoices!A1:ZZ'
  });

  const invHeaders = ['invoice_id', 'client_id', 'client_name', 'phone', 'email', 'amount', 'currency', 'due_date', 'status', 'reminder_count', 'last_reminder_date', 'escalated'];
  const invRows = INVOICES_DATA.map(inv => invHeaders.map(h => inv[h] || ''));
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Invoices!A1',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [invHeaders, ...invRows] }
  });
  console.log(`✅ Invoices tab populated: ${INVOICES_DATA.length} invoices`);

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🎉 GOOGLE SHEETS POPULATED SUCCESSFULLY WITH 20 CLIENTS!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

seedSheet().catch(err => {
  console.error('❌ Failed to seed Google Sheets:', err.message);
  process.exit(1);
});
