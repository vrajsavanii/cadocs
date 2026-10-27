import { NextResponse } from "next/server";
import { listUsers } from "@/lib/db";
import { ensureEngagementData } from "@/lib/engagements-db";
import { scheduleAndProcessRecurrence } from "@/lib/engagement-jobs";

export const dynamic = "force-dynamic";

function isVercelCron(req: Request): boolean {
  if (req.headers.get("x-vercel-cron")) return true;
  const ua = (req.headers.get("user-agent") || "").toLowerCase();
  return ua.startsWith("vercel-cron") || ua.includes("vercel-cron/");
}

function authorize(req: Request): boolean {
  const secret = (process.env.CRON_SECRET || "").trim();
  const auth = req.headers.get("authorization") || "";
  const key = new URL(req.url).searchParams.get("key") || "";
  if (secret && (auth === `Bearer ${secret}` || key === secret)) return true;
  return isVercelCron(req);
}

export async function GET(req: Request) {
  if (!authorize(req)) {
    return NextResponse.json(
      { error: "Unauthorized — set CRON_SECRET and pass it as a Bearer token, or invoke from Vercel Cron." },
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
