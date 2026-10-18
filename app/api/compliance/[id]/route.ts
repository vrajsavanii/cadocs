import { updateComplianceStatus } from "@/lib/db";
import { fail, handle, ok, pick, readBody } from "@/lib/api";
import type { Compliance } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = await readBody(req);
    const status = pick<Compliance["status"]>(body.status, ["Pending", "In Progress", "Filed", "Overdue"], "Status");
    const updated = updateComplianceStatus(id, status);
    if (!updated) return fail("Compliance task not found", 404);
    return ok(updated);
  } catch (err) {
    return handle(err);
  }
}
