import path from "node:path";
import { getSessionUser } from "@/lib/auth";
import { attachDocumentFile, getDocument, listFileVersions, recordFileVersion } from "@/lib/db";
import { purgeDocumentBytes } from "@/lib/documents";
import { refreshRequestStatus } from "@/lib/engagements-db";
import { dataPath } from "@/lib/data-dir";
import { deleteObject, getObject, objectKeyFor, objectKeyIsSafe, putObject, sha256Hex, sniffType, StorageError } from "@/lib/storage";
import { fail, handle, ok } from "@/lib/api";

export const dynamic = "force-dynamic";

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED = new Set(["pdf", "png", "jpg", "jpeg", "webp", "csv", "xls", "xlsx", "doc", "docx", "txt", "zip"]);

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  csv: "text/csv",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  zip: "application/zip",
};

/**
 * Legacy uploads (pre object-storage) live directly under the uploads
 * directory with a doc-prefixed filename. New uploads use opaque
 * `docs/<docId>/<stamp>-<name>` keys kept in sync with the file_versions
 * ledger. Old rows keep downloading through the legacy branch until the
 * operator runs the legacy migration (see docs/operations); nothing is
 * deleted by this route.
 */
async function readLegacy(key: string): Promise<Buffer | null> {
  if (objectKeyIsSafe(key)) return null;
  const absolute = path.join(dataPath("uploads"), path.basename(key));
  const fs = await import("node:fs/promises");
  try {
    return await fs.readFile(absolute);
  } catch {
    return null;
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser();
    if (!user) return fail("Sign in required", 401);
    if (user.role === "article") return fail("Only a manager or partner can upload document files", 403);
    const { id } = await ctx.params;
    const doc = getDocument(id);
    if (!doc) return fail("Document not found", 404);

    const form = await req.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") return fail("Choose a file to upload", 400);
    const upload = file as File;
    if (upload.size === 0) return fail("The uploaded file is empty", 400);
    if (upload.size > MAX_BYTES) return fail("Files must be 8 MB or smaller", 413);

    const extension = (upload.name.split(".").pop() ?? "").toLowerCase();
    if (!ALLOWED.has(extension)) {
      return fail(`Unsupported file type. Allowed: ${Array.from(ALLOWED).join(", ")}`, 415);
    }

    // Only the declared extension's own bytes are trusted after this. The
    // sniffed content must agree with the extension: a browser-provided MIME
    // is never trusted, so no route in this app consults upload.type at all.
    const bytes = Buffer.from(await upload.arrayBuffer());
    const sniffed = sniffType(bytes);
    const compatible = new Map<string, string[]>([
      ["pdf", ["pdf"]],
      ["png", ["png"]],
      ["jpg", ["jpeg"]],
      ["jpeg", ["jpeg"]],
      ["webp", ["webp"]],
      ["csv", ["text"]],
      ["txt", ["text"]],
      ["xls", ["ole2"]],
      ["doc", ["ole2"]],
      ["xlsx", ["zip"]],
      ["docx", ["zip"]],
      ["zip", ["zip"]],
    ]);
    if (!(compatible.get(extension) ?? []).includes(sniffed)) {
      return fail(`The file content does not look like a ${extension.toUpperCase()} file`, 415);
    }

    const key = objectKeyFor(id, upload.name);
    const contentType = MIME[extension] ?? "application/octet-stream";
    const changeReason = typeof form.get("change_reason") === "string" ? String(form.get("change_reason")).trim().slice(0, 500) : "";

    // Store bytes first, then record metadata; if the metadata write fails the
    // orphaned bytes are removed so a document never claims success on a
    // half-failed upload. recordFileVersion marks the previous object
    // superseded — version history is retained, nothing is destroyed.
    const stored = await putObject(key, bytes, contentType);
    try {
      recordFileVersion(id, {
        object_key: stored.key,
        file_name: upload.name.slice(0, 160),
        size_bytes: stored.size,
        checksum: stored.checksum,
        uploaded_by: user.name,
        change_reason: changeReason,
      });
    } catch (err) {
      await deleteObject(stored.key).catch(() => undefined);
      throw err;
    }

    // attachDocumentFile resets the review state: the new bytes have not been
    // reviewed, whatever happened to the previous version.
    const updated = attachDocumentFile(id, { file_name: upload.name.slice(0, 160), file_size: stored.size, file_path: stored.key });
    if (!updated) return fail("Document not found", 404);
    if (doc.request_id) refreshRequestStatus(doc.request_id);
    return ok(updated, 201);
  } catch (err) {
    if (err instanceof StorageError) return fail(err.message, err.status);
    return handle(err);
  }
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser();
    if (!user) return fail("Sign in required", 401);
    const { id } = await ctx.params;
    const doc = getDocument(id);
    if (!doc) return fail("Document not found", 404);

    const url = new URL(req.url);
    const versionParam = Number(url.searchParams.get("version")) || 0;
    let selected: { object_key?: string | null; file_name?: string | null; checksum: string } | null = null;
    if (versionParam) {
      const row = listFileVersions(id).find((v) => v.version === versionParam);
      if (!row) return fail(`Version ${versionParam} does not exist for this document`, 404);
      selected = { object_key: row.object_key, file_name: row.file_name, checksum: row.checksum };
    }

    const objectKey = selected?.object_key ?? doc.file_path;
    if (!objectKey) return fail("No file has been uploaded for this document", 404);

    const extension = (objectKey.split(".").pop() ?? "").toLowerCase();
    let filename = selected?.file_name ?? doc.file_name ?? path.basename(objectKey);
    let buffer: Buffer;
    const legacy = await readLegacy(objectKey);
    if (legacy) {
      buffer = legacy;
      filename = doc.file_name ?? path.basename(objectKey);
    } else {
      if (!objectKeyIsSafe(objectKey)) return fail("Invalid file path", 400);
      buffer = await getObject(objectKey);
    }

    // Content integrity: the served bytes must hash to the checksum that was
    // recorded when the object was stored. The legacy branch has no recorded
    // checksum, so it is served without one (the migration run fixes it).
    if (selected?.checksum) {
      if (sha256Hex(buffer) !== selected.checksum) {
        return fail("The stored file failed its integrity check — do not rely on this copy; contact the operator", 500);
      }
    } else if (!legacy) {
      const current = listFileVersions(id).find((v) => v.object_key === objectKey);
      if (current && sha256Hex(buffer) !== current.checksum) {
        return fail("The stored file failed its integrity check — do not rely on this copy; contact the operator", 500);
      }
    }

    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": MIME[extension] ?? "application/octet-stream",
        // Always an attachment: uploaded content is never executed or rendered
        // in the application origin.
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Content-Length": String(buffer.byteLength),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'",
      },
    });
  } catch (err) {
    if (err instanceof StorageError) return fail(err.message, err.status);
    return handle(err);
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser();
    if (!user) return fail("Sign in required", 401);
    if (user.role === "article") return fail("Only a manager or partner can remove document files", 403);
    const { id } = await ctx.params;
    const doc = getDocument(id);
    if (!doc) return fail("Document not found", 404);
    await purgeDocumentBytes(id, user.name);
    const updated = getDocument(id);
    if (!updated) return fail("Document not found", 404);
    if (doc.request_id) refreshRequestStatus(doc.request_id);
    return ok(updated);
  } catch (err) {
    return handle(err);
  }
}
