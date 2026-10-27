/**
 * Restore-verification CLI — proves a backup is usable without touching live data.
 *
 * Usage: node scripts/restore-verify.ts --backup <dir>
 *
 * Opens the snapshot read-only, runs SQLite integrity + foreign-key checks,
 * compares row counts against the manifest, and re-hashes every versioned file
 * against its recorded checksum. This is the "non-production restoration test"
 * the disaster-recovery runbook requires before any real restore.
 */
import path from "node:path";
import fsSync from "node:fs";
import { verifyBackup } from "../lib/backup";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const backup = arg("backup");
  if (!backup) {
    console.error("Usage: node scripts/restore-verify.ts --backup <dir>");
    process.exit(2);
  }
  const dir = path.resolve(backup);
  if (!fsSync.existsSync(dir)) {
    console.error(`Backup directory does not exist: ${dir}`);
    process.exit(2);
  }
  console.log(`Verifying backup at ${dir} (read-only) …`);
  const result = await verifyBackup(dir);
  console.log(`integrity_check: ${result.integrity}`);
  console.log(`foreign key violations: ${result.foreignKeyViolations}`);
  for (const [table, n] of Object.entries(result.counts)) console.log(`  ${table}: ${n >= 0 ? n : "(absent)"}`);
  console.log(`files re-hashed ok: ${result.filesChecked}`);
  for (const failure of result.fileFailures) console.error(`  file failure: ${failure}`);
  for (const problem of result.problems) console.error(`  problem: ${problem}`);
  if (!result.ok) {
    console.error("Backup verification FAILED — do not restore from this snapshot before re-creating one.");
    process.exit(1);
  }
  console.log("Backup verification PASSED.");
}

main().catch((err) => {
  console.error(`Verification failed: ${(err as Error).message}`);
  process.exit(1);
});
