/**
 * Data-migration CLI — moves an existing deployment's state to a new location
 * (typically a mounted persistent volume) without modifying the source.
 *
 * Usage: node scripts/migrate-to-volume.ts --source <dataDir> --target <volumeDir>
 *
 * What it does NOT do: switch production traffic. The cutover is an explicit
 * operator action — point CA_DATA_DIR at --target and restart (see
 * docs/operations/DATA-MIGRATION-RUNBOOK.md). This tool verifies the copy so
 * the operator cutover is safe, and never deletes the original files.
 */
import fsSync from "node:fs";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

interface TableCounts {
  [table: string]: number;
}

const TRACKED = [
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

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function copyDir(from: string, to: string): Promise<number> {
  let n = 0;
  await fs.mkdir(to, { recursive: true });
  for (const entry of await fs.readdir(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) {
      n += await copyDir(src, dst);
    } else {
      await fs.copyFile(src, dst);
      n++;
    }
  }
  return n;
}

function openCounts(file: string): TableCounts {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const counts: TableCounts = {};
    for (const table of TRACKED) {
      try {
        const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
        counts[table] = row?.n ?? 0;
      } catch {
        counts[table] = -1;
      }
    }
    const integrity = (db.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check;
    const checks = db.prepare("PRAGMA foreign_key_check").all() as unknown as unknown[];
    if (integrity !== "ok") throw new Error(`Copied database failed integrity check: ${integrity}`);
    if (checks.length > 0) throw new Error(`Copied database has ${checks.length} foreign key violation(s)`);
    return counts;
  } finally {
    db.close();
  }
}

async function main() {
  const source = arg("source");
  const target = arg("target");
  if (!source || !target) {
    console.error("Usage: node scripts/migrate-to-volume.ts --source <dataDir> --target <volumeDir>");
    process.exit(2);
  }
  const src = path.resolve(source);
  const dst = path.resolve(target);
  const dbFile = path.join(src, "ca-suite.db");
  if (!fsSync.existsSync(dbFile)) {
    console.error(`No database found at ${dbFile} — nothing to migrate.`);
    process.exit(2);
  }
  if (src === dst || !fsSync.existsSync(src)) {
    console.error("Source and target must be different existing directories.");
    process.exit(2);
  }
  if (fsSync.existsSync(dst) && fsSync.existsSync(path.join(dst, "ca-suite.db"))) {
    console.error(`Refusing: target ${dst} already contains ca-suite.db. Aborting without writing anything.`);
    process.exit(1);
  }

  console.log(`Copying ${src} → ${dst} (source is never modified)…`);
  await fs.mkdir(dst, { recursive: true });
  await copyDir(src, dst);

  const sourceCounts = openCounts(path.join(src, "ca-suite.db"));
  const targetCounts = openCounts(path.join(dst, "ca-suite.db"));
  let mismatches = 0;
  for (const table of TRACKED) {
    const a = sourceCounts[table] ?? 0;
    const b = targetCounts[table] ?? 0;
    const ok = a === b || (a < 0 && b < 0);
    if (!ok) mismatches++;
    console.log(`  ${table}: ${a < 0 ? "(absent)" : a} → ${b < 0 ? "(absent)" : b}${ok ? "" : "  MISMATCH"}`);
  }
  const filesCopied = await copyDirOnVerify(src, dst);
  console.log(`uploads verified: ${filesCopied}`);
  if (mismatches > 0) {
    console.error("Row-count mismatches found — the copy is NOT safe for cutover. Do not switch CA_DATA_DIR.");
    process.exit(1);
  }
  if (filesCopied.failed > 0) {
    console.error("Uploaded-file verification failures above — resolve them before cutover. The source files were not touched.");
    process.exit(1);
  }
  console.log("Migration copy verified. To cut over (operator action): stop the app, set CA_DATA_DIR=" + dst + ", restart, then run the health check.");
}

/** Re-checks every copied upload exists and matches its file_versions checksum. */
async function copyDirOnVerify(src: string, dst: string): Promise<{ total: number; failed: number }> {
  const uploadsSrc = path.join(src, "uploads");
  if (!fsSync.existsSync(uploadsSrc)) return { total: 0, failed: 0 };
  const db = new DatabaseSync(path.join(dst, "ca-suite.db"), { readOnly: true });
  let total = 0;
  let failed = 0;
  try {
    const versions = db.prepare("SELECT object_key, size_bytes, checksum FROM file_versions").all() as unknown as Array<{
      object_key: string;
      size_bytes: number;
      checksum: string;
    }>;
    for (const v of versions) {
      const targetFile = path.join(dst, "uploads", v.object_key);
      total++;
      if (!fsSync.existsSync(targetFile)) {
        console.error(`  missing copy: uploads/${v.object_key}`);
        failed++;
        continue;
      }
      const stat = await fs.stat(targetFile);
      if (stat.size !== v.size_bytes) {
        console.error(`  size mismatch: uploads/${v.object_key} (ledger says ${v.size_bytes}, copy has ${stat.size})`);
        failed++;
        continue;
      }
      const hash = createHash("sha256").update(readFileSync(targetFile)).digest("hex");
      if (hash !== v.checksum) {
        console.error(`  checksum mismatch: uploads/${v.object_key}`);
        failed++;
      }
    }
  } finally {
    db.close();
  }
  return { total, failed };
}

main().catch((err) => {
  console.error(`Migration failed: ${(err as Error).message}`);
  process.exit(1);
});
