import { handle, ok, readBody, pick, str } from "@/lib/api";
import { getSessionUser } from "@/lib/auth";
import { AiQuotaError, runAssist } from "@/lib/ai-agent";
import { ASSIST_TASKS, type AssistTask } from "@/lib/ai-prompts";
import { rateLimit } from "@/lib/crypto";

export const dynamic = "force-dynamic";

/** Predefined module assists: client summary, week plan, collections, utilization, notice draft. */
export async function POST(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return ok({ error: "Sign in required" }, 401);

    const limited = rateLimit(`assist:${user.user_id}`, 20, 60_000);
    if (!limited.ok) return ok({ error: `Slow down — retry in ${limited.retryAfterSec}s` }, 429);

    const body = await readBody(req);
    const task = pick(body.task, ASSIST_TASKS, "Task") as AssistTask;
    const id = str(body.id, "Record id", { optional: true, max: 40 });

    if (task === "client_summary" && !id) return ok({ error: "client_summary needs a client id" }, 400);
    if (task === "notice_draft" && !id) return ok({ error: "notice_draft needs a notice id" }, 400);

    const result = await runAssist({ user, task, id: id || undefined });
    return ok(result);
  } catch (err) {
    if (err instanceof AiQuotaError) return ok({ error: err.message }, 429);
    return handle(err);
  }
}