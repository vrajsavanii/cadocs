import { getSessionUser } from "@/lib/auth";
import { getDocumentRequest, updateDocumentRequest } from "@/lib/engagements-db";
import { chaseRequest } from "@/lib/reminders";
import { fail, handle, ok, readBody } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser();
    if (!user) return fail("Sign in required", 401);
    const { id } = await ctx.params;
    const current = getDocumentRequest(id);
    if (!current) return fail("Document request not found", 404);
    const body = await readBody(req);
    const action = String(body.action || "chase");

    if (action === "chase") {
      const result = await chaseRequest(id, user.name);
      if (result.status === "capped") return fail(result.reason || "All reminders have been used", 409);
      if (result.status === "skipped" || result.status === "cleared") return fail(result.reason || "Nothing to chase", 409);
      return ok(result);
    }

    if (action === "close") {
      if (user.role === "article") return fail("Only a manager or partner can close a request", 403);
      return ok(updateDocumentRequest(id, { status: "Closed", next_reminder_on: null }));
    }

    if (action === "reopen") {
      if (user.role === "article") return fail("Only a manager or partner can reopen a request", 403);
      return ok(updateDocumentRequest(id, { status: "Open", cleared_at: null, next_reminder_on: new Date().toISOString().slice(0, 10), reminders_sent: 0 }));
    }

    if (action === "note") {
      if (user.role === "article") return fail("Only a manager or partner can record the outstanding list", 403);
      const note = typeof body.note === "string" ? body.note.trim().slice(0, 500) : "";
      if (!note) return fail("Write what is still missing, or clear the note");
      return ok(updateDocumentRequest(id, { missing_note: note, status: current.status === "Cleared" ? "Open" : current.status }));
    }

    if (action === "policy") {
      if (user.role === "article") return fail("Only a manager or partner can change the reminder policy", 403);
      const cap = Math.round(Number(body.reminder_cap));
      const gap = Math.round(Number(body.reminder_gap_days));
      if (!Number.isFinite(cap) || cap < 1 || cap > 3) return fail("The reminder cap must be between 1 and 3");
      if (!Number.isFinite(gap) || gap < 1 || gap > 30) return fail("The reminder gap must be between 1 and 30 days");
      return ok(updateDocumentRequest(id, { reminder_cap: cap }));
    }

    return fail("Unknown request action");
  } catch (err) {
    return handle(err);
  }
}
