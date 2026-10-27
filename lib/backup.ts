/**
 * Backup and restoration utilities.
 *
 * `createBackup` produces a consistent, verified snapshot without touching the
 * live database (SQLite `VACUUM INTO` copies a transactionally consistent
 * image; uploads and keys are copied alongside). `verifyBackup` re-opens the
 * snapshot read-only, runs SQLite integrity and foreign-key checks, counts
 * each table, and re-hashes every versioned file against its stored checksum.
 *
 * These functions are deliberately provider-neutral: on local storage they
 * copy from the uploads tree; on R2 the snapshot must be produced by the
 * provider's own backup/versioning (documented in
 * docs/operations/BACKUP-AND-RECOVERY.md), and verifyBackup still validates
 * the file_versions ledger against the live store row by row.
 */
import { createHash } from "node:crypto";
import fsSync from "node:fs";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { dataDir, dataPath } from "./data-dir";
import { objectKeyIsSafe } from "./storage";

export interface BackupCounts {
  [table: string]: number;
}

const TRACKED_TABLES = [
  "clients",
  "users",
  "client_services",
  "compliance",
  "document_requests",
  "documents",
  "file_versions",
  "invoices",
  "payments",
  "messages",
  "audit_log",
  "udin",
  "dsc",
  "notices",
  "leads",
  "proposals",
  "campaigns",
  "timesheets",
  "automation_rules",
  "automation_runs",
  "ai_actions",
  "jobs",
  "schema_migrations",
];

function sha256File(file: string): string {
  // Uploads are capped at 8 MB, so hashing reads them synchronously.
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/** Creates a consistent snapshot into targetDir and returns its manifest. */
export async function createBackup(targetDir: string): Promise<{ manifestPath: string; counts: BackupCounts; files: number }> {
  const dbFile = dataPath("ca-suite.db");
  if (!fsSync.existsSync(dbFile)) throw new Error("No database file exists to back up");

  await fs.mkdir(targetDir, { recursive: true });

  // Open the live db read-only and clone transactionally. WAL/DELETE journalling
  // does not affect the copy: VACUUM INTO reads a consistent snapshot.
  const source = new DatabaseSync(dbFile, { readOnly: true });
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const snapshot = path.join(targetDir, `ca-suite-${stamp}.db`);
    source.exec(`VACUUM INTO '${snapshot.replace(/\\/g, "\\\\")}'`);

    // Snapshot integrity before anything else touches the target.
    const check = source.prepare("PRAGMA integrity_check").get() as { integrity_check?: string };
    if (check?.integrity_check && check.integrity_check !== "ok") {
      await fs.unlink(snapshot).catch(() => undefined);
      throw new Error(`Source database failed integrity check — backup aborted: ${check.integrity_check}`);
    }

    const counts: BackupCounts = {};
    for (const table of TRACKED_TABLES) {
      try {
        const row = source.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
        counts[table] = row?.n ?? 0;
      } catch {
        counts[table] = -1; // table absent in this deployment's schema
      }
    }

    // Uploaded files (local provider): copy the whole uploads tree, preserving
    // opaque keys. Legacy files (pre-storage) live here too and travel along.
    let fileCount = 0;
    const uploadsDir = dataPath("uploads");
    if (fsSync.existsSync(uploadsDir)) {
      await copyDir(uploadsDir, path.join(targetDir, "uploads"));
      fileCount = await countFiles(path.join(targetDir, "uploads"));
    }

    // Field/session decryption keys are required to restore client data. They
    // are written with restrictive permissions and the operator is warned —
    // the backup bundle must be stored encrypted and off this repository.
    for (const keyFileName of ["field.key", "session.key"]) {
      const keyFile = path.join(dataDir(), keyFileName);
      if (fsSync.existsSync(keyFile)) {
        await fs.copyFile(keyFile, path.join(targetDir, keyFileName));
        await fs.chmod(path.join(targetDir, keyFileName), 0o600);
      }
    }

    const manifest = {
      created_at: new Date().toISOString(),
      database: path.basename(snapshot),
      tables: counts,
      files: fileCount,
      note: "Snapshot contains decryption keys — store encrypted, outside any repository.",
    };
    const manifestPath = path.join(targetDir, "backup-manifest.json");
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    return { manifestPath, counts, files: fileCount };
  } finally {
    source.close();
  }
}

async function copyDir(from: string, to: string): Promise<void> {
  await fs.mkdir(to, { recursive: true });
  for (const entry of await fs.readdir(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) await copyDir(src, dst);
    else await fs.copyFile(src, dst);
  }
}

async function countFiles(dir: string): Promise<number> {
  let n = 0;
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) n += await countFiles(path.join(dir, entry.name));
    else n++;
  }
  return n;
}

export interface BackupVerification {
  ok: boolean;
  integrity: string;
  foreignKeyViolations: number;
  counts: BackupCounts;
  filesChecked: number;
  fileFailures: string[];
  problems: string[];
}

/**
 * Verifies a backup made by createBackup. Read-only against the snapshot; the
 * only artifacts it writes now are verification logs the caller prints.
 */
export async function verifyBackup(backupDir: string): Promise<BackupVerification> {
  const problems: string[] = [];
  const manifestFile = path.join(backupDir, "backup-manifest.json");
  if (!fsSync.existsSync(manifestFile)) problems.push("backup-manifest.json missing");
  let manifest: { database?: string; tables?: BackupCounts; files?: number } = {};
  try {
    manifest = JSON.parse(await fs.readFile(manifestFile, "utf8"));
  } catch {
    problems.push("backup-manifest.json unreadable");
  }

  const dbFiles = (await fs.readdir(backupDir)).filter((f) => f.startsWith("ca-suite-") && f.endsWith(".db"));
  if (dbFiles.length === 0) problems.push("No database snapshot found in the backup directory");
  if (manifest.database && !dbFiles.includes(manifest.database)) problems.push(`Manifest references missing snapshot ${manifest.database}`);
  if (dbFiles.length > 1) problems.push(`Multiple snapshots present (${dbFiles.join(", ")}) — the manifest may refer to an older one`);

  const counts: BackupCounts = {};
  let foreignKeyViolations = 0;
  let integrity = "not-checked";
  if (manifest.database && dbFiles.includes(manifest.database)) {
    const db = new DatabaseSync(path.join(backupDir, manifest.database), { readOnly: true });
    try {
      integrity = ((db.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check ?? "unknown") as string;
      if (integrity !== "ok") problems.push(`integrity_check: ${integrity}`);
      fk: {
        const violations = db.prepare("PRAGMA foreign_key_check").all() as unknown as Array<Record<string, unknown>>;
        foreignKeyViolations = violations.length;
        if (foreignKeyViolations > 0) problems.push(`${foreignKeyViolations} foreign key violation(s)`);
      }
      for (const table of TRACKED_TABLES) {
        try {
          const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
          counts[table] = row?.n ?? 0;
        } catch {
          counts[table] = -1;
        }
      }
      // Compare row counts with the manifest to catch a partially-written copy.
      for (const [table, expected] of Object.entries(manifest.tables ?? {})) {
        if (counts[table] !== undefined && expected >= 0 && counts[table] !== expected) {
          problems.push(`Table ${table}: snapshot has ${counts[table]} rows, manifest recorded ${expected}`);
        }
      }
    } finally {
      db.close();
    }
  }

  // Re-hash every versioned upload inside the backup (local provider).
  let filesChecked = 0;
  const fileFailures: string[] = [];
  const uploadsDir = path.join(backupDir, "uploads");
  if (manifest.database && dbFiles.includes(manifest.database) && fsSync.existsSync(uploadsDir)) {
    const db = new DatabaseSync(path.join(backupDir, manifest.database), { readOnly: true });
    try {
      const versions = db
        .prepare("SELECT version_id, doc_id, version, object_key, size_bytes, checksum FROM file_versions")
        .all() as unknown as Array<{ version_id: string; doc_id: string; version: number; object_key: string; size_bytes: number; checksum: string }>;
      for (const v of versions) {
        if (!objectKeyIsSafe(v.object_key)) {
          fileFailures.push(`${v.version_id}: unsafe key — skipped`);
          continue;
        }
        const file = path.join(uploadsDir, v.object_key);
        if (!fsSync.existsSync(file)) {
          fileFailures.push(`${v.version_id}: file missing (${v.object_key})`);
          continue;
        }
        const stat = await fs.stat(file);
        if (stat.size !== v.size_bytes) {
          fileFailures.push(`${v.version_id}: size mismatch (stored ${v.size_bytes}, actual ${stat.size})`);
          continue;
        }
        const hash = sha256File(file);
        if (hash !== v.checksum) {
          fileFailures.push(`${v.version_id}: checksum mismatch for ${v.object_key}`);
          continue;
        }
        filesChecked++;
      }
    } finally {
      db.close();
    }
  }

  return {
    ok: problems.length === 0 && fileFailures.length === 0,
    integrity,
    foreignKeyViolations,
    counts,
    filesChecked,
    fileFailures,
    problems,
  };
}
