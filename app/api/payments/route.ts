import { getInvoice, listPayments, recordPayment } from "@/lib/db";
import { date, fail, handle, num, ok, pick, readBody, str, today } from "@/lib/api";
import type { Payment } from "@/lib/types";

export const dynamic = "force-dynamic";

export function GET() {
  try {
    return ok(listPayments());
  } catch (err) {
    return handle(err);
  }
}

export async function POST(req: Request) {
  try {
    const body = await readBody(req);
    const invoiceId = str(body.invoice_id, "Invoice", { max: 40 });
    const invoice = getInvoice(invoiceId);
    if (!invoice) return fail("Invoice not found", 404);
    if (invoice.status === "Cancelled") return fail("This invoice is cancelled", 409);

    const balance = Math.round((invoice.total_amount - invoice.paid_amount) * 100) / 100;
    if (balance <= 0) return fail("This invoice is already fully paid", 409);
    const amount = Math.round(num(body.amount, "Amount", { min: 0.01 }) * 100) / 100;
    if (amount > balance) return fail(`Amount exceeds the outstanding balance of ₹${balance}`, 400);

    const payment = recordPayment(invoiceId, {
      amount,
      paid_on: body.paid_on ? date(body.paid_on, "Payment date") : today(),
      mode: pick(body.mode, ["UPI", "Bank Transfer", "Cash", "Cheque", "Card", "Other"] as const, "Mode", "Bank Transfer") as Payment["mode"],
      reference: str(body.reference, "Reference", { optional: true, max: 80 }),
      notes: str(body.notes, "Notes", { optional: true, max: 200 }),
    });
    if (!payment) return fail("Could not record the payment", 400);
    return ok({ payment, invoice: getInvoice(invoiceId) }, 201);
  } catch (err) {
    return handle(err);
  }
}
