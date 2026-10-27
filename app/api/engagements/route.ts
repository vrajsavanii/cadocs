import { getSessionUser } from "@/lib/auth";
import { queryEngagements } from "@/lib/engagement-queries";
import { fail, handle, ok } from "@/lib/api";

export const dynamic = "force-dynamic";

function flag(value: string | null): boolean {
  return value === "1" || value === "true" || value === "yes";
}

export async function GET(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return fail("Sign in required", 401);
    const params = new URL(req.url).searchParams;
    const statutory = params.get("statutory");
    const result = queryEngagements(user, {
      client_id: params.get("client_id") || undefined,
      service_code: params.get("service_code") || undefined,
      registration_id: params.get("registration_id") || undefined,
      preparer: params.get("preparer") || undefined,
      reviewer: params.get("reviewer") || undefined,
      status: params.get("status") || undefined,
      stage: params.get("stage") || undefined,
      line: params.get("line") || undefined,
      from: params.get("from") || undefined,
      to: params.get("to") || undefined,
      overdue: flag(params.get("overdue")),
      missing_assignment: flag(params.get("missing_assignment")),
      statutory: statutory === "verified" || statutory === "unverified" || statutory === "conflicting" || statutory === "missing" ? statutory : undefined,
      q: params.get("q") || undefined,
      page: Number(params.get("page")) || 1,
      pageSize: Number(params.get("pageSize") || params.get("page_size")) || 25,
    });
    return ok(result);
  } catch (err) {
    return handle(err);
  }
}
