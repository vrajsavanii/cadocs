/**
 * Private object storage for client-uploaded documents.
 *
 * All bytes live outside the web root, addressed by opaque, server-generated
 * keys (`docs/DOC-012/…`). Filesystem layout and provider paths are never
 * exposed to the client: downloads stream through the authorised document API
 * route, or — when object storage (R2) is enabled — through a short-lived
 * SigV4 presigned URL produced only after a server-side permission check.
 *
 * Providers (lib/config.ts CA_STORAGE_PROVIDER):
 *   - `local` (default): files under the validated data directory. Correct for
 *     local development and for persistent-volume deployments.
 *   - `r2`: Cloudflare R2 (S3 API), SigV4-signed with fetch — no SDK
 *     dependency. Requires CA_R2_* credentials (validated at startup).
 *
 * Every stored object records a SHA-256 checksum and its byte size, so the
 * document download route can verify content integrity, and the migration
 * tooling can prove nothing was corrupted in transit.
 */
import { createHash, createHmac } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { dataDir } from "./data-dir";
import { getConfig } from "./config";

export interface StoredObject {
  key: string;
  checksum: string;
  size: number;
  contentType: string;
}

export class StorageError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.name = "StorageError";
    this.status = status;
  }
}

/** Opaque, traversal-proof key: `docs/<docId>/<timestamp>-<safeName>` or arbitrary sub-objects. */
export function objectKeyFor(docId: string, fileName: string): string {
  const safe = path.basename(fileName).replace(/[^\w.\- ]+/g, "_").replace(/\s+/g, " ").trim().slice(-80) || "document.bin";
  return `docs/${docId}/${Date.now().toString(36)}-${safe}`;
}

/** Rejects traversal, absolute paths, and anything outside the docs/ namespace. */
export function objectKeyIsSafe(key: string): boolean {
  if (!key || key.length > 400) return false;
  if (key.includes("..") || key.includes("\\") || key.startsWith("/")) return false;
  return key.startsWith("docs/");
}

function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Standalone checksum for callers outside this module (integrity checks). */
export function sha256Hex(data: Buffer): string {
  return sha256(data);
}

export type SniffedType = "pdf" | "png" | "jpeg" | "webp" | "zip" | "ole2" | "text" | "unknown";

/**
 * Content sniffing from the first bytes (not the browser's claimed MIME). The
 * allowlist categories map onto our permitted extensions: zip covers
 * zip/xlsx/docx; ole2 covers xls/doc; text covers txt/csv (and is also where
 * html/deceptive text payloads land — callers reject those by extension).
 */
export function sniffType(bytes: Buffer): SniffedType {
  if (bytes.length < 8) return "unknown";
  const head = bytes.subarray(0, 16);
  if (head.subarray(0, 5).toString("ascii") === "%PDF-") return "pdf";
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return "png";
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "jpeg";
  if (head.subarray(0, 4).toString("ascii") === "RIFF" && head.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  if (head[0] === 0x50 && head[1] === 0x4b) return "zip"; // zip, xlsx, docx
  if (head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0) return "ole2"; // xls, doc
  const printable = head.every((b) => b === 9 || b === 10 || b === 13 || (b >= 32 && b <= 126) || b >= 128);
  return printable ? "text" : "unknown";
}

// ── Local provider ───────────────────────────────────────────────────────────

function localRoot(): string {
  return path.join(dataDir(), "uploads");
}

function localPath(key: string): string {
  if (!objectKeyIsSafe(key)) throw new StorageError("Invalid storage key", 400);
  const absolute = path.join(localRoot(), key);
  if (!absolute.startsWith(path.resolve(localRoot()))) throw new StorageError("Invalid storage key", 400);
  return absolute;
}

// ── R2 / SigV4 provider ──────────────────────────────────────────────────────

interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

function r2Config(): R2Config {
  const cfg = getConfig();
  if (cfg.storageProvider !== "r2") throw new StorageError("Object storage provider is not R2", 400);
  return {
    accountId: process.env.CA_R2_ACCOUNT_ID || "",
    accessKeyId: process.env.CA_R2_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.CA_R2_SECRET_ACCESS_KEY || "",
    bucket: process.env.CA_R2_BUCKET || "",
  };
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function amzDate(date: Date): { amz: string; short: string } {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amz: iso, short: iso.slice(0, 8) };
}

function encodeRfc3986(str: string): string {
  return encodeURIComponent(str).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function r2Url(key: string): string {
  const cfg = r2Config();
  return `https://${cfg.accountId}.r2.cloudflarestorage.com/${cfg.bucket}/${key.split("/").map(encodeRfc3986).join("/")}`;
}

function signingKey(cfg: R2Config, date: Date): Buffer {
  const { short } = amzDate(date);
  const kDate = hmac(`AWS4${cfg.secretAccessKey}`, short);
  const kRegion = hmac(kDate, "auto");
  const kService = hmac(kRegion, "s3");
  return hmac(kService, "aws4_request");
}

class SignatureContext {
  date = new Date();
  cfg = r2Config();
  constructor(public key: string) {}
  canonicalHeaders(extra: Record<string, string>): { headers: Record<string, string>; signedHeaders: string; canonicalHeaders: string } {
    const headers: Record<string, string> = { ...extra };
    headers.host = `r2.cloudflarestorage.com`;
    headers["x-amz-date"] = amzDate(this.date).amz;
    const signed = Object.keys(headers).sort();
    return {
      headers,
      signedHeaders: signed.join(";"),
      canonicalHeaders: signed.map((h) => `${h}:${headers[h]!.trim()}\n`).join(""),
    };
  }
  signature(canonicalRequest: string): string {
    const scope = `${amzDate(this.date).short}/auto/s3/aws4_request`;
    const stringToSign = `AWS4-HMAC-SHA256\n${amzDate(this.date).amz}\n${scope}\n${sha256(Buffer.from(canonicalRequest, "utf8"))}`;
    return createHmac("sha256", signingKey(this.cfg, this.date)).update(stringToSign, "utf8").digest("hex");
  }
}

async function r2Put(key: string, data: Buffer, contentType: string): Promise<void> {
  const ctx = new SignatureContext(key);
  const payloadHash = sha256(data);
  const { headers, signedHeaders, canonicalHeaders } = ctx.canonicalHeaders({
    "x-amz-content-sha256": payloadHash,
  });
  const canonicalRequest = `PUT\n/${ctx.cfg.bucket}/${encodeRfc3986(key).replaceAll("%2F", "/")}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  const res = await fetch(r2Url(key), {
    method: "PUT",
    headers: {
      ...headers,
      Authorization: `AWS4-HMAC-SHA256 Credential=${ctx.cfg.accessKeyId}/${amzDate(ctx.date).short}/auto/s3/aws4_request, SignedHeaders=${signedHeaders}, Signature=${ctx.signature(canonicalRequest)}`,
      "Content-Type": contentType,
      "Content-Length": String(data.byteLength),
    },
    body: new Uint8Array(data),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new StorageError(`Object storage rejected the upload (status ${res.status}). STOR-SAVE-FAILED ${body.slice(0, 120)}`);
  }
}

async function r2Get(key: string): Promise<Buffer> {
  const ctx = new SignatureContext(key);
  const { headers, signedHeaders, canonicalHeaders } = ctx.canonicalHeaders({ "x-amz-content-sha256": sha256(Buffer.alloc(0)) });
  const canonicalRequest = `GET\n/${ctx.cfg.bucket}/${encodeRfc3986(key).replaceAll("%2F", "/")}\n\n${canonicalHeaders}\n${signedHeaders}\n${sha256(Buffer.alloc(0))}`;
  const res = await fetch(r2Url(key), {
    method: "GET",
    headers: {
      ...headers,
      Authorization: `AWS4-HMAC-SHA256 Credential=${ctx.cfg.accessKeyId}/${amzDate(ctx.date).short}/auto/s3/aws4_request, SignedHeaders=${signedHeaders}, Signature=${ctx.signature(canonicalRequest)}`,
    },
  });
  if (res.status === 404) throw new StorageError("The stored file is missing", 404);
  if (!res.ok) throw new StorageError(`Object storage read failed (status ${res.status}). STOR-READ-FAILED`);
  return Buffer.from(await res.arrayBuffer());
}

async function r2Delete(key: string): Promise<void> {
  const ctx = new SignatureContext(key);
  const { headers, signedHeaders, canonicalHeaders } = ctx.canonicalHeaders({ "x-amz-content-sha256": sha256(Buffer.alloc(0)) });
  const canonicalRequest = `DELETE\n/${ctx.cfg.bucket}/${encodeRfc3986(key).replaceAll("%2F", "/")}\n\n${canonicalHeaders}\n${signedHeaders}\n${sha256(Buffer.alloc(0))}`;
  const res = await fetch(r2Url(key), {
    method: "DELETE",
    headers: {
      ...headers,
      Authorization: `AWS4-HMAC-SHA256 Credential=${ctx.cfg.accessKeyId}/${amzDate(ctx.date).short}/auto/s3/aws4_request, SignedHeaders=${signedHeaders}, Signature=${ctx.signature(canonicalRequest)}`,
    },
  });
  if (!res.ok && res.status !== 404) throw new StorageError(`Object storage delete failed (status ${res.status}). STOR-DELETE-FAILED`);
}

/** Short-lived, read-only presigned GET for the R2 provider. */
export function presignDownload(key: string, ttlSeconds = 300): string {
  if (!objectKeyIsSafe(key)) throw new StorageError("Invalid storage key", 400);
  if (getConfig().storageProvider !== "r2") {
    throw new StorageError("Presigned URLs are only available with object storage provider r2", 400);
  }
  const ttl = Math.min(Math.max(Math.round(ttlSeconds) || 300, 30), 3600);
  const cfg = r2Config();
  const ctx = new SignatureContext(key);
  const { amz, short } = amzDate(ctx.date);
  const credential = `${cfg.accessKeyId}/${short}/auto/s3/aws4_request`;
  const query = [
    `X-Amz-Algorithm=AWS4-HMAC-SHA256`,
    `X-Amz-Credential=${encodeRfc3986(credential)}`,
    `X-Amz-Date=${amz}`,
    `X-Amz-Expires=${ttl}`,
    `X-Amz-SignedHeaders=host`,
  ].join("&");
  const canonicalRequest = `GET\n/${cfg.bucket}/${encodeRfc3986(key).replaceAll("%2F", "/")}\n${query}\nhost:r2.cloudflarestorage.com\nhost\nUNSIGNED-PAYLOAD`;
  return `${r2Url(key).split("?")[0]}?${query}&X-Amz-Signature=${ctx.signature(canonicalRequest)}`;
}

// ── Provider-agnostic API ────────────────────────────────────────────────────

/** Stores bytes under a key that has already been generated via objectKeyFor. */
export async function putObject(key: string, data: Buffer, contentType: string): Promise<StoredObject> {
  if (!objectKeyIsSafe(key)) throw new StorageError("Invalid storage key", 400);
  const checksum = sha256(data);
  if (getConfig().storageProvider === "r2") {
    await r2Put(key, data, contentType);
  } else {
    const absolute = localPath(key);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, data, { mode: 0o600 });
  }
  return { key, checksum, size: data.byteLength, contentType };
}

/** Reads an object whole (uploads are capped at 8 MB, so whole-read is fine). */
export async function getObject(key: string): Promise<Buffer> {
  if (!objectKeyIsSafe(key)) throw new StorageError("Invalid storage key", 400);
  if (getConfig().storageProvider === "r2") return r2Get(key);
  const absolute = localPath(key);
  try {
    return await fs.readFile(absolute);
  } catch {
    throw new StorageError("The stored file is missing", 404);
  }
}

/** Deletes an object; silently succeeds if it never existed or already went. */
export async function deleteObject(key: string): Promise<void> {
  if (!objectKeyIsSafe(key)) throw new StorageError("Invalid storage key", 400);
  try {
    if (getConfig().storageProvider === "r2") {
      await r2Delete(key);
    } else {
      const absolute = localPath(key);
      await fs.unlink(absolute);
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw err;
  }
}

/** Existence check used by the health endpoint and migration verification. */
export async function objectExists(key: string): Promise<boolean> {
  try {
    if (getConfig().storageProvider === "r2") {
      await r2Get(key);
      return true;
    }
    await fs.stat(localPath(key));
    return true;
  } catch {
    return false;
  }
}
