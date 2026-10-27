/**
 * Backup CLI — operator-run, never scheduled from the app process.
 *
 * Usage: node scripts/backup.ts --target <dir> [--source <dataDir>]
 *
 * Creates a transactionally consistent SQLite snapshot plus the uploads tree
 * and decryption keys, then verifies what it just wrote. Never touches the
 * live database.
 */
import fsSync from "node:fs";
import path from "node:path";
import { createBackup, verifyBackup } from "../lib/backup";
import { dataDir } from "../lib/data-dir";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const target = arg("target");
  if (!target) {
    console.error("Usage: node scripts/backup.ts --target <dir> [--source <dataDir>]");
    process.exit(2);
  }
  const source = arg("source");
  if (source) process.env.CA_DATA_DIR = source;

  console.log(`Backing up data from ${dataDir()} into ${path.resolve(target)} …`);
  const { manifestPath, counts, files } = await createBackup(path.resolve(target));
  console.log(`Snapshot written. Manifest: ${manifestPath}`);
  for (const [table, n] of Object.entries(counts)) console.log(`  ${table}: ${n >= 0 ? n : "(absent)"}`);
  console.log(`  files copied: ${files}`);

  const verification = await verifyBackup(path.resolve(target));
  if (!verification.ok) {
    console.error("Backup verification FAILED:");
    for (const problem of verification.problems) console.error(`  - ${problem}`);
    for (const failure of verification.fileFailures) console.error(`  - file: ${failure}`);
    process.exit(1);
  }
  console.log("Backup verification passed: integrity ok, foreign keys ok, row counts match, checksums verified.");
  console.log("WARNING: the snapshot contains decryption keys — store it encrypted and outside any repository.");
  if (!fsSync.existsSync(manifestPath)) process.exit(1);
}

main().catch((err) => {
  console.error(`Backup failed: ${(err as Error).message}`);
  process.exit(1);
});
