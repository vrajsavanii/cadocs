import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { withIsolatedDataDir } from "./helpers/setup";

const dataDir = withIsolatedDataDir();

const { createBackup, verifyBackup } = await import("../lib/backup");
const { putObject, objectKeyFor } = await import("../lib/storage");
const { getDb, recordFileVersion } = await import("../lib/db");

describe("backup and verification", () => {
  it("creates a verified snapshot of database, files and keys", async () => {
    // Seed a record and one uploaded file with recorded version/checksum.
    const db = getDb();
    db.prepare("INSERT INTO clients (client_id, name, created_at) VALUES ('CLIENT-B1', 'Backup Client', ?)").run(new Date().toISOString());
    const key = objectKeyFor("DOC-B1", "backup-probe.pdf");
    const stored = await putObject(key, Buffer.from("backup-probe-bytes"), "application/pdf");
    db.prepare("INSERT INTO documents (doc_id, client_id, client_name, document_name, status, requested_date) VALUES ('DOC-B1','CLIENT-B1','Backup Client','Probe','Received','2026-10-01')").run();
    recordFileVersion("DOC-B1", { object_key: stored.key, file_name: "backup-probe.pdf", size_bytes: stored.size, checksum: stored.checksum });

    const target = path.join(os.tmpdir(), `ca-backup-${Date.now()}`);
    const { manifestPath } = await createBackup(target);
    expect(fsSync.existsSync(manifestPath)).toBe(true);

    const verification = await verifyBackup(target);
    expect(verification.ok).toBe(true);
    expect(verification.integrity).toBe("ok");
    expect(verification.foreignKeyViolations).toBe(0);
    expect(verification.counts.clients).toBeGreaterThanOrEqual(1);
    expect(verification.filesChecked).toBeGreaterThanOrEqual(1);
    expect(verification.fileFailures).toHaveLength(0);
  });

  it("detects corruption in a snapshot and reports verification failure", async () => {
    // Build a clean backup, then corrupt a copied file (simulating bit-rot on the backup medium).
    const target = path.join(os.tmpdir(), `ca-backup-corrupt-${Date.now()}`);
    await createBackup(target);
    const versionsPath = path.join(target, "uploads");
    const probe = findFirstFile(versionsPath);
    if (probe) {
      fsSync.writeFileSync(probe, Buffer.from("tampered bytes"));
      const verification = await verifyBackup(target);
      expect(verification.ok).toBe(false);
      expect(verification.fileFailures.length).toBeGreaterThanOrEqual(1);
    }
    void dataDir;
  }, 30_000);
});

function findFirstFile(dir: string): string | null {
  try {
    for (const entry of fsSync.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const nested = findFirstFile(path.join(dir, entry.name));
        if (nested) return nested;
      } else return path.join(dir, entry.name);
    }
  } catch {
    return null;
  }
  return null;
}
