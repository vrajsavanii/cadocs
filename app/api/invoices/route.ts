import { createInvoice, getClient, listInvoices } from "@/lib/db";
import { addDays, date, fail, handle, num, ok, readBody, str, today } from "@/lib/api";

export const dynamic = "force-dynamic";

export function GET() {
  try {
    return ok(listInvoices());
  } catch (err) {
    return handle(err);
  }
}

export async function POST(req: Request) {
  try {
    const body = await readBody(req);
    const client = getClient(str(body.client_id, "Client"));
    if (!client) return fail("Client not found", 404);
    const invoiceDate = body.invoice_date ? date(body.invoice_date, "Invoice date") : today();
    const amount = num(body.amount, "Amount", { min: 1 });
    const gst = Math.round(amount * 0.18 * 100) / 100;
    const invoice = createInvoice({
      client_id: client.client_id,
      client_name: client.name,
      invoice_date: invoiceDate,
      due_date: body.due_date ? date(body.due_date, "Due date") : addDays(invoiceDate, 30),
      service_description: str(body.service_description, "Service description", { max: 200 }),
      amount,
      gst_amount: gst,
      total_amount: amount + gst,
      status: "Pending",
      paid_date: null,
    });
    return ok(invoice, 201);
  } catch (err) {
    return handle(err);
  }
}
