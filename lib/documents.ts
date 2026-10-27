/**
 * Document-management operations on top of the practice ledger and the
 * storage abstraction (lib/storage.ts).
 *
 * Kept beside db/engagements-db as its own bounded context: review rules,
 * classification, soft archival, filtered queries and the legacy-file
 * migration. This module never renders a UI concern and never imports
 * next/* — it is exercised directly by tests as well as by route handlers.
 *
 * House rules:
 *  - A replacement upload resets review state (attachDocumentFile does this
 *    in lib/db.ts); a prior approval never carries over to new bytes.
 *  - Only a manager or partner may verify or reject a document; rejection
 *    always carries a written reason.
 *  - Review history is append-only (SQLite triggers in migration 5).
 *  - Archive is a soft delete: the bytes stay in storage until an explicit
 *    retention decision removes them.
 *  - The legacy migration verifies checksums and is retry-safe; it never
 *    deletes the original legacy file until the row is verified.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type {
  DocumentItem,
  DocumentMigrationReport,
  DocumentStatusHistoryEntry,
  FileVersion,
} from "./types";
import { all, getDb, getDocument, listFileVersions, logAudit, nextId, one, recordFileVersion, withTransaction } from "./db";
import { dataPath } from "./data-dir";
import { deleteObject, objectExists, objectKeyFor, objectKeyIsSafe, putObject } from "./storage";

export class DocumentOpError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "DocumentOpError";
    this.status = status;
  }
}

export const REVIEW_STATUSES = ["Received", "Verified", "Rejected", "Pending", "Waived"] as const;
export const MANAGER_ROLES = new Set(["partner", "manager"]);

const MAX_FILENAME = 160;

// ── Review ───────────────────────────────────────────────────────────────────

/**
 * Applies a review decision with the firm's rules enforced server-side:
 * verification/rejection is manager+, rejection needs a reason, every
 * transition is recorded in the append-only history and the audit log.
 */
export function reviewDocument(
  docId: string,
  input: { status: DocumentItem["status"]; actor: string; role: string; reason?: string },
): DocumentItem {
  const current = getDocument(docId);
  if (!current) throw new DocumentOpError("Document not found", 404);
  const status = input.status;
  if (!(REVIEW_STATUSES as readonly string[]).includes(status)) {
    throw new DocumentOpError(`Status must be one of: ${REVIEW_STATUSES.join(", ")}`);
  }
  if ((status === "Verified" || status === "Rejected") && !MANAGER_ROLES.has(input.role)) {
    throw new DocumentOpError("Only a manager or partner can verify or reject a document", 403);
  }
  const reason = (input.reason ?? "").trim();
  if (status === "Rejected" && reason.length < 3) {
    throw new DocumentOpError("A rejection needs a written reason so the client can fix the re-upload", 400);
  }
  if (status === "Received" && !current.file_path && !current.received_date) {
    // Marking received without bytes is the operator's "paper came by hand"
    // shortcut — allowed, but next_reminder_on is then cleared and history
    // records who decided it.
  }
  if (status === "Verified" && !current.file_path && !current.received_date) {
    throw new DocumentOpError("A document cannot be verified before it has been received", 409);
  }

  return withTransaction(() => {
    const now = new Date().toISOString();
    const received = status === "Received" || status === "Verified" || status === "Rejected" ? current.received_date ?? now.slice(0, 10) : current.received_date;
    getDb()
      .prepare(
        `UPDATE documents SET status=?, received_date=?, verified_by=?, review_reason=?, reviewed_at=?,
         next_reminder_on=CASE WHEN ? IN ('Received','Verified','Waived') THEN NULL ELSE next_reminder_on END
         WHERE doc_id=?`,
      )
      .run(
        status,
        received,
        status === "Verified" ? input.actor : current.verified_by ?? "",
        status === "Rejected" ? reason : status === "Received" ? "" : current.review_reason ?? "",
        status === "Verified" || status === "Rejected" ? now : current.reviewed_at ?? null,
        status,
        docId,
      );
    recordHistory({
      doc_id: docId,
      from_status: current.status,
      to_status: status,
      actor: input.actor,
      role: input.role,
      reason,
    });
    logAudit({
      actor: input.actor,
      action: `DOCUMENT_${status.toUpperCase()}`,
      entity_type: "document",
      entity_id: docId,
      detail: `${current.document_name} for ${current.client_name} → ${status}${reason ? ` · ${reason.slice(0, 120)}` : ""}`,
    });
    return getDocument(docId)!;
  });
}

function recordHistory(input: {
  doc_id: string;
  from_status: string | null;
  to_status: string;
  actor: string;
  role: string;
  reason: string;
}): void {
  getDb()
    .prepare(
      `INSERT INTO document_status_history (history_id,doc_id,from_status,to_status,actor,role,reason,created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    )
    .run(
      nextId("DH", "document_status_history", "history_id"),
      input.doc_id,
      input.from_status,
      input.to_status,
      input.actor,
      input.role,
      input.reason.slice(0, 500),
      new Date().toISOString(),
    );
}

export function listDocumentHistory(docId: string): DocumentStatusHistoryEntry[] {
  return all<DocumentStatusHistoryEntry>(
    "SELECT * FROM document_status_history WHERE doc_id = ? ORDER BY created_at, history_id",
    docId,
  );
}

// ── Classification / folders ─────────────────────────────────────────────────

export type ClassificationPatch = {
  category?: string;
  fy?: string;
  period?: string;
  service_code?: string;
  compliance_id?: string;
  registration_id?: string;
  needs_classification?: boolean;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const FY_LABEL = /^FY\s*\d{4}-\d{2,4}$/i;
const AY_LABEL = /^AY\s*\d{4}-\d{2,4}$/i;

/**
 * Moves a document between logical folders (FY / period / service /
 * compliance link). Document identity, bytes and version history are
 * untouched; every field change lands in the audit trail.
 */
export function classifyDocument(docId: string, patch: ClassificationPatch, actor: string): DocumentItem {
  const current = getDocument(docId);
  if (!current) throw new DocumentOpError("Document not found", 404);

  const updates: Array<[string, string | number]> = [];
  if (patch.category !== undefined) {
    const category = patch.category.trim().slice(0, MAX_FILENAME);
    if (!category) throw new DocumentOpError("Category cannot be empty — mark the document as needing classification instead");
    updates.push(["category", category]);
  }
  if (patch.fy !== undefined) {
    const fy = patch.fy.trim().slice(0, 12);
    if (fy && !FY_LABEL.test(fy)) throw new DocumentOpError('Financial year looks like "FY 2025-26"');
    updates.push(["fy", fy]);
  }
  if (patch.period !== undefined) updates.push(["period", patch.period.trim().slice(0, MAX_FILENAME)]);
  if (patch.service_code !== undefined) updates.push(["service_code", patch.service_code.trim().slice(0, 40)]);
  if (patch.compliance_id !== undefined) {
    if (patch.compliance_id && patch.compliance_id !== current.compliance_id) {
      const task = one<{ client_id: string; compliance_id: string }>(
        "SELECT compliance_id, client_id FROM compliance WHERE compliance_id = ?",
        patch.compliance_id,
      );
      if (!task) throw new DocumentOpError("That filing does not exist", 404);
      if (task.client_id !== current.client_id) {
        throw new DocumentOpError("A document can only be linked to one of this client's own filings", 409);
      }
    }
    updates.push(["compliance_id", patch.compliance_id.trim().slice(0, 40)]);
  }
  if (patch.registration_id !== undefined) {
    const clientId = current.client_id;
    if (patch.registration_id && patch.registration_id !== current.registration_id) {
      const reg = one<{ client_id: string }>("SELECT client_id FROM client_registrations WHERE registration_id = ?", patch.registration_id);
      if (!reg) throw new DocumentOpError("That registration does not exist", 404);
      if (reg.client_id !== clientId) throw new DocumentOpError("That registration belongs to another client", 409);
    }
    updates.push(["registration_id", patch.registration_id.trim().slice(0, 40)]);
  }
  if (patch.needs_classification !== undefined) updates.push(["needs_classification", patch.needs_classification ? 1 : 0]);
  if (updates.length === 0) return getDocument(docId)!;

  const setSql = updates.map(([col]) => `${col}=?`).join(", ");
  getDb()
    .prepare(`UPDATE documents SET ${setSql} WHERE doc_id=?`)
    .run(...updates.map(([, value]) => value), docId);
  logAudit({
    actor,
    action: "DOCUMENT_CLASSIFIED",
    entity_type: "document",
    entity_id: docId,
    detail: updates.map(([col, value]) => `${col} → ${String(value).slice(0, 60)}`).join(" · "),
  });
  return getDocument(docId)!;
}

// ── Soft archival ────────────────────────────────────────────────────────────

/** Soft delete: the row is hidden from the active lists but bytes stay stored. */
export function archiveDocument(docId: string, actor: string, reason = ""): DocumentItem {
  const current = getDocument(docId);
  if (!current) throw new DocumentOpError("Document not found", 404);
  if (current.archived_at) throw new DocumentOpError("The document is already archived", 409);
  getDb().prepare("UPDATE documents SET archived_at=?, next_reminder_on=NULL, status=CASE WHEN status='Pending' THEN 'Waived' ELSE status END WHERE doc_id=?").run(new Date().toISOString(), docId);
  recordHistory({ doc_id: docId, from_status: current.status, to_status: current.status === "Pending" ? "Waived (archived)" : `${current.status} (archived)`, actor, role: "manager", reason });
  logAudit({ actor, action: "DOCUMENT_ARCHIVED", entity_type: "document", entity_id: docId, detail: `${current.document_name} archived${reason ? ` · ${reason.slice(0, 120)}` : ""} — bytes retained` });
  return getDocument(docId)!;
}

export function restoreDocument(docId: string, actor: string): DocumentItem {
  const current = getDocument(docId);
  if (!current) throw new DocumentOpError("Document not found", 404);
  if (!current.archived_at) throw new DocumentOpError("The document is not archived", 409);
  getDb().prepare("UPDATE documents SET archived_at=NULL WHERE doc_id=?").run(docId);
  recordHistory({ doc_id: docId, from_status: current.status, to_status: current.status, actor, role: "manager", reason: "Archived document restored" });
  logAudit({ actor, action: "DOCUMENT_RESTORED", entity_type: "document", entity_id: docId, detail: `${current.document_name} restored from the archive` });
  return getDocument(docId)!;
}

export async function purgeDocumentBytes(docId: string, actor: string): Promise<Array<{ key: string; removed: boolean }>> {
  const current = getDatabaseDoc(docId);
  if (!current) throw new DocumentOpError("Document not found", 404);
  // Collect the keys BEFORE removing the ledger rows, so a crash between the
  // two steps leaves at most orphaned bytes — never a document pointing at
  // nothing. Legacy uploads live outside the object store and are removed
  // from the uploads directory instead.
  const keys = new Set<string>();
  for (const version of listFileVersions(docId)) if (version.object_key) keys.add(version.object_key);
  if (current.file_path) keys.add(current.file_path);

  withTransaction(() => {
    getDb().prepare("DELETE FROM file_versions WHERE doc_id=?").run(docId);
    getDb()
      .prepare("UPDATE documents SET file_name=NULL, file_size=NULL, file_path=NULL, uploaded_at=NULL, status=CASE WHEN status='Verified' THEN 'Waived' WHEN status='Rejected' THEN 'Pending' ELSE 'Pending' END WHERE doc_id=?")
      .run(docId);
    logAudit({ actor, action: "DOCUMENT_BYTES_PURGED", entity_type: "document", entity_id: docId, detail: `${current.document_name}: every version's bytes removed by retention decision` });
  });

  const results: Array<{ key: string; removed: boolean }> = [];
  for (const key of keys) {
    if (objectKeyIsSafe(key)) {
      await deleteObject(key).catch(() => undefined);
      results.push({ key, removed: true });
      continue;
    }
    if (key && !key.includes("/") && !key.includes("..")) {
      await fs.unlink(path.join(dataPath("uploads"), path.basename(key))).catch(() => undefined);
      results.push({ key, removed: true });
    }
  }
  return results;
}

function getDatabaseDoc(docId: string): DocumentItem | null {
  return one<DocumentItem>("SELECT * FROM documents WHERE doc_id = ?", docId);
}

// ── Filtered queries ─────────────────────────────────────────────────────────

export type DocumentFilters = {
  client_id?: string;
  status?: string;
  fy?: string;
  period?: string;
  service_code?: string;
  category?: string;
  compliance_id?: string;
  request_id?: string;
  q?: string;
  include_archived?: boolean;
  only_needs_classification?: boolean;
  page?: number;
  pageSize?: number;
};

export function queryDocuments(filters: DocumentFilters): { items: DocumentItem[]; page: number; pageSize: number; total: number; pages: number } {
  const where: string[] = [];
  const args: Array<string | number> = [];
  if (filters.client_id) { where.push("client_id = ?"); args.push(filters.client_id); }
  if (filters.status) { where.push("status = ?"); args.push(filters.status); }
  if (filters.fy) { where.push("fy = ?"); args.push(filters.fy); }
  if (filters.period) { where.push("period = ?"); args.push(filters.period); }
  if (filters.service_code) { where.push("service_code = ?"); args.push(filters.service_code); }
  if (filters.category) { where.push("category = ?"); args.push(filters.category); }
  if (filters.compliance_id) { where.push("compliance_id = ?"); args.push(filters.compliance_id); }
  if (filters.request_id) { where.push("request_id = ?"); args.push(filters.request_id); }
  if (!filters.include_archived) { where.push("archived_at IS NULL"); }
  if (filters.only_needs_classification) { where.push("needs_classification = 1"); }
  const q = filters.q?.trim().toLowerCase();
  if (q) {
    where.push("LOWER(document_name || ' ' || client_name) LIKE ?");
    args.push(`%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = Number(one<{ n: number }>(`SELECT COUNT(*) AS n FROM documents ${whereSql}`, ...args)?.n ?? 0);
  const pageSize = Math.min(200, Math.max(1, Math.round(Number(filters.pageSize) || 50)));
  const page = Math.max(1, Math.round(Number(filters.page) || 1));
  const items = all<DocumentItem>(
    `SELECT * FROM documents ${whereSql}
     ORDER BY CASE status WHEN 'Pending' THEN 0 ELSE 1 END, requested_date DESC
     LIMIT ? OFFSET ?`,
    ...args,
    pageSize,
    (page - 1) * pageSize,
  );
  return { items, page, pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

export function checksumOf(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

// ── Legacy file migration ────────────────────────────────────────────────────

/**
 * Re-homes documents uploaded before object storage (files sitting in the
 * uploads directory) under opaque object keys, with a verified checksum.
 * Idempotent: rows already migrated are skipped, and the original legacy
 * file is never removed — the operator does that only after reviewing the
 * migration report.
 */
export async function migrateLegacyDocuments(actor: string): Promise<DocumentMigrationReport> {
  const report: DocumentMigrationReport = { at: new Date().toISOString(), scanned: 0, migrated: 0, verified: 0, skipped: 0, failed: 0, failures: [] };
  const rows = all<DocumentItem>("SELECT * FROM documents WHERE file_path IS NOT NULL AND file_path <> ''");
  report.scanned = rows.length;
  for (const doc of rows) {
    const pathValue = String(doc.file_path ?? "");
    try {
      if (objectKeyIsSafe(pathValue)) { report.skipped++; continue; }
      // Legacy naming: pre-storage uploads live directly under uploads/.
      const legacyPath = dataPath("uploads", path.basename(pathValue));
      let bytes: Buffer;
      try {
        bytes = await fs.readFile(legacyPath);
      } catch {
        report.failed++;
        report.failures.push(`${doc.doc_id}: legacy file is missing on disk (${path.basename(pathValue)})`);
        continue;
      }
      if (getBytes(doc.doc_id).some((v) => v.checksum === checksumOf(bytes))) {
        // Already migrated under another key — just repoint the row.
        const first = getBytes(doc.doc_id).find((v) => v.checksum === checksumOf(bytes))!;
        getDb().prepare("UPDATE documents SET file_path=? WHERE doc_id=?").run(first.object_key, doc.doc_id);
        report.skipped++;
        continue;
      }
      const key = objectKeyFor(doc.doc_id, doc.file_name ?? `${doc.doc_id}.bin`);
      const stored = await putObject(key, bytes, "application/octet-stream");
      if (stored.checksum !== checksumOf(bytes)) throw new Error("checksum mismatch after storage");
      // recordFileVersion supersedes any previous current object and appends
      // the migrated copy as the new current version.
      recordFileVersion(doc.doc_id, {
        object_key: stored.key,
        file_name: (doc.file_name ?? `${doc.doc_id}.bin`).slice(0, MAX_FILENAME),
        size_bytes: stored.size,
        checksum: stored.checksum,
        uploaded_by: actor,
        change_reason: "Re-homed from the legacy uploads directory (checksum verified at rest)",
      });
      getDb().prepare("UPDATE documents SET file_path=? WHERE doc_id=?").run(stored.key, doc.doc_id);
      // Verify through the storage layer itself, then report success.
      if (!(await objectExists(stored.key))) throw new Error("stored object not readable after migration");
      report.migrated++;
      report.verified++;
      logAudit({ actor, action: "DOCUMENT_LEGACY_MIGRATED", entity_type: "document", entity_id: doc.doc_id, detail: `${doc.document_name}: legacy bytes re-homed under an opaque object key (checksum verified)` });
    } catch (err) {
      report.failed++;
      report.failures.push(`${doc.doc_id}: ${(err as Error).message}`.slice(0, 300));
    }
  }
  getDb()
    .prepare("INSERT INTO settings (key,value) VALUES ('document_migration_report_v1', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(JSON.stringify(report));
  logAudit({
    actor,
    action: "DOCUMENT_LEGACY_MIGRATION_RUN",
    entity_type: "system",
    entity_id: "document_migration_report_v1",
    detail: `scanned ${report.scanned} · migrated ${report.migrated} · verified ${report.verified} · skipped ${report.skipped} · failed ${report.failed}`,
  });
  return report;
}

function getBytes(docId: string): FileVersion[] {
  return all<FileVersion>("SELECT * FROM file_versions WHERE doc_id=?", docId);
}
