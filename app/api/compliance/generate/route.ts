import { generateCompliance, listClients } from "@/lib/db";
import { date, fail, handle, ok, readBody, str } from "@/lib/api";

export const dynamic = "force-dynamic";

const TEMPLATES = new Set([
  "GST Filing (GSTR-1)",
  "GST Filing (GSTR-3B)",
  "GST Filing (GSTR-9)",
  "TDS Payment (26Q)",
  "TDS Return (24Q)",
  "ITR Filing",
  "Tax Audit Report",
  "ROC Annual Filing (AOC-4)",
  "ROC Annual Filing (MGT-7)",
  "Trust Audit",
  "Statutory Audit",
]);

export async function POST(req: Request) {
  try {
    const body = await readBody(req);
    const complianceType = str(body.compliance_type, "Task type", { max: 80 });
    if (!TEMPLATES.has(complianceType)) return fail("Choose a valid compliance template", 400);

    const ids = Array.isArray(body.client_ids) ? body.client_ids.map((id) => String(id)).slice(0, 200) : [];
    const clients = listClients();
    const clientIds = body.all_clients === true ? clients.map((c) => c.client_id) : ids;
    if (clientIds.length === 0) return fail("Select at least one client", 400);

    const result = generateCompliance({
      compliance_type: complianceType,
      period: str(body.period, "Period", { max: 60 }),
      due_date: date(body.due_date, "Due date"),
      assigned_to: str(body.assigned_to, "Assigned to", { optional: true, max: 80 }),
      client_ids: clientIds,
    });
    return ok(result, 201);
  } catch (err) {
    return handle(err);
  }
}
