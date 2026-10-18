import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import type {
  AuditEntry,
  AuthUser,
  Campaign,
  Client,
  ClientDetail,
  Compliance,
  DashboardData,
  Dsc,
  DocumentItem,
  Invoice,
  Lead,
  Message,
  Notice,
  Payment,
  Proposal,
  ReportData,
  Settings,
  Timesheet,
  Udin,
} from "./types";
import { dayDiff } from "./format";
import { buildProposal } from "./proposals";
import { decryptField, encryptField, generatePassword, hashPassword, isEncrypted } from "./crypto";
import { dataPath } from "./data-dir";

const DB_FILE = dataPath("ca-suite.db");

const globalForDb = globalThis as unknown as { __caDb?: DatabaseSync };

export function getDb(): DatabaseSync {
  if (globalForDb.__caDb) return globalForDb.__caDb;

  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  const db = new DatabaseSync(DB_FILE);
  // Rollback journalling keeps reads from touching the project tree. WAL rewrites
  // its shared-memory file on every read, which makes the dev file watcher
  // recompile in a loop (visible as constant page reloads during development).
  db.exec("PRAGMA journal_mode = DELETE;");
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db);
  seedIfEmpty(db);
  seedExtrasIfEmpty(db);
  seedUsersIfEmpty(db);
  globalForDb.__caDb = db;
  return db;
}

function migrate(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS clients (
      client_id TEXT PRIMARY KEY, name TEXT NOT NULL, contact_person TEXT, phone TEXT, email TEXT,
      entity_type TEXT, gst_number TEXT, pan TEXT, services_opted TEXT, city TEXT, state TEXT, created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS leads (
      lead_id TEXT PRIMARY KEY, name TEXT NOT NULL, company_name TEXT, phone TEXT, email TEXT,
      source TEXT, service_interest TEXT, lead_score INTEGER, category TEXT, status TEXT, notes TEXT, created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS compliance (
      compliance_id TEXT PRIMARY KEY, client_id TEXT, client_name TEXT, compliance_type TEXT,
      period TEXT, due_date TEXT, status TEXT, filed_date TEXT, ack_number TEXT, assigned_to TEXT, notes TEXT
    );
    CREATE TABLE IF NOT EXISTS documents (
      doc_id TEXT PRIMARY KEY, client_id TEXT, client_name TEXT, document_name TEXT,
      status TEXT, requested_date TEXT, received_date TEXT, notes TEXT,
      file_name TEXT, file_size INTEGER, file_path TEXT, uploaded_at TEXT
    );
    CREATE TABLE IF NOT EXISTS invoices (
      invoice_id TEXT PRIMARY KEY, client_id TEXT, client_name TEXT, invoice_date TEXT, due_date TEXT,
      service_description TEXT, amount REAL, gst_amount REAL, total_amount REAL, paid_amount REAL DEFAULT 0,
      status TEXT, paid_date TEXT
    );
    CREATE TABLE IF NOT EXISTS payments (
      payment_id TEXT PRIMARY KEY, invoice_id TEXT, client_name TEXT, amount REAL,
      paid_on TEXT, mode TEXT, reference TEXT, notes TEXT, created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS messages (
      message_id TEXT PRIMARY KEY, channel TEXT, recipient_name TEXT, to_address TEXT,
      subject TEXT, body TEXT, related_type TEXT, related_id TEXT, status TEXT, created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS udin (
      udin_id TEXT PRIMARY KEY, udin TEXT, client_name TEXT, document_type TEXT,
      financial_year TEXT, generated_date TEXT, ca_member_no TEXT, notes TEXT
    );
    CREATE TABLE IF NOT EXISTS dsc (
      dsc_id TEXT PRIMARY KEY, client_name TEXT, holder_name TEXT, class_type TEXT,
      valid_from TEXT, valid_until TEXT, token_serial TEXT, status TEXT
    );
    CREATE TABLE IF NOT EXISTS notices (
      notice_id TEXT PRIMARY KEY, client_name TEXT, notice_type TEXT, portal TEXT,
      notice_date TEXT, response_deadline TEXT, reference_number TEXT, amount REAL, status TEXT, notes TEXT
    );
    CREATE TABLE IF NOT EXISTS timesheets (
      timesheet_id TEXT PRIMARY KEY, user_name TEXT, client_name TEXT, date TEXT, task_type TEXT,
      description TEXT, hours REAL, billable INTEGER, status TEXT, created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS proposals (
      proposal_id TEXT PRIMARY KEY, lead_id TEXT, prospect_name TEXT, company_name TEXT,
      entity_type TEXT, services TEXT, fee TEXT, body TEXT, status TEXT, converted_client_id TEXT, created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS campaigns (
      campaign_id TEXT PRIMARY KEY, name TEXT, channel TEXT, audience TEXT, subject TEXT,
      message TEXT, recipients INTEGER, status TEXT, created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT, action TEXT, entity_type TEXT,
      entity_id TEXT, detail TEXT, created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, email TEXT,
      role TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL, last_login TEXT
    );
    CREATE TABLE IF NOT EXISTS ai_calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, action TEXT, provider TEXT, model TEXT,
      tool_names TEXT, tool_calls INTEGER, rounds INTEGER, tokens_in INTEGER, tokens_out INTEGER,
      latency_ms INTEGER, status TEXT, detail TEXT, created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS ai_actions (
      action_id TEXT PRIMARY KEY, user_id TEXT, tool TEXT, args TEXT, title TEXT,
      status TEXT, result TEXT, created_at TEXT, decided_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_compliance_due ON compliance(due_date);
    CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
    CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
    CREATE INDEX IF NOT EXISTS idx_notices_deadline ON notices(response_deadline);
    CREATE INDEX IF NOT EXISTS idx_dsc_valid ON dsc(valid_until);
    CREATE INDEX IF NOT EXISTS idx_proposals_lead ON proposals(lead_id);
    CREATE INDEX IF NOT EXISTS idx_campaigns_created ON campaigns(created_at);
    CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
    CREATE INDEX IF NOT EXISTS idx_messages_related ON messages(related_type, related_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_udin_unique ON udin(udin);
    CREATE INDEX IF NOT EXISTS idx_ai_calls_user_day ON ai_calls(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_ai_actions_user ON ai_actions(user_id, status);
  `);

  // Columns added after the first release — safe to run on existing databases.
  ensureColumn(db, "documents", "file_name", "TEXT");
  ensureColumn(db, "documents", "file_size", "INTEGER");
  ensureColumn(db, "documents", "file_path", "TEXT");
  ensureColumn(db, "documents", "uploaded_at", "TEXT");
  ensureColumn(db, "invoices", "paid_amount", "REAL DEFAULT 0");
  ensureColumn(db, "proposals", "converted_client_id", "TEXT");
  ensureColumn(db, "users", "token_version", "INTEGER DEFAULT 0");
  db.exec("UPDATE invoices SET paid_amount = total_amount WHERE status = 'Paid' AND (paid_amount IS NULL OR paid_amount = 0)");
  encryptLegacyIdentifiers(db);
}

/**
 * PAN and GSTIN are stored AES-256-GCM encrypted (see lib/crypto.ts). Rows
 * written before field encryption existed are plaintext — bring them forward.
 */
function encryptLegacyIdentifiers(db: DatabaseSync) {
  const rows = db
    .prepare(
      `SELECT client_id, pan, gst_number FROM clients
       WHERE (pan IS NOT NULL AND pan NOT LIKE 'enc:v1:%')
          OR (gst_number IS NOT NULL AND gst_number NOT LIKE 'enc:v1:%')`,
    )
    .all() as unknown as Array<{ client_id: string; pan: string | null; gst_number: string | null }>;
  if (rows.length === 0) return;
  const update = db.prepare("UPDATE clients SET pan = ?, gst_number = ? WHERE client_id = ?");
  for (const row of rows) {
    update.run(
      row.pan && !isEncrypted(row.pan) ? encryptField(row.pan) : row.pan,
      row.gst_number && !isEncrypted(row.gst_number) ? encryptField(row.gst_number) : row.gst_number,
      row.client_id,
    );
  }
}

function ensureColumn(db: DatabaseSync, table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{ name: string }>;
  if (!columns.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function iso(offsetDays: number): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function localIso(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function stamp(offsetMinutes: number): string {
  const d = new Date(Date.now() - offsetMinutes * 60_000);
  return d.toISOString();
}

type SeedClient = [name: string, person: string, phone: string, email: string, entity: string, gst: string, pan: string, services: string, city: string, state: string];

const SEED_CLIENTS: SeedClient[] = [
  ["Sharma Textiles Pvt Ltd", "Rahul Sharma", "9820011223", "rahul@sharmatextiles.in", "Private Limited", "27AABCS1234A1Z5", "AABCS1234A", "GST Filing, Tax Audit, ITR", "Mumbai", "Maharashtra"],
  ["Mehta & Sons LLP", "Nilesh Mehta", "9822033445", "nilesh@mehtasons.in", "LLP", "27AABCM5678B1Z2", "AABCM5678B", "GST Filing, ROC Compliance, ITR", "Thane", "Maharashtra"],
  ["GreenLeaf Organics", "Priya Nair", "9845066778", "priya@greenleaf.co", "Proprietorship", "29AAGPG9012C1Z8", "AAGPG9012C", "GST Filing, ITR", "Bengaluru", "Karnataka"],
  ["Shah Capital Advisors", "Kunal Shah", "9824077889", "kunal@shahcapital.in", "Partnership", "24AACFS3456D1Z1", "AACFS3456D", "Tax Audit, ITR, TDS", "Ahmedabad", "Gujarat"],
  ["NovaBuild Infra Pvt Ltd", "Ananya Desai", "9820088990", "ananya@novabuild.in", "Private Limited", "27AADCN7890E1Z4", "AADCN7890E", "GST Filing, Tax Audit, ROC", "Pune", "Maharashtra"],
  ["Verma Family Trust", "Suresh Verma", "9811099001", "suresh@vermatrust.org", "Trust", "07AAATV2345F1Z6", "AAATV2345F", "ITR, Trust Audit", "New Delhi", "Delhi"],
  ["Krishna Agro Exports", "Manoj Patil", "9823010112", "manoj@krishnaagro.in", "Proprietorship", "27AAKPK6789G1Z3", "AAKPK6789G", "GST Filing, ITR", "Nashik", "Maharashtra"],
  ["Bluewave Technologies LLP", "Rohan Iyer", "9845022334", "rohan@bluewave.tech", "LLP", "29AABCB1234H1Z9", "AABCB1234H", "GST Filing, TDS, ITR", "Bengaluru", "Karnataka"],
  ["Deshmukh HUF", "Vasant Deshmukh", "9826044556", "vasant.deshmukh@gmail.com", "HUF", "27AAHHD4567J1Z5", "AAHHD4567J", "ITR", "Nagpur", "Maharashtra"],
  ["Apex Media Pvt Ltd", "Farah Khan", "9820055667", "farah@apexmedia.in", "Private Limited", "27AAECA8910K1Z7", "AAECA8910K", "GST Filing, Tax Audit, ROC", "Mumbai", "Maharashtra"],
  ["Sunrise Hospitality", "Deepak Gupta", "9829066778", "deepak@sunrisehospitality.in", "Partnership", "08AAFCS3456L1Z2", "AAFCS3456L", "GST Filing, ITR", "Jaipur", "Rajasthan"],
  ["Trident Pharma Pvt Ltd", "Sneha Kulkarni", "9820077889", "sneha@tridentpharma.in", "Private Limited", "27AAGCT7890M1Z8", "AAGCT7890M", "GST, TDS, Tax Audit, ITR", "Mumbai", "Maharashtra"],
];

const SEED_LEADS: Array<[string, string, string, string, string, string, number, Lead["category"], Lead["status"], string]> = [
  ["Aditya Rao", "Rao Foods Pvt Ltd", "9820112233", "aditya@raofoods.in", "Website", "GST Filing, ITR", 86, "Hot", "Qualified", "Needs monthly GST + quarterly ITR support. Turnover ₹4.2 Cr."],
  ["Neha Joshi", "Joshi Design Studio", "9821223344", "neha@joshidesign.in", "Referral", "GST Filing", 72, "Warm", "Contacted", "Referred by Apex Media. Wants proposal this week."],
  ["Vikram Singh", "Singh Logistics", "9822334455", "vikram@singhlogistics.in", "WhatsApp", "Tax Audit, TDS", 91, "Hot", "Proposal Sent", "Proposal sent for FY audit. Follow up Friday."],
  ["Ritu Agarwal", "Agarwal Jewellers", "9823445566", "ritu@agarwaljewellers.in", "Website", "GST Filing, Tax Audit", 64, "Warm", "New", "Enquiry from website form. Awaiting first call."],
  ["Sameer Kulkarni", "Kulkarni Consulting", "9824556677", "sameer@kulkarniconsulting.in", "LinkedIn", "ITR, ROC", 58, "Warm", "Contacted", "Solo consultant, ROC + ITR scope."],
  ["Pooja Menon", "Menon Interiors", "9825667788", "pooja@menoninteriors.in", "Referral", "GST Filing", 45, "Cold", "Lost", "Went with a lower-cost local firm."],
  ["Arjun Bhatia", "Bhatia Exports LLP", "9826778899", "arjun@bhatiaexports.in", "Website", "GST Filing, ITR, TDS", 78, "Hot", "Qualified", "Export refunds pending, urgent GST help."],
  ["Kavita Reddy", "Reddy Pharma", "9827889900", "kavita@reddypharma.in", "Event", "Tax Audit, ITR", 69, "Warm", "New", "Met at ICAI seminar. Needs audit for FY24-25."],
  ["Harish Patel", "Patel Textiles", "9828990011", "harish@pateltextiles.in", "WhatsApp", "GST Filing", 55, "Warm", "Contacted", "Wants to migrate from current CA."],
  ["Divya Shah", "Shah Digital", "9829001122", "divya@shahdigital.in", "Referral", "ITR, ROC", 82, "Hot", "Won", "Signed annual retainer of ₹1.8L."],
];

type SeedCompliance = [number, string, string, number, Compliance["status"], string];
const SEED_COMPLIANCE: SeedCompliance[] = [
  [0, "GST Filing (GSTR-3B)", "Sep 2026", 2, "Pending", "Priya Nair"],
  [0, "TDS Payment (26Q)", "Q2 FY26", -4, "Pending", "Rahul Sharma"],
  [1, "GST Filing (GSTR-1)", "Sep 2026", 5, "Pending", "Nilesh Mehta"],
  [1, "ROC Annual Filing (AOC-4)", "FY 2025-26", 18, "Pending", "Nilesh Mehta"],
  [2, "GST Filing (GSTR-3B)", "Sep 2026", -2, "Pending", "Priya Nair"],
  [2, "ITR Filing", "AY 2026-27", 24, "Pending", "Priya Nair"],
  [3, "Tax Audit Report", "FY 2025-26", 9, "In Progress", "Kunal Shah"],
  [4, "GST Filing (GSTR-9)", "FY 2025-26", 30, "Pending", "Ananya Desai"],
  [4, "ROC Annual Filing (MGT-7)", "FY 2025-26", 12, "Pending", "Ananya Desai"],
  [5, "Trust Audit", "FY 2025-26", 15, "Pending", "Suresh Verma"],
  [6, "GST Filing (GSTR-1)", "Sep 2026", 4, "Pending", "Manoj Patil"],
  [7, "TDS Payment (26Q)", "Q2 FY26", 6, "In Progress", "Rohan Iyer"],
  [8, "ITR Filing", "AY 2026-27", 21, "Pending", "Vasant Deshmukh"],
  [9, "GST Filing (GSTR-3B)", "Sep 2026", -8, "Overdue", "Farah Khan"],
  [9, "Tax Audit Report", "FY 2025-26", 11, "Pending", "Farah Khan"],
  [10, "GST Filing (GSTR-9)", "FY 2025-26", 27, "Pending", "Deepak Gupta"],
  [11, "ITR Filing", "AY 2026-27", -12, "Filed", "Sneha Kulkarni"],
  [11, "GST Filing (GSTR-1)", "Sep 2026", 3, "Pending", "Sneha Kulkarni"],
  [0, "GST Filing (GSTR-9)", "FY 2025-26", -25, "Filed", "Rahul Sharma"],
  [3, "ITR Filing", "AY 2025-26", -40, "Filed", "Kunal Shah"],
];

type SeedDoc = [number, string, DocumentItem["status"], number];
const SEED_DOCS: SeedDoc[] = [
  [0, "Bank Statement — Sep 2026", "Pending", 6],
  [0, "Purchase Invoices Q2", "Received", 4],
  [1, "GST Returns — Aug 2026", "Pending", 3],
  [2, "Form 16A — Q2", "Pending", 9],
  [3, "Trial Balance FY25-26", "Verified", 2],
  [4, "Board Resolution — AOC-4", "Pending", 1],
  [4, "Shareholding Pattern", "Received", 7],
  [5, "Trust Deed Copy", "Verified", 14],
  [6, "Export Invoices — Sep", "Pending", 2],
  [7, "TDS Challans Q2", "Pending", 5],
  [9, "Rent Agreement", "Received", 8],
  [9, "GST Notice Reply Draft", "Pending", 0],
  [11, "Audited Financials FY25-26", "Verified", 11],
  [11, "Director KYC", "Pending", 3],
];

type SeedInvoice = [number, number, string, number, Invoice["status"]];
const SEED_INVOICES: SeedInvoice[] = [
  [0, -120, "GST retainer — Q1 FY26-27", 45000, "Paid"],
  [1, -95, "ROC annual filing FY25-26", 38000, "Paid"],
  [2, -80, "GST filing and advisory — Jul", 22000, "Paid"],
  [3, -60, "Tax audit FY25-26", 65000, "Paid"],
  [4, -45, "GST retainer + advisory", 52000, "Overdue"],
  [0, -30, "GST retainer — Aug 2026", 45000, "Paid"],
  [5, -24, "Trust audit FY25-26", 32000, "Pending"],
  [9, -18, "GST notice representation", 28000, "Overdue"],
  [7, -12, "TDS quarterly filing — Q2", 18000, "Pending"],
  [11, -6, "Statutory audit FY25-26", 85000, "Pending"],
  [2, 0, "ITR filing advance", 15000, "Pending"],
  [6, 2, "GST annual return FY25-26", 24000, "Pending"],
];

type SeedUdin = [number, string, string, number];
const SEED_UDIN: SeedUdin[] = [
  [0, "Audited Financial Statements", "FY 2025-26", -12],
  [3, "Tax Audit Report (3CA/3CB)", "FY 2025-26", -20],
  [11, "Statutory Audit Report", "FY 2025-26", -6],
  [5, "Trust Audit Certificate", "FY 2025-26", -35],
  [1, "Certification — Net Worth", "FY 2025-26", -3],
  [4, "GST Annual Return Certification", "FY 2025-26", -48],
];

type SeedDsc = [number, string, string, number, string];
const SEED_DSC: SeedDsc[] = [
  [0, "Rahul Sharma", "Class 3 Signing", 340, "Active"],
  [1, "Nilesh Mehta", "Class 3 Signing", 21, "Active"],
  [4, "Ananya Desai", "Class 3 DGFT", 8, "Active"],
  [9, "Farah Khan", "Class 3 Signing", -5, "Active"],
  [7, "Rohan Iyer", "Class 3 Signing", 75, "Active"],
  [10, "Deepak Gupta", "Class 3 Signing", 290, "Active"],
];

type SeedNotice = [number, string, string, string, number, Notice["status"], number];
const SEED_NOTICES: SeedNotice[] = [
  [9, "GST", "ASMT-10 — Scrutiny of Returns", "GSTN/ASMT/2026/8841", 145000, "Open", 4],
  [0, "Income Tax", "142(1) — Query on ITR", "ITBA/142/2026/1192", 0, "Response Filed", 9],
  [4, "GST", "DRC-01 — Demand Confirmation", "GSTN/DRC/2026/3320", 62000, "Escalated", -2],
  [2, "Income Tax", "139(9) — Defective Return", "ITBA/139/2026/4410", 0, "Open", 12],
  [11, "GST", "GSTR-3A — Notice to Return Defaulters", "GSTN/3A/2026/7725", 18000, "Closed", 20],
];

type SeedTimesheet = [string, number, string, number, number];
const SEED_TIMESHEETS: SeedTimesheet[] = [
  ["Ananya Iyer", 0, "GST Filing", 3.5, -1],
  ["Rohit Bansal", 4, "Tax Audit", 6.0, -1],
  ["Ananya Iyer", 1, "ROC Compliance", 2.25, -2],
  ["Meera Pillai", 9, "Notice Representation", 4.5, -2],
  ["Rohit Bansal", 11, "Statutory Audit", 7.5, -3],
  ["Meera Pillai", 2, "ITR Filing", 3.0, -3],
  ["Ananya Iyer", 6, "GST Filing", 2.5, -4],
  ["Rohit Bansal", 3, "Tax Audit", 5.5, -5],
  ["Meera Pillai", 5, "Trust Audit", 3.25, -6],
  ["Ananya Iyer", 7, "TDS Filing", 2.0, -7],
];

type SeedAudit = [string, string, string, string, number];
const SEED_AUDIT: SeedAudit[] = [
  ["Managing Partner", "STATUS_CHANGE", "compliance", "GST Filing (GSTR-3B) marked filed for Trident Pharma", -35],
  ["Meera Pillai", "DOCUMENT_RECEIVED", "document", "Bank Statement — Sep 2026 received from Sharma Textiles", -120],
  ["Rohit Bansal", "INVOICE_PAID", "invoice", "Invoice INV-2026-004 settled by Shah Capital Advisors", -240],
  ["Ananya Iyer", "LEAD_UPDATE", "lead", "Divya Shah moved to Won — annual retainer signed", -300],
  ["Managing Partner", "NOTICE_RESPONSE", "notice", "ASMT-10 response filed for Apex Media", -390],
  ["Meera Pillai", "CLIENT_CREATED", "client", "Trident Pharma Pvt Ltd onboarded", -520],
  ["Rohit Bansal", "UDIN_GENERATED", "udin", "UDIN generated for NovaBuild statutory audit", -660],
  ["Ananya Iyer", "TIMESHEET_APPROVED", "timesheet", "6.0 billable hours approved for Rohit Bansal", -800],
];

function seedIfEmpty(db: DatabaseSync) {
  const count = db.prepare("SELECT COUNT(*) AS n FROM clients").get() as { n: number };
  if (count.n > 0) return;

  const insertClient = db.prepare(`INSERT INTO clients (client_id,name,contact_person,phone,email,entity_type,gst_number,pan,services_opted,city,state,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insertLead = db.prepare(`INSERT INTO leads (lead_id,name,company_name,phone,email,source,service_interest,lead_score,category,status,notes,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insertCompliance = db.prepare(`INSERT INTO compliance (compliance_id,client_id,client_name,compliance_type,period,due_date,status,filed_date,ack_number,assigned_to,notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const insertDoc = db.prepare(`INSERT INTO documents (doc_id,client_id,client_name,document_name,status,requested_date,received_date,notes)
    VALUES (?,?,?,?,?,?,?,?)`);
  const insertInvoice = db.prepare(`INSERT INTO invoices (invoice_id,client_id,client_name,invoice_date,due_date,service_description,amount,gst_amount,total_amount,status,paid_date)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const insertUdin = db.prepare(`INSERT INTO udin (udin_id,udin,client_name,document_type,financial_year,generated_date,ca_member_no,notes)
    VALUES (?,?,?,?,?,?,?,?)`);
  const insertDsc = db.prepare(`INSERT INTO dsc (dsc_id,client_name,holder_name,class_type,valid_from,valid_until,token_serial,status)
    VALUES (?,?,?,?,?,?,?,?)`);
  const insertNotice = db.prepare(`INSERT INTO notices (notice_id,client_name,notice_type,portal,notice_date,response_deadline,reference_number,amount,status,notes)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);
  const insertTimesheet = db.prepare(`INSERT INTO timesheets (timesheet_id,user_name,client_name,date,task_type,description,hours,billable,status,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);
  const insertAudit = db.prepare(`INSERT INTO audit_log (actor,action,entity_type,entity_id,detail,created_at)
    VALUES (?,?,?,?,?,?)`);
  const insertSetting = db.prepare(`INSERT INTO settings (key,value) VALUES (?,?)`);

  db.exec("BEGIN");
  try {
    SEED_CLIENTS.forEach((c, i) => {
      insertClient.run(
        `CLIENT-${String(i + 1).padStart(3, "0")}`, c[0], c[1], c[2], c[3], c[4], encryptField(c[5]), encryptField(c[6]), c[7], c[8], c[9], stamp((i + 1) * 60 * 24 * 20),
      );
    });

    SEED_LEADS.forEach((l, i) => {
      insertLead.run(
        `LEAD-${String(i + 1).padStart(3, "0")}`, l[0], l[1], l[2], l[3], l[4], l[5], l[6], l[7], l[8], l[9], stamp((i + 1) * 60 * 18),
      );
    });

    SEED_COMPLIANCE.forEach((c, i) => {
      const client = SEED_CLIENTS[c[0]];
      const clientId = `CLIENT-${String(c[0] + 1).padStart(3, "0")}`;
      insertCompliance.run(
        `COMP-${String(i + 1).padStart(3, "0")}`, clientId, client[0], c[1], c[2], iso(c[3]), c[4],
        c[4] === "Filed" ? iso(c[3] - 2) : null,
        c[4] === "Filed" ? `ACK${String(100000 + i * 137).slice(0, 6)}` : null,
        c[5], "",
      );
    });

    SEED_DOCS.forEach((d, i) => {
      const client = SEED_CLIENTS[d[0]];
      const clientId = `CLIENT-${String(d[0] + 1).padStart(3, "0")}`;
      insertDoc.run(
        `DOC-${String(i + 1).padStart(3, "0")}`, clientId, client[0], d[1], d[2], iso(-d[3] - 2),
        d[2] === "Pending" ? null : iso(-d[3]), "",
      );
    });

    SEED_INVOICES.forEach((inv, i) => {
      const client = SEED_CLIENTS[inv[0]];
      const clientId = `CLIENT-${String(inv[0] + 1).padStart(3, "0")}`;
      const amount = inv[3];
      const gst = Math.round(amount * 0.18);
      insertInvoice.run(
        `INV-2026-${String(i + 1).padStart(3, "0")}`, clientId, client[0], iso(inv[1]), iso(inv[1] + 30),
        inv[2], amount, gst, amount + gst, inv[4], inv[4] === "Paid" ? iso(inv[1] + 12) : null,
      );
    });

    SEED_UDIN.forEach((u, i) => {
      const client = SEED_CLIENTS[u[0]];
      // 18-character UDIN shape: 2-digit year + 6-digit membership no. + 10 random digits.
      const udin = `26154789${String(1000000000 + i * 137).slice(0, 10)}`;
      insertUdin.run(`UDIN-${String(i + 1).padStart(3, "0")}`, udin, client[0], u[1], u[2], iso(u[3]), "154789", "");
    });

    SEED_DSC.forEach((d, i) => {
      const client = SEED_CLIENTS[d[0]];
      insertDsc.run(
        `DSC-${String(i + 1).padStart(3, "0")}`, client[0], d[1], d[2], iso(-800), iso(d[3]),
        `TOK-${String(48210 + i * 733)}`, d[4],
      );
    });

    SEED_NOTICES.forEach((n, i) => {
      const client = SEED_CLIENTS[n[0]];
      insertNotice.run(
        `NTC-${String(i + 1).padStart(3, "0")}`, client[0], n[2], n[1], iso(-14), iso(n[6]), n[3], n[4], n[5], "",
      );
    });

    SEED_TIMESHEETS.forEach((t, i) => {
      const client = SEED_CLIENTS[t[1]];
      insertTimesheet.run(
        `TS-${String(i + 1).padStart(3, "0")}`, t[0], client[0], iso(t[4]), t[2],
        `${t[2]} work for ${client[0]}`, t[3], 1, i < 6 ? "Approved" : "Pending", new Date(Date.now() + t[4] * 86400000).toISOString(),
      );
    });

    SEED_AUDIT.forEach((a) => {
      insertAudit.run(a[0], a[1], a[2], "", a[3], stamp(Math.abs(a[4])));
    });

    const settings: Array<[string, string]> = [
      ["firm_name", "Sharma & Associates"],
      ["firm_city", "Mumbai"],
      ["firm_phone", "+91 98765 43210"],
      ["firm_email", "info@sharmaassociates.in"],
      ["firm_gstin", "27AABFS4521P1Z4"],
      ["ca_member_no", "154789"],
      ["firm_address", "402, Maker Chambers V, Nariman Point, Mumbai 400021"],
      ["firm_tagline", "Chartered Accountants · Est. 2009"],
    ];
    settings.forEach(([k, v]) => insertSetting.run(k, v));

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/**
 * Backfills the newer modules (proposals, campaigns) for databases created
 * before they existed, so an existing workspace still opens with demo content.
 */
function seedExtrasIfEmpty(db: DatabaseSync) {
  const proposals = db.prepare("SELECT COUNT(*) AS n FROM proposals").get() as { n: number };
  if (proposals.n === 0) {
    const settings = Object.fromEntries(
      (db.prepare("SELECT key, value FROM settings").all() as unknown as Array<{ key: string; value: string }>).map((r) => [r.key, r.value]),
    );
    const leads = db.prepare("SELECT lead_id, name, company_name, service_interest FROM leads ORDER BY lead_score DESC LIMIT 2").all() as unknown as Array<{
      lead_id: string;
      name: string;
      company_name: string;
      service_interest: string;
    }>;
    const insert = db.prepare(`INSERT INTO proposals (proposal_id,lead_id,prospect_name,company_name,entity_type,services,fee,body,status,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`);
    const seeds = [
      { fee: "₹45,000 / engagement", status: "Sent", offset: 4 },
      { fee: "₹18,000 / month", status: "Draft", offset: 1 },
    ];
    leads.forEach((lead, i) => {
      const seed = seeds[i];
      if (!seed) return;
      const proposalId = `PROP-${String(i + 1).padStart(3, "0")}`;
      const companyName = lead.company_name || lead.name;
      const entityType = companyName.includes("LLP") ? "LLP" : "Private Limited";
      const services = lead.service_interest || "GST Filing, ITR";
      insert.run(
        proposalId,
        lead.lead_id,
        lead.name,
        companyName,
        entityType,
        services,
        seed.fee,
        buildProposal({
          reference: proposalId,
          firmName: settings.firm_name ?? "Sharma & Associates",
          firmAddress: settings.firm_address ?? "Mumbai",
          firmPhone: settings.firm_phone ?? "",
          firmEmail: settings.firm_email ?? "",
          memberNo: settings.ca_member_no ?? "",
          prospectName: lead.name,
          companyName,
          entityType,
          services,
          fee: seed.fee,
          date: iso(-seed.offset),
        }),
        seed.status,
        stamp(seed.offset * 60 * 8),
      );
    });
  }

  const payments = db.prepare("SELECT COUNT(*) AS n FROM payments").get() as { n: number };
  if (payments.n === 0) {
    db.exec(`INSERT INTO payments (payment_id,invoice_id,client_name,amount,paid_on,mode,reference,notes,created_at)
      SELECT 'PAY-' || invoice_id, invoice_id, client_name, total_amount, COALESCE(paid_date, due_date),
        'Bank Transfer', '', 'Opening balance', COALESCE(paid_date, due_date) || 'T00:00:00.000Z'
      FROM invoices WHERE status = 'Paid'`);
  }

  const messages = db.prepare("SELECT COUNT(*) AS n FROM messages").get() as { n: number };
  if (messages.n === 0) {
    const insertMessage = db.prepare(`INSERT INTO messages (message_id,channel,recipient_name,to_address,subject,body,related_type,related_id,status,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`);
    insertMessage.run(
      "MESSAGE-001", "WhatsApp", "Apex Media Pvt Ltd", "9820055667", "",
      "Dear Farah Khan, a reminder from Sharma & Associates that GSTR-3B for Sep 2026 is past its due date. Please share the pending purchase invoices today.",
      "compliance", "COMP-014", "Logged", stamp(60 * 20),
    );
    insertMessage.run(
      "MESSAGE-002", "Email", "Sharma Textiles Pvt Ltd", "rahul@sharmatextiles.in", "Bank statement pending",
      "Dear Rahul Sharma, we are waiting on the September bank statement to close your GST filing. Kindly share it at the earliest.",
      "document", "DOC-001", "Logged", stamp(60 * 30),
    );
  }

  const campaigns = db.prepare("SELECT COUNT(*) AS n FROM campaigns").get() as { n: number };
  if (campaigns.n === 0) {
    db.prepare(`INSERT INTO campaigns (campaign_id,name,channel,audience,subject,message,recipients,status,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(
      "CMP-001",
      "September GST filing reminder",
      "WhatsApp",
      "Overdue compliance",
      "GST filing pending",
      "Dear {name},\n\nThis is a reminder from {firm} that your GST filing for the current period is pending with {count} open items. Please share the pending documents so we can file before the due date.\n\nThank you,\n{firm}",
      3,
      "Ready",
      stamp(60 * 26),
    );
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
// node:sqlite returns null-prototype rows. Normalise to plain objects so the
// records can cross the Server → Client Component boundary in Next.js.
function all<T>(sql: string, ...params: Array<string | number | null>): T[] {
  const rows = getDb().prepare(sql).all(...params) as unknown as Array<Record<string, unknown>>;
  return rows.map((row) => ({ ...row })) as T[];
}

function one<T>(sql: string, ...params: Array<string | number | null>): T | null {
  const row = getDb().prepare(sql).get(...params) as unknown as Record<string, unknown> | undefined;
  return row ? ({ ...row } as T) : null;
}

function nextId(prefix: string, table: string, column: string): string {
  // MAX(suffix) instead of COUNT(*) so deleting a record can never resurrect an id.
  const row = one<{ max: number | null }>(
    `SELECT MAX(CAST(SUBSTR(${column}, ${prefix.length + 2}) AS INTEGER)) AS max FROM ${table}`,
  );
  return `${prefix}-${String((row?.max ?? 0) + 1).padStart(3, "0")}`;
}

function nextPaymentId(invoiceId: string): string {
  // Payments are numbered per invoice: PAY-INV-2026-013, then -2, -3 for splits.
  const base = `PAY-${invoiceId}`;
  const rows = all<{ payment_id: string }>(
    "SELECT payment_id FROM payments WHERE payment_id = ? OR payment_id LIKE ?",
    base,
    `${base}-%`,
  );
  if (!rows.some((r) => r.payment_id === base)) return base;
  const max = rows.reduce((m, r) => {
    const n = Number(r.payment_id.slice(base.length + 1));
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
  return `${base}-${max + 1}`;
}

export function logAudit(entry: { actor?: string; action: string; entity_type: string; entity_id?: string; detail: string }) {
  getDb()
    .prepare("INSERT INTO audit_log (actor,action,entity_type,entity_id,detail,created_at) VALUES (?,?,?,?,?,?)")
    .run(entry.actor ?? "Managing Partner", entry.action, entry.entity_type, entry.entity_id ?? "", entry.detail, new Date().toISOString());
}

// ── Users & auth ─────────────────────────────────────────────────────────────────────────

const SEED_USERS: Array<{
  username: string; name: string; email: string; role: AuthUser["role"];
  envVar: string; label: string;
}> = [
  { username: "admin", name: "Managing Partner", email: "partner@firm.local", role: "partner", envVar: "ADMIN_PASSWORD", label: "Partner — full access" },
  { username: "manager", name: "Operations Manager", email: "manager@firm.local", role: "manager", envVar: "MANAGER_PASSWORD", label: "Manager — compliance, billing, clients" },
  { username: "staff", name: "Article Assistant", email: "staff@firm.local", role: "article", envVar: "STAFF_PASSWORD", label: "Article assistant — read-only plus timesheets & messages" },
];

/**
 * First run creates three role-tiered accounts. Passwords come from the
 * environment when provided; otherwise a random one is generated and written
 * once to `.data/bootstrap-credentials.txt` (mode 0600 — never served,
 * never in git). The file tells the operator to change them immediately.
 */
function seedUsersIfEmpty(db: DatabaseSync) {
  const count = db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number };
  if (count.n > 0) return;

  const insert = db.prepare(
    "INSERT INTO users (user_id,username,name,email,role,password_hash,created_at) VALUES (?,?,?,?,?,?,?)",
  );
  const lines: string[] = [
    "CADocs — first-run credentials",
    "Change these immediately in Settings → Security. Keep this file private (0600) or delete it after storing the passwords in your password manager.",
    "",
  ];

  db.exec("BEGIN");
  try {
    SEED_USERS.forEach((user, i) => {
      const envPassword = process.env[user.envVar];
      const password = envPassword && envPassword.length >= 8 ? envPassword : generatePassword();
      insert.run(
        `USER-${String(i + 1).padStart(3, "0")}`,
        user.username,
        user.name,
        user.email,
        user.role,
        hashPassword(password),
        new Date().toISOString(),
      );
      if (!envPassword) lines.push(`${user.username.padEnd(8)} ${password}   (${user.label})`);
    });
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  if (lines.length > 3) {
    fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
    const bootFile = path.join(path.dirname(DB_FILE), "bootstrap-credentials.txt");
    fs.writeFileSync(bootFile, `${lines.join("\n")}\n`, { mode: 0o600 });
    try {
      fs.chmodSync(bootFile, 0o600);
    } catch {
      // best effort without POSIX permissions
    }
  }
}

export function listUsers(): AuthUser[] {
  return all<AuthUser>("SELECT user_id, username, name, email, role, created_at, last_login FROM users ORDER BY username");
}

export function getUserForLogin(username: string): (AuthUser & { password_hash: string }) | null {
  return one<AuthUser & { password_hash: string }>(
    "SELECT user_id, username, name, email, role, created_at, last_login, token_version, password_hash FROM users WHERE username = ?",
    username.toLowerCase().trim(),
  );
}

export function getUserById(userId: string): AuthUser | null {
  return one<AuthUser>(
    "SELECT user_id, username, name, email, role, created_at, last_login, token_version FROM users WHERE user_id = ?",
    userId,
  );
}

/** Revokes every outstanding session token for a user (logout / password change). */
export function bumpTokenVersion(userId: string): number {
  getDb().prepare("UPDATE users SET token_version = COALESCE(token_version, 0) + 1 WHERE user_id = ?").run(userId);
  const row = one<{ token_version: number }>("SELECT token_version FROM users WHERE user_id = ?", userId);
  return row?.token_version ?? 0;
}

export function createUser(input: { username: string; name: string; email?: string; role: AuthUser["role"]; password: string }): AuthUser {
  const db = getDb();
  const max = one<{ max: number | null }>("SELECT MAX(CAST(SUBSTR(user_id, 6) AS INTEGER)) AS max FROM users");
  const userId = `USER-${String((max?.max ?? 0) + 1).padStart(3, "0")}`;
  const username = input.username.toLowerCase().trim();
  const exists = db.prepare("SELECT 1 FROM users WHERE username = ?").get(username);
  if (exists) throw new Error("That username is already taken");
  db.prepare("INSERT INTO users (user_id,username,name,email,role,password_hash,created_at) VALUES (?,?,?,?,?,?,?)")
    .run(userId, username, input.name.trim(), input.email?.trim() ?? "", input.role, hashPassword(input.password), new Date().toISOString());
  logAudit({ action: "USER_CREATED", entity_type: "user", entity_id: userId, detail: `${username} onboarded as ${input.role}` });
  return getUserById(userId)!;
}

export function setUserPassword(userId: string, password: string): void {
  getDb().prepare("UPDATE users SET password_hash = ? WHERE user_id = ?").run(hashPassword(password), userId);
  logAudit({ action: "PASSWORD_CHANGED", entity_type: "user", entity_id: userId, detail: "Login password rotated" });
}

export function recordLogin(userId: string): void {
  getDb().prepare("UPDATE users SET last_login = ? WHERE user_id = ?").run(new Date().toISOString(), userId);
}

// ── AI audit & supervised actions ───────────────────────────────────────────────

export type AiCallRow = {
  id: number; user_id: string; action: string; provider: string | null; model: string | null;
  tool_names: string; tool_calls: number; rounds: number; tokens_in: number; tokens_out: number;
  latency_ms: number; status: string; detail: string; created_at: string;
};

export type AiActionRow = {
  action_id: string; user_id: string; tool: string; args: string; title: string;
  status: "pending" | "approved" | "rejected" | "executed" | "failed";
  result: string; created_at: string; decided_at: string | null;
};

/** Records an AI call. Deliberately stores no prompts, documents or identifiers. */
export function logAiCall(entry: {
  user_id: string; action: string; provider?: string | null; model?: string | null;
  tool_names?: string[]; tool_calls?: number; rounds?: number;
  tokens_in?: number; tokens_out?: number; latency_ms?: number;
  status: string; detail?: string;
}): void {
  getDb()
    .prepare(
      `INSERT INTO ai_calls (user_id,action,provider,model,tool_names,tool_calls,rounds,tokens_in,tokens_out,latency_ms,status,detail,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      entry.user_id,
      entry.action,
      entry.provider ?? null,
      entry.model ?? null,
      (entry.tool_names ?? []).join(","),
      entry.tool_calls ?? 0,
      entry.rounds ?? 0,
      entry.tokens_in ?? 0,
      entry.tokens_out ?? 0,
      entry.latency_ms ?? 0,
      entry.status,
      entry.detail ?? "",
      new Date().toISOString(),
    );
}

export function countAiCallsToday(userId: string): number {
  const row = one<{ n: number }>(
    "SELECT COUNT(*) AS n FROM ai_calls WHERE user_id = ? AND date(created_at) = date('now')",
    userId,
  );
  return row?.n ?? 0;
}

export function recentAiCalls(userId: string, limit = 8): AiCallRow[] {
  return all<AiCallRow>(
    "SELECT * FROM ai_calls WHERE user_id = ? ORDER BY id DESC LIMIT ?",
    userId,
    limit,
  );
}

/** Persists a write proposal awaiting explicit human approval. */
export function createAiAction(entry: { user_id: string; tool: string; args: Record<string, unknown>; title: string }): AiActionRow {
  const row: AiActionRow = {
    action_id: nextId("AIACT", "ai_actions", "action_id"),
    user_id: entry.user_id,
    tool: entry.tool,
    args: JSON.stringify(entry.args),
    title: entry.title.slice(0, 300),
    status: "pending",
    result: "",
    created_at: new Date().toISOString(),
    decided_at: null,
  };
  getDb()
    .prepare("INSERT INTO ai_actions (action_id,user_id,tool,args,title,status,result,created_at) VALUES (?,?,?,?,?,?,?,?)")
    .run(row.action_id, row.user_id, row.tool, row.args, row.title, row.status, row.result, row.created_at);
  logAudit({ action: "AI_ACTION_PROPOSED", entity_type: "ai_action", entity_id: row.action_id, detail: row.title });
  return row;
}

export function getAiAction(actionId: string): AiActionRow | null {
  return one<AiActionRow>("SELECT * FROM ai_actions WHERE action_id = ?", actionId);
}

export function listAiActions(userId: string, limit = 10): AiActionRow[] {
  return all<AiActionRow>("SELECT * FROM ai_actions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?", userId, limit);
}

export function countPendingAiActions(userId: string): number {
  const row = one<{ n: number }>(
    "SELECT COUNT(*) AS n FROM ai_actions WHERE user_id = ? AND status = 'pending'",
    userId,
  );
  return row?.n ?? 0;
}

export function decideAiAction(
  actionId: string,
  status: "approved" | "rejected" | "executed" | "failed",
  result: string,
): AiActionRow | null {
  getDb()
    .prepare("UPDATE ai_actions SET status = ?, result = ?, decided_at = ? WHERE action_id = ?")
    .run(status, result.slice(0, 500), new Date().toISOString(), actionId);
  return getAiAction(actionId);
}

// ── Clients ───────────────────────────────────────────────────────────────────
export function listClients(): Client[] {
  return all<Client>("SELECT * FROM clients ORDER BY name").map(fromDbClient);
}

export function getClient(clientId: string): Client | null {
  const row = one<Client>("SELECT * FROM clients WHERE client_id = ?", clientId);
  return row ? fromDbClient(row) : null;
}

// PAN and GSTIN come back out of storage decrypted; everything above this
// layer only ever sees plaintext values.
function fromDbClient(row: Client): Client {
  return { ...row, gst_number: decryptField(row.gst_number), pan: decryptField(row.pan) };
}

export function createClient(input: Omit<Client, "client_id" | "created_at">): Client {
  const client: Client = { ...input, client_id: nextId("CLIENT", "clients", "client_id"), created_at: new Date().toISOString() };
  getDb()
    .prepare(`INSERT INTO clients (client_id,name,contact_person,phone,email,entity_type,gst_number,pan,services_opted,city,state,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(client.client_id, client.name, client.contact_person, client.phone, client.email, client.entity_type, encryptField(client.gst_number), encryptField(client.pan), client.services_opted, client.city, client.state, client.created_at);
  logAudit({ action: "CLIENT_CREATED", entity_type: "client", entity_id: client.client_id, detail: `${client.name} onboarded` });
  return client;
}

export function updateClient(
  clientId: string,
  patch: Partial<Omit<Client, "client_id" | "created_at">>,
): Client | null {
  const current = getClient(clientId);
  if (!current) return null;
  const next = { ...current, ...patch };
  const db = getDb();
  db.exec("BEGIN");
  try {
    db.prepare(`UPDATE clients SET name=?, contact_person=?, phone=?, email=?, entity_type=?, gst_number=?, pan=?, services_opted=?, city=?, state=? WHERE client_id=?`)
      .run(next.name, next.contact_person, next.phone, next.email, next.entity_type, encryptField(next.gst_number), encryptField(next.pan), next.services_opted, next.city, next.state, clientId);
    if (next.name !== current.name) {
      // Keep the denormalised capture name in sync across the practice.
      db.prepare("UPDATE compliance SET client_name=? WHERE client_id=?").run(next.name, clientId);
      db.prepare("UPDATE documents SET client_name=? WHERE client_id=?").run(next.name, clientId);
      db.prepare("UPDATE invoices SET client_name=? WHERE client_id=?").run(next.name, clientId);
      db.prepare("UPDATE payments SET client_name=? WHERE client_name=?").run(next.name, current.name);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  logAudit({ action: "CLIENT_UPDATED", entity_type: "client", entity_id: clientId, detail: `${next.name} profile updated` });
  return next;
}

export function deleteClient(clientId: string): { ok: boolean; blockers: string[] } {
  const client = getClient(clientId);
  if (!client) return { ok: false, blockers: ["Client not found"] };
  const db = getDb();
  const count = (table: string) =>
    Number((db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE client_id = ?`).get(clientId) as { n: number }).n);
  const blockers: string[] = [];
  const compliance = count("compliance");
  const documents = count("documents");
  const invoices = count("invoices");
  if (compliance) blockers.push(`${compliance} compliance task${compliance === 1 ? "" : "s"}`);
  if (documents) blockers.push(`${documents} document${documents === 1 ? "" : "s"}`);
  if (invoices) blockers.push(`${invoices} invoice${invoices === 1 ? "" : "s"}`);
  if (blockers.length) return { ok: false, blockers };
  db.prepare("DELETE FROM clients WHERE client_id = ?").run(clientId);
  logAudit({ action: "CLIENT_DELETED", entity_type: "client", entity_id: clientId, detail: `${client.name} removed` });
  return { ok: true, blockers: [] };
}

export function getClientDetail(clientId: string): ClientDetail | null {
  const client = getClient(clientId);
  if (!client) return null;
  const invoices = listInvoices().filter((i) => i.client_id === clientId || i.client_name === client.name);
  const compliance = listCompliance().filter((c) => c.client_id === clientId || c.client_name === client.name);
  const documents = listDocuments().filter((d) => d.client_id === clientId || d.client_name === client.name);
  const proposals = listProposals().filter((p) => p.company_name === client.name);
  const messages = listMessages().filter(
    (m) => m.recipient_name === client.name || (client.email && m.to_address === client.email) || (client.phone && m.to_address === client.phone),
  );
  const active = invoices.filter((i) => i.status !== "Cancelled");
  const billed = active.reduce((s, i) => s + i.total_amount, 0);
  const collected = active.reduce((s, i) => s + (i.paid_amount ?? 0), 0);
  const overdue = active
    .filter((i) => i.status === "Overdue" || (i.status !== "Paid" && dayDiff(i.due_date) < 0))
    .reduce((s, i) => s + (i.total_amount - (i.paid_amount ?? 0)), 0);
  return {
    client,
    invoices,
    compliance,
    documents,
    proposals,
    messages,
    totals: { billed, collected, outstanding: billed - collected, overdue },
  };
}

// ── Leads ─────────────────────────────────────────────────────────────────────
export function listLeads(): Lead[] {
  return all<Lead>("SELECT * FROM leads ORDER BY lead_score DESC");
}

export function createLead(input: Omit<Lead, "lead_id" | "created_at">): Lead {
  const lead: Lead = { ...input, lead_id: nextId("LEAD", "leads", "lead_id"), created_at: new Date().toISOString() };
  getDb()
    .prepare(`INSERT INTO leads (lead_id,name,company_name,phone,email,source,service_interest,lead_score,category,status,notes,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(lead.lead_id, lead.name, lead.company_name, lead.phone, lead.email, lead.source, lead.service_interest, lead.lead_score, lead.category, lead.status, lead.notes, lead.created_at);
  logAudit({ action: "LEAD_CREATED", entity_type: "lead", entity_id: lead.lead_id, detail: `${lead.name} (${lead.company_name}) added` });
  return lead;
}

export function updateLead(leadId: string, patch: Partial<Pick<Lead, "status" | "category" | "lead_score" | "notes">>): Lead | null {
  const current = one<Lead>("SELECT * FROM leads WHERE lead_id = ?", leadId);
  if (!current) return null;
  const next = { ...current, ...patch };
  getDb()
    .prepare("UPDATE leads SET status=?, category=?, lead_score=?, notes=? WHERE lead_id=?")
    .run(next.status, next.category, next.lead_score, next.notes, leadId);
  logAudit({ action: "LEAD_UPDATE", entity_type: "lead", entity_id: leadId, detail: `${current.name} moved to ${next.status}` });
  return next;
}

// ── Compliance ────────────────────────────────────────────────────────────────
function effectiveComplianceStatus(row: Compliance): Compliance["status"] {
  if (row.status === "Filed") return "Filed";
  if (dayDiff(row.due_date) < 0) return "Overdue";
  return row.status;
}

export function listCompliance(): Compliance[] {
  return all<Compliance>("SELECT * FROM compliance ORDER BY due_date").map((r) => ({ ...r, status: effectiveComplianceStatus(r) }));
}

export function createCompliance(input: Omit<Compliance, "compliance_id">): Compliance {
  const item: Compliance = { ...input, compliance_id: nextId("COMP", "compliance", "compliance_id") };
  getDb()
    .prepare(`INSERT INTO compliance (compliance_id,client_id,client_name,compliance_type,period,due_date,status,filed_date,ack_number,assigned_to,notes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(item.compliance_id, item.client_id, item.client_name, item.compliance_type, item.period, item.due_date, item.status, item.filed_date, item.ack_number, item.assigned_to, item.notes);
  logAudit({ action: "COMPLIANCE_CREATED", entity_type: "compliance", entity_id: item.compliance_id, detail: `${item.compliance_type} for ${item.client_name}` });
  return item;
}

export function updateComplianceStatus(complianceId: string, status: Compliance["status"]): Compliance | null {
  const current = one<Compliance>("SELECT * FROM compliance WHERE compliance_id = ?", complianceId);
  if (!current) return null;
  const filed = status === "Filed";
  const ackNumber = filed ? current.ack_number || `ACK${Date.now().toString().slice(-6)}` : current.ack_number;
  const filedDate = filed ? iso(0) : current.filed_date;
  getDb()
    .prepare("UPDATE compliance SET status=?, filed_date=?, ack_number=? WHERE compliance_id=?")
    .run(status, filedDate, ackNumber, complianceId);
  logAudit({ action: "STATUS_CHANGE", entity_type: "compliance", entity_id: complianceId, detail: `${current.compliance_type} for ${current.client_name} → ${status}` });
  return { ...current, status, filed_date: filedDate, ack_number: ackNumber };
}

// ── Documents ─────────────────────────────────────────────────────────────────
export function listDocuments(): DocumentItem[] {
  return all<DocumentItem>("SELECT * FROM documents ORDER BY CASE status WHEN 'Pending' THEN 0 ELSE 1 END, requested_date DESC");
}

export function getDocument(docId: string): DocumentItem | null {
  return one<DocumentItem>("SELECT * FROM documents WHERE doc_id = ?", docId);
}

export function createDocument(
  input: Omit<DocumentItem, "doc_id" | "file_name" | "file_size" | "file_path" | "uploaded_at">,
): DocumentItem {
  const doc: DocumentItem = {
    ...input,
    doc_id: nextId("DOC", "documents", "doc_id"),
    file_name: null,
    file_size: null,
    file_path: null,
    uploaded_at: null,
  };
  getDb()
    .prepare("INSERT INTO documents (doc_id,client_id,client_name,document_name,status,requested_date,received_date,notes) VALUES (?,?,?,?,?,?,?,?)")
    .run(doc.doc_id, doc.client_id, doc.client_name, doc.document_name, doc.status, doc.requested_date, doc.received_date, doc.notes);
  logAudit({ action: "DOCUMENT_REQUESTED", entity_type: "document", entity_id: doc.doc_id, detail: `${doc.document_name} requested from ${doc.client_name}` });
  return doc;
}

export function attachDocumentFile(
  docId: string,
  file: { file_name: string; file_size: number; file_path: string },
): DocumentItem | null {
  const current = getDocument(docId);
  if (!current) return null;
  const uploadedAt = new Date().toISOString();
  getDb()
    .prepare("UPDATE documents SET file_name=?, file_size=?, file_path=?, uploaded_at=?, status='Received', received_date=? WHERE doc_id=?")
    .run(file.file_name, file.file_size, file.file_path, uploadedAt, iso(0), docId);
  logAudit({ action: "DOCUMENT_UPLOADED", entity_type: "document", entity_id: docId, detail: `${file.file_name} uploaded for ${current.client_name}` });
  return { ...current, ...file, uploaded_at: uploadedAt, status: "Received", received_date: iso(0) };
}

export function clearDocumentFile(docId: string): DocumentItem | null {
  const current = getDocument(docId);
  if (!current) return null;
  getDb()
    .prepare("UPDATE documents SET file_name=NULL, file_size=NULL, file_path=NULL, uploaded_at=NULL, status='Pending', received_date=NULL WHERE doc_id=?")
    .run(docId);
  logAudit({ action: "DOCUMENT_FILE_REMOVED", entity_type: "document", entity_id: docId, detail: `File removed from ${current.document_name}` });
  return { ...current, file_name: null, file_size: null, file_path: null, uploaded_at: null, status: "Pending", received_date: null };
}

export function updateDocumentStatus(docId: string, status: DocumentItem["status"]): DocumentItem | null {
  const current = one<DocumentItem>("SELECT * FROM documents WHERE doc_id = ?", docId);
  if (!current) return null;
  const received = status === "Received" || status === "Verified";
  getDb()
    .prepare("UPDATE documents SET status=?, received_date=? WHERE doc_id=?")
    .run(status, received ? iso(0) : current.received_date, docId);
  logAudit({ action: "DOCUMENT_RECEIVED", entity_type: "document", entity_id: docId, detail: `${current.document_name} ${status.toLowerCase()} from ${current.client_name}` });
  return { ...current, status, received_date: received ? iso(0) : current.received_date };
}

// ── Invoices ──────────────────────────────────────────────────────────────────
function effectiveInvoiceStatus(row: Invoice): Invoice["status"] {
  if (row.status === "Cancelled") return "Cancelled";
  const paid = row.paid_amount ?? 0;
  if (paid >= row.total_amount) return "Paid";
  if (dayDiff(row.due_date) < 0) return "Overdue";
  if (paid > 0) return "Partially Paid";
  return "Pending";
}

function normaliseInvoice(row: Invoice): Invoice {
  const invoice = { ...row, paid_amount: row.paid_amount ?? 0 };
  return { ...invoice, status: effectiveInvoiceStatus(invoice) };
}

export function listInvoices(): Invoice[] {
  return all<Invoice>("SELECT * FROM invoices ORDER BY invoice_date DESC").map(normaliseInvoice);
}

export function getInvoice(invoiceId: string): Invoice | null {
  const row = one<Invoice>("SELECT * FROM invoices WHERE invoice_id = ?", invoiceId);
  return row ? normaliseInvoice(row) : null;
}

function nextInvoiceId(): string {
  const prefix = `INV-${new Date().getFullYear()}-`;
  const row = one<{ max: number | null }>(
    `SELECT MAX(CAST(SUBSTR(invoice_id, ${prefix.length + 1}) AS INTEGER)) AS max FROM invoices WHERE invoice_id LIKE ?`,
    `${prefix}%`,
  );
  return `${prefix}${String((row?.max ?? 0) + 1).padStart(3, "0")}`;
}

export function createInvoice(input: Omit<Invoice, "invoice_id" | "paid_amount"> & { paid_amount?: number }): Invoice {
  const invoice: Invoice = {
    ...input,
    invoice_id: nextInvoiceId(),
    paid_amount: input.paid_amount ?? 0,
  };
  getDb()
    .prepare(`INSERT INTO invoices (invoice_id,client_id,client_name,invoice_date,due_date,service_description,amount,gst_amount,total_amount,paid_amount,status,paid_date)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(invoice.invoice_id, invoice.client_id, invoice.client_name, invoice.invoice_date, invoice.due_date, invoice.service_description, invoice.amount, invoice.gst_amount, invoice.total_amount, invoice.paid_amount, invoice.status, invoice.paid_date);
  logAudit({ action: "INVOICE_CREATED", entity_type: "invoice", entity_id: invoice.invoice_id, detail: `Invoice for ${invoice.client_name} — ₹${invoice.total_amount}` });
  return invoice;
}

export function updateInvoiceStatus(invoiceId: string, status: "Pending" | "Paid" | "Cancelled"): Invoice | null {
  const current = getInvoice(invoiceId);
  if (!current) return null;
  const db = getDb();
  const paidAmount = status === "Paid" ? current.total_amount : current.paid_amount;
  const paidDate = status === "Paid" ? iso(0) : current.paid_date;

  if (status === "Paid") {
    const balance = Math.round((current.total_amount - current.paid_amount) * 100) / 100;
    if (balance > 0) {
      // Keep the payment ledger complete when an invoice is settled manually.
      db.prepare(`INSERT INTO payments (payment_id,invoice_id,client_name,amount,paid_on,mode,reference,notes,created_at)
        VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(nextPaymentId(invoiceId), invoiceId, current.client_name, balance, iso(0), "Other", "", "Marked paid from invoice", new Date().toISOString());
    }
  }

  db.prepare("UPDATE invoices SET status=?, paid_amount=?, paid_date=? WHERE invoice_id=?")
    .run(status, paidAmount, paidDate, invoiceId);
  logAudit({ action: "INVOICE_UPDATED", entity_type: "invoice", entity_id: invoiceId, detail: `${invoiceId} for ${current.client_name} → ${status}` });
  return normaliseInvoice({ ...current, status, paid_amount: paidAmount, paid_date: paidDate });
}

export function listPayments(): Payment[] {
  return all<Payment>("SELECT * FROM payments ORDER BY paid_on DESC, created_at DESC");
}

export function listPaymentsForInvoice(invoiceId: string): Payment[] {
  return all<Payment>("SELECT * FROM payments WHERE invoice_id = ? ORDER BY paid_on DESC, created_at DESC", invoiceId);
}

export function recordPayment(
  invoiceId: string,
  input: { amount: number; paid_on: string; mode: Payment["mode"]; reference: string; notes: string },
): Payment | null {
  const invoice = getInvoice(invoiceId);
  if (!invoice || invoice.status === "Cancelled") return null;
  const payment: Payment = {
    payment_id: nextPaymentId(invoiceId),
    invoice_id: invoiceId,
    client_name: invoice.client_name,
    amount: input.amount,
    paid_on: input.paid_on,
    mode: input.mode,
    reference: input.reference,
    notes: input.notes,
    created_at: new Date().toISOString(),
  };
  const db = getDb();
  db.exec("BEGIN");
  try {
    db.prepare(`INSERT INTO payments (payment_id,invoice_id,client_name,amount,paid_on,mode,reference,notes,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(payment.payment_id, payment.invoice_id, payment.client_name, payment.amount, payment.paid_on, payment.mode, payment.reference, payment.notes, payment.created_at);
    const paidAmount = Math.round((invoice.paid_amount + input.amount) * 100) / 100;
    const fullyPaid = paidAmount >= invoice.total_amount;
    const status = fullyPaid ? "Paid" : invoice.status === "Overdue" ? "Overdue" : "Partially Paid";
    db.prepare("UPDATE invoices SET paid_amount=?, status=?, paid_date=? WHERE invoice_id=?")
      .run(paidAmount, status, fullyPaid ? input.paid_on : invoice.paid_date, invoiceId);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  logAudit({ action: "PAYMENT_RECEIVED", entity_type: "invoice", entity_id: invoiceId, detail: `₹${input.amount} received from ${invoice.client_name} (${input.mode})` });
  return payment;
}

// ── UDIN ──────────────────────────────────────────────────────────────────────
export function listUdin(): Udin[] {
  return all<Udin>("SELECT * FROM udin ORDER BY generated_date DESC");
}

export function getUdinByValue(value: string): Udin | null {
  return one<Udin>("SELECT * FROM udin WHERE udin = ?", value);
}

export function createUdin(input: Omit<Udin, "udin_id">): Udin {
  const item: Udin = { ...input, udin_id: nextId("UDIN", "udin", "udin_id") };
  getDb()
    .prepare("INSERT INTO udin (udin_id,udin,client_name,document_type,financial_year,generated_date,ca_member_no,notes) VALUES (?,?,?,?,?,?,?,?)")
    .run(item.udin_id, item.udin, item.client_name, item.document_type, item.financial_year, item.generated_date, item.ca_member_no, item.notes);
  logAudit({ action: "UDIN_GENERATED", entity_type: "udin", entity_id: item.udin_id, detail: `${item.udin} for ${item.client_name}` });
  return item;
}

export function deleteUdin(udinId: string): boolean {
  const result = getDb().prepare("DELETE FROM udin WHERE udin_id = ?").run(udinId);
  return Number(result.changes) > 0;
}

// ── DSC ───────────────────────────────────────────────────────────────────────
function dscStatus(validUntil: string): Dsc["status"] {
  const days = dayDiff(validUntil);
  if (days < 0) return "Expired";
  if (days <= 30) return "Expiring Soon";
  return "Active";
}

export function listDsc(): Dsc[] {
  return all<Dsc>("SELECT * FROM dsc ORDER BY valid_until").map((r) => ({ ...r, status: dscStatus(r.valid_until) }));
}

export function createDsc(input: Omit<Dsc, "dsc_id">): Dsc {
  const item: Dsc = { ...input, dsc_id: nextId("DSC", "dsc", "dsc_id") };
  getDb()
    .prepare("INSERT INTO dsc (dsc_id,client_name,holder_name,class_type,valid_from,valid_until,token_serial,status) VALUES (?,?,?,?,?,?,?,?)")
    .run(item.dsc_id, item.client_name, item.holder_name, item.class_type, item.valid_from, item.valid_until, item.token_serial, item.status);
  logAudit({ action: "DSC_ADDED", entity_type: "dsc", entity_id: item.dsc_id, detail: `${item.holder_name} — ${item.client_name}` });
  return { ...item, status: dscStatus(item.valid_until) };
}

// ── Notices ───────────────────────────────────────────────────────────────────
export function listNotices(): Notice[] {
  return all<Notice>("SELECT * FROM notices ORDER BY response_deadline");
}

export function createNotice(input: Omit<Notice, "notice_id">): Notice {
  const item: Notice = { ...input, notice_id: nextId("NTC", "notices", "notice_id") };
  getDb()
    .prepare(`INSERT INTO notices (notice_id,client_name,notice_type,portal,notice_date,response_deadline,reference_number,amount,status,notes)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(item.notice_id, item.client_name, item.notice_type, item.portal, item.notice_date, item.response_deadline, item.reference_number, item.amount, item.status, item.notes);
  logAudit({ action: "NOTICE_ADDED", entity_type: "notice", entity_id: item.notice_id, detail: `${item.notice_type} for ${item.client_name}` });
  return item;
}

export function updateNoticeStatus(noticeId: string, status: Notice["status"]): Notice | null {
  const current = one<Notice>("SELECT * FROM notices WHERE notice_id = ?", noticeId);
  if (!current) return null;
  getDb().prepare("UPDATE notices SET status=? WHERE notice_id=?").run(status, noticeId);
  logAudit({ action: "NOTICE_RESPONSE", entity_type: "notice", entity_id: noticeId, detail: `${current.notice_type} → ${status}` });
  return { ...current, status };
}

// ── Timesheets ────────────────────────────────────────────────────────────────
export function listTimesheets(): Timesheet[] {
  return all<Record<string, unknown>>("SELECT * FROM timesheets ORDER BY date DESC").map((r) => ({
    ...(r as unknown as Timesheet),
    billable: Boolean(r.billable),
  }));
}

export function createTimesheet(input: Omit<Timesheet, "timesheet_id" | "created_at">): Timesheet {
  const item: Timesheet = { ...input, timesheet_id: nextId("TS", "timesheets", "timesheet_id"), created_at: new Date().toISOString() };
  getDb()
    .prepare("INSERT INTO timesheets (timesheet_id,user_name,client_name,date,task_type,description,hours,billable,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(item.timesheet_id, item.user_name, item.client_name, item.date, item.task_type, item.description, item.hours, item.billable ? 1 : 0, item.status, item.created_at);
  logAudit({ action: "TIMESHEET_LOGGED", entity_type: "timesheet", entity_id: item.timesheet_id, detail: `${item.hours}h logged by ${item.user_name}` });
  return item;
}

export function updateTimesheet(timesheetId: string, status: Timesheet["status"]): Timesheet | null {
  const current = one<Record<string, unknown>>("SELECT * FROM timesheets WHERE timesheet_id = ?", timesheetId);
  if (!current) return null;
  getDb().prepare("UPDATE timesheets SET status=? WHERE timesheet_id=?").run(status, timesheetId);
  logAudit({ action: "TIMESHEET_APPROVED", entity_type: "timesheet", entity_id: timesheetId, detail: `${status} — ${current.user_name}` });
  return { ...(current as unknown as Timesheet), billable: Boolean(current.billable), status };
}

// ── Settings ──────────────────────────────────────────────────────────────────
export function getSettings(): Settings {
  const rows = all<{ key: string; value: string }>("SELECT key, value FROM settings");
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export function updateSettings(patch: Settings): Settings {
  const stmt = getDb().prepare("INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
  Object.entries(patch).forEach(([k, v]) => stmt.run(k, String(v)));
  return getSettings();
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
export function getDashboard(): DashboardData {
  const clients = listClients();
  const compliance = listCompliance();
  const documents = listDocuments();
  const invoices = listInvoices();
  const leads = listLeads();
  const notices = listNotices();
  const timesheets = listTimesheets();

  const payments = listPayments();
  const pendingInvoices = invoices.filter((i) => i.status !== "Cancelled" && i.paid_amount < i.total_amount);
  const totalBilled = invoices.reduce((sum, i) => sum + (i.status === "Cancelled" ? 0 : i.total_amount), 0);
  const totalCollected = invoices.reduce((sum, i) => sum + (i.status === "Cancelled" ? 0 : i.paid_amount), 0);
  const overdueInvoices = pendingInvoices
    .filter((i) => dayDiff(i.due_date) < 0)
    .map((i) => ({ ...i, daysOverdue: Math.abs(dayDiff(i.due_date)), balance: i.total_amount - i.paid_amount }))
    .sort((a, b) => b.daysOverdue - a.daysOverdue);

  const openCompliance = compliance.filter((c) => c.status !== "Filed");
  const dueThisWeek = openCompliance.filter((c) => {
    const d = dayDiff(c.due_date);
    return d >= 0 && d <= 7;
  });

  const months: Array<{ month: string; billed: number; collected: number }> = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("en-IN", { month: "short" });
    const inMonth = invoices.filter((inv) => inv.invoice_date.startsWith(key) && inv.status !== "Cancelled");
    const collectedInMonth = payments.filter((p) => p.paid_on.startsWith(key));
    months.push({
      month: label,
      billed: inMonth.reduce((s, inv) => s + inv.total_amount, 0),
      collected: collectedInMonth.reduce((s, p) => s + p.amount, 0),
    });
  }

  const pipelineOrder: Lead["status"][] = ["New", "Contacted", "Qualified", "Proposal Sent", "Won", "Lost"];
  const pipeline = pipelineOrder.map((status) => ({ status, count: leads.filter((l) => l.status === status).length }));

  return {
    kpis: {
      activeClients: clients.length,
      pendingDocuments: documents.filter((d) => d.status === "Pending").length,
      complianceDueThisWeek: dueThisWeek.length,
      overdueCompliance: openCompliance.filter((c) => c.status === "Overdue").length,
      overdueFees: overdueInvoices.reduce((s, i) => s + i.balance, 0),
      totalBilled,
      totalCollected,
      collectionRate: totalBilled > 0 ? Math.round((totalCollected / totalBilled) * 1000) / 10 : 0,
      openLeads: leads.filter((l) => !["Won", "Lost"].includes(l.status)).length,
      hotLeads: leads.filter((l) => l.category === "Hot" && !["Won", "Lost"].includes(l.status)).length,
      pendingTimesheets: timesheets.filter((t) => t.status === "Pending").length,
      activeNotices: notices.filter((n) => n.status !== "Closed").length,
    },
    urgentCompliance: openCompliance
      .map((c) => ({ ...c, daysUntilDue: dayDiff(c.due_date) }))
      .sort((a, b) => a.daysUntilDue - b.daysUntilDue)
      .slice(0, 6),
    recentActivity: all<AuditEntry>("SELECT * FROM audit_log ORDER BY id DESC LIMIT 8"),
    overdueInvoices: overdueInvoices.slice(0, 5),
    revenueByMonth: months,
    pipeline,
  };
}

/**
 * Cheap badge counts for the app shell. Keeps the root layout from loading
 * every row of every module on each navigation.
 */
export function getNavCounts() {
  const db = getDb();
  const count = (sql: string, ...params: Array<string | number | null>) =>
    Number((db.prepare(sql).get(...params) as unknown as { n: number } | undefined)?.n ?? 0);

  const today = localIso(0);
  const week = localIso(7);

  return {
    documents: count("SELECT COUNT(*) AS n FROM documents WHERE status = 'Pending'"),
    compliance: count("SELECT COUNT(*) AS n FROM compliance WHERE status <> 'Filed' AND due_date <= ?", week),
    leads: count("SELECT COUNT(*) AS n FROM leads WHERE status NOT IN ('Won','Lost')"),
    invoices: count("SELECT COUNT(*) AS n FROM invoices WHERE status NOT IN ('Paid','Cancelled') AND due_date < ?", today),
    agent: 0,
  };
}

// ── Proposals ─────────────────────────────────────────────────────────────────
export function listProposals(): Proposal[] {
  return all<Proposal>("SELECT * FROM proposals ORDER BY created_at DESC");
}

export function getProposal(proposalId: string): Proposal | null {
  return one<Proposal>("SELECT * FROM proposals WHERE proposal_id = ?", proposalId);
}

export function createProposal(
  input: Omit<Proposal, "proposal_id" | "created_at" | "body" | "converted_client_id"> & { body?: string },
): Proposal {
  const proposalId = nextId("PROP", "proposals", "proposal_id");
  const settings = getSettings();
  const proposal: Proposal = {
    ...input,
    proposal_id: proposalId,
    converted_client_id: null,
    body:
      input.body ??
      buildProposal({
        reference: proposalId,
        firmName: settings.firm_name ?? "Sharma & Associates",
        firmAddress: settings.firm_address ?? "Mumbai",
        firmPhone: settings.firm_phone ?? "",
        firmEmail: settings.firm_email ?? "",
        memberNo: settings.ca_member_no ?? "",
        prospectName: input.prospect_name,
        companyName: input.company_name,
        entityType: input.entity_type,
        services: input.services,
        fee: input.fee,
      }),
    created_at: new Date().toISOString(),
  };
  getDb()
    .prepare(`INSERT INTO proposals (proposal_id,lead_id,prospect_name,company_name,entity_type,services,fee,body,status,converted_client_id,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(proposal.proposal_id, proposal.lead_id, proposal.prospect_name, proposal.company_name, proposal.entity_type, proposal.services, proposal.fee, proposal.body, proposal.status, proposal.converted_client_id, proposal.created_at);
  logAudit({ action: "PROPOSAL_GENERATED", entity_type: "proposal", entity_id: proposal.proposal_id, detail: `Proposal for ${proposal.company_name} — ${proposal.fee}` });
  return proposal;
}

export function updateProposalStatus(proposalId: string, status: Proposal["status"]): Proposal | null {
  const current = getProposal(proposalId);
  if (!current) return null;
  getDb().prepare("UPDATE proposals SET status=? WHERE proposal_id=?").run(status, proposalId);
  logAudit({ action: "PROPOSAL_UPDATE", entity_type: "proposal", entity_id: proposalId, detail: `${current.company_name} proposal → ${status}` });
  return { ...current, status };
}

export function convertProposal(proposalId: string): { proposal: Proposal; client: Client; created: boolean } | null {
  const proposal = getProposal(proposalId);
  if (!proposal) return null;
  const lead = listLeads().find((l) => l.lead_id === proposal.lead_id);
  const existing = listClients().find((c) => c.name.toLowerCase() === proposal.company_name.toLowerCase());
  const db = getDb();

  if (existing) {
    db.prepare("UPDATE proposals SET status='Accepted', converted_client_id=? WHERE proposal_id=?").run(existing.client_id, proposalId);
    if (lead && !["Won", "Lost"].includes(lead.status)) updateLead(lead.lead_id, { status: "Won" });
    logAudit({ action: "PROPOSAL_CONVERTED", entity_type: "proposal", entity_id: proposalId, detail: `${proposal.company_name} matched to existing client ${existing.client_id}` });
    return { proposal: { ...proposal, status: "Accepted", converted_client_id: existing.client_id }, client: existing, created: false };
  }

  const client = createClient({
    name: proposal.company_name || proposal.prospect_name,
    contact_person: proposal.prospect_name,
    phone: lead?.phone ?? "",
    email: lead?.email ?? "",
    entity_type: proposal.entity_type || "Private Limited",
    gst_number: "",
    pan: "",
    services_opted: proposal.services || "GST Filing, ITR",
    city: "",
    state: "",
  });
  db.prepare("UPDATE proposals SET status='Accepted', converted_client_id=? WHERE proposal_id=?").run(client.client_id, proposalId);
  if (lead && !["Won", "Lost"].includes(lead.status)) updateLead(lead.lead_id, { status: "Won" });
  logAudit({ action: "PROPOSAL_CONVERTED", entity_type: "proposal", entity_id: proposalId, detail: `${proposal.company_name} converted to client ${client.client_id}` });
  return { proposal: { ...proposal, status: "Accepted", converted_client_id: client.client_id }, client, created: true };
}

// ── Campaigns ─────────────────────────────────────────────────────────────────
export function listCampaigns(): Campaign[] {
  return all<Campaign>("SELECT * FROM campaigns ORDER BY created_at DESC");
}

export function createCampaign(input: Omit<Campaign, "campaign_id" | "created_at">): Campaign {
  const campaign: Campaign = {
    ...input,
    campaign_id: nextId("CMP", "campaigns", "campaign_id"),
    created_at: new Date().toISOString(),
  };
  getDb()
    .prepare("INSERT INTO campaigns (campaign_id,name,channel,audience,subject,message,recipients,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(campaign.campaign_id, campaign.name, campaign.channel, campaign.audience, campaign.subject, campaign.message, campaign.recipients, campaign.status, campaign.created_at);
  logAudit({ action: "CAMPAIGN_DRAFTED", entity_type: "campaign", entity_id: campaign.campaign_id, detail: `${campaign.name} — ${campaign.recipients} ${campaign.channel} recipients` });
  return campaign;
}

export function updateCampaignStatus(campaignId: string, status: Campaign["status"]): Campaign | null {
  const current = one<Campaign>("SELECT * FROM campaigns WHERE campaign_id = ?", campaignId);
  if (!current) return null;
  getDb().prepare("UPDATE campaigns SET status=? WHERE campaign_id=?").run(status, campaignId);
  logAudit({ action: "CAMPAIGN_UPDATE", entity_type: "campaign", entity_id: campaignId, detail: `${current.name} → ${status}` });
  return { ...current, status };
}

// ── Client communication log ──────────────────────────────────────────────────
export function listMessages(): Message[] {
  return all<Message>("SELECT * FROM messages ORDER BY created_at DESC LIMIT 500");
}

export function createMessage(input: Omit<Message, "message_id" | "created_at">): Message {
  const message: Message = { ...input, message_id: nextId("MESSAGE", "messages", "message_id"), created_at: new Date().toISOString() };
  getDb()
    .prepare(`INSERT INTO messages (message_id,channel,recipient_name,to_address,subject,body,related_type,related_id,status,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(message.message_id, message.channel, message.recipient_name, message.to_address, message.subject, message.body, message.related_type, message.related_id, message.status, message.created_at);
  logAudit({ action: "MESSAGE_LOGGED", entity_type: message.related_type || "message", entity_id: message.related_id, detail: `${message.channel} reminder to ${message.recipient_name}` });
  return message;
}

// ── Recurring compliance ──────────────────────────────────────────────────────
export function generateCompliance(input: {
  compliance_type: string;
  period: string;
  due_date: string;
  assigned_to: string;
  client_ids: string[];
}): { created: number; skipped: number; ids: string[] } {
  let created = 0;
  let skipped = 0;
  const ids: string[] = [];
  for (const clientId of input.client_ids) {
    const client = getClient(clientId);
    if (!client) {
      skipped++;
      continue;
    }
    const duplicate = one<{ compliance_id: string }>(
      "SELECT compliance_id FROM compliance WHERE client_id = ? AND compliance_type = ? AND period = ?",
      clientId,
      input.compliance_type,
      input.period,
    );
    if (duplicate) {
      skipped++;
      continue;
    }
    const item = createCompliance({
      client_id: client.client_id,
      client_name: client.name,
      compliance_type: input.compliance_type,
      period: input.period,
      due_date: input.due_date,
      status: "Pending",
      filed_date: null,
      ack_number: null,
      assigned_to: input.assigned_to,
      notes: "Generated from recurring template",
    });
    ids.push(item.compliance_id);
    created++;
  }
  logAudit({ action: "COMPLIANCE_BULK", entity_type: "compliance", entity_id: "", detail: `${created} ${input.compliance_type} task(s) generated for ${input.period}` });
  return { created, skipped, ids };
}

// ── Reports ───────────────────────────────────────────────────────────────────
export function getReports(): ReportData {
  const invoices = listInvoices();
  const payments = listPayments();
  const compliance = listCompliance();
  const timesheets = listTimesheets();
  const leads = listLeads();
  const clients = listClients();

  const active = invoices.filter((i) => i.status !== "Cancelled");
  const billed = active.reduce((s, i) => s + i.total_amount, 0);
  const collected = active.reduce((s, i) => s + i.paid_amount, 0);
  const outstanding = billed - collected;
  const openInvoices = active.filter((i) => i.total_amount - i.paid_amount > 0);
  const overdueInvoices = openInvoices.filter((i) => dayDiff(i.due_date) < 0);
  const overdue = overdueInvoices.reduce((s, i) => s + (i.total_amount - i.paid_amount), 0);
  const paidInvoices = active.filter((i) => i.status === "Paid" && i.paid_date);
  const avgDaysToPay = paidInvoices.length
    ? Math.round(
        paidInvoices.reduce((s, i) => {
          const start = new Date(`${i.invoice_date}T00:00:00`).getTime();
          const end = new Date(`${i.paid_date}T00:00:00`).getTime();
          return s + Math.max(0, Math.round((end - start) / 86400000));
        }, 0) / paidInvoices.length,
      )
    : 0;

  const buckets: Array<{ bucket: string; amount: number; count: number }> = [
    { bucket: "Not due", amount: 0, count: 0 },
    { bucket: "1–30 days", amount: 0, count: 0 },
    { bucket: "31–60 days", amount: 0, count: 0 },
    { bucket: "61–90 days", amount: 0, count: 0 },
    { bucket: "90+ days", amount: 0, count: 0 },
  ];
  openInvoices.forEach((invoice) => {
    const balance = invoice.total_amount - invoice.paid_amount;
    const days = -dayDiff(invoice.due_date);
    const index = days <= 0 ? 0 : days <= 30 ? 1 : days <= 60 ? 2 : days <= 90 ? 3 : 4;
    buckets[index].amount += balance;
    buckets[index].count += 1;
  });

  const monthly: ReportData["monthly"] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    monthly.push({
      month: d.toLocaleDateString("en-IN", { month: "short" }),
      billed: active.filter((inv) => inv.invoice_date.startsWith(key)).reduce((s, inv) => s + inv.total_amount, 0),
      collected: payments.filter((p) => p.paid_on.startsWith(key)).reduce((s, p) => s + p.amount, 0),
    });
  }

  const utilizationMap = new Map<string, { hours: number; billable: number; approved: number; clients: Set<string> }>();
  timesheets.forEach((t) => {
    const entry = utilizationMap.get(t.user_name) ?? { hours: 0, billable: 0, approved: 0, clients: new Set<string>() };
    entry.hours += t.hours;
    if (t.billable) entry.billable += t.hours;
    if (t.status === "Approved") entry.approved += t.hours;
    entry.clients.add(t.client_name);
    utilizationMap.set(t.user_name, entry);
  });
  const utilization = Array.from(utilizationMap.entries())
    .map(([user, entry]) => ({ user, hours: entry.hours, billable: entry.billable, approved: entry.approved, clients: entry.clients.size }))
    .sort((a, b) => b.hours - a.hours);

  const filed = compliance.filter((c) => c.status === "Filed");
  const onTime = filed.filter((c) => c.filed_date && c.filed_date <= c.due_date).length;
  const overdueCompliance = compliance.filter((c) => c.status === "Overdue").length;
  const dueThisWeek = compliance.filter((c) => c.status !== "Filed" && dayDiff(c.due_date) >= 0 && dayDiff(c.due_date) <= 7).length;
  const typeMap = new Map<string, { open: number; filed: number }>();
  compliance.forEach((c) => {
    const entry = typeMap.get(c.compliance_type) ?? { open: 0, filed: 0 };
    if (c.status === "Filed") entry.filed += 1;
    else entry.open += 1;
    typeMap.set(c.compliance_type, entry);
  });
  const byType = Array.from(typeMap.entries())
    .map(([type, entry]) => ({ type, ...entry }))
    .sort((a, b) => b.open + b.filed - (a.open + a.filed))
    .slice(0, 8);

  const clientMap = new Map<string, { client: string; billed: number; collected: number; outstanding: number; wipHours: number }>();
  clients.forEach((c) => clientMap.set(c.name, { client: c.name, billed: 0, collected: 0, outstanding: 0, wipHours: 0 }));
  active.forEach((invoice) => {
    const entry = clientMap.get(invoice.client_name) ?? { client: invoice.client_name, billed: 0, collected: 0, outstanding: 0, wipHours: 0 };
    entry.billed += invoice.total_amount;
    entry.collected += invoice.paid_amount;
    entry.outstanding += invoice.total_amount - invoice.paid_amount;
    clientMap.set(invoice.client_name, entry);
  });
  timesheets.filter((t) => t.status === "Approved" && t.billable).forEach((t) => {
    const entry = clientMap.get(t.client_name);
    if (entry) entry.wipHours += t.hours;
  });
  const clientRows = Array.from(clientMap.values()).sort((a, b) => b.billed - a.billed).slice(0, 8);

  const won = leads.filter((l) => l.status === "Won").length;
  const lost = leads.filter((l) => l.status === "Lost").length;
  const pipelineStages: Lead["status"][] = ["New", "Contacted", "Qualified", "Proposal Sent", "Won", "Lost"];

  return {
    finance: {
      billed,
      collected,
      outstanding,
      overdue,
      realization: billed ? Math.round((collected / billed) * 1000) / 10 : 0,
      avgDaysToPay,
    },
    ageing: buckets,
    monthly,
    utilization,
    compliance: {
      total: compliance.length,
      filed: filed.length,
      onTime,
      overdue: overdueCompliance,
      dueThisWeek,
      byType,
    },
    clients: clientRows,
    pipeline: {
      open: leads.filter((l) => !["Won", "Lost"].includes(l.status)).length,
      won,
      lost,
      conversion: won + lost ? Math.round((won / (won + lost)) * 1000) / 10 : 0,
      byStage: pipelineStages.map((stage) => ({ stage, count: leads.filter((l) => l.status === stage).length })),
    },
  };
}
