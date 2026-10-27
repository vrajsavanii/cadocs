import { getSessionUser } from "@/lib/auth";
import {
  advanceTask,
  assignTask,
  getTaskDetail,
  overrideInternalTarget,
  overrideStatutoryDate,
  recordFilingEvidence,
  StaleWorkflowError,
} from "@/lib/workflow";
import { BlockerError, createBlocker, listBlockers, reopenBlocker, resolveBlocker } from "@/lib/blockers";
import { date, fail, handle, ok, pick, readBody, str } from "@/lib/api";
import type { WorkStage } from "@/lib/types";

export const dynamic = "force-dynamic";

const STAGES = ["documents", "preparation", "review", "filing", "signoff", "done"] as const;

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser();
    if (!user) return fail("Sign in required", 401);
    const { id } = await ctx.params;
    const detail = getTaskDetail(id, user);
    if (!detail) return fail("Engagement not found", 404);
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
        typeof body.reason === "string" ? body.reason : "",
      );
      return ok({ task, detail: getTaskDetail(id, user) });
    }

    if (action === "blocker_open") {
      const blocker = createBlocker({
        complianceId: id,
        category: str(body.category, "Blocker category", { max: 60 }),
        description: str(body.description, "Blocker description", { max: 500 }),
        owner: typeof body.owner === "string" ? body.owner : undefined,
        blocksProgress: body.blocks_progress === false ? false : true,
        user,
      });
      return ok({ blocker, blockers: listBlockers({ complianceId: id }), detail: getTaskDetail(id, user) });
    }

    if (action === "blocker_resolve") {
      const blocker = resolveBlocker({
        blockerId: str(body.blocker_id, "Blocker", { max: 60 }),
        resolutionNote: typeof body.resolution_note === "string" ? body.resolution_note : "",
        user,
      });
      return ok({ blocker, blockers: listBlockers({ complianceId: id }), detail: getTaskDetail(id, user) });
    }

    if (action === "blocker_reopen") {
      const blocker = reopenBlocker({
        blockerId: str(body.blocker_id, "Blocker", { max: 60 }),
        reason: str(body.reason, "Reopen reason", { max: 300 }),
        user,
      });
      return ok({ blocker, blockers: listBlockers({ complianceId: id }), detail: getTaskDetail(id, user) });
    }

    if (action === "record_filing") {
      const task = recordFilingEvidence({
        complianceId: id,
        reference: str(body.reference, "Filing reference", { max: 120 }),
        filedOn: date(body.filed_on, "Filed on", { optional: true }) || undefined,
        note: str(body.note, "Note", { optional: true, max: 500 }),
        user,
      });
      return ok({ task, detail: getTaskDetail(id, user) });
    }

    if (action === "set_internal_target") {
      const task = overrideInternalTarget({
        complianceId: id,
        date: date(body.date, "Internal target date"),
        reason: str(body.reason, "Reason", { max: 300 }),
        user,
      });
      return ok({ task, detail: getTaskDetail(id, user) });
    }

    if (action === "override_statutory") {
      const task = overrideStatutoryDate({
        complianceId: id,
        date: date(body.date, "Statutory due date"),
        authorityReference: str(body.authority_reference, "Authority reference", { max: 200 }),
        reason: str(body.reason, "Reason", { max: 300 }),
        user,
      });
      return ok({ task, detail: getTaskDetail(id, user) });
    }

    if (action !== "advance") return fail("Unknown engagement action", 400);
    const target = pick<WorkStage>(body.target, STAGES, "Target stage");
    const result = await advanceTask({
      complianceId: id,
      target,
      user,
      note: typeof body.note === "string" ? body.note : "",
      ackNumber: typeof body.ack_number === "string" ? body.ack_number : "",
      expectedStageUpdatedAt:
        typeof body.expected_stage_updated_at === "string" ? body.expected_stage_updated_at : undefined,
    });
    return ok({ ...result, detail: getTaskDetail(id, user) });
  } catch (err) {
    if (err instanceof StaleWorkflowError) return fail(err.message, 409);
    if (err instanceof BlockerError) return fail(err.message, err.status);
    if (err instanceof Error && !("status" in err)) return fail(err.message, 400);
    return handle(err);
  }
}
