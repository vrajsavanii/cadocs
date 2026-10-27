import { NextResponse } from "next/server";
import { listUsers } from "@/lib/db";
import { runAutomationSweep } from "@/lib/automation";
import { runClientAutomation } from "@/lib/reminders";
import { ensureEngagementData } from "@/lib/engagements-db";

export const dynamic = "force-dynamic";

/**
 * Scheduled sweep — the unattended half of the automation layer.
 *
 * Deployments point a cron at this URL (see `vercel.json`). It runs every
 * enabled rule whose cadence window has elapsed and records each run.
 *
 * Authorisation, strongest first:
 *   - `Authorization: Bearer $CRON_SECRET` (Vercel forwards this automatically
 *     for cron invocations once the variable is set) or `?key=$CRON_SECRET`;
 *   - Vercel's own cron markers: the `x-vercel-cron` header, or the
 *     `vercel-cron` user agent.
 *
 * A sweep is cadence-gated, so even a spoofed trigger cannot do more than run
 * the rules the firm already switched on, earlier than their own window — and
 * every run is audited. Nothing here writes to a client without a rule.
 */
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
    // The sweep needs an actor for the audit trail; the partner account owns it.
    const users = listUsers();
    const actor = users.find((u) => u.role === "partner") ?? users[0];
    if (!actor) {
      return NextResponse.json({ error: "No user account exists yet — complete first-run setup" }, { status: 503 });
    }

    ensureEngagementData();
    const result = runAutomationSweep({ user: actor, actorLabel: "Scheduled sweep" });
    const client = await runClientAutomation({ actor: "Scheduled sweep", role: "system" });
    return NextResponse.json({
      ok: true,
      considered: result.considered,
      actions: result.actions + client.messages_queued + client.messages_sent + client.invoices_created,
      summary: `${result.summary} · Client cycles: ${client.messages_queued + client.messages_sent} message(s), ${client.invoices_created} invoice(s).`,
      runs: result.runs.map((r) => ({ rule: r.rule_name, status: r.status, summary: r.summary })),
      client_engine: client,
    });
  } catch (err) {
    return NextResponse.json({ error: `Sweep failed: ${(err as Error).message}` }, { status: 500 });
  }
}
