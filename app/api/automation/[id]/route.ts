import { getSessionUser } from "@/lib/auth";
import { deleteAutomationRule, getAutomationRule, updateAutomationRule } from "@/lib/db";
import { fail, handle, ok, readBody, str } from "@/lib/api";
import { sanitizeParams } from "@/lib/automation";
import type { AutomationCadence, AutomationMode } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Update a rule: pause/resume, switch mode, or change its parameters. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser();
    if (!user) return ok({ error: "Sign in required" }, 401);
    if (user.role === "article") return ok({ error: "Only a partner or manager can configure automation" }, 403);

    const { id } = await ctx.params;
    const existing = getAutomationRule(id);
    if (!existing) return fail("Rule not found", 404);

    const body = await readBody(req);
    const patch: Parameters<typeof updateAutomationRule>[1] = {};

    if (body.enabled !== undefined) patch.enabled = body.enabled === true || body.enabled === 1 || body.enabled === "1";
    if (body.mode !== undefined) patch.mode = str(body.mode, "Mode", { max: 20 }) as AutomationMode;
    if (body.cadence !== undefined) patch.cadence = str(body.cadence, "Cadence", { max: 20 }) as AutomationCadence;
    if (body.name !== undefined) patch.name = str(body.name, "Name", { max: 120 });
    if (body.params !== undefined) patch.params = sanitizeParams(existing.action, body.params);

    if (patch.mode && !["auto", "approval"].includes(patch.mode)) return fail("Mode must be auto or approval", 400);
    if (patch.cadence && !["daily", "weekly", "monthly"].includes(patch.cadence)) return fail("Cadence must be daily, weekly or monthly", 400);

    const rule = updateAutomationRule(id, patch);
    if (!rule) return fail("Could not update the rule", 500);
    return ok({ rule });
  } catch (err) {
    return handle(err);
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser();
    if (!user) return ok({ error: "Sign in required" }, 401);
    if (user.role === "article") return ok({ error: "Only a partner or manager can configure automation" }, 403);
    const { id } = await ctx.params;
    if (!deleteAutomationRule(id)) return fail("Rule not found", 404);
    return ok({ status: "deleted" });
  } catch (err) {
    return handle(err);
  }
}
