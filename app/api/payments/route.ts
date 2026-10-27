import { recordPaymentEntry } from "@/lib/invoicing";
import { getInvoice, listPayments } from "@/lib/db";
import { date, fail, handle, num, ok, pick, readBody, str, today } from "@/lib/api";
import { actorFrom, notSignedIn } from "@/lib/billing-actor";
import { getSessionUser } from "@/lib/auth";
import type { Payment } from "@/lib/types";

export const dynamic = "force-dynamic";

export function GET() {
  try {
    return ok(listPayments());
  } catch (err) {
    return handle(err);
  }
}

/**
 * Manual payment recording through the payment ledger. The engine validates
 * the amount rules, the freshness of the invoice and the balance inside a
 * transaction; statuses stay ledger-derived. A duplicate event_id or a
 * reference already recorded returns 409.
 */
export async function POST(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return notSignedIn();
    const body = await readBody(req);
    const invoiceId = str(body.invoice_id, "Invoice", { max: 40 });
    const invoice = getInvoice(invoiceId);
    if (!invoice) return fail("Invoice not found", 404);

    const result = recordPaymentEntry(
      invoiceId,
      {
        amount: num(body.amount, "Amount", { max: 50_000_000 }),
        paid_on: body.paid_on ? date(body.paid_on, "Payment date") : today(),
        mode: pick(body.mode, ["UPI", "Bank Transfer", "Cash", "Cheque", "Card", "Other"] as const, "Mode", "Bank Transfer") as Payment["mode"],
        reference: str(body.reference, "Reference", { optional: true, max: 80 }),
        notes: str(body.notes, "Notes", { optional: true, max: 300 }),
      },
      actorFrom(user),
    );
    const refreshed = getInvoice(invoiceId);
    return ok({ payment: result.payment, invoice: refreshed ?? result.invoice }, 201);
  } catch (err) {
    return handle(err);
  }
}
