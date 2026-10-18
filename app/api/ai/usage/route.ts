import { listAiActions } from "@/lib/db";
import { usageSnapshot } from "@/lib/ai-agent";
import { getSessionUser } from "@/lib/auth";
import { handle, ok } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Quota, provider disclosure, recent audit trail and pending proposals. */
export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) return ok({ error: "Sign in required" }, 401);
    const snapshot = usageSnapshot(user);
    return ok({
      ...snapshot,
      actions: listAiActions(user.user_id, 10),
    });
  } catch (err) {
    return handle(err);
  }
}