import fs from "node:fs";
import path from "node:path";
import { getConfig } from "./config";

/**
 * The one writable directory for runtime state: the SQLite database, the
 * session/encryption keys and uploaded documents.
 *
 * The location is governed by lib/config.ts — on serverless hosts a persistent
 * CA_DATA_DIR is mandatory unless the install is explicitly a demo
 * (CA_ALLOW_EPHEMERAL=1); misconfiguration fails at startup rather than quietly
 * writing client records to an ephemeral path.
 */
export function dataDir(): string {
  return getConfig().dataDir;
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
