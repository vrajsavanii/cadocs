import { getSessionUser } from "@/lib/auth";
import { fail, handle, ok } from "@/lib/api";
import { receivablesReport } from "@/lib/invoicing";

export const dynamic = "force-dynamic";

/**
 * Accounts-receivables report scoped to the firm. Query filters: client_id,
 * fy, service_code. Every invoice row carries its own aging bucket (computed
 * from the due date); aggregates are firm-wide, never user-personal.
 */
export async function GET(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user || user.role === "article") return fail("Only a manager or partner can view receivables", 403);
    const url = new URL(req.url);
    const client_id = url.searchParams.get("client_id") || undefined;
    const fy = url.searchParams.get("fy") || undefined;
    const service_code = url.searchParams.get("service_code") || undefined;
    return ok(receivablesReport({ client_id, fy, service_code }));
  } catch (err) {
    return handle(err);
  }
}
