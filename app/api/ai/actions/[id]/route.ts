import { decideAiAction, getAiAction, logAiCall } from "@/lib/db";
import { getTool } from "@/lib/ai-tools";
import { pendingActionFor } from "@/lib/ai-agent";
import { getSessionUser } from "@/lib/auth";
import { handle, ok, readBody, pick } from "@/lib/api";
import { rateLimit } from "@/lib/crypto";

export const dynamic = "force-dynamic";

/**
 * Approve or reject a pending AI proposal.
 *
 * Approval re-runs every gate: ownership, pending status, current role, schema
 * validation and domain validation. The model's arguments are never trusted
 * just because the model produced them.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser();
    if (!user) return ok({ error: "Sign in required" }, 401);

    const { id } = await ctx.params;
    const limited = rateLimit(`ai-action:${user.user_id}`, 30, 60_000);
    if (!limited.ok) return ok({ error: "Too many requests" }, 429);

    const row = pendingActionFor(user, id);
    if (!row) return ok({ error: "Action not found" }, 404);
    if (row.status !== "pending") return ok({ error: `Action already ${row.status}` }, 409);

    const body = await readBody(req);
    const decision = pick(body.decision, ["approve", "reject"] as const, "Decision");

    if (decision === "reject") {
      decideAiAction(id, "rejected", "Rejected by the user");
      logAiCall({ user_id: user.user_id, action: "approval:reject", status: "rejected", detail: row.tool });
      return ok({ status: "rejected", message: "Nothing was written." });
    }

    const tool = getTool(row.tool);
    if (!tool || tool.kind !== "write") return ok({ error: "This action is no longer executable" }, 400);
    if (!tool.roles.includes(user.role)) {
      return ok({ error: `Your role (${user.role}) cannot execute this action` }, 403);
    }

    let args: Record<string, unknown>;
    try {
      args = tool.validate(JSON.parse(row.args || "{}"));
    } catch (err) {
      decideAiAction(id, "failed", `Validation failed: ${(err as Error).message}`);
      return ok({ error: `Validation failed: ${(err as Error).message}` }, 400);
    }

    try {
      const outcome = tool.execute(args, { user });
      decideAiAction(id, "executed", outcome.summary);
      logAiCall({
        user_id: user.user_id,
        action: "approval:execute",
        status: "ok",
        detail: `${tool.name} → ${outcome.summary}`.slice(0, 300),
        tool_names: [tool.name],
        tool_calls: 1,
      });
      return ok({ status: "executed", summary: outcome.summary });
    } catch (err) {
      decideAiAction(id, "failed", `Execution failed: ${(err as Error).message}`);
      return ok({ error: `Could not execute: ${(err as Error).message}` }, 400);
    }
  } catch (err) {
    return handle(err);
  }
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser();
    if (!user) return ok({ error: "Sign in required" }, 401);
    const { id } = await ctx.params;
    const row = pendingActionFor(user, id);
    if (!row) return ok({ error: "Action not found" }, 404);
    return ok({ action: row, args: JSON.parse(row.args || "{}") });
  } catch (err) {
    return handle(err);
  }
}