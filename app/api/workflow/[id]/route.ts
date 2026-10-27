import { getSessionUser } from "@/lib/auth";
import { advanceTask, assignTask, getTaskDetail } from "@/lib/workflow";
import { fail, handle, ok, pick, readBody } from "@/lib/api";
import type { WorkStage } from "@/lib/types";

export const dynamic = "force-dynamic";

const STAGES = ["documents", "preparation", "review", "filing", "signoff", "done"] as const;

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser();
    if (!user) return fail("Sign in required", 401);
    const { id } = await ctx.params;
    const detail = getTaskDetail(id, user);
    if (!detail) return fail("Filing not found", 404);
    return ok(detail);
  } catch (err) {
    return handle(err);
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser();
    if (!user) return fail("Sign in required", 401);
    const { id } = await ctx.params;
    const body = await readBody(req);
    const action = String(body.action || "advance");

    if (action === "assign") {
      const task = assignTask(
        id,
        {
          preparer: typeof body.preparer === "string" ? body.preparer : undefined,
          reviewer: typeof body.reviewer === "string" ? body.reviewer : undefined,
        },
        user,
      );
      return ok({ task, detail: getTaskDetail(id, user) });
    }

    if (action !== "advance") return fail("Unknown workflow action");
    const target = pick<WorkStage>(body.target, STAGES, "Target stage");
    const result = await advanceTask({
      complianceId: id,
      target,
      user,
      note: typeof body.note === "string" ? body.note : "",
      ackNumber: typeof body.ack_number === "string" ? body.ack_number : "",
    });
    return ok({ ...result, detail: getTaskDetail(id, user) });
  } catch (err) {
    if (err instanceof Error && !("status" in err)) return fail(err.message, 400);
    return handle(err);
  }
}
