import { NextResponse } from "next/server";
import { listUsers } from "@/lib/db";
import { ensureEngagementData } from "@/lib/engagements-db";
import { isCronAuthorized, CRON_UNAUTHORIZED_MESSAGE } from "@/lib/cron-auth";
import { scheduleAndProcessRecurrence } from "@/lib/engagement-jobs";

export const dynamic = "force-dynamic";

// Authorisation is strict (DEF-001 fix): only `Authorization: Bearer
// $CRON_SECRET`, which Vercel Cron sends once the variable is set. The old
// x-vercel-cron / user-agent fallbacks were spoofable from the internet.

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json(
      { error: CRON_UNAUTHORIZED_MESSAGE },
      { status: 401 },
    );
  }
  try {
    const users = listUsers();
    const actor = users.find((u) => u.role === "partner") ?? users[0];
    if (!actor) return NextResponse.json({ error: "No user account exists yet" }, { status: 503 });
    ensureEngagementData();
    const result = scheduleAndProcessRecurrence(actor.name);
    return NextResponse.json({
      ok: result.failed === 0,
      queued: result.queued,
      job_id: result.job_id,
      processed: result.processed,
      completed: result.completed,
      failed: result.failed,
      runs: result.runs,
      errors: result.errors,
    });
  } catch (err) {
    return NextResponse.json({ error: `Recurrence sweep failed: ${(err as Error).message}` }, { status: 500 });
  }
}
