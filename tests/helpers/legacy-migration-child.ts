/**
 * Child-process fixture for the legacy migration test.
 *
 * It creates a pre-v3 database containing only the old client master (with a
 * plaintext GSTIN), then opens the current app so the versioned migration runs
 * against that file. It prints a single JSON line for the parent test.
 */
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

const dir = process.env.LEGACY_DIR;
if (!dir) throw new Error("LEGACY_DIR is required");

const db = new DatabaseSync(path.join(dir, "ca-suite.db"));
db.exec("PRAGMA journal_mode = DELETE;");
db.exec(`
  CREATE TABLE clients (
    client_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    legal_name TEXT,
    gst_number TEXT,
    gst_state_code TEXT,
    pan TEXT,
    tan TEXT,
    created_at TEXT,
    created_by TEXT
  );
`);
db.prepare(
  "INSERT INTO clients (client_id,name,legal_name,gst_number,gst_state_code,pan,tan,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?)",
).run(
  "CLIENT-LEGACY",
  "Legacy Textiles",
  "Legacy Textiles Private Limited",
  "27AAPFC0939F1ZD",
  "27",
  "AAPFC0939F",
  "",
  "2020-04-01T00:00:00.000Z",
  "legacy",
);
db.close();

void import("../../lib/db")
  .then(async () => {
    const { getClientMigrationReport, listRegistrations } = await import("../../lib/onboarding");
    process.stdout.write(
      `${JSON.stringify({
        report: getClientMigrationReport(),
        registrations: listRegistrations("CLIENT-LEGACY", "partner"),
      })}\n`,
    );
  })
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
