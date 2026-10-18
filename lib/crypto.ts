/**
 * Cryptographic primitives for CADocs.
 *
 * Everything here uses Node's built-in `node:crypto` — no third-party crypto
 * dependency, no key ever leaves this machine. Three independent keys live in
 * `.data/` (0600 permissions, outside every uploaded-asset and git path):
 *
 *   .data/field.key   AES-256-GCM key for sensitive columns (PAN, GSTIN)
 *   .data/session.key HMAC key that signs the auth cookie
 *
 * Each key can be overridden with an environment variable
 * (FIELD_ENCRYPTION_KEY / SESSION_SECRET) for deployments that manage secrets
 * outside the file system.
 *
 * Passwords are hashed with scrypt (memory-hard, built into Node) with a
 * per-password random salt and a constant-time comparison.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./data-dir";

const DATA_DIR = dataDir();

const cache = new Map<string, Buffer>();

/** Loads (or creates, mode 0600) a named key. Env var wins when present. */
function loadKey(name: "field" | "session"): Buffer {
  const envValue = name === "field" ? process.env.FIELD_ENCRYPTION_KEY : process.env.SESSION_SECRET;
  if (envValue && envValue.length >= 32) return Buffer.from(envValue, "utf8").subarray(0, 32);

  const cached = cache.get(name);
  if (cached) return cached;

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const file = path.join(DATA_DIR, `${name}.key`);
  let hex: string;
  if (fs.existsSync(file)) {
    hex = fs.readFileSync(file, "utf8").trim();
  } else {
    hex = randomBytes(32).toString("hex");
    fs.writeFileSync(file, `${hex}\n`, { mode: 0o600 });
    try {
      fs.chmodSync(file, 0o600);
    } catch {
      // best effort on platforms without POSIX permissions
    }
  }
  const key = Buffer.from(hex, "hex");
  cache.set(name, key);
  return key;
}

// ── Column-level encryption (AES-256-GCM) ────────────────────────────────────
// Stored value format: enc:v1:<iv-b64>:<tag-b64>:<ciphertext-b64>
// Anything not matching that prefix is treated as legacy plaintext.

const ENC_PREFIX = "enc:v1:";

export function encryptField(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value.startsWith(ENC_PREFIX)) return value;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", loadKey("field"), iv);
  const ct = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

export function decryptField(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  if (!value.startsWith(ENC_PREFIX)) return value; // legacy plaintext row
  try {
    const [ivB64, tagB64, ctB64] = value.slice(ENC_PREFIX.length).split(":");
    const decipher = createDecipheriv("aes-256-gcm", loadKey("field"), Buffer.from(ivB64!, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64!, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(ctB64!, "base64")), decipher.final()]).toString("utf8");
  } catch {
    // Wrong key (e.g. FIELD_ENCRYPTION_KEY rotated without migration) — fail soft
    // so the UI degrades to an empty identifier instead of crashing every page.
    return "";
  }
}

export function isEncrypted(value: string | null | undefined): boolean {
  return Boolean(value && value.startsWith(ENC_PREFIX));
}

// ── Passwords (scrypt) ───────────────────────────────────────────────────────

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, salt, hash] = stored.split(":");
    if (scheme !== "scrypt" || !salt || !hash) return false;
    const candidate = scryptSync(password, salt, 64);
    const expected = Buffer.from(hash, "hex");
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}

export function generatePassword(length = 14): string {
  // Unambiguous alphabet (no O/0/I/1) so users can retype bootstrap credentials.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789@#%+=?";
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[bytes[i]! % alphabet.length];
  return out;
}

// ── Session tokens (HMAC-SHA256, stateless) ──────────────────────────────────

export type SessionClaims = { uid: string; iat: number; exp: number; v: number };

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64url");
}

export function signSession(claims: { uid: string; v?: number }, ttlHours = 12): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionClaims = { uid: claims.uid, v: claims.v ?? 0, iat: now, exp: now + ttlHours * 3600 };
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", loadKey("session")).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifySession(token: string | undefined | null): SessionClaims | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot < 1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", loadKey("session")).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionClaims;
    if (typeof claims.uid !== "string" || typeof claims.exp !== "number") return null;
    if (claims.exp < Date.now() / 1000) return null;
    return claims;
  } catch {
    return null;
  }
}

// ── Fixed-window rate limiter (in-memory, per process) ───────────────────────

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 5000) {
      for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
    }
    return { ok: true, retryAfterSec: 0 };
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }
  return { ok: true, retryAfterSec: 0 };
}