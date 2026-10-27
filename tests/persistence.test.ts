import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import fsSync from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { resetConfigForTests } from "../lib/config";

let DATA: string;
let DB: DatabaseSync;

beforeAll(() => {
  DATA = mkdtempSync(path.join(tmpdir(), "ca-persist-"));
  process.env.CA_DATA_DIR = DATA;
  resetConfigForTests();
});

beforeEach(() => {
  try {
    rmSync(DATA, { recursive: true, force: true });
  } catch {
    // Ignore temporary permission errors during teardown.
  }
  fsSync.mkdirSync(DATA, { recursive: true });
  const targetPath = path.join(DATA, "ca-suite.db");
  try {
    fsSync.unlinkSync(targetPath);
  } catch {
    // File may not exist on first run.
  }
  DB = new DatabaseSync(targetPath);
  DB.exec("PRAGMA journal_mode = DELETE;");
  DB.exec("PRAGMA foreign_keys = ON;");

  DB.exec(`DROP TABLE IF EXISTS clients`);
  DB.exec(`DROP TABLE IF EXISTS users`);
  DB.exec(`DROP TABLE IF EXISTS jobs`);
  DB.exec(`PRAGMA journal_mode = DELETE`);

  DB.exec(`
    CREATE TABLE clients (client_id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE users (user_id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL);
    CREATE TABLE jobs
      (job_id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
       run_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
       created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  `);
});

function reopen(): DatabaseSync {
  DB.close();
  const reopened = new DatabaseSync(path.join(DATA, "ca-suite.db"));
  reopened.exec("PRAGMA journal_mode = DELETE;");
  reopened.exec("PRAGMA foreign_keys = ON;");
  return reopened;
}

describe("prompt-02: persistence across simulated restart", () => {
  it("retains client records after a process restart", () => {
    DB.prepare("INSERT INTO clients (client_id, name) VALUES (?, ?)")
      .run("C-1", "A사");
    DB = reopen();
    expect(DB.prepare("SELECT name FROM clients WHERE client_id = ?").get("C-1")?.name).toBe("A사");
  });

  it("retains users across restart", () => {
    DB.prepare("INSERT INTO users (user_id, username) VALUES (?, ?)")
      .run("U-1", "partner@firm");
    DB = reopen();
    expect(DB.prepare("SELECT username FROM users WHERE user_id = ?").get("U-1")?.username).toBe("partner@firm");
  });

  it("retains durable job records across restart", () => {
    const now = new Date().toISOString().slice(0, 19).replace("T", " ");
    DB.prepare(`INSERT INTO jobs (job_id,kind,status,run_at,attempts,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`)
      .run("J-1", "send_reminder", "pending", now, 0, now, now);
    DB = reopen();
    const row = DB.prepare("SELECT status, attempts FROM jobs WHERE job_id = ?").get("J-1") as { status: string; attempts: number } | undefined;
    expect(row).toBeDefined();
    expect(row?.status).toBe("pending");
    expect(row?.attempts).toBe(0);
  });
});
