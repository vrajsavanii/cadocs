import { getSessionUser } from "@/lib/auth";
import { listGenerationRuns } from "@/lib/engagement-engine";
import { fail, handle, ok } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return fail("Sign in required", 401);
    if (user.role !== "partner" && user.role !== "manager") {
      return fail("Only a manager or partner can view generation runs", 403);
    }
    const limit = Number(new URL(req.url).searchParams.get("limit")) || 20;
    return ok({ runs: listGenerationRuns(limit) });
  } catch (err) {
    return handle(err);
  }
}
