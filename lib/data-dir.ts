import fs from "node:fs";
import path from "node:path";

/**
 * The one writable directory for runtime state: the SQLite database, the
 * session/encryption keys and uploaded documents.
 *
 * Locally that is `.data/` beside the project, which survives restarts.
 * Serverless hosts (Vercel) ship the deployment bundle read-only, so there the
 * only writable path is the instance's `/tmp` — state there is ephemeral and
 * not shared between instances, which is fine for a demo but means a real
 * deployment should set CA_DATA_DIR to a mounted volume.
 */
export function dataDir(): string {
  const configured = process.env.CA_DATA_DIR?.trim();
  if (configured) return path.resolve(configured);
  if (process.env.VERCEL) return path.join("/tmp", "ca-suite");
  return path.join(process.cwd(), ".data");
}

/** Absolute path inside the data directory, e.g. dataPath("uploads"). */
export function dataPath(...parts: string[]): string {
  return path.join(dataDir(), ...parts);
}

/** Creates (if needed) and returns a directory inside the data directory. */
export function ensureDataDir(...parts: string[]): string {
  const dir = dataPath(...parts);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
