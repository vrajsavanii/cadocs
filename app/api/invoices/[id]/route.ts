import { getInvoiceDetail, deliverIssuedInvoice } from "@/lib/invoicing";
import { fail, handle, ok, readBody, str } from "@/lib/api";
import { getSessionUser } from "@/lib/auth";
import { actorFrom, notSignedIn } from "@/lib/billing-actor";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser();
    if (!user) return fail("Sign in required", 401);
    const { id } = await ctx.params;
    const detail = getInvoiceDetail(id);
    if (!detail) return fail("Invoice not found", 404);
    return ok(detail);
  } catch (err) {
    return handle(err);
  }
}

/**
 * The only Patch action supported on an invoice is an authorized WhatsApp
 * delivery retry of an ISSUED invoice. Structural edits go through the
 * lifecycle routes (draft PATCH / approve / issue / credit / cancel), never
 * through this endpoint — a finalized invoice is immutable here.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser();
    if (!user) return notSignedIn();
    const { id } = await ctx.params;
    const body = await readBody(req);
    const action = str(body.action, "action", { max: 40 });
    if (action !== "deliver") return fail(`Unknown action "${action}" — did you mean "deliver"?`, 400);
    const result = await deliverIssuedInvoice(id, actorFrom(user));
    if (result === "skipped") return fail("Delivery skipped: the invoice is not issued, delivery is disabled, or the client is not WhatsApp-eligible", 409);
    return ok({ invoice_id: id, delivery: result });
  } catch (err) {
    return handle(err);
  }
}
