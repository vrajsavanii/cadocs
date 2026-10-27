import { createDraftInvoice, getInvoiceDetail, listTaxTreatments } from "@/lib/invoicing";
import { date, fail, handle, num, ok, pick, readBody, str, today } from "@/lib/api";
import { actorFrom, notSignedIn } from "@/lib/billing-actor";
import { getSessionUser } from "@/lib/auth";
import { listInvoices } from "@/lib/db";
import type { DraftLineInput } from "@/lib/invoicing";

export const dynamic = "force-dynamic";

export function GET() {
  try {
    return ok(listInvoices());
  } catch (err) {
    return handle(err);
  }
}

function normaliseLine(raw: unknown, index: number): DraftLineInput {
  const line = (raw ?? {}) as Record<string, unknown>;
  return {
    description: str(line.description, `Line ${index + 1} description`, { max: 300 }),
    quantity: num(line.quantity, `Line ${index + 1} quantity`, { min: 1, max: 100_000 }),
    unit_price: num(line.unit_price, `Line ${index + 1} unit price`, { max: 50_000_000 }),
    discount: num(line.discount, `Line ${index + 1} discount`, { optional: true, min: 0, max: 50_000_000 }),
    treatment_id:
      listTaxTreatments().some((t) => t.treatment_id === line.treatment_id)
        ? str(line.treatment_id, "Treatment id", { max: 60 })
        : "",
  };
}

/**
 * Manual draft creation. The human number is NOT allocated here — it is
 * assigned only at issuance, inside the finalisation transaction.
 */
export async function POST(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return notSignedIn();
    const body = await readBody(req);
    const clientId = str(body.client_id, "Client", { max: 40 });
    const rawLines = Array.isArray(body.lines) ? body.lines : [];
    const lines = rawLines.slice(0, 50).map((line: unknown, index: number) => normaliseLine(line, index));
    const result = createDraftInvoice(
      {
        client_id: clientId,
        lines,
        invoice_date: body.invoice_date ? date(body.invoice_date, "Invoice date") : today(),
        due_date: body.due_date ? date(body.due_date, "Due date", { optional: true }) : undefined,
        notes: str(body.notes, "Notes", { optional: true, max: 500 }),
        service_id: str(body.service_id, "Service", { optional: true, max: 40 }),
        period: str(body.period, "Period", { optional: true, max: 60 }),
        auto_generated: false,
      },
      actorFrom(user),
    );
    if (!result.created) return ok(result.invoice, 200);
    return await withDetail(result.invoice.invoice_id, 201);
  } catch (err) {
    return handle(err);
  }
}

async function withDetail(invoiceId: string, status: number) {
  return ok(getInvoiceDetail(invoiceId), status);
}
