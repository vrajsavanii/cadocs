import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Points the process at an isolated temp data directory and returns it.
 * Call at the top of a test file, BEFORE importing lib/db (module-level
 * imports of lib/db evaluate the data path at import time).
 *
 * NODE_ENV=production + no VERCEL ⇒ persistent mode, demo data disabled, so
 * every test starts from an empty, deterministic database. Never touches the
 * developer's real .data directory, and no real client data is ever read.
 */
export function withIsolatedDataDir(): string {
  const temp = fsSync.mkdtempSync(path.join(os.tmpdir(), "ca-suite-test-"));
  process.env.CA_DATA_DIR = temp;
  Object.assign(process.env, { NODE_ENV: "production" });
  delete process.env.VERCEL;
  delete process.env.CA_ALLOW_EPHEMERAL;
  delete process.env.CA_DEMO_SEED;
  return temp;
}

/** Simulates an application restart: forgets the cached connection. */
export function simulateRestart(): void {
  const g = globalThis as unknown as { __caDb?: unknown };
  delete g.__caDb;
}
