import { getSessionUser } from "@/lib/auth";
import { automationActivity, listAutomationRuns } from "@/lib/db";
import { handle, ok } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Run history — what automation did, with the records it created. */
export async function GET(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return ok({ error: "Sign in required" }, 401);
    const limit = Math.min(100, Math.max(1, Number(new URL(req.url).searchParams.get("limit") ?? 25) || 25));
    return ok({ runs: listAutomationRuns(limit), activity: automationActivity(7) });
  } catch (err) {
    return handle(err);
  }
}
