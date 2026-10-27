import { describe, expect, it } from "vitest";

// Configuration is validated before lib modules load anything else, so no
// imports from lib at module scope — every case resets env, resets the config
// cache, imports lib/config fresh, and asserts.
import { resetConfigForTests } from "../lib/config";

function env(): Record<string, string | undefined> {
  return process.env as unknown as Record<string, string | undefined>;
}

async function freshConfig() {
  resetConfigForTests();
  const mod = await import("../lib/config");
  return mod.getConfig();
}

describe("config: durable storage policy", () => {
  it("rejects a serverless deployment with no CA_DATA_DIR", async () => {
    const snapshot = { ...env() };
    process.env.VERCEL = "1";
    delete process.env.CA_DATA_DIR;
    delete process.env.CA_ALLOW_EPHEMERAL;
    await expect(freshConfig()).rejects.toThrow(/CA_DATA_DIR/);
    Object.assign(process.env, snapshot);
  });

  it("rejects CA_DATA_DIR under /tmp on a serverless deployment", async () => {
    const snapshot = { ...env() };
    process.env.VERCEL = "1";
    process.env.CA_DATA_DIR = "/tmp/ca-suite";
    delete process.env.CA_ALLOW_EPHEMERAL;
    await expect(freshConfig()).rejects.toThrow(/ephemeral/i);
    Object.assign(process.env, snapshot);
  });

  it("allows ephemeral storage only with an explicit demo declaration", async () => {
    const snapshot = { ...env() };
    process.env.VERCEL = "1";
    process.env.CA_DATA_DIR = "/tmp/ca-suite";
    process.env.CA_ALLOW_EPHEMERAL = "1";
    const config = await freshConfig();
    expect(config.storageMode).toBe("ephemeral-demo");
    expect(config.demoSeed).toBe(true); // demo-marked installs keep demo data
    Object.assign(process.env, snapshot);
  });

  it("accepts a persistent volume path on a serverless deployment", async () => {
    const snapshot = { ...env() };
    process.env.VERCEL = "1";
    process.env.CA_DATA_DIR = "/mnt/persistent-volume/ca-suite";
    Object.assign(process.env, { NODE_ENV: "production" });
    delete process.env.CA_ALLOW_EPHEMERAL;
    const config = await freshConfig();
    expect(config.storageMode).toBe("persistent");
    expect(config.demoSeed).toBe(false); // no demo reseeding in production
    Object.assign(process.env, snapshot);
  });

  it("falls back to '.data' next to the project for local development", async () => {
    const snapshot = { ...env() };
    delete process.env.VERCEL;
    delete process.env.CA_DATA_DIR;
    const config = await freshConfig();
    expect(config.storageMode).toBe("persistent");
    expect(config.dataDir.endsWith(".data")).toBe(true);
    Object.assign(process.env, snapshot);
  });

  it("requires full R2 credentials when the r2 provider is selected", async () => {
    const snapshot = { ...env() };
    delete process.env.VERCEL;
    process.env.CA_STORAGE_PROVIDER = "r2";
    delete process.env.CA_R2_ACCOUNT_ID;
    delete process.env.CA_R2_ACCESS_KEY_ID;
    await expect(freshConfig()).rejects.toThrow(/CA_R2_ACCOUNT_ID/);
    process.env.CA_STORAGE_PROVIDER = "local";
    Object.assign(process.env, snapshot);
  });
});
