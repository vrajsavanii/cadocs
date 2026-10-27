/**
 * Central, validated configuration for runtime state and storage.
 *
 * Two hard rules drive this module:
 *   1. Durable business data (SQLite, uploaded client files) must never live in
 *      an ephemeral location on a serverless/multi-instance deployment unless
 *      the operator has explicitly declared the install a demo.
 *   2. Misconfiguration must fail loudly at startup with an actionable message —
 *      and must never echo the secret values involved.
 *
 * Everything the app writes (database, keys, uploads, logs) resolves through
 * `dataDir()` (lib/data-dir.ts), which consults this module. Provider-specific
 * object-storage settings live here too so `lib/storage.ts` has one source.
 */

import path from "node:path";

export type StorageMode = "persistent" | "ephemeral-demo";
export type StorageProvider = "local" | "r2";

export interface AppConfig {
  /** True on serverless/multi-instance hosts (Vercel et al). */
  isServerless: boolean;
  /** How durable state is stored in this deployment. */
  storageMode: StorageMode;
  /** Which object-storage backend file uploads use. */
  storageProvider: StorageProvider;
  /** Absolute directory holding the SQLite database, keys and local uploads. */
  dataDir: string;
  /** Seed a synthetic demo practice on first boot? */
  demoSeed: boolean;
  /** Validated signal-of-persistence explanation, shown in health checks. */
  storageExplanation: string;
}

class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

function flag(name: string): boolean {
  return TRUE_VALUES.has((process.env[name] || "").trim().toLowerCase());
}

function isEphemeralDir(dir: string): boolean {
  const normalised = dir.replace(/\\/g, "/").toLowerCase();
  // /tmp and friends vanish between instances on serverless platforms.
  return normalised === "/tmp" || normalised.startsWith("/tmp/") || normalised.includes("/vercel/") || normalised.startsWith("/var/folders/") || normalised.includes(".vercel/output");
}

/**
 * Resolves and validates the durable-state configuration. Throws ConfigError
 * with operator-safe wording when a production deployment would silently be
 * given ephemeral storage, when required provider credentials are missing, or
 * when production would fall back to development-only behaviour.
 */
function resolveConfig(): AppConfig {
  const isServerless = Boolean(process.env.VERCEL);
  const allowEphemeral = flag("CA_ALLOW_EPHEMERAL"); // demo installs only
  const configuredDir = (process.env.CA_DATA_DIR || "").trim();
  let dataDir = configuredDir;

  if (!dataDir) {
    if (isServerless) {
      if (!allowEphemeral) {
        throw new ConfigError(
          `Durable storage is not configured for this serverless deployment. ` +
            `Set CA_DATA_DIR to a mounted persistent volume, or run a managed ` +
            `database (see docs/architecture/DATABASE.md). For a throwaway demo ` +
            `set CA_ALLOW_EPHEMERAL=1 — data will be lost on every cold start ` +
            `and is not shared between instances.`,
        );
      }
      // Match the long-standing demo path rather than a hidden default.
      dataDir = "/tmp/ca-suite";
    } else {
      // Local development: project-sibling .data/ survives restarts.
      dataDir = path.resolve(process.cwd(), ".data");
    }
  }

  const ephemeral = isServerless && (!configuredDir || isEphemeralDir(dataDir));
  if (ephemeral && !allowEphemeral && isEphemeralDir(dataDir)) {
    throw new ConfigError(
      `CA_DATA_DIR (${dataDir.replace(/�/g, "")}) resolves to an ephemeral path. ` +
        `Business records cannot safely be written there. Set CA_DATA_DIR to a ` +
        `mounted persistent volume, or explicitly mark this install a demo with ` +
        `CA_ALLOW_EPHEMERAL=1.`,
    );
  }

  const storageMode: StorageMode = ephemeral ? "ephemeral-demo" : "persistent";
  if (storageMode === "ephemeral-demo" && !allowEphemeral) {
    throw new ConfigError("Ephemeral state requires CA_ALLOW_EPHEMERAL=1 in production.");
  }

  // Demo dataset policy: synthetic practice data is seeded only where an
  // operator explicitly re-enabled it for a demo install, or on a dev machine.
  const demoSeed =
    storageMode === "ephemeral-demo" ? true : process.env.NODE_ENV !== "production" ? !flag("CA_DEMO_SEED_OFF") : flag("CA_DEMO_SEED");

  const providerRaw = (process.env.CA_STORAGE_PROVIDER || "local").trim().toLowerCase();
  if (providerRaw !== "local" && providerRaw !== "r2") {
    throw new ConfigError(`CA_STORAGE_PROVIDER must be "local" or "r2" (got another value).`);
  }
  const storageProvider = providerRaw as StorageProvider;

  if (storageProvider === "r2") {
    const required = ["CA_R2_ACCOUNT_ID", "CA_R2_ACCESS_KEY_ID", "CA_R2_SECRET_ACCESS_KEY", "CA_R2_BUCKET"] as const;
    const missing = required.filter((k) => !(process.env[k] || "").trim());
    if (missing.length > 0) {
      throw new ConfigError(`CA_STORAGE_PROVIDER=r2 selected but required variables are not set: ${missing.join(", ")}.`);
    }
  }

  const explanation =
    storageMode === "persistent"
      ? storageProvider === "r2"
        ? "Persistent database volume · object storage (R2)"
        : "Persistent database and file storage"
      : "Demo-only ephemeral storage (CA_ALLOW_EPHEMERAL=1) — state resets on cold start";

  return { isServerless, storageMode, storageProvider, dataDir, demoSeed, storageExplanation: explanation };
}

let cached: AppConfig | null = null;

/** Validated config, memoised per process. Throws on invalid production setup. */
export function getConfig(): AppConfig {
  if (!cached) cached = resolveConfig();
  return cached;
}

/** Test hook: forget the cached config so new env vars are picked up. */
export function resetConfigForTests(): void {
  cached = null;
}
