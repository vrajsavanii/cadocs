import { updateTimesheet } from "@/lib/db";
import { fail, handle, ok, pick, readBody } from "@/lib/api";
import type { Timesheet } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = await readBody(req);
    const status = pick<Timesheet["status"]>(body.status, ["Pending", "Approved", "Rejected"], "Status");
    const updated = updateTimesheet(id, status);
    if (!updated) return fail("Timesheet not found", 404);
    return ok(updated);
  } catch (err) {
    return handle(err);
  }
}
