import { getSessionUser } from "@/lib/auth";
import { getDocument, listFileVersions } from "@/lib/db";
import { fail, handle, ok } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Version ledger for a document. The current object is the newest row with
 * status 'current'; superseded rows stay downloadable via the file route's
 * ?version= parameter after the same permission checks. Object keys are NOT
 * returned to the client: storage paths are internal.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser();
    if (!user) return fail("Sign in required", 401);
    const { id } = await ctx.params;
    const doc = getDocument(id);
    if (!doc) return fail("Document not found", 404);
    const versions = listFileVersions(id).map((v) => ({
      version: v.version,
      file_name: v.file_name,
      size_bytes: v.size_bytes,
      checksum: v.checksum,
      uploaded_by: v.uploaded_by,
      uploaded_at: v.uploaded_at,
      status: v.status,
      change_reason: v.change_reason,
      superseded_at: v.superseded_at,
    }));
    return ok({ versions, current_version: versions.find((v) => v.status === "current")?.version ?? null });
  } catch (err) {
    return handle(err);
  }
}
