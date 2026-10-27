import { getSessionUser } from "@/lib/auth";
import { ensureEngagementData } from "@/lib/engagements-db";
import { buildWorkflow } from "@/lib/workflow";
import { fail, handle, ok } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    ensureEngagementData();
    const user = await getSessionUser();
    if (!user) return fail("Sign in required", 401);
    return ok(buildWorkflow(user));
  } catch (err) {
    return handle(err);
  }
}
