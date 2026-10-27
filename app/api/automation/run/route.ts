import { getSessionUser } from "@/lib/auth";
import { runAutomationSweep } from "@/lib/automation";
import { listAutomationRules } from "@/lib/db";
import { handle, ok, readBody } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Runs the sweep now.
 *
 *   - `{ }`                      → every enabled rule that is due (the cron path)
 *   - `{ include_not_due: true }` → every enabled rule, ignoring the cadence
 *   - `{ rule_ids: ["AUTO-002"] }` → exactly those rules, even if paused
 *   - `{ dry_run: true }`         → preview only; nothing is written
 */
export async function POST(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return ok({ error: "Sign in required" }, 401);
    if (user.role === "article") return ok({ error: "Only a partner or manager can run automation" }, 403);

    const body = await readBody(req).catch(() => ({}) as Record<string, unknown>);
    const ruleIds = Array.isArray(body.rule_ids) ? (body.rule_ids as unknown[]).map(String).slice(0, 50) : undefined;
    if (ruleIds?.length) {
      const known = new Set(listAutomationRules().map((r) => r.rule_id));
      const unknown = ruleIds.filter((id) => !known.has(id));
      if (unknown.length) return ok({ error: `Unknown rule(s): ${unknown.join(", ")}` }, 400);
    }

    const result = runAutomationSweep({
      user,
      ruleIds,
      includeNotDue: body.include_not_due === true,
      dryRun: body.dry_run === true,
      actorLabel: body.dry_run === true ? `${user.name} (preview)` : user.name,
    });
    return ok(result);
  } catch (err) {
    return handle(err);
  }
}
