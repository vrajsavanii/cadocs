import { getSessionUser } from "@/lib/auth";
import { billingBacklog, billingFlags, invoiceCompletedCycles } from "@/lib/billing";
import { fail, handle, ok, readBody } from "@/lib/api";

export const dynamic = "force-dynamic";

export function GET() {
  try {
    return ok({ ...billingBacklog(), flags: billingFlags() });
  } catch (err) {
    return handle(err);
  }
}

/**
 * The sweep drafts invoices for completed, unbilled cycles. Despite the
 * route's legacy name it no longer SENDS anything: issuance + WhatsApp
 * delivery are explicit, permissioned steps in the billing engine.
 */
export async function POST(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return fail("Sign in required", 401);
    if (user.role === "article") return fail("Only a manager or partner can run billing generation", 403);
    const body = await readBody(req);
    const result = await invoiceCompletedCycles(user.name, { dryRun: Boolean(body.dry_run) });
    return ok({ ...result, backlog: billingBacklog() });
  } catch (err) {
    return handle(err);
  }
}
