import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import type {
  AuditEntry,
  AuthUser,
  AutomationCadence,
  AutomationKind,
  AutomationMode,
  AutomationRule,
  AutomationRun,
  Campaign,
  Client,
  ClientDetail,
  ClientService,
  Compliance,
  DashboardData,
  DocumentItem,
  FileVersion,
  DocumentRequest,
  Dsc,
  Invoice,
  Lead,
  Message,
  Notice,
  Payment,
  Proposal,
  ReportData,
  Settings,
  StatusHistoryEntry,
  TaskEvent,
  Timesheet,
  Udin,
  WorkStage,
} from "./types";
import { dayDiff } from "./format";
import { SERVICES, fyForDate, inspectGstin, serviceCodeFromLabel, validateGstin } from "./services";
import { createHash } from "node:crypto";
import { buildProposal } from "./proposals";
import { decryptField, encryptField, generatePassword, hashPassword, isEncrypted } from "./crypto";
import { dataPath } from "./data-dir";
import { getConfig } from "./config";

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
      entity_type TEXT, gst_number TEXT, pan TEXT, services_opted TEXT, city TEXT, state TEXT, created_at TEXT,
      legal_name TEXT, trade_name TEXT, tan TEXT, cin TEXT, gst_registration_type TEXT,
      gst_state_code TEXT, date_of_incorporation TEXT, address TEXT, pincode TEXT,
      whatsapp_opt_in INTEGER DEFAULT 1, onboarding_status TEXT DEFAULT 'Active',
      client_status TEXT DEFAULT 'Active', relationship_status TEXT DEFAULT 'Client', relationship_manager TEXT, notes TEXT, fy_end_month INTEGER DEFAULT 3
    );
    CREATE TABLE IF NOT EXISTS compliance (
      compliance_id TEXT PRIMARY KEY, client_id TEXT, client_name TEXT, compliance_type TEXT,
      period TEXT, due_date TEXT, status TEXT, filed_date TEXT, ack_number TEXT, assigned_to TEXT, notes TEXT,
      service_id TEXT, service_code TEXT, fy TEXT, stage TEXT DEFAULT 'documents',
      stage_updated_at TEXT, preparer TEXT, reviewer TEXT, blocked_reason TEXT, completed_at TEXT, billed INTEGER DEFAULT 0
    );
    -- Leads table removed — using client relationship_status field instead
    CREATE TABLE IF NOT EXISTS documents (
      doc_id TEXT PRIMARY KEY, client_id TEXT, client_name TEXT, document_name TEXT,
      status TEXT, requested_date TEXT, received_date TEXT, notes TEXT,
      file_name TEXT, file_size INTEGER, file_path TEXT, uploaded_at TEXT,
      request_id TEXT, compliance_id TEXT, service_code TEXT, category TEXT, fy TEXT, period TEXT,
      reminder_count INTEGER DEFAULT 0, last_reminded_at TEXT, next_reminder_on TEXT,
      verified_by TEXT, source TEXT DEFAULT 'manual', sort_order INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS invoices (
      invoice_id TEXT PRIMARY KEY, client_id TEXT, client_name TEXT, invoice_date TEXT, due_date TEXT,
      service_description TEXT, amount REAL, gst_amount REAL, total_amount REAL, paid_amount REAL DEFAULT 0,
      status TEXT, paid_date TEXT, service_id TEXT, compliance_id TEXT, period TEXT,
      auto_generated INTEGER DEFAULT 0, reminder_count INTEGER DEFAULT 0, last_reminded_at TEXT
    );
    CREATE TABLE IF NOT EXISTS payments (
      payment_id TEXT PRIMARY KEY, invoice_id TEXT, client_name TEXT, amount REAL,
      paid_on TEXT, mode TEXT, reference TEXT, notes TEXT, created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS messages (
      message_id TEXT PRIMARY KEY, channel TEXT, recipient_name TEXT, to_address TEXT,
      subject TEXT, body TEXT, related_type TEXT, related_id TEXT, status TEXT, created_at TEXT,
      kind TEXT, reminder_number INTEGER, sent_at TEXT, error TEXT, automation_key TEXT
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
    CREATE TABLE IF NOT EXISTS automation_rules (
      rule_id TEXT PRIMARY KEY, name TEXT NOT NULL, action TEXT NOT NULL, params TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'auto', cadence TEXT NOT NULL DEFAULT 'daily',
      enabled INTEGER NOT NULL DEFAULT 1, last_run_at TEXT, run_count INTEGER NOT NULL DEFAULT 0,
      created_by TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS automation_runs (
      run_id TEXT PRIMARY KEY, rule_id TEXT, rule_name TEXT, status TEXT, summary TEXT,
      detail TEXT, actor TEXT, started_at TEXT, finished_at TEXT
    );
    CREATE TABLE IF NOT EXISTS client_services (
      service_id TEXT PRIMARY KEY, client_id TEXT NOT NULL, service_code TEXT NOT NULL,
      service_name TEXT, line TEXT, frequency TEXT, fee REAL DEFAULT 0,
      billing_cycle TEXT DEFAULT 'per_cycle', auto_invoice INTEGER DEFAULT 1,
      owner TEXT, reviewer TEXT, status TEXT DEFAULT 'Active', start_date TEXT,
      reminder_cap INTEGER DEFAULT 3, reminder_gap_days INTEGER DEFAULT 3,
      next_cycle_on TEXT, created_at TEXT,
      UNIQUE(client_id, service_code)
    );
    CREATE TABLE IF NOT EXISTS document_requests (
      request_id TEXT PRIMARY KEY, client_id TEXT, client_name TEXT, compliance_id TEXT,
      service_code TEXT, period TEXT, fy TEXT, due_date TEXT, status TEXT DEFAULT 'Open',
      reminder_cap INTEGER DEFAULT 3, reminders_sent INTEGER DEFAULT 0,
      last_sent_at TEXT, next_reminder_on TEXT, created_at TEXT, cleared_at TEXT
    );
    CREATE TABLE IF NOT EXISTS task_events (
      event_id TEXT PRIMARY KEY, compliance_id TEXT, from_stage TEXT, to_stage TEXT,
      actor TEXT, role TEXT, note TEXT, created_at TEXT
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
    CREATE INDEX IF NOT EXISTS idx_automation_rules_enabled ON automation_rules(enabled, cadence);
    CREATE INDEX IF NOT EXISTS idx_automation_runs_started ON automation_runs(started_at);
    CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status);
    CREATE INDEX IF NOT EXISTS idx_client_services_client ON client_services(client_id);
    CREATE INDEX IF NOT EXISTS idx_document_requests_status ON document_requests(status, next_reminder_on);
    -- Workflow-era indexes on late-added columns (documents.request_id,
    -- invoices.compliance_id, documents.source / compliance_id) are created
    -- after ensureColumn — on a legacy database those columns do not exist
    -- yet at this point and index creation would fail.
  `);

  // Columns added after the first release — safe to run on existing databases.
  ensureColumn(db, "documents", "file_name", "TEXT");
  ensureColumn(db, "documents", "file_size", "INTEGER");
  ensureColumn(db, "documents", "file_path", "TEXT");
  ensureColumn(db, "documents", "uploaded_at", "TEXT");
  ensureColumn(db, "invoices", "paid_amount", "REAL DEFAULT 0");
  ensureColumn(db, "proposals", "converted_client_id", "TEXT");
  ensureColumn(db, "users", "token_version", "INTEGER DEFAULT 0");

  // Engagement workflow — additive so an existing practice database keeps working.
  const additions: Array<[string, string, string]> = [
    ["clients", "legal_name", "TEXT"],
    ["clients", "trade_name", "TEXT"],
    ["clients", "tan", "TEXT"],
    ["clients", "cin", "TEXT"],
    ["clients", "gst_registration_type", "TEXT"],
    ["clients", "gst_state_code", "TEXT"],
    ["clients", "date_of_incorporation", "TEXT"],
    ["clients", "address", "TEXT"],
    ["clients", "pincode", "TEXT"],
    ["clients", "whatsapp_opt_in", "INTEGER DEFAULT 1"],
    ["clients", "onboarding_status", "TEXT DEFAULT 'Active'"],
    ["clients", "client_status", "TEXT DEFAULT 'Active'"],
    ["clients", "relationship_status", "TEXT DEFAULT 'Client'"],
    ["clients", "relationship_manager", "TEXT"],
    ["clients", "notes", "TEXT"],
    ["clients", "fy_end_month", "INTEGER DEFAULT 3"],
    ["compliance", "service_id", "TEXT"],
    ["compliance", "service_code", "TEXT"],
    ["compliance", "fy", "TEXT"],
    ["compliance", "stage", "TEXT DEFAULT 'documents'"],
    ["compliance", "stage_updated_at", "TEXT"],
    ["compliance", "preparer", "TEXT"],
    ["compliance", "reviewer", "TEXT"],
    ["compliance", "blocked_reason", "TEXT"],
    ["compliance", "completed_at", "TEXT"],
    ["compliance", "billed", "INTEGER DEFAULT 0"],
    ["documents", "request_id", "TEXT"],
    ["documents", "compliance_id", "TEXT"],
    ["documents", "service_code", "TEXT"],
    ["documents", "category", "TEXT"],
    ["documents", "fy", "TEXT"],
    ["documents", "period", "TEXT"],
    ["documents", "reminder_count", "INTEGER DEFAULT 0"],
    ["documents", "last_reminded_at", "TEXT"],
    ["documents", "next_reminder_on", "TEXT"],
    ["documents", "verified_by", "TEXT"],
    ["documents", "source", "TEXT DEFAULT 'manual'"],
    ["documents", "sort_order", "INTEGER DEFAULT 0"],
    ["invoices", "service_id", "TEXT"],
    ["invoices", "compliance_id", "TEXT"],
    ["invoices", "period", "TEXT"],
    ["invoices", "auto_generated", "INTEGER DEFAULT 0"],
    ["invoices", "reminder_count", "INTEGER DEFAULT 0"],
    ["invoices", "last_reminded_at", "TEXT"],
    ["messages", "kind", "TEXT"],
    ["messages", "reminder_number", "INTEGER"],
    ["messages", "sent_at", "TEXT"],
    ["messages", "error", "TEXT"],
    ["messages", "automation_key", "TEXT"],
    ["users", "service_lines", "TEXT"],
    ["users", "phone", "TEXT"],
  ];
  for (const [table, column, definition] of additions) ensureColumn(db, table, column, definition);
  db.exec("CREATE INDEX IF NOT EXISTS idx_client_services_client ON client_services(client_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_document_requests_status ON document_requests(status, next_reminder_on)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_documents_request ON documents(request_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_task_events_compliance ON task_events(compliance_id, created_at)");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_compliance ON invoices(compliance_id) WHERE compliance_id IS NOT NULL AND compliance_id <> ''");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_checklist ON documents(client_id, compliance_id, document_name) WHERE source = 'checklist'");
  db.exec("UPDATE clients SET whatsapp_opt_in = 1 WHERE whatsapp_opt_in IS NULL");
  db.exec("UPDATE clients SET onboarding_status = 'Active' WHERE onboarding_status IS NULL");
  db.exec("UPDATE clients SET client_status = 'Active' WHERE client_status IS NULL");
  db.exec("UPDATE clients SET relationship_status = 'Client' WHERE relationship_status IS NULL");
  db.exec("UPDATE compliance SET stage = 'documents' WHERE stage IS NULL");
  db.exec("UPDATE compliance SET billed = 0 WHERE billed IS NULL");
  db.exec("UPDATE invoices SET paid_amount = total_amount WHERE status = 'Paid' AND (paid_amount IS NULL OR paid_amount = 0)");
  encryptLegacyIdentifiers(db);
  applyMigrationLedger(db);
}

/**
 * Versioned migration ledger. `ensureColumn`/`IF NOT EXISTS` calls above are
 * the v3.0 bootstrap; the ledger (schema_migrations) starts there and tracks
 * each subsequent migration under BEGIN IMMEDIATE, so a failed migration is
 * rolled back whole rather than half-applied.
 */
interface LedgerEntry {
  version: number;
  name: string;
  apply: (db: DatabaseSync) => void;
}

const PERSISTENCE_MIGRATIONS: LedgerEntry[] = [
  {
    version: 2,
    name: "persistence-hardening: cycle uniqueness, file version history, durable job queue",
    apply: (db) => {
      // Re-point references off duplicate engagement cycles (same client +
      // service + period), then drop the duplicates, so the unique cycle key
      // below can exist as a real database constraint.
      interface DuplicateRow { removed: string; kept: string }
      const dupes = db
        .prepare(
          `SELECT a.compliance_id AS removed, b.compliance_id AS kept FROM compliance a
           JOIN compliance b
             ON a.client_id = b.client_id AND a.service_code = b.service_code AND a.period = b.period
            AND a.rowid > b.rowid
           WHERE a.service_code IS NOT NULL AND a.service_code <> ''`,
        )
        .all() as unknown as DuplicateRow[];
      for (const d of dupes) {
        for (const table of ["document_requests", "documents", "task_events", "invoices"]) {
          db.prepare(`UPDATE ${table} SET compliance_id = ? WHERE compliance_id = ?`).run(d.kept, d.removed);
        }
        db.prepare("DELETE FROM compliance WHERE compliance_id = ?").run(d.removed);
      }
      if (dupes.length > 0) {
        db.prepare("INSERT INTO audit_log (actor,action,entity_type,entity_id,detail,created_at) VALUES (?,?,?,?,?,?)").run(
          "migration",
          "MIGRATION_DEDUPE",
          "compliance",
          "",
          `Merged ${dupes.length} duplicate engagement cycle(s) into their earliest sibling (migration 2)`,
          new Date().toISOString(),
        );
      }

      db.exec(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_compliance_cycle
         ON compliance(client_id, service_code, period)
         WHERE service_code IS NOT NULL AND service_code <> ''`,
      );

      db.exec(
        `CREATE TABLE IF NOT EXISTS file_versions (
          version_id TEXT PRIMARY KEY,
          doc_id TEXT NOT NULL,
          version INTEGER NOT NULL,
          object_key TEXT NOT NULL,
          file_name TEXT NOT NULL,
          size_bytes INTEGER NOT NULL,
          checksum TEXT NOT NULL,
          uploaded_by TEXT,
          uploaded_at TEXT NOT NULL,
          UNIQUE(doc_id, version)
        ` + `)`,
      );
      db.exec(`CREATE INDEX IF NOT EXISTS idx_file_versions_doc ON file_versions(doc_id, version)`);

      db.exec(
        `CREATE TABLE IF NOT EXISTS jobs (
          job_id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          logical_key TEXT,
          run_at TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          attempts INTEGER NOT NULL DEFAULT 0,
          max_attempts INTEGER NOT NULL DEFAULT 3,
          payload TEXT NOT NULL DEFAULT '{}',
          last_error TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`,
      );
      // logical_key makes scheduling idempotent: the same logical event cannot
      // be queued twice no matter how many callers race.
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_logical ON jobs(logical_key) WHERE logical_key IS NOT NULL`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_jobs_due ON jobs(status, run_at)`);

      // Reminder/idempotency key on outbound messages: keep the newest row per
      // key, then enforce uniqueness so a raced reminder cannot double-send.
      db.exec(
        `DELETE FROM messages
         WHERE automation_key <> ''
           AND automation_key IN (
             SELECT automation_key FROM messages WHERE automation_key <> ''
             GROUP BY automation_key HAVING COUNT(*) > 1
           )
           AND rowid NOT IN (
             SELECT MAX(rowid) FROM messages WHERE automation_key <> '' GROUP BY automation_key
           )`,
      );
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_automation_key ON messages(automation_key) WHERE automation_key IS NOT NULL AND automation_key <> ''`);
    },
  },
  {
    version: 3,
    name: "client-onboarding: registrations, service configuration, checklist templates, assignment history",
    apply: (db) => {
      for (const [column, definition] of [
        ["date_of_birth", "TEXT"],
        ["primary_contact_designation", "TEXT"],
        ["whatsapp_number", "TEXT"],
        ["billing_contact", "TEXT"],
        ["authorised_representative", "TEXT"],
        ["preferred_language", "TEXT DEFAULT 'English'"],
        ["preferred_channel", "TEXT DEFAULT 'WhatsApp'"],
        ["contact_verified_at", "TEXT"],
        ["contact_verification_note", "TEXT"],
        ["whatsapp_consent_at", "TEXT"],
        ["whatsapp_consent_source", "TEXT"],
        ["engagement_letter_status", "TEXT DEFAULT 'Not recorded'"],
        ["engagement_letter_date", "TEXT"],
        ["onboarding_stage", "TEXT DEFAULT 'review'"],
        ["onboarding_completed_at", "TEXT"],
        ["created_by", "TEXT"],
        ["updated_by", "TEXT"],
        ["updated_at", "TEXT"],
      ] as Array<[string, string]>) {
        ensureColumn(db, "clients", column, definition);
      }
      for (const [table, column, definition] of [
        ["compliance", "registration_id", "TEXT"],
        ["document_requests", "registration_id", "TEXT"],
        ["document_requests", "template_version", "INTEGER"],
        ["documents", "registration_id", "TEXT"],
        ["documents", "template_version", "INTEGER"],
      ] as Array<[string, string, string]>) {
        ensureColumn(db, table, column, definition);
      }

      db.exec(`
        CREATE TABLE IF NOT EXISTS client_registrations (
          registration_id TEXT PRIMARY KEY,
          client_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          identifier_enc TEXT NOT NULL DEFAULT '',
          identifier_hash TEXT NOT NULL DEFAULT '',
          legal_name TEXT DEFAULT '',
          state TEXT DEFAULT '',
          state_code TEXT DEFAULT '',
          status TEXT NOT NULL DEFAULT 'Active',
          effective_from TEXT DEFAULT '',
          effective_to TEXT DEFAULT '',
          place_of_business TEXT DEFAULT '',
          filing_frequency TEXT DEFAULT '',
          is_primary INTEGER DEFAULT 0,
          verification_status TEXT NOT NULL DEFAULT 'User entered',
          migration_note TEXT DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          created_by TEXT DEFAULT '',
          updated_by TEXT DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS idx_registrations_client ON client_registrations(client_id, kind);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_registrations_unique
          ON client_registrations(client_id, kind, identifier_hash) WHERE identifier_hash <> '';

        CREATE TABLE IF NOT EXISTS service_catalogue_settings (
          service_code TEXT PRIMARY KEY,
          enabled INTEGER NOT NULL DEFAULT 1,
          default_frequency TEXT,
          default_fee REAL,
          requires_engagement_letter INTEGER NOT NULL DEFAULT 0,
          requires_approval INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS checklist_templates (
          template_id TEXT PRIMARY KEY,
          service_code TEXT NOT NULL,
          version INTEGER NOT NULL,
          name TEXT NOT NULL,
          items_json TEXT NOT NULL,
          active INTEGER NOT NULL DEFAULT 1,
          created_by TEXT DEFAULT '',
          created_at TEXT NOT NULL,
          UNIQUE(service_code, version)
        );

        CREATE TABLE IF NOT EXISTS client_service_assignments (
          assignment_id TEXT PRIMARY KEY,
          client_id TEXT NOT NULL,
          service_id TEXT DEFAULT '',
          role TEXT NOT NULL,
          assignee TEXT NOT NULL,
          assigned_by TEXT DEFAULT '',
          assigned_at TEXT NOT NULL,
          unassigned_at TEXT,
          note TEXT DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS idx_assignments_client ON client_service_assignments(client_id, role);
        CREATE INDEX IF NOT EXISTS idx_assignments_service ON client_service_assignments(service_id);

        CREATE TABLE IF NOT EXISTS onboarding_activations (
          activation_id TEXT PRIMARY KEY,
          client_id TEXT NOT NULL,
          service_id TEXT NOT NULL,
          idempotency_key TEXT NOT NULL UNIQUE,
          detail TEXT DEFAULT '',
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS onboarding_tasks (
          task_id TEXT PRIMARY KEY,
          client_id TEXT NOT NULL,
          service_id TEXT DEFAULT '',
          label TEXT NOT NULL,
          kind TEXT DEFAULT 'onboarding',
          status TEXT NOT NULL DEFAULT 'Open',
          due_date TEXT DEFAULT '',
          created_at TEXT NOT NULL,
          completed_at TEXT,
          UNIQUE(client_id, service_id, label)
        );
        CREATE INDEX IF NOT EXISTS idx_onboarding_tasks_client ON onboarding_tasks(client_id, status);
      `);

      // Rebuild client_services: the v1 UNIQUE(client_id, service_code) blocked
      // a second GST registration's engagement. Preserve every row and id.
      db.exec(`
        CREATE TABLE client_services_v3 (
          service_id TEXT PRIMARY KEY, client_id TEXT NOT NULL, service_code TEXT NOT NULL,
          service_name TEXT, line TEXT, frequency TEXT, fee REAL DEFAULT 0,
          billing_cycle TEXT DEFAULT 'per_cycle', auto_invoice INTEGER DEFAULT 1,
          owner TEXT, reviewer TEXT, status TEXT DEFAULT 'Active', start_date TEXT,
          reminder_cap INTEGER DEFAULT 3, reminder_gap_days INTEGER DEFAULT 3,
          next_cycle_on TEXT, created_at TEXT,
          registration_id TEXT, manager TEXT, partner TEXT, end_date TEXT,
          fee_model TEXT DEFAULT 'recurring', setup_fee REAL DEFAULT 0,
          payment_terms_days INTEGER DEFAULT 30, fee_effective_from TEXT,
          approval_stage TEXT DEFAULT 'none', paused_at TEXT, completed_at TEXT,
          cancelled_at TEXT, updated_at TEXT, created_by TEXT, updated_by TEXT
        );
        INSERT INTO client_services_v3
          (service_id, client_id, service_code, service_name, line, frequency, fee, billing_cycle,
           auto_invoice, owner, reviewer, status, start_date, reminder_cap, reminder_gap_days,
           next_cycle_on, created_at, fee_model, setup_fee, payment_terms_days, approval_stage, updated_at)
        SELECT service_id, client_id, service_code, service_name, line, frequency, fee, billing_cycle,
           auto_invoice, owner, reviewer, status, start_date, reminder_cap, reminder_gap_days,
           next_cycle_on, created_at, 'recurring', 0, 30, 'none', created_at
        FROM client_services;
        DROP TABLE client_services;
        ALTER TABLE client_services_v3 RENAME TO client_services;
        CREATE INDEX IF NOT EXISTS idx_client_services_client ON client_services(client_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_client_services_unique
          ON client_services(client_id, service_code, IFNULL(registration_id, ''));
      `);

      const now = new Date().toISOString();
      const setting = db.prepare(
        "INSERT OR IGNORE INTO service_catalogue_settings (service_code,enabled,default_frequency,default_fee,requires_engagement_letter,requires_approval,updated_at) VALUES (?,?,?,?,?,?,?)",
      );
      const template = db.prepare(
        "INSERT OR IGNORE INTO checklist_templates (template_id,service_code,version,name,items_json,active,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)",
      );
      for (const def of SERVICES) {
        setting.run(def.code, 1, def.frequency, def.defaultFee, 0, 0, now);
        template.run(
          `TPL-${def.code.toUpperCase()}-1`,
          def.code,
          1,
          `${def.name} checklist`,
          JSON.stringify(def.checklist.map((item) => ({ ...item, mandatory: !item.optional }))),
          1,
          "system",
          now,
        );
      }

      // Backfill one GST registration per legacy client GSTIN. Invalid checksums
      // are preserved but flagged for authorised review — never silently dropped
      // or "verified".
      const legacy = db
        .prepare("SELECT client_id, legal_name, name, gst_number, gst_state_code, created_at, created_by FROM clients WHERE gst_number IS NOT NULL AND gst_number <> ''")
        .all() as unknown as Array<Record<string, string | null>>;
      let backfilled = 0;
      let flagged = 0;
      const existingRegistration = db.prepare("SELECT COUNT(*) AS n FROM client_registrations WHERE client_id = ? AND kind = 'GST'");
      const insertRegistration = db.prepare(
        `INSERT INTO client_registrations (registration_id,client_id,kind,identifier_enc,identifier_hash,legal_name,state,state_code,status,
         effective_from,effective_to,place_of_business,filing_frequency,is_primary,verification_status,migration_note,created_at,updated_at,created_by,updated_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      );
      for (const row of legacy) {
        const clientId = String(row.client_id);
        if (Number((existingRegistration.get(clientId) as { n: number }).n) > 0) continue;
        const gstin = decryptField(row.gst_number).toUpperCase().trim();
        if (!gstin) continue;
        const invalid = validateGstin(gstin);
        const info = inspectGstin(gstin);
        const status = invalid ? "Needs review" : "Active";
        if (invalid) flagged++;
        insertRegistration.run(
          `REG-M3-${String(backfilled + 1).padStart(4, "0")}`,
          clientId,
          "GST",
          encryptField(gstin),
          createHash("sha256").update(gstin).digest("hex"),
          String(row.legal_name || row.name || ""),
          info.state || String(row.gst_state_code || ""),
          info.stateCode || String(row.gst_state_code || ""),
          status,
          "",
          "",
          "",
          "",
          1,
          "User entered",
          invalid
            ? `Migrated from the legacy client GSTIN field — checksum failed (${invalid}); review required.`
            : "Migrated from the legacy client GSTIN field; not externally verified.",
          now,
          now,
          "migration",
          "migration",
        );
        backfilled++;
      }
      const legacyClients = Number((db.prepare("SELECT COUNT(*) AS n FROM clients").get() as { n: number }).n);
      const report = {
        at: now,
        legacy_clients: legacyClients,
        gst_registrations_backfilled: backfilled,
        flagged_for_review: flagged,
        ambiguous: 0,
      };
      db.prepare("INSERT INTO settings (key,value) VALUES ('client_migration_report_v1', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(report));
      db.exec("UPDATE clients SET onboarding_stage = 'review' WHERE onboarding_stage IS NULL OR onboarding_stage = ''");
      db.exec("UPDATE clients SET preferred_language = 'English' WHERE preferred_language IS NULL OR preferred_language = ''");
      db.exec("UPDATE clients SET preferred_channel = 'WhatsApp' WHERE preferred_channel IS NULL OR preferred_channel = ''");
      db.exec("UPDATE clients SET updated_at = created_at WHERE updated_at IS NULL");
      db.exec("CREATE INDEX IF NOT EXISTS idx_compliance_registration ON compliance(registration_id)");
      // A client with two GSTINs runs the same service code twice per period;
      // the registration is part of the cycle key. Existing rows all have a
      // NULL registration, so the earlier uniqueness guarantee is preserved.
      db.exec("DROP INDEX IF EXISTS idx_compliance_cycle");
      db.exec(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_compliance_cycle
         ON compliance(client_id, service_code, period, IFNULL(registration_id, ''))
         WHERE service_code IS NOT NULL AND service_code <> ''`,
      );
    },
  },
  {
    version: 4,
    name: "recurring-engagement-engine: period model, due-date rules, append-only status history, generation runs",
    apply: (db) => {
      for (const [column, definition] of [
        ["period_type", "TEXT"],
        ["period_start", "TEXT"],
        ["period_end", "TEXT"],
        ["assessment_year", "TEXT"],
        ["internal_target_date", "TEXT"],
        ["statutory_due_date", "TEXT"],
        ["due_rule_id", "TEXT"],
        ["due_rule_version", "INTEGER"],
        ["due_date_source", "TEXT DEFAULT ''"],
        ["due_date_verified", "INTEGER DEFAULT 0"],
        ["statutory_rule_status", "TEXT DEFAULT 'unverified'"],
        ["generation_source", "TEXT DEFAULT 'migration'"],
        ["generated_at", "TEXT"],
        ["filing_recorded_at", "TEXT"],
        ["filing_reference", "TEXT"],
        ["filing_recorded_by", "TEXT DEFAULT ''"],
        ["filing_confirmed_by_integration", "INTEGER DEFAULT 0"],
        ["filing_notes", "TEXT DEFAULT ''"],
      ] as Array<[string, string]>) {
        ensureColumn(db, "compliance", column, definition);
      }
      for (const [column, definition] of [
        ["priority", "TEXT DEFAULT 'Normal'"],
        ["escalation_days", "INTEGER DEFAULT 2"],
      ] as Array<[string, string]>) {
        ensureColumn(db, "client_services", column, definition);
      }

      db.exec(`
        CREATE TABLE IF NOT EXISTS due_date_rules (
          rule_id TEXT PRIMARY KEY,
          service_code TEXT NOT NULL,
          frequency TEXT NOT NULL,
          effective_from TEXT NOT NULL,
          effective_to TEXT NOT NULL DEFAULT '',
          due_month_offset INTEGER NOT NULL,
          due_day INTEGER NOT NULL,
          internal_lead_days INTEGER NOT NULL DEFAULT 0,
          source TEXT NOT NULL,
          authority_reference TEXT NOT NULL DEFAULT '',
          verification_status TEXT NOT NULL DEFAULT 'unverified',
          verified_at TEXT,
          verified_by TEXT NOT NULL DEFAULT '',
          version INTEGER NOT NULL DEFAULT 1,
          notes TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_due_rules_lookup ON due_date_rules(service_code, frequency, verification_status);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_due_rules_version ON due_date_rules(service_code, frequency, version);

        CREATE TABLE IF NOT EXISTS compliance_status_history (
          history_id TEXT PRIMARY KEY,
          compliance_id TEXT NOT NULL,
          from_status TEXT,
          to_status TEXT NOT NULL,
          from_stage TEXT,
          to_stage TEXT,
          actor TEXT NOT NULL,
          role TEXT NOT NULL,
          reason TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_status_history_task ON compliance_status_history(compliance_id, created_at);
        CREATE TRIGGER IF NOT EXISTS trg_status_history_no_update
          BEFORE UPDATE ON compliance_status_history
          BEGIN SELECT RAISE(ABORT, 'compliance status history is append-only'); END;
        CREATE TRIGGER IF NOT EXISTS trg_status_history_no_delete
          BEFORE DELETE ON compliance_status_history
          BEGIN SELECT RAISE(ABORT, 'compliance status history is append-only'); END;

        CREATE TABLE IF NOT EXISTS engagement_generation_runs (
          run_id TEXT PRIMARY KEY,
          trigger TEXT NOT NULL,
          actor TEXT NOT NULL,
          window_from TEXT NOT NULL,
          window_to TEXT NOT NULL,
          client_id TEXT NOT NULL DEFAULT '',
          service_id TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL,
          processed INTEGER NOT NULL DEFAULT 0,
          created INTEGER NOT NULL DEFAULT 0,
          skipped INTEGER NOT NULL DEFAULT 0,
          failed INTEGER NOT NULL DEFAULT 0,
          warnings INTEGER NOT NULL DEFAULT 0,
          detail TEXT NOT NULL DEFAULT '{}',
          started_at TEXT NOT NULL,
          finished_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_generation_runs_started ON engagement_generation_runs(started_at);
      `);

      const now = new Date().toISOString();
      const insertRule = db.prepare(
        `INSERT OR IGNORE INTO due_date_rules
         (rule_id,service_code,frequency,effective_from,effective_to,due_month_offset,due_day,internal_lead_days,
          source,authority_reference,verification_status,verified_at,verified_by,version,notes,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      );
      for (const def of SERVICES) {
        insertRule.run(
          `DDR-${def.code.toUpperCase()}-${def.frequency.toUpperCase()}-V1`,
          def.code,
          def.frequency,
          "2020-04-01",
          "",
          def.dueMonthOffset,
          def.dueDay,
          0,
          "Product default schedule — not verified against a statutory source",
          "",
          "unverified",
          null,
          "",
          1,
          "Generated with the recurrence engine. A partner must verify the rule before it can be shown as a statutory due date.",
          now,
          now,
        );
      }

      db.exec("CREATE INDEX IF NOT EXISTS idx_compliance_internal_target ON compliance(internal_target_date)");
      db.exec("CREATE INDEX IF NOT EXISTS idx_compliance_statutory ON compliance(statutory_due_date)");
      db.exec("CREATE INDEX IF NOT EXISTS idx_compliance_service_period ON compliance(service_id, period)");

      // Backfill the period model without changing a single existing id,
      // service assignment, filed date or acknowledgement. Legacy due dates
      // become internal targets; no legacy row is labelled legally verified.
      const rows = db
        .prepare(
          `SELECT compliance_id, client_id, compliance_type, period, due_date, fy, status, stage, ack_number,
                  filed_date, registration_id, service_id, service_code, generated_at, stage_updated_at, completed_at
           FROM compliance`,
        )
        .all() as unknown as Array<Record<string, string | null>>;
      const serviceRows = db.prepare("SELECT service_id, frequency, start_date, end_date FROM client_services").all() as unknown as Array<Record<string, string | null>>;
      const serviceById = new Map(serviceRows.map((row) => [String(row.service_id || ""), row]));
      const update = db.prepare(
        `UPDATE compliance SET period_type=?, period_start=?, period_end=?, assessment_year=?, internal_target_date=?,
          statutory_due_date=NULL, due_rule_id=?, due_rule_version=?, due_date_source=?, due_date_verified=0,
          statutory_rule_status='unverified', generation_source=COALESCE(NULLIF(generation_source,''),'migration'),
          generated_at=COALESCE(generated_at, ?), filing_reference=COALESCE(NULLIF(filing_reference,''), ack_number),
          filing_recorded_at=COALESCE(filing_recorded_at, filed_date), filing_confirmed_by_integration=0
         WHERE compliance_id=?`,
      );
      const history = db.prepare(
        `INSERT OR IGNORE INTO compliance_status_history
         (history_id,compliance_id,from_status,to_status,from_stage,to_stage,actor,role,reason,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      );
      const report = { at: now, scanned: rows.length, period_backfilled: 0, ambiguous_periods: 0, missing_service_code: 0, duplicate_labels: 0 };
      const seen = new Set<string>();
      for (const row of rows) {
        const complianceId = String(row.compliance_id);
        const catalogCode = String(row.service_code || "");
        const def = SERVICES.find((s) => s.code === catalogCode);
        if (!catalogCode) report.missing_service_code++;
        const service = serviceById.get(String(row.service_id || ""));
        const frequency = (service?.frequency as string) || def?.frequency || "one_time";
        const period = String(row.period || "Current");
        const dueDate = String(row.due_date || "");
        const parsed = legacyPeriod(period, frequency, dueDate);
        if (!parsed) report.ambiguous_periods++;
        const periodType = frequency === "monthly" || frequency === "quarterly" || frequency === "half_yearly" || frequency === "annual" ? frequency : "one_time";
        const fy = String(row.fy || "") || (parsed ? legacyFy(parsed.periodEnd) : "") || (dueDate ? legacyFy(dueDate) : "");
        const assessment = catalogCode === "itr" && fy ? legacyNextAy(fy) : null;
        const dedupeKey = `${row.client_id}|${catalogCode}|${period}|${row.registration_id || ""}`;
        if (seen.has(dedupeKey)) report.duplicate_labels++;
        seen.add(dedupeKey);
        update.run(
          periodType,
          parsed?.periodStart ?? "",
          parsed?.periodEnd ?? "",
          assessment,
          dueDate,
          def ? `DDR-${def.code.toUpperCase()}-${def.frequency.toUpperCase()}-V1` : null,
          def ? 1 : null,
          dueDate ? "Legacy due date migrated as an unverified internal target" : "No due date recorded",
          row.generated_at || row.stage_updated_at || now,
          complianceId,
        );
        const toStage = row.stage || (row.status === "Filed" ? "done" : "documents");
        history.run(
          `HIST-M4-${complianceId}`,
          complianceId,
          null,
          row.status || "Pending",
          null,
          toStage,
          "migration",
          "system",
          "Baseline history created while migrating to the recurring engagement model",
          row.stage_updated_at || row.filed_date || now,
        );
        if (parsed) report.period_backfilled++;
      }
      db.prepare(
        "INSERT INTO settings (key,value) VALUES ('engagement_migration_report_v1', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      ).run(JSON.stringify(report));
    },
  },
  {
    version: 5,
    name: "document-management: version supersession, review history, classification, soft archival",
    apply: (db) => {
      for (const [table, column, definition] of [
        ["file_versions", "status", "TEXT NOT NULL DEFAULT 'superseded'"],
        ["file_versions", "change_reason", "TEXT NOT NULL DEFAULT ''"],
        ["file_versions", "superseded_at", "TEXT"],
        ["documents", "review_reason", "TEXT NOT NULL DEFAULT ''"],
        ["documents", "reviewed_at", "TEXT"],
        ["documents", "archived_at", "TEXT"],
        ["documents", "needs_classification", "INTEGER NOT NULL DEFAULT 0"],
        ["document_requests", "missing_note", "TEXT NOT NULL DEFAULT ''"],
      ] as Array<[string, string, string]>) {
        ensureColumn(db, table, column, definition);
      }

      // The newest version of every document is the current one; everything
      // else is superseded history. Version numbers are monotonic per doc
      // (MAX(version)+1), so the highest rowid is the current version.
      // Existing rows get no fabricated review state — received/verified
      // flags on the documents row stay exactly as they are.
      db.exec("UPDATE file_versions SET status='superseded' WHERE status IS NULL OR status = ''");
      db.exec("UPDATE file_versions SET status='current' WHERE rowid IN (SELECT MAX(rowid) FROM file_versions GROUP BY doc_id)");

      // Soft-archival is off by default: nothing becomes archived during
      // migration just because the column exists now.
      db.exec("UPDATE documents SET needs_classification = 0 WHERE needs_classification IS NULL");
      db.exec("UPDATE document_requests SET missing_note = '' WHERE missing_note IS NULL");

      // Append-only review history, mirroring compliance_status_history.
      db.exec(`
        CREATE TABLE IF NOT EXISTS document_status_history (
          history_id TEXT PRIMARY KEY,
          doc_id TEXT NOT NULL,
          from_status TEXT,
          to_status TEXT NOT NULL,
          actor TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'system',
          reason TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_doc_history_doc ON document_status_history(doc_id, created_at);
        CREATE TRIGGER IF NOT EXISTS trg_doc_history_no_update
          BEFORE UPDATE ON document_status_history
          BEGIN SELECT RAISE(ABORT, 'document status history is append-only'); END;
        CREATE TRIGGER IF NOT EXISTS trg_doc_history_no_delete
          BEFORE DELETE ON document_status_history
          BEGIN SELECT RAISE(ABORT, 'document status history is append-only'); END;
      `);

      db.exec("CREATE INDEX IF NOT EXISTS idx_documents_client ON documents(client_id, fy)");
      db.exec("CREATE INDEX IF NOT EXISTS idx_documents_archived ON documents(archived_at)");
      db.exec("CREATE INDEX IF NOT EXISTS idx_file_versions_status ON file_versions(doc_id, status)");
    },
  },
  {
    version: 6,
    name: "staff-work-management: per-task assignment ledger and task blockers",
    apply: (db) => {
      // Append-only assignment ledger. Every preparer/reviewer set or change on
      // an engagement records the previous assignee, the new assignee, the
      // actor and the reason. History is never overwritten by the next change.
      db.exec(`
        CREATE TABLE IF NOT EXISTS task_assignments (
          assignment_id TEXT PRIMARY KEY,
          compliance_id TEXT NOT NULL,
          client_id TEXT NOT NULL DEFAULT '',
          responsibility TEXT NOT NULL,
          previous_assignee TEXT NOT NULL DEFAULT '',
          new_assignee TEXT NOT NULL DEFAULT '',
          actor TEXT NOT NULL,
          actor_role TEXT NOT NULL DEFAULT '',
          reason TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_task_assignments_task ON task_assignments(compliance_id, created_at);
        CREATE TRIGGER IF NOT EXISTS trg_task_assignments_no_update
          BEFORE UPDATE ON task_assignments
          BEGIN SELECT RAISE(ABORT, 'task assignment history is append-only'); END;
        CREATE TRIGGER IF NOT EXISTS trg_task_assignments_no_delete
          BEFORE DELETE ON task_assignments
          BEGIN SELECT RAISE(ABORT, 'task assignment history is append-only'); END;
      `);

      // Explicit blockers: a work item that cannot proceed for a recorded
      // reason, owned by a named person until it is resolved.
      db.exec(`
        CREATE TABLE IF NOT EXISTS task_blockers (
          blocker_id TEXT PRIMARY KEY,
          compliance_id TEXT NOT NULL,
          client_id TEXT NOT NULL DEFAULT '',
          category TEXT NOT NULL DEFAULT 'other',
          description TEXT NOT NULL DEFAULT '',
          owner TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'open',
          blocks_progress INTEGER NOT NULL DEFAULT 1,
          created_by TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          resolved_by TEXT,
          resolved_at TEXT,
          resolution_note TEXT NOT NULL DEFAULT '',
          reopened_at TEXT,
          reopened_by TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_task_blockers_task ON task_blockers(compliance_id, status);
        CREATE INDEX IF NOT EXISTS idx_task_blockers_owner ON task_blockers(owner, status);
      `);
    },
  },
  {
    version: 7,
    name: "billing-v2: line items, invoice lifecycle, idempotency, payments reconciliation, credit notes, billing settings and tax treatments",
    apply: (db) => {
      // ── Firm-level billing configuration (one row, id 1) ─────────────
      db.exec(`
        CREATE TABLE IF NOT EXISTS billing_settings (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          billing_enabled INTEGER NOT NULL DEFAULT 1,
          legal_name TEXT NOT NULL DEFAULT '',
          display_name TEXT NOT NULL DEFAULT '',
          address TEXT NOT NULL DEFAULT '',
          contact TEXT NOT NULL DEFAULT '',
          pan TEXT NOT NULL DEFAULT '',
          gstin TEXT NOT NULL DEFAULT '',
          invoice_prefix TEXT NOT NULL DEFAULT 'NV',
          credit_note_prefix TEXT NOT NULL DEFAULT 'NC',
          numbering_policy TEXT NOT NULL DEFAULT 'per_fy',
          currency TEXT NOT NULL DEFAULT 'INR',
          default_payment_terms_days INTEGER NOT NULL DEFAULT 15,
          internal_billing_contact TEXT NOT NULL DEFAULT '',
          invoice_footer TEXT NOT NULL DEFAULT '',
          payment_instructions TEXT NOT NULL DEFAULT '',
          bank_details TEXT NOT NULL DEFAULT '',
          invoice_grouping TEXT NOT NULL DEFAULT 'one_per_event',
          approval_required_for_auto INTEGER NOT NULL DEFAULT 1,
          approval_required_for_manual INTEGER NOT NULL DEFAULT 0,
          deliver_on_issue INTEGER NOT NULL DEFAULT 1,
          aging_buckets TEXT NOT NULL DEFAULT '[30,60,90]',
          updated_at TEXT NOT NULL DEFAULT '',
          updated_by TEXT NOT NULL DEFAULT ''
        );
      `);
      db.prepare(`INSERT OR IGNORE INTO billing_settings (id, updated_at, updated_by) VALUES (1, '', '')`).run();
      // Default payment terms carry the legacy invoice_due_days when the firm
      // already tuned it; nothing else is invented here.
      const legacyDue = db.prepare("SELECT value AS v FROM settings WHERE key = 'invoice_due_days'").get() as unknown as { v: string } | undefined;
      const legacyDays = legacyDue ? Number(legacyDue.v) : NaN;
      if (Number.isFinite(legacyDays) && legacyDays >= 1 && legacyDays <= 90) {
        db.prepare("UPDATE billing_settings SET default_payment_terms_days = ? WHERE id = 1").run(Math.round(legacyDays));
      }

      // ── Configurable tax treatments. No rate is invented by code: a GST
      // treatment seeded without a rate blocks issuance until the firm
      // configures one through the settings API. ─────────────────────────
      db.exec(`
        CREATE TABLE IF NOT EXISTS tax_treatments (
          treatment_id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          kind TEXT NOT NULL DEFAULT 'none',
          rate_bp INTEGER,
          active INTEGER NOT NULL DEFAULT 1,
          note TEXT NOT NULL DEFAULT '',
          updated_by TEXT NOT NULL DEFAULT '',
          updated_at TEXT NOT NULL
        );
      `);
      const now7 = new Date().toISOString();
      db.prepare(
        "INSERT OR IGNORE INTO tax_treatments (treatment_id,name,kind,rate_bp,active,note,updated_by,updated_at) VALUES (?,?,?,?,?,?,?,?)",
      ).run("TAX-NONE", "No GST charged", "none", null, 1, "Fee is invoiced without any tax component. Correct only where the firm has determined the supply is not taxable.", "migration", now7);
      db.prepare(
        "INSERT OR IGNORE INTO tax_treatments (treatment_id,name,kind,rate_bp,active,note,updated_by,updated_at) VALUES (?,?,?,?,?,?,?,?)",
      ).run("TAX-GST-UNCONFIGURED", "GST — rate not configured yet", "gst", null, 1, "A partner must configure the rate (basis points) through billing settings before invoices using this treatment can be issued.", "migration", now7);

      // ── Invoice lifecycle, numbering and idempotency columns ────────────
      for (const [column, definition] of [
        ["invoice_number", "TEXT"],
        ["fy", "TEXT"],
        ["notes", "TEXT NOT NULL DEFAULT ''"],
        ["lifecycle", "TEXT NOT NULL DEFAULT ''"],
        ["billing_event_key", "TEXT"],
        ["approved_by", "TEXT"],
        ["approved_at", "TEXT"],
        ["issued_by", "TEXT"],
        ["issued_at", "TEXT"],
        ["taxable_paise", "INTEGER"],
        ["gst_paise", "INTEGER"],
        ["total_paise", "INTEGER"],
        ["paid_paise", "INTEGER"],
        ["credit_paise", "INTEGER NOT NULL DEFAULT 0"],
        ["issue_snapshot", "TEXT"],
        ["cancelled_at", "TEXT"],
        ["cancelled_by", "TEXT"],
        ["cancel_reason", "TEXT"],
        ["pdf_object_key", "TEXT"],
        ["pdf_checksum", "TEXT"],
        ["pdf_size", "INTEGER"],
        ["pdf_version", "INTEGER NOT NULL DEFAULT 0"],
        ["pdf_generated_at", "TEXT"],
      ] as Array<[string, string]>) {
        ensureColumn(db, "invoices", column, definition);
      }
      for (const [column, definition] of [
        ["status", "TEXT NOT NULL DEFAULT 'Confirmed'"],
        ["recorded_by", "TEXT"],
        ["reversal_of", "TEXT"],
      ] as Array<[string, string]>) {
        ensureColumn(db, "payments", column, definition);
      }

      db.exec(`
        CREATE TABLE IF NOT EXISTS invoice_lines (
          line_id TEXT PRIMARY KEY,
          invoice_id TEXT NOT NULL,
          seq INTEGER NOT NULL DEFAULT 0,
          description TEXT NOT NULL DEFAULT '',
          service_code TEXT NOT NULL DEFAULT '',
          client_service_id TEXT NOT NULL DEFAULT '',
          compliance_id TEXT NOT NULL DEFAULT '',
          registration_id TEXT NOT NULL DEFAULT '',
          quantity INTEGER NOT NULL DEFAULT 1,
          unit_price_paise INTEGER NOT NULL DEFAULT 0,
          discount_paise INTEGER NOT NULL DEFAULT 0,
          taxable_paise INTEGER NOT NULL DEFAULT 0,
          treatment_id TEXT NOT NULL DEFAULT '',
          tax_kind TEXT NOT NULL DEFAULT 'none',
          gst_rate_bp INTEGER,
          cgst_paise INTEGER NOT NULL DEFAULT 0,
          sgst_paise INTEGER NOT NULL DEFAULT 0,
          igst_paise INTEGER NOT NULL DEFAULT 0,
          line_total_paise INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice ON invoice_lines(invoice_id, seq);

        CREATE TABLE IF NOT EXISTS credit_notes (
          credit_note_id TEXT PRIMARY KEY,
          invoice_id TEXT NOT NULL,
          number TEXT NOT NULL,
          fy TEXT NOT NULL DEFAULT '',
          reason TEXT NOT NULL DEFAULT '',
          taxable_paise INTEGER NOT NULL DEFAULT 0,
          gst_paise INTEGER NOT NULL DEFAULT 0,
          total_paise INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'Issued',
          created_by TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          voided_at TEXT,
          voided_by TEXT
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_notes_number ON credit_notes(number);
        CREATE INDEX IF NOT EXISTS idx_credit_notes_invoice ON credit_notes(invoice_id);

        CREATE TABLE IF NOT EXISTS invoice_events (
          event_id TEXT PRIMARY KEY,
          invoice_id TEXT NOT NULL,
          event TEXT NOT NULL,
          actor TEXT NOT NULL DEFAULT '',
          role TEXT NOT NULL DEFAULT 'system',
          detail TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_invoice_events_invoice ON invoice_events(invoice_id, created_at);
        CREATE TRIGGER IF NOT EXISTS trg_invoice_events_no_update
          BEFORE UPDATE ON invoice_events
          BEGIN SELECT RAISE(ABORT, 'invoice event history is append-only'); END;
        CREATE TRIGGER IF NOT EXISTS trg_invoice_events_no_delete
          BEFORE DELETE ON invoice_events
          BEGIN SELECT RAISE(ABORT, 'invoice event history is append-only'); END;
      `);

      db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_number ON invoices(invoice_number) WHERE invoice_number IS NOT NULL AND invoice_number <> ''");
      db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_event ON invoices(billing_event_key) WHERE billing_event_key IS NOT NULL AND billing_event_key <> ''");

      // ── Legacy invoice backfill: numbers and amounts are preserved
      // exactly as issued; lifecycle is derived, nothing is re-taxed. ---
      const legacy = db
        .prepare("SELECT invoice_id, client_id, invoice_date, gst_amount, amount, total_amount, paid_amount, status, compliance_id FROM invoices")
        .all() as unknown as Array<Record<string, string | number | null>>;
      const backfill = db.prepare(
        `UPDATE invoices SET lifecycle=?, invoice_number=?, fy=?, taxable_paise=?, gst_paise=?, total_paise=?, paid_paise=?, billing_event_key=?
         WHERE invoice_id=?`,
      );
      const usedEvents = new Set(db.prepare("SELECT billing_event_key FROM invoices WHERE billing_event_key IS NOT NULL AND billing_event_key <> ''").all().map((r: Record<string, unknown>) => String((r as { billing_event_key?: string }).billing_event_key)));
      for (const row of legacy) {
        const id = String(row.invoice_id);
        const eventKey = row.compliance_id ? `completion:${row.compliance_id}` : `legacy:${id}`;
        if (usedEvents.has(eventKey)) {
          // Collision (legacy duplicates): suffix keeps the row addressable
          // without disturbing any number in the unique indexes.
          usedEvents.add(eventKey);
          db.prepare("UPDATE invoices SET lifecycle=?, invoice_number=? WHERE invoice_id=?").run(
            row.status === "Cancelled" ? "cancelled" : "issued", id, id,
          );
          continue;
        }
        usedEvents.add(eventKey);
        backfill.run(
          row.status === "Cancelled" ? "cancelled" : "issued",
          id,
          fyForDateSafe(String(row.invoice_date || "")),
          Math.round(Number(row.amount || 0) * 100),
          Math.round(Number(row.gst_amount || 0) * 100),
          Math.round(Number(row.total_amount || 0) * 100),
          Math.round(Number(row.paid_amount || 0) * 100),
          eventKey,
          id,
        );
      }
      db.exec("CREATE INDEX IF NOT EXISTS idx_invoices_lifecycle ON invoices(lifecycle, status)");
    },
  },
];

function fyForDateSafe(iso: string): string {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  if (!Number.isFinite(year) || !Number.isFinite(month) || !year) return "";
  const start = month >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

const LEGACY_MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8,
  oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

function legacyYmd(year: number, monthIndex: number, day: number): string {
  const last = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
}

function legacyFy(iso: string): string {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  if (!Number.isFinite(year) || !Number.isFinite(month)) return "";
  const start = month >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

function legacyNextAy(fy: string): string {
  const start = Number(fy.slice(0, 4));
  if (!Number.isFinite(start)) return "";
  return `${start + 1}-${String((start + 2) % 100).padStart(2, "0")}`;
}

/** Best-effort period bounds for rows created before the explicit period model. */
function legacyPeriod(period: string, frequency: string, dueDate: string): { periodStart: string; periodEnd: string } | null {
  const text = period.trim();
  const fyMatch = text.match(/(?:FY\s*)?(\d{4})[-\/](\d{2,4})/i);
  if (/\bA[YS]\b/i.test(text) && fyMatch) {
    const start = Number(fyMatch[1]);
    const fyStartYear = start - 1;
    const endYear = fyStartYear + 1;
    return { periodStart: `${fyStartYear}-04-01`, periodEnd: `${endYear}-03-31` };
  }
  if (/\bH[12]\b/i.test(text) && fyMatch) {
    const start = Number(fyMatch[1]);
    const second = /\bH2\b/i.test(text);
    return second
      ? { periodStart: `${start}-10-01`, periodEnd: `${start + 1}-03-31` }
      : { periodStart: `${start}-04-01`, periodEnd: `${start}-09-30` };
  }
  const quarter = text.match(/\bQ([1-4])\b/i);
  if (quarter && fyMatch) {
    const start = Number(fyMatch[1]);
    const q = Number(quarter[1]);
    const endMonth = q * 3; // Q1 -> June (6), Q2 -> September (9) ...
    const endYear = endMonth <= 9 ? start : start + 1;
    const monthIndex = ((endMonth - 1) % 12 + 12) % 12;
    return { periodStart: legacyYmd(endYear, monthIndex - 2, 1), periodEnd: legacyYmd(endYear, monthIndex, 31) };
  }
  const month = text.match(/\b([A-Za-z]{3,9})\s+(\d{4})\b/);
  if (month && LEGACY_MONTHS[month[1].toLowerCase()] !== undefined) {
    const monthIndex = LEGACY_MONTHS[month[1].toLowerCase()]!;
    const year = Number(month[2]);
    return { periodStart: legacyYmd(year, monthIndex, 1), periodEnd: legacyYmd(year, monthIndex, 31) };
  }
  if (/FY\s*\d{4}/i.test(text) && fyMatch) {
    const start = Number(fyMatch[1]);
    return { periodStart: `${start}-04-01`, periodEnd: `${start + 1}-03-31` };
  }
  if (frequency === "annual" && dueDate) {
    const year = Number(dueDate.slice(0, 4));
    const month = Number(dueDate.slice(5, 7));
    const fyEndYear = month < 4 ? year : year + 1;
    return { periodStart: `${fyEndYear - 1}-04-01`, periodEnd: `${fyEndYear}-03-31` };
  }
  if (frequency === "monthly" && dueDate) {
    const year = Number(dueDate.slice(0, 4));
    const month = Number(dueDate.slice(5, 7)) - 2;
    const dt = new Date(Date.UTC(year, month, 1));
    return { periodStart: legacyYmd(dt.getUTCFullYear(), dt.getUTCMonth(), 1), periodEnd: legacyYmd(dt.getUTCFullYear(), dt.getUTCMonth(), 31) };
  }
  return null;
}

function applyMigrationLedger(db: DatabaseSync) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )`,
  );
  const appliedRows = db.prepare("SELECT version FROM schema_migrations").all() as unknown as Array<{ version: number }>;
  const applied = new Set(appliedRows.map((r) => r.version));
  // The in-code bootstrap above ran before the ledger existed; record it as
  // migration 1 so the ledger is complete from the first run on this codebase.
  if (!applied.has(1)) {
    db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (1, ?, ?)").run(
      "v3.0 bootstrap (ensureColumn chain + workflow backfills)",
      new Date().toISOString(),
    );
    applied.add(1);
  }
  for (const migration of PERSISTENCE_MIGRATIONS) {
    if (applied.has(migration.version)) continue;
    db.exec("BEGIN IMMEDIATE");
    try {
      migration.apply(db);
      db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(
        migration.version,
        migration.name,
        new Date().toISOString(),
      );
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw new Error(`Migration ${migration.version} (${migration.name}) failed: ${(err as Error).message}`);
    }
  }
}

/** Safe migration status for the health endpoint: versions only, no SQL. */
export function getMigrationStatus(): { applied: number[]; pending: number } {
  const db = getDb();
  const rows = db.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as unknown as Array<{ version: number }>;
  return { applied: rows.map((r) => r.version), pending: PERSISTENCE_MIGRATIONS.filter((m) => !rows.some((r) => r.version === m.version)).length };
}

/**
 * Runs a group of writes atomically. SQLite node driver holds one connection,
 * and no await may occur inside fn (never hold a transaction open across an
 * external HTTP call).
 */
let transactionDepth = 0;

export function withTransaction<T>(fn: () => T): T {
  const db = getDb();
  const savepoint = transactionDepth > 0 ? `sp_${transactionDepth}` : null;
  db.exec(savepoint ? `SAVEPOINT ${savepoint}` : "BEGIN IMMEDIATE");
  transactionDepth++;
  try {
    const result = fn();
    transactionDepth--;
    db.exec(savepoint ? `RELEASE ${savepoint}` : "COMMIT");
    return result;
  } catch (err) {
    transactionDepth = Math.max(0, transactionDepth - 1);
    db.exec(savepoint ? `ROLLBACK TO ${savepoint}` : "ROLLBACK");
    if (savepoint) db.exec(`RELEASE ${savepoint}`);
    throw err;
  }
}

/**
 * PAN and GSTIN are stored AES-256-GCM encrypted (see lib/crypto.ts). Rows
 * written before field encryption existed are plaintext — bring them forward.
 */
function encryptLegacyIdentifiers(db: DatabaseSync) {
  const rows = db
    .prepare(
      `SELECT client_id, pan, gst_number, tan FROM clients
       WHERE (pan IS NOT NULL AND pan NOT LIKE 'enc:v1:%')
          OR (gst_number IS NOT NULL AND gst_number NOT LIKE 'enc:v1:%')
          OR (tan IS NOT NULL AND tan NOT LIKE 'enc:v1:%')`,
    )
    .all() as unknown as Array<{ client_id: string; pan: string | null; gst_number: string | null; tan: string | null }>;
  if (rows.length === 0) return;
  const update = db.prepare("UPDATE clients SET pan = ?, gst_number = ?, tan = ? WHERE client_id = ?");
  for (const row of rows) {
    update.run(
      row.pan && !isEncrypted(row.pan) ? encryptField(row.pan) : row.pan,
      row.gst_number && !isEncrypted(row.gst_number) ? encryptField(row.gst_number) : row.gst_number,
      row.tan && !isEncrypted(row.tan) ? encryptField(row.tan) : row.tan,
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
  ["Managing Partner", "NOTICE_RESPONSE", "notice", "ASMT-10 response filed for Apex Media", -390],
  ["Meera Pillai", "CLIENT_CREATED", "client", "Trident Pharma Pvt Ltd onboarded", -520],
  ["Rohit Bansal", "UDIN_GENERATED", "udin", "UDIN generated for NovaBuild statutory audit", -660],
  ["Ananya Iyer", "TIMESHEET_APPROVED", "timesheet", "6.0 billable hours approved for Rohit Bansal", -800],
];

function seedIfEmpty(db: DatabaseSync) {
  const count = db.prepare("SELECT COUNT(*) AS n FROM clients").get() as { n: number };
  if (count.n > 0) return;
  // Synthetic demo practice data is never auto-seeded in durable production —
  // only demo-marked installs (CA_ALLOW_EPHEMERAL=1) or dev machines.
  if (!getConfig().demoSeed) return;

  const insertClient = db.prepare(`INSERT INTO clients (client_id,name,contact_person,phone,email,entity_type,gst_number,pan,services_opted,city,state,created_at)
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
  if (proposals.n === 0 && !getConfig().demoSeed) return;
  if (proposals.n === 0) {
    const settings = Object.fromEntries(
      (db.prepare("SELECT key, value FROM settings").all() as unknown as Array<{ key: string; value: string }>).map((r) => [r.key, r.value]),
    );
    let leads: Array<{ lead_id: string; name: string; company_name: string; service_interest: string }> = [];
    try {
      leads = db.prepare("SELECT lead_id, name, company_name, service_interest FROM leads ORDER BY lead_score DESC LIMIT 2").all() as unknown as typeof leads;
    } catch {
      // The leads module was removed from the schema — seed no demo proposals.
    }
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
export function all<T>(sql: string, ...params: Array<string | number | null>): T[] {
  const rows = getDb().prepare(sql).all(...params) as unknown as Array<Record<string, unknown>>;
  return rows.map((row) => ({ ...row })) as T[];
}

export function one<T>(sql: string, ...params: Array<string | number | null>): T | null {
  const row = getDb().prepare(sql).get(...params) as unknown as Record<string, unknown> | undefined;
  return row ? ({ ...row } as T) : null;
}

export function nextId(prefix: string, table: string, column: string): string {
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

// ── Automation rules ──────────────────────────────────────────────────────────
//
// A rule is a *standing approval*: a partner or manager configures it once and
// the sweep runs it unattended. Every run is recorded in automation_runs and
// the audit log, so the firm can always answer "why did this happen?".

type AutomationRuleRow = {
  rule_id: string; name: string; action: string; params: string;
  mode: string; cadence: string; enabled: number; last_run_at: string | null;
  run_count: number; created_by: string; created_at: string;
};

function fromDbRule(row: AutomationRuleRow): AutomationRule {
  let params: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(row.params || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) params = parsed as Record<string, unknown>;
  } catch {
    params = {};
  }
  return {
    rule_id: row.rule_id,
    name: row.name,
    action: row.action as AutomationKind,
    params,
    mode: (row.mode === "approval" ? "approval" : "auto") as AutomationMode,
    cadence: (["daily", "weekly", "monthly"].includes(row.cadence) ? row.cadence : "daily") as AutomationCadence,
    enabled: row.enabled === 1,
    last_run_at: row.last_run_at,
    run_count: row.run_count,
    created_by: row.created_by,
    created_at: row.created_at,
  };
}

export function listAutomationRules(): AutomationRule[] {
  return all<AutomationRuleRow>("SELECT * FROM automation_rules ORDER BY enabled DESC, created_at ASC").map(fromDbRule);
}

export function getAutomationRule(ruleId: string): AutomationRule | null {
  const row = one<AutomationRuleRow>("SELECT * FROM automation_rules WHERE rule_id = ?", ruleId);
  return row ? fromDbRule(row) : null;
}

export function createAutomationRule(input: {
  name: string;
  action: AutomationKind;
  params: Record<string, unknown>;
  mode: AutomationMode;
  cadence: AutomationCadence;
  created_by: string;
}): AutomationRule {
  const row: AutomationRuleRow = {
    rule_id: nextId("AUTO", "automation_rules", "rule_id"),
    name: input.name.slice(0, 120),
    action: input.action,
    params: JSON.stringify(input.params ?? {}),
    mode: input.mode,
    cadence: input.cadence,
    enabled: 1,
    last_run_at: null,
    run_count: 0,
    created_by: input.created_by,
    created_at: new Date().toISOString(),
  };
  getDb()
    .prepare(
      `INSERT INTO automation_rules (rule_id,name,action,params,mode,cadence,enabled,last_run_at,run_count,created_by,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(row.rule_id, row.name, row.action, row.params, row.mode, row.cadence, row.enabled, row.last_run_at, row.run_count, row.created_by, row.created_at);
  logAudit({ actor: input.created_by, action: "AUTOMATION_RULE_CREATED", entity_type: "automation_rule", entity_id: row.rule_id, detail: `${row.name} (${row.action}, ${row.mode}, ${row.cadence})` });
  return fromDbRule(row);
}

export function updateAutomationRule(
  ruleId: string,
  patch: Partial<Pick<AutomationRule, "name" | "params" | "mode" | "cadence" | "enabled">>,
): AutomationRule | null {
  const existing = getAutomationRule(ruleId);
  if (!existing) return null;
  const next = { ...existing, ...patch };
  getDb()
    .prepare("UPDATE automation_rules SET name = ?, params = ?, mode = ?, cadence = ?, enabled = ? WHERE rule_id = ?")
    .run(next.name, JSON.stringify(next.params ?? {}), next.mode, next.cadence, next.enabled ? 1 : 0, ruleId);
  return getAutomationRule(ruleId);
}

export function deleteAutomationRule(ruleId: string): boolean {
  const result = getDb().prepare("DELETE FROM automation_rules WHERE rule_id = ?").run(ruleId);
  if (Number(result.changes) > 0) {
    logAudit({ action: "AUTOMATION_RULE_DELETED", entity_type: "automation_rule", entity_id: ruleId, detail: "Rule removed" });
    return true;
  }
  return false;
}

/** Records that a rule completed a run (attempt-count, not success-count). */
export function markAutomationRuleRun(ruleId: string): void {
  getDb()
    .prepare("UPDATE automation_rules SET last_run_at = ?, run_count = run_count + 1 WHERE rule_id = ?")
    .run(new Date().toISOString(), ruleId);
}

export function logAutomationRun(entry: {
  rule_id: string;
  rule_name: string;
  status: AutomationRun["status"];
  summary: string;
  detail?: Record<string, unknown>;
  actor: string;
  started_at: string;
}): AutomationRun {
  const run: AutomationRun = {
    run_id: nextId("ARUN", "automation_runs", "run_id"),
    rule_id: entry.rule_id,
    rule_name: entry.rule_name,
    status: entry.status,
    summary: entry.summary.slice(0, 500),
    detail: entry.detail ?? {},
    actor: entry.actor,
    started_at: entry.started_at,
    finished_at: new Date().toISOString(),
  };
  getDb()
    .prepare("INSERT INTO automation_runs (run_id,rule_id,rule_name,status,summary,detail,actor,started_at,finished_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(run.run_id, run.rule_id, run.rule_name, run.status, run.summary, JSON.stringify(run.detail), run.actor, run.started_at, run.finished_at);
  logAudit({
    actor: entry.actor,
    action: entry.status === "failed" ? "AUTOMATION_RUN_FAILED" : "AUTOMATION_RUN",
    entity_type: "automation_run",
    entity_id: run.run_id,
    detail: `${run.rule_name}: ${run.summary}`,
  });
  return run;
}

export function listAutomationRuns(limit = 25): AutomationRun[] {
  return all<Omit<AutomationRun, "detail"> & { detail: string }>(
    "SELECT * FROM automation_runs ORDER BY started_at DESC LIMIT ?",
    limit,
  ).map((row) => {
    let detail: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(row.detail || "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) detail = parsed as Record<string, unknown>;
    } catch {
      detail = {};
    }
    return { ...row, detail };
  });
}

/** Runs from the last N days, used for the "actions taken" counter. */
export function automationActivity(sinceDays = 7): { runs: number; actions: number } {
  const row = one<{ runs: number; actions: number }>(
    `SELECT COUNT(*) AS runs,
            COALESCE(SUM(CAST(json_extract(detail, '$.actions') AS INTEGER)), 0) AS actions
       FROM automation_runs
      WHERE started_at >= datetime('now', ?)`,
    `-${sinceDays} days`,
  );
  return { runs: row?.runs ?? 0, actions: row?.actions ?? 0 };
}

// ── Automation outbox ─────────────────────────────────────────────────────────
// Automation drafts communication as `Queued` messages. Nothing is claimed to
// have been sent: the firm opens the deep link, sends it, and marks it sent.

export function listQueuedMessages(limit = 40): Message[] {
  return all<Message>("SELECT * FROM messages WHERE status = 'Queued' ORDER BY created_at ASC LIMIT ?", limit);
}

export function countQueuedMessages(): number {
  const row = one<{ n: number }>("SELECT COUNT(*) AS n FROM messages WHERE status = 'Queued'");
  return row?.n ?? 0;
}

export function markMessageStatus(messageId: string, status: string): Message | null {
  getDb()
    .prepare("UPDATE messages SET status = ?, sent_at = CASE WHEN ? = 'Sent' THEN COALESCE(sent_at, ?) ELSE sent_at END WHERE message_id = ?")
    .run(status, status, new Date().toISOString(), messageId);
  const row = one<Message>("SELECT * FROM messages WHERE message_id = ?", messageId);
  if (row && status === "Sent") {
    logAudit({ action: "MESSAGE_SENT", entity_type: row.related_type || "message", entity_id: row.related_id, detail: `${row.channel} to ${row.recipient_name}` });
  }
  return row;
}

// ── Clients ───────────────────────────────────────────────────────────────────
export function listClients(): Client[] {
  return all<Client>("SELECT * FROM clients ORDER BY name").map(fromDbClient);
}

export function getClient(clientId: string): Client | null {
  const row = one<Client>("SELECT * FROM clients WHERE client_id = ?", clientId);
  return row ? fromDbClient(row) : null;
}

// PAN, GSTIN and TAN come back out of storage decrypted; everything above this
// layer only ever sees plaintext values.
function fromDbClient(row: Client): Client {
  return {
    ...row,
    gst_number: decryptField(row.gst_number),
    pan: decryptField(row.pan),
    tan: decryptField(row.tan ?? ""),
    whatsapp_opt_in: row.whatsapp_opt_in === undefined ? true : Boolean(row.whatsapp_opt_in),
    onboarding_status: row.onboarding_status ?? "Active",
    client_status: row.client_status ?? "Active",
    fy_end_month: row.fy_end_month ?? 3,
    preferred_language: row.preferred_language ?? "English",
    preferred_channel: (row.preferred_channel as Client["preferred_channel"]) ?? "WhatsApp",
    onboarding_stage: row.onboarding_stage ?? "review",
    engagement_letter_status: row.engagement_letter_status ?? "Not recorded",
    contact_verified_at: row.contact_verified_at ?? null,
    onboarding_completed_at: row.onboarding_completed_at ?? null,
  };
}

export function createClient(input: Omit<Client, "client_id" | "created_at">): Client {
  const client: Client = {
    ...input,
    client_id: nextId("CLIENT", "clients", "client_id"),
    created_at: new Date().toISOString(),
    gst_state_code: input.gst_state_code || (input.gst_number ? input.gst_number.slice(0, 2) : ""),
    whatsapp_opt_in: input.whatsapp_opt_in ?? true,
    onboarding_status: input.onboarding_status ?? "Active",
    client_status: input.client_status ?? "Active",
    fy_end_month: input.fy_end_month ?? 3,
  };
  getDb()
    .prepare(`INSERT INTO clients (client_id,name,contact_person,phone,email,entity_type,gst_number,pan,services_opted,city,state,created_at,
      legal_name,trade_name,tan,cin,gst_registration_type,gst_state_code,date_of_incorporation,address,pincode,
      whatsapp_opt_in,onboarding_status,client_status,relationship_manager,notes,fy_end_month,
      date_of_birth,primary_contact_designation,whatsapp_number,billing_contact,authorised_representative,
      preferred_language,preferred_channel,contact_verified_at,contact_verification_note,
      whatsapp_consent_at,whatsapp_consent_source,engagement_letter_status,engagement_letter_date,
      onboarding_stage,onboarding_completed_at,created_by,updated_by,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(
      client.client_id,
      client.name,
      client.contact_person,
      client.phone,
      client.email,
      client.entity_type,
      encryptField(client.gst_number),
      encryptField(client.pan),
      client.services_opted,
      client.city,
      client.state,
      client.created_at,
      client.legal_name ?? client.name,
      client.trade_name ?? "",
      encryptField(client.tan ?? ""),
      client.cin ?? "",
      client.gst_registration_type ?? (client.gst_number ? "Regular" : "Unregistered"),
      client.gst_state_code ?? "",
      client.date_of_incorporation ?? "",
      client.address ?? "",
      client.pincode ?? "",
      client.whatsapp_opt_in ? 1 : 0,
      client.onboarding_status ?? "Active",
      client.client_status ?? "Active",
      client.relationship_manager ?? "",
      client.notes ?? "",
      client.fy_end_month ?? 3,
      client.date_of_birth ?? "",
      client.primary_contact_designation ?? "",
      client.whatsapp_number ?? "",
      client.billing_contact ?? "",
      client.authorised_representative ?? "",
      client.preferred_language ?? "English",
      client.preferred_channel ?? "WhatsApp",
      client.contact_verified_at ?? null,
      client.contact_verification_note ?? "",
      client.whatsapp_consent_at ?? null,
      client.whatsapp_consent_source ?? "",
      client.engagement_letter_status ?? "Not recorded",
      client.engagement_letter_date ?? "",
      client.onboarding_stage ?? "review",
      client.onboarding_completed_at ?? null,
      client.created_by ?? "",
      client.updated_by ?? "",
      client.updated_at ?? client.created_at,
    );
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
  // withTransaction uses a savepoint when a caller (onboarding) already opened
  // a transaction, so profile writes never issue a nested BEGIN.
  withTransaction(() => {
    db.prepare(`UPDATE clients SET name=?, contact_person=?, phone=?, email=?, entity_type=?, gst_number=?, pan=?, services_opted=?, city=?, state=?,
      legal_name=?, trade_name=?, tan=?, cin=?, gst_registration_type=?, gst_state_code=?, date_of_incorporation=?, address=?, pincode=?,
      whatsapp_opt_in=?, onboarding_status=?, client_status=?, relationship_manager=?, notes=?, fy_end_month=?,
      date_of_birth=?, primary_contact_designation=?, whatsapp_number=?, billing_contact=?, authorised_representative=?,
      preferred_language=?, preferred_channel=?, contact_verified_at=?, contact_verification_note=?,
      whatsapp_consent_at=?, whatsapp_consent_source=?, engagement_letter_status=?, engagement_letter_date=?,
      onboarding_stage=?, onboarding_completed_at=?, updated_by=?, updated_at=? WHERE client_id=?`)
      .run(
        next.name,
        next.contact_person,
        next.phone,
        next.email,
        next.entity_type,
        encryptField(next.gst_number),
        encryptField(next.pan),
        next.services_opted,
        next.city,
        next.state,
        next.legal_name ?? next.name,
        next.trade_name ?? "",
        encryptField(next.tan ?? ""),
        next.cin ?? "",
        next.gst_registration_type ?? "",
        next.gst_state_code ?? "",
        next.date_of_incorporation ?? "",
        next.address ?? "",
        next.pincode ?? "",
        next.whatsapp_opt_in ? 1 : 0,
        next.onboarding_status ?? "Active",
        next.client_status ?? "Active",
        next.relationship_manager ?? "",
        next.notes ?? "",
        next.fy_end_month ?? 3,
        next.date_of_birth ?? "",
        next.primary_contact_designation ?? "",
        next.whatsapp_number ?? "",
        next.billing_contact ?? "",
        next.authorised_representative ?? "",
        next.preferred_language ?? "English",
        next.preferred_channel ?? "WhatsApp",
        next.contact_verified_at ?? null,
        next.contact_verification_note ?? "",
        next.whatsapp_consent_at ?? null,
        next.whatsapp_consent_source ?? "",
        next.engagement_letter_status ?? "Not recorded",
        next.engagement_letter_date ?? "",
        next.onboarding_stage ?? "review",
        next.onboarding_completed_at ?? null,
        next.updated_by ?? next.created_by ?? "",
        next.updated_at ?? new Date().toISOString(),
        clientId,
      );
    if (next.name !== current.name) {
      // Keep the denormalised capture name in sync across the practice.
      db.prepare("UPDATE compliance SET client_name=? WHERE client_id=?").run(next.name, clientId);
      db.prepare("UPDATE documents SET client_name=? WHERE client_id=?").run(next.name, clientId);
      db.prepare("UPDATE invoices SET client_name=? WHERE client_id=?").run(next.name, clientId);
      db.prepare("UPDATE payments SET client_name=? WHERE client_name=?").run(next.name, current.name);
      db.prepare("UPDATE document_requests SET client_name=? WHERE client_id=?").run(next.name, clientId);
    }
  });
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
  withTransaction(() => {
    db.prepare("DELETE FROM client_services WHERE client_id = ?").run(clientId);
    db.prepare("DELETE FROM document_requests WHERE client_id = ?").run(clientId);
    db.prepare("DELETE FROM client_registrations WHERE client_id = ?").run(clientId);
    db.prepare("DELETE FROM client_service_assignments WHERE client_id = ?").run(clientId);
    db.prepare("DELETE FROM onboarding_tasks WHERE client_id = ?").run(clientId);
    db.prepare("DELETE FROM onboarding_activations WHERE client_id = ?").run(clientId);
    db.prepare("DELETE FROM clients WHERE client_id = ?").run(clientId);
  });
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
    services: all<ClientService>("SELECT * FROM client_services WHERE client_id = ? ORDER BY service_name", clientId).map((row) => ({
      ...row,
      auto_invoice: Boolean(row.auto_invoice),
      fee: Number(row.fee) || 0,
      reminder_cap: Math.min(3, Math.max(1, Number(row.reminder_cap) || 3)),
    })),
    requests: all<DocumentRequest>(
      "SELECT * FROM document_requests WHERE client_id = ? ORDER BY CASE status WHEN 'Open' THEN 0 ELSE 1 END, due_date",
      clientId,
    ),
    timeline: all<TaskEvent>(
      `SELECT e.* FROM task_events e JOIN compliance c ON c.compliance_id = e.compliance_id WHERE c.client_id = ? ORDER BY e.created_at DESC LIMIT 40`,
      clientId,
    ),
  };
}

// ── Leads ─────────────────────────────────────────────────────────────────────
export function listLeads(): Lead[] {
  try {
    return all<Lead>("SELECT * FROM leads ORDER BY lead_score DESC");
  } catch {
    // Databases created after the leads module was removed have no leads table.
    return [];
  }
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

function normaliseCompliance(row: Compliance): Compliance {
  return {
    ...row,
    status: effectiveComplianceStatus(row),
    due_date_verified: Boolean(row.due_date_verified),
    filing_confirmed_by_integration: Boolean(row.filing_confirmed_by_integration),
    billed: Boolean(row.billed),
  };
}

export function listCompliance(): Compliance[] {
  return all<Compliance>("SELECT * FROM compliance ORDER BY due_date").map(normaliseCompliance);
}

export function getCompliance(complianceId: string): Compliance | null {
  const row = one<Compliance>("SELECT * FROM compliance WHERE compliance_id = ?", complianceId);
  return row ? normaliseCompliance(row) : null;
}export function createCompliance(input: Omit<Compliance, "compliance_id">): Compliance {
  const generatedAt = input.generated_at ?? new Date().toISOString();
  const item: Compliance = {
    ...input,
    compliance_id: nextId("COMP", "compliance", "compliance_id"),
    stage: input.stage ?? (input.status === "Filed" ? "done" : input.status === "In Progress" ? "preparation" : "documents"),
    stage_updated_at: input.stage_updated_at ?? generatedAt,
    preparer: input.preparer ?? input.assigned_to ?? "",
    reviewer: input.reviewer ?? "",
    fy: input.fy ?? fyForDate(input.due_date),
    service_code: input.service_code ?? serviceCodeFromLabel(input.compliance_type) ?? "other",
    service_id: input.service_id ?? "",
    billed: input.billed ?? false,
    period_type: input.period_type ?? "custom",
    period_start: input.period_start ?? null,
    period_end: input.period_end ?? null,
    assessment_year: input.assessment_year ?? null,
    internal_target_date: input.internal_target_date ?? input.due_date,
    statutory_due_date: input.statutory_due_date ?? null,
    due_rule_id: input.due_rule_id ?? null,
    due_rule_version: input.due_rule_version ?? null,
    due_date_source: input.due_date_source ?? "Manual due date (unverified)",
    due_date_verified: input.due_date_verified ?? false,
    statutory_rule_status: input.statutory_rule_status ?? "unverified",
    generation_source: input.generation_source ?? "manual",
    generated_at: generatedAt,
    filing_recorded_at: input.filing_recorded_at ?? null,
    filing_reference: input.filing_reference ?? null,
    filing_recorded_by: input.filing_recorded_by ?? "",
    filing_confirmed_by_integration: input.filing_confirmed_by_integration ?? false,
    filing_notes: input.filing_notes ?? "",
  };
  getDb()
    .prepare(`INSERT INTO compliance (compliance_id,client_id,client_name,compliance_type,period,due_date,status,filed_date,ack_number,assigned_to,notes,
      service_id,service_code,fy,stage,stage_updated_at,preparer,reviewer,blocked_reason,completed_at,billed,registration_id,
      period_type,period_start,period_end,assessment_year,internal_target_date,statutory_due_date,due_rule_id,due_rule_version,
      due_date_source,due_date_verified,statutory_rule_status,generation_source,generated_at,
      filing_recorded_at,filing_reference,filing_recorded_by,filing_confirmed_by_integration,filing_notes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(
      item.compliance_id,
      item.client_id,
      item.client_name,
      item.compliance_type,
      item.period,
      item.due_date,
      item.status,
      item.filed_date,
      item.ack_number,
      item.assigned_to,
      item.notes,
      item.service_id ?? "",
      item.service_code ?? "other",
      item.fy ?? "",
      item.stage ?? "documents",
      item.stage_updated_at ?? generatedAt,
      item.preparer ?? "",
      item.reviewer ?? "",
      item.blocked_reason ?? "",
      item.completed_at ?? null,
      item.billed ? 1 : 0,
      item.registration_id ?? "",
      item.period_type ?? "custom",
      item.period_start ?? null,
      item.period_end ?? null,
      item.assessment_year ?? null,
      item.internal_target_date ?? item.due_date,
      item.statutory_due_date ?? null,
      item.due_rule_id ?? null,
      item.due_rule_version ?? null,
      item.due_date_source ?? "Manual due date (unverified)",
      item.due_date_verified ? 1 : 0,
      item.statutory_rule_status ?? "unverified",
      item.generation_source ?? "manual",
      generatedAt,
      item.filing_recorded_at ?? null,
      item.filing_reference ?? null,
      item.filing_recorded_by ?? "",
      item.filing_confirmed_by_integration ? 1 : 0,
      item.filing_notes ?? "",
    );
  logAudit({ action: "COMPLIANCE_CREATED", entity_type: "compliance", entity_id: item.compliance_id, detail: `${item.compliance_type} for ${item.client_name}` });
  return item;
}

export function updateComplianceStatus(complianceId: string, status: Compliance["status"]): Compliance | null {
  const current = one<Compliance>("SELECT * FROM compliance WHERE compliance_id = ?", complianceId);
  if (!current) return null;
  const filed = status === "Filed";
  // Never invent an acknowledgement. A filing needs recorded evidence first.
  if (filed && !current.ack_number) {
    throw new Error("Record the portal acknowledgement / ARN before marking this engagement as filed");
  }
  const ackNumber = current.ack_number;
  const filedDate = filed ? current.filed_date || iso(0) : current.filed_date;
  const stage = filed ? "done" : current.stage ?? "documents";
  getDb()
    .prepare("UPDATE compliance SET status=?, filed_date=?, stage=?, completed_at=? WHERE compliance_id=?")
    .run(status, filedDate, stage, filed ? new Date().toISOString() : current.completed_at ?? null, complianceId);
  logAudit({ action: "STATUS_CHANGE", entity_type: "compliance", entity_id: complianceId, detail: `${current.compliance_type} for ${current.client_name} → ${status}` });
  return { ...current, status, filed_date: filedDate, ack_number: ackNumber, stage };
}

export function recordComplianceHistory(input: {
  compliance_id: string;
  from_status: string | null;
  to_status: string;
  from_stage?: string | null;
  to_stage?: string | null;
  actor: string;
  role: string;
  reason?: string;
  at?: string;
}): void {
  getDb()
    .prepare(`INSERT INTO compliance_status_history
      (history_id,compliance_id,from_status,to_status,from_stage,to_stage,actor,role,reason,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(
      nextId("HIST", "compliance_status_history", "history_id"),
      input.compliance_id,
      input.from_status,
      input.to_status,
      input.from_stage ?? null,
      input.to_stage ?? null,
      input.actor,
      input.role,
      (input.reason ?? "").slice(0, 500),
      input.at ?? new Date().toISOString(),
    );
}

export function listComplianceHistory(complianceId: string): StatusHistoryEntry[] {
  return all<StatusHistoryEntry>(
    "SELECT * FROM compliance_status_history WHERE compliance_id = ? ORDER BY created_at, history_id",
    complianceId,
  );
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
    reminder_count: input.reminder_count ?? 0,
    source: input.source ?? "manual",
  };
  getDb()
    .prepare(`INSERT INTO documents (doc_id,client_id,client_name,document_name,status,requested_date,received_date,notes,
      request_id,compliance_id,service_code,category,fy,period,reminder_count,last_reminded_at,next_reminder_on,verified_by,source,sort_order,
      registration_id,template_version)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(
      doc.doc_id,
      doc.client_id,
      doc.client_name,
      doc.document_name,
      doc.status,
      doc.requested_date,
      doc.received_date,
      doc.notes,
      doc.request_id ?? "",
      doc.compliance_id ?? "",
      doc.service_code ?? "",
      doc.category ?? "General",
      doc.fy ?? "",
      doc.period ?? "",
      doc.reminder_count ?? 0,
      doc.last_reminded_at ?? null,
      doc.next_reminder_on ?? null,
      doc.verified_by ?? "",
      doc.source ?? "manual",
      doc.sort_order ?? 0,
      doc.registration_id ?? "",
      doc.template_version ?? null,
    );
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
    .prepare("UPDATE documents SET file_name=?, file_size=?, file_path=?, uploaded_at=?, status='Received', received_date=?, verified_by='', review_reason='', reviewed_at=? WHERE doc_id=?")
    .run(file.file_name, file.file_size, file.file_path, uploadedAt, iso(0), uploadedAt, docId);
  logAudit({ action: "DOCUMENT_UPLOADED", entity_type: "document", entity_id: docId, detail: `${file.file_name} uploaded for ${current.client_name}${current.status === "Verified" ? " — a prior review was reset" : ""}` });
  return getDocument(docId);
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

/** Replaces a document's current object with a new upload; the previous
 *  object's bytes stay in storage under the version ledger until an explicit
 *  retention decision (documents DELETE route) removes them. */
export function recordFileVersion(
  docId: string,
  file: { object_key: string; file_name: string; size_bytes: number; checksum: string; uploaded_by?: string | null; change_reason?: string },
): { version: number; version_id: string; superseded: number } {
  return withTransaction(() => {
    const row = one<{ next: number | null }>("SELECT MAX(version)+1 AS next FROM file_versions WHERE doc_id=?", docId);
    const version = Math.max(1, Number(row?.next) || 1);
    const versionId = nextId("FV", "file_versions", "version_id");
    getDb()
      .prepare(`INSERT INTO file_versions (version_id,doc_id,version,object_key,file_name,size_bytes,checksum,uploaded_by,uploaded_at,status,change_reason)
        VALUES (?,?,?,?,?,?,?,?,?,'current',?)`)
      .run(versionId, docId, version, file.object_key, file.file_name, file.size_bytes, file.checksum, file.uploaded_by ?? null, new Date().toISOString(), (file.change_reason ?? "").slice(0, 500));
    // A replacement supersedes the previous current object: version history is
    // the ledger, so nothing is destroyed — the old bytes stay until an
    // explicit retention decision removes them.
    const supersede = getDb().prepare(
      "UPDATE file_versions SET status='superseded', superseded_at=? WHERE doc_id=? AND status='current' AND version_id <> ?",
    ).run(new Date().toISOString(), docId, versionId);
    return { version, version_id: versionId, superseded: Number(supersede.changes) || 0 };
  });
}

export function listFileVersions(docId: string): FileVersion[] {
  return all<FileVersion>("SELECT * FROM file_versions WHERE doc_id = ? ORDER BY version DESC", docId) as FileVersion[];
}

export function updateDocumentStatus(docId: string, status: DocumentItem["status"], actor = ""): DocumentItem | null {
  const current = one<DocumentItem>("SELECT * FROM documents WHERE doc_id = ?", docId);
  if (!current) return null;
  const received = status === "Received" || status === "Verified";
  getDb()
    .prepare("UPDATE documents SET status=?, received_date=?, next_reminder_on=NULL, verified_by=? WHERE doc_id=?")
    .run(status, received ? iso(0) : current.received_date, status === "Verified" ? actor || "Verified" : current.verified_by ?? "", docId);
  logAudit({ action: "DOCUMENT_RECEIVED", entity_type: "document", entity_id: docId, detail: `${current.document_name} ${status.toLowerCase()} from ${current.client_name}` });
  return { ...current, status, received_date: received ? iso(0) : current.received_date };
}

// ── Invoices ──────────────────────────────────────────────────────────────────
function effectiveInvoiceStatus(row: Invoice): Invoice["status"] {
  if (row.status === "Cancelled" || row.lifecycle === "cancelled") return "Cancelled";
  const total = row.total_paise ?? Math.round(row.total_amount * 100);
  const paid = row.paid_paise ?? Math.round(row.paid_amount * 100);
  const credit = row.credit_paise ?? 0;
  // Drafts are receivable potentials, not issued receivables: they are never
  // overdue and can only show as Pending until finalisation.
  if (row.lifecycle === "draft" || row.lifecycle === "pending_approval" || row.lifecycle === "approved") return "Pending";
  if (total > 0 && paid + credit >= total) return "Paid";
  if (dayDiff(row.due_date) < 0) return "Overdue";
  if (paid + credit > 0) return "Partially Paid";
  return "Pending";
}

function normaliseInvoice(row: Invoice): Invoice {
  const paidPaise = row.paid_paise ?? Math.round((row.paid_amount ?? 0) * 100);
  const paiseRow: Invoice = { ...row, paid_paise: paidPaise };
  return { ...paiseRow, paid_amount: paiseToRupees(paidPaise), status: effectiveInvoiceStatus(paiseRow) };
}

function paiseToRupees(paise: number): number {
  return Math.round(paise) / 100;
}

export function listInvoices(): Invoice[] {
  return all<Invoice>("SELECT * FROM invoices ORDER BY invoice_date DESC").map(normaliseInvoice);
}

export function getInvoice(invoiceId: string): Invoice | null {
  const row = one<Invoice>("SELECT * FROM invoices WHERE invoice_id = ?", invoiceId);
  return row ? normaliseInvoice(row) : null;
}

/**
 * Legacy single-shot invoice creation is gone: all invoices — manual or
 * automatic — now go through the billing engine in lib/invoicing.ts, which
 * owns numbering, approval, tax treatment, the payment ledger and the
 * append-only invoice event history. The old path created a Pending invoice
 * with a silently applied GST rate and allowed "Paid" to be set without any
 * payment evidence; both behaviours were withdrawn for Prompt 10.
 */

export function listPayments(): Payment[] {
  return all<Payment>("SELECT * FROM payments ORDER BY paid_on DESC, created_at DESC");
}

export function listPaymentsForInvoice(invoiceId: string): Payment[] {
  return all<Payment>("SELECT * FROM payments WHERE invoice_id = ? ORDER BY paid_on DESC, created_at DESC", invoiceId);
}

/**
 * Payment recording lives in lib/invoicing.ts (`recordPaymentEntry`): the
 * ledger-derived implementation adds duplicate guards, fresh-balance
 * over-allocation checks inside the write transaction, reconciliation states
 * and partner-only reversal entries. This stub remains for any historical
 * caller; it delegates to the engine.
 */
export { recordPaymentEntry as recordPayment } from "./invoicing";

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
    workflow: count("SELECT COUNT(*) AS n FROM compliance WHERE status <> 'Filed' AND COALESCE(stage,'documents') <> 'done' AND due_date <= ?", week),
    compliance: count("SELECT COUNT(*) AS n FROM compliance WHERE status <> 'Filed' AND due_date <= ?", week),
    leads: 0, // the leads module was removed; key kept for the NavCounts shape
    invoices: count("SELECT COUNT(*) AS n FROM invoices WHERE status NOT IN ('Paid','Cancelled') AND due_date < ?", today),
    agent: 0,
    // Prepared client communication waiting in the automation outbox.
    automation: count("SELECT COUNT(*) AS n FROM messages WHERE status = 'Queued'"),
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
    .prepare(`INSERT INTO messages (message_id,channel,recipient_name,to_address,subject,body,related_type,related_id,status,created_at,
      kind,reminder_number,sent_at,error,automation_key)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(
      message.message_id,
      message.channel,
      message.recipient_name,
      message.to_address,
      message.subject,
      message.body,
      message.related_type,
      message.related_id,
      message.status,
      message.created_at,
      message.kind ?? "manual",
      message.reminder_number ?? 0,
      message.sent_at ?? null,
      message.error ?? "",
      message.automation_key ?? "",
    );
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
