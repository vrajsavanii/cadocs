import { updateLead } from "@/lib/db";
import { fail, handle, num, ok, pick, readBody, str } from "@/lib/api";
import type { Lead } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = await readBody(req);
    const updated = updateLead(id, {
      status: pick<Lead["status"]>(body.status, ["New", "Contacted", "Qualified", "Proposal Sent", "Won", "Lost"], "Status", "New"),
      ...(body.category !== undefined ? { category: pick<Lead["category"]>(body.category, ["Hot", "Warm", "Cold"], "Category") } : {}),
      ...(body.lead_score !== undefined ? { lead_score: num(body.lead_score, "Lead score", { min: 0, max: 100 }) } : {}),
      ...(body.notes !== undefined ? { notes: str(body.notes, "Notes", { optional: true, max: 500 }) } : {}),
    });
    if (!updated) return fail("Lead not found", 404);
    return ok(updated);
  } catch (err) {
    return handle(err);
  }
}
