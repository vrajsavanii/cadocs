import { NextResponse } from "next/server";
import { listUsers } from "@/lib/db";
import { runAutomationSweep } from "@/lib/automation";
import { runClientAutomation } from "@/lib/reminders";
import { ensureEngagementData } from "@/lib/engagements-db";
import { isCronAuthorized, CRON_UNAUTHORIZED_MESSAGE } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";

/**
 * Scheduled sweep — the unattended half of the automation layer.
 *
 * Deployments point a cron at this URL (see `vercel.json`). It runs every
 * enabled rule whose cadence window has elapsed and records each run.
 *
 * Authorisation is strict: `Authorization: Bearer $CRON_SECRET`, which Vercel
 * forwards for cron invocations once the variable is set. Header/user-agent
 * fallbacks were removed after the V1 audit (DEF-001) — both are spoofable
 * from the open internet.
 *
 * The sweep is cadence-gated and every run is audited, but the endpoint still
 * mutates state, so it authorises only with the configured secret.
 */

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json(
      { error: CRON_UNAUTHORIZED_MESSAGE },
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
