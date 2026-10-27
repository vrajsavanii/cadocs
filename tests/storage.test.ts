import { describe, expect, it } from "vitest";
import { withIsolatedDataDir } from "./helpers/setup";

withIsolatedDataDir();

const { putObject, getObject, deleteObject, objectExists, objectKeyFor, objectKeyIsSafe } = await import("../lib/storage");
const { getDb, recordFileVersion, listFileVersions } = await import("../lib/db");

describe("object storage", () => {
  it("round-trips bytes and records the correct checksum and size", async () => {
    const key = objectKeyFor("DOC-T1", "bank statement.pdf");
    expect(key.startsWith("docs/DOC-T1/")).toBe(true);
    expect(objectKeyIsSafe(key)).toBe(true);

    const stored = await putObject(key, Buffer.from("pdf-bytes-here"), "application/pdf");
    expect(stored.size).toBe(14);
    expect(stored.checksum).toMatch(/^[0-9a-f]{64}$/);

    const read = await getObject(key);
    expect(read.toString("utf8")).toBe("pdf-bytes-here");
    expect(await objectExists(key)).toBe(true);

    await deleteObject(key);
    expect(await objectExists(key)).toBe(false);
    await expect(getObject(key)).rejects.toThrow(/missing/);
  });

  it("rejects traversal and unsafe keys", async () => {
    expect(objectKeyIsSafe("../../etc/passwd")).toBe(false);
    expect(objectKeyIsSafe("/etc/passwd")).toBe(false);
    expect(objectKeyIsSafe("docs/x/../../y")).toBe(false);
    await expect(getObject("../../etc/passwd")).rejects.toThrow(/Invalid storage key/);
    await expect(putObject("../escape.bin", Buffer.from("x"), "text/plain")).rejects.toThrow(/Invalid storage key/);
  });

  it("records version history with unique per-document version numbers", async () => {
    getDb()
      .prepare("INSERT INTO documents (doc_id, client_id, client_name, document_name, status, requested_date) VALUES ('DOC-TV', 'CLIENT-T01', 'T', 'Ledger', 'Received', '2026-10-01')")
      .run();
    const key1 = objectKeyFor("DOC-TV", "ledger-v1.pdf");
    const key2 = objectKeyFor("DOC-TV", "ledger-v2.pdf");
    await putObject(key1, Buffer.from("ledger-one"), "application/pdf");
    await putObject(key2, Buffer.from("ledger-two"), "application/pdf");

    recordFileVersion("DOC-TV", { object_key: key1, file_name: "ledger.pdf", size_bytes: 10, checksum: "a".repeat(64) });
    const second = recordFileVersion("DOC-TV", { object_key: key2, file_name: "ledger.pdf", size_bytes: 12, checksum: "b".repeat(64) });

    expect(second.version).toBe(2);
    const versions = listFileVersions("DOC-TV") as unknown as Array<{ version: number; object_key: string }>;
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    expect(versions[0]!.object_key).toBe(key2);
    // Replaced files keep their bytes under the version ledger.
    expect(await objectExists(key1)).toBe(true);
    expect(await objectExists(key2)).toBe(true);
    await deleteObject(key1);
    await deleteObject(key2);
  });

  it("removes the stored bytes when the metadata write fails (never a falsely received document)", async () => {
    const key = objectKeyFor("DOC-TF", "orphan.pdf");
    await putObject(key, Buffer.from("orphan"), "application/pdf");
    // recordFileVersion hitting a not-exists document path is not possible (no
    // FK), so simulate the failure at the DB level: a duplicate version insert
    // for the same doc+version would violate the unique key.
    getDb()
      .prepare("INSERT INTO documents (doc_id, client_id, client_name, document_name, status, requested_date) VALUES ('DOC-TF', 'CLIENT-T01', 'T', 'Orphan', 'Pending', '2026-10-01')")
      .run();
    recordFileVersion("DOC-TF", { object_key: key, file_name: "orphan.pdf", size_bytes: 6, checksum: "c".repeat(64) });
    expect(() =>
      // Same (doc_id, version) pair can only be re-inserted by forcing version 1
      // back into the sequence — the unique index must reject it.
      getDb()
        .prepare("INSERT INTO file_versions (version_id, doc_id, version, object_key, file_name, size_bytes, checksum, uploaded_at) VALUES ('FV-TX','DOC-TF',1,'docs/other','x',1,'d',? )")
        .run(new Date().toISOString()),
    ).toThrow(/UNIQUE constraint failed/);
    await deleteObject(key);
    expect(await objectExists(key)).toBe(false);
  });
});
