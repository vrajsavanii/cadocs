import { updateNoticeStatus } from "@/lib/db";
import { fail, handle, ok, pick, readBody } from "@/lib/api";
import type { Notice } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = await readBody(req);
    const status = pick<Notice["status"]>(body.status, ["Open", "Response Filed", "Closed", "Escalated"], "Status");
    const updated = updateNoticeStatus(id, status);
    if (!updated) return fail("Notice not found", 404);
    return ok(updated);
  } catch (err) {
    return handle(err);
  }
}
