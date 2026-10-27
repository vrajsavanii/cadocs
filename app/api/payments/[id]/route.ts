import { getSessionUser } from "@/lib/auth";
import { fail, handle, ok, readBody, str } from "@/lib/api";
import { actorFrom, notSignedIn } from "@/lib/billing-actor";
import { getInvoice, listPayments } from "@/lib/db";
import { reconcilePaymentEntry, reversePaymentEntry } from "@/lib/invoicing";

export const dynamic = "force-dynamic";

export function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    return ok(listPayments());
  } catch (err) {
    return handle(err);
  }
}

/**
 * Ledger corrections, never edits:
 *  - reconcile: "Pending reconciliation" → "Confirmed" (manager+).
 *  - reverse:   partner-only reversing entry with a mandatory reason; both the
 *               original payment and the reversal row are preserved.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser();
    if (!user) return notSignedIn();
    const { id } = await ctx.params;
    const body = await readBody(req);
    const action = str(body.action, "action", { max: 30 });
    if (action === "reconcile") {
      return ok({ payment: reconcilePaymentEntry(id, actorFrom(user)) });
    }
    if (action === "reverse") {
      const payment = reversePaymentEntry(id, actorFrom(user), str(body.reason, "reason", { max: 300 }));
      return ok({ payment, invoice: getInvoice(payment.invoice_id) });
    }
    return fail(`Unknown action "${action}" — use "reconcile" or "reverse"`, 400);
  } catch (err) {
    return handle(err);
  }
}
