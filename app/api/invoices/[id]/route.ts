import { getInvoice, listPaymentsForInvoice, updateInvoiceStatus } from "@/lib/db";
import { fail, handle, ok, pick, readBody } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const invoice = getInvoice(id);
    if (!invoice) return fail("Invoice not found", 404);
    return ok({ invoice, payments: listPaymentsForInvoice(id) });
  } catch (err) {
    return handle(err);
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const body = await readBody(req);
    const status = pick(body.status, ["Pending", "Paid", "Cancelled"] as const, "Status");
    const updated = updateInvoiceStatus(id, status);
    if (!updated) return fail("Invoice not found", 404);
    return ok(updated);
  } catch (err) {
    return handle(err);
  }
}
