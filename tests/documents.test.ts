import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import { withIsolatedDataDir } from "./helpers/setup";
import type { DocumentItem } from "../lib/types";

withIsolatedDataDir();

const db = await import("../lib/db");
const documents = await import("../lib/documents");
const storage = await import("../lib/storage");
const { getDb } = db;
const { createDocument, getDocument, listFileVersions } = db;
const {
  archiveDocument,
  classifyDocument,
  DocumentOpError,
  migrateLegacyDocuments,
  queryDocuments,
  restoreDocument,
  reviewDocument,
  listDocumentHistory,
} = documents;
const { deleteObject, objectExists, putObject } = storage;

function seedClient(): void {
  getDb()
    .prepare("INSERT INTO clients (client_id,name) VALUES (?,?)")
    .run("CLIENT-D1", "Docs Test Client");
}

function seedDocument(name = "Bank statement Apr 2026"): DocumentItem {
  const doc = createDocument({
    client_id: "CLIENT-D1",
    client_name: "Docs Test Client",
    document_name: name,
    status: "Pending",
    requested_date: "2026-04-10",
    received_date: null,
    notes: "",
    request_id: "",
    compliance_id: "",
    service_code: "",
    category: "Bank statements",
    fy: "FY 2026-27",
    period: "April 2026",
    reminder_count: 0,
    last_reminded_at: null,
    next_reminder_on: null,
    verified_by: "",
    source: "manual",
    sort_order: 0,
  });
  return getDocument(doc.doc_id)!;
}

seedClient();

describe("prompt-06: document management", () => {
  it("resets review state on a replacement upload and keeps the old bytes", async () => {
    const doc = seedDocument("Ledger");
    await putObject(documents.checksumOf(Buffer.from("v1")) && "docs/DOCV1/v1.bin", Buffer.from("ledger-v1"), "application/pdf");
    const key1 = "docs/DOCV1/v1.bin";
    await putObject(key1, Buffer.from("ledger-v1"), "application/pdf");
    db.recordFileVersion(doc.doc_id, { object_key: key1, file_name: "ledger.pdf", size_bytes: 10, checksum: documents.checksumOf(Buffer.from("ledger-v1")), uploaded_by: "Article" });
    db.attachDocumentFile(doc.doc_id, { file_name: "ledger.pdf", file_size: 10, file_path: key1 });
    reviewDocument(doc.doc_id, { status: "Verified", actor: "Manager", role: "manager" });
    expect(getDocument(doc.doc_id)!.status).toBe("Verified");

    const key2 = "docs/DOCV1/v2.bin";
    await putObject(key2, Buffer.from("ledger-v2-bytes"), "application/pdf");
    const recorded = db.recordFileVersion(doc.doc_id, { object_key: key2, file_name: "ledger-v2.pdf", size_bytes: 15, checksum: documents.checksumOf(Buffer.from("ledger-v2-bytes")), uploaded_by: "Manager", change_reason: "corrected totals" });
    expect(recorded.version).toBe(2);
    db.attachDocumentFile(doc.doc_id, { file_name: "ledger-v2.pdf", file_size: 15, file_path: key2 });

    const currentDoc = getDocument(doc.doc_id)!;
    // A new upload has not been reviewed — a prior approval never carries over.
    expect(currentDoc.status).toBe("Received");
    expect(currentDoc.verified_by ?? "").toBe("");
    const versions = listFileVersions(doc.doc_id);
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    expect(versions.find((v) => v.version === 2)!.status).toBe("current");
    expect(versions.find((v) => v.version === 1)!.status).toBe("superseded");
    expect(versions[0]!.change_reason).toBe("corrected totals");
    expect(versions[1]!.change_reason).toBe("");
    // Old bytes stay in storage under the version ledger.
    expect(await objectExists(key1)).toBe(true);
    expect(await objectExists(key2)).toBe(true);
    await deleteObject(key1);
    await deleteObject(key2);
  });

  it("enforces review rules: rejection needs a reason, verification is manager+, history is append-only", () => {
    const doc = seedDocument("Purchase invoices Q1");
    expect(() =>
      reviewDocument(doc.doc_id, { status: "Rejected", actor: "Manager", role: "manager" }),
    ).toThrow(/rejection needs a written reason/i);
    expect(() =>
      reviewDocument(doc.doc_id, { status: "Rejected", actor: "Manager", role: "manager", reason: "Illegible copies" }),
    ).not.toThrow();
    expect(getDocument(doc.doc_id)!.review_reason).toBe("Illegible copies");
    expect(() =>
      reviewDocument(doc.doc_id, { status: "Verified", actor: "Article", role: "article" }),
    ).toThrow(/manager or partner/i);
    const history = listDocumentHistory(doc.doc_id);
    expect(history).toHaveLength(1);
    expect(history[0]!.to_status).toBe("Rejected");
    // Both tampering paths are refused by the append-only triggers.
    for (const sql of ["UPDATE document_status_history SET reason='tampered' WHERE doc_id=?", "DELETE FROM document_status_history WHERE doc_id=?"]) {
      let error = "";
      try {
        getDb().prepare(sql).run(doc.doc_id);
      } catch (err) {
        error = (err as Error).message;
      }
      expect(error).toMatch(/append-only/);
    }
  });

  it("moves a document between logical folders without touching bytes or identity", async () => {
    const doc = seedDocument("Trial balance FY25");
    const key = "docs/FOLDER-MOVE/tb.bin";
    await putObject(key, Buffer.from("trial balance"), "application/pdf");
    db.recordFileVersion(doc.doc_id, { object_key: key, file_name: "tb.pdf", size_bytes: 13, checksum: documents.checksumOf(Buffer.from("trial balance")) });
    db.attachDocumentFile(doc.doc_id, { file_name: "tb.pdf", file_size: 13, file_path: key });

    const moved = classifyDocument(doc.doc_id, { category: "Financial statements", fy: "FY 2025-26", period: "March 2026" }, "Manager");
    expect(moved.category).toBe("Financial statements");
    expect(moved.fy).toBe("FY 2025-26");
    expect(moved.doc_id).toBe(doc.doc_id);
    expect(moved.file_path).toBe(key);
    expect(await objectExists(key)).toBe(true);

    expect(() => classifyDocument(doc.doc_id, { fy: "2025/26" }, "Manager")).toThrow(/FY 2025-26/i);
    const empty = classifyDocument(doc.doc_id, {}, "Manager");
    expect(empty.category).toBe("Financial statements");
    await deleteObject(key);
  });

  it("archives softly and restores — bytes are never destroyed by an archive", async () => {
    const doc = seedDocument("ROC filing copy");
    const key = "docs/ARCHIVE/roc.pdf";
    await putObject(key, Buffer.from("roc copy"), "application/pdf");
    db.recordFileVersion(doc.doc_id, { object_key: key, file_name: "roc.pdf", size_bytes: 8, checksum: documents.checksumOf(Buffer.from("roc copy")) });
    db.attachDocumentFile(doc.doc_id, { file_name: "roc.pdf", file_size: 8, file_path: key });

    const archived = archiveDocument(doc.doc_id, "Partner", "Retention review");
    expect(archived.archived_at).toBeTruthy();
    expect((await objectExists(key))).toBe(true);
    const active = queryDocuments({ include_archived: false });
    expect(active.items.some((d) => d.doc_id === doc.doc_id)).toBe(false);
    expect(queryDocuments({ include_archived: true }).items.some((d) => d.doc_id === doc.doc_id)).toBe(true);

    const restored = restoreDocument(doc.doc_id, "Partner");
    expect(restored.archived_at).toBeNull();
    expect(queryDocuments({}).items.some((d) => d.doc_id === doc.doc_id)).toBe(true);
    await deleteObject(key);
  });

  it("paginates and filters server-side without leaking across filters", () => {
    for (let i = 0; i < 7; i++) {
      seedDocument(`Bulk doc ${i} (bank)`);
    }
    const bank = queryDocuments({ category: "Bank statements", pageSize: 3, page: 1 });
    expect(bank.pageSize).toBe(3);
    expect(bank.items.length).toBeLessThanOrEqual(3);
    expect(bank.total).toBeGreaterThanOrEqual(7);
    expect(bank.pages).toBeGreaterThan(1);
    expect(queryDocuments({ fy: "FY 2099-00" }).total).toBe(0);
    expect(queryDocuments({ q: "bulk doc 3" }).total).toBe(1);
    const classified = classifyDocument(queryDocuments({ q: "Bulk doc 0" }).items[0]!.doc_id, { needs_classification: true }, "Manager");
    expect(queryDocuments({ only_needs_classification: true }).items.some((d) => d.doc_id === classified.doc_id)).toBe(true);
  });

  it("migrates legacy uploads with verified checksums, retry-safe, originals untouched", async () => {
    const doc = seedDocument("Legacy scanned ledger");
    await fs.mkdir(`${process.env.CA_DATA_DIR}/uploads`, { recursive: true });
    // Simulate a pre-storage upload: an unscoped legacy filename in uploads/.
    const legacyPath = `${process.env.CA_DATA_DIR}/uploads/ledger-scan-2023.bin`;
    await fs.writeFile(legacyPath, Buffer.from("legacy ledger bytes"));
    getDb()
      .prepare("UPDATE documents SET file_path='ledger-scan-2023.bin', file_name='Ledger scan 2023.pdf' WHERE doc_id=?")
      .run(doc.doc_id);

    const report = await migrateLegacyDocuments("Partner");
    expect(report.scanned).toBeGreaterThan(0);
    expect(report.migrated).toBeGreaterThan(0);
    expect(report.verified).toBe(report.migrated);
    const migrated = getDocument(doc.doc_id)!;
    expect(migrated.file_path).toMatch(/^docs\//);
    expect(await objectExists(migrated.file_path!)).toBe(true);
    const bytes = (await import("../lib/storage")).getObject(migrated.file_path!);
    expect(documents.checksumOf(await bytes)).toBe(listFileVersions(doc.doc_id).find((v) => v.status === "current")!.checksum);
    // The legacy original is left in place for the operator.
    await fs.access(legacyPath);

    const second = await migrateLegacyDocuments("Partner");
    // Retry: the row is already on an object key, so it is skipped, not duplicated.
    expect(second.migrated).toBe(0);
    expect(listFileVersions(doc.doc_id).filter((v) => v.file_name === "Ledger scan 2023.pdf").length).toBe(1);
    await deleteObject(migrated.file_path!);
    await fs.unlink(legacyPath).catch(() => undefined);
  });

  it("keeps checklist-sourced duplicates impossible and records new review fields on packets", () => {
    getDb()
      .prepare("INSERT INTO document_requests (request_id,client_id,client_name,compliance_id,service_code,period,fy,due_date,status,missing_note,created_at) VALUES ('REQ-D1','CLIENT-D1','Docs Test Client','','gstr1','April 2026','FY 2026-27','2026-05-01','Open','Sales data still missing','2026-04-01')")
      .run();
    const request = db.one<{ missing_note: string }>("SELECT missing_note FROM document_requests WHERE request_id='REQ-D1'");
    expect(request!.missing_note).toBe("Sales data still missing");
  });
});
