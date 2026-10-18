import fs from "node:fs";
import path from "node:path";
import { attachDocumentFile, clearDocumentFile, getDocument } from "@/lib/db";
import { dataPath } from "@/lib/data-dir";
import { fail, handle, ok } from "@/lib/api";

export const dynamic = "force-dynamic";

const UPLOAD_DIR = dataPath("uploads");
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

function removeStored(stored: string | null) {
  if (!stored) return;
  const absolute = path.join(UPLOAD_DIR, path.basename(stored));
  fs.promises.unlink(absolute).catch(() => undefined);
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
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

    await fs.promises.mkdir(UPLOAD_DIR, { recursive: true });
    const safeBase = path.basename(upload.name).replace(/[^\w.\- ]+/g, "_").slice(-80) || `document.${extension}`;
    const stored = `${id}-${Date.now()}-${safeBase}`;
    const absolute = path.join(UPLOAD_DIR, stored);
    await fs.promises.writeFile(absolute, Buffer.from(await upload.arrayBuffer()));

    removeStored(doc.file_path);
    const updated = attachDocumentFile(id, { file_name: upload.name.slice(0, 160), file_size: upload.size, file_path: stored });
    if (!updated) return fail("Document not found", 404);
    return ok(updated, 201);
  } catch (err) {
    return handle(err);
  }
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const doc = getDocument(id);
    if (!doc || !doc.file_path) return fail("No file has been uploaded for this document", 404);

    const absolute = path.join(UPLOAD_DIR, path.basename(doc.file_path));
    if (!absolute.startsWith(UPLOAD_DIR)) return fail("Invalid file path", 400);
    if (!fs.existsSync(absolute)) return fail("The stored file is missing", 404);

    const extension = (doc.file_path.split(".").pop() ?? "").toLowerCase();
    const buffer = await fs.promises.readFile(absolute);
    const filename = doc.file_name ?? path.basename(doc.file_path);
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": MIME[extension] ?? "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Content-Length": String(buffer.byteLength),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    return handle(err);
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const doc = getDocument(id);
    if (!doc) return fail("Document not found", 404);
    removeStored(doc.file_path);
    const updated = clearDocumentFile(id);
    if (!updated) return fail("Document not found", 404);
    return ok(updated);
  } catch (err) {
    return handle(err);
  }
}
