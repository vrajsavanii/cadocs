import { updateDocumentStatus } from "@/lib/db";
import { fail, handle, ok, pick, readBody } from "@/lib/api";
import type { DocumentItem } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = await readBody(req);
    const status = pick<DocumentItem["status"]>(body.status, ["Pending", "Received", "Verified", "Rejected"], "Status");
    const updated = updateDocumentStatus(id, status);
    if (!updated) return fail("Document not found", 404);
    return ok(updated);
  } catch (err) {
    return handle(err);
  }
}
