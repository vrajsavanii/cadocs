import { createCompliance, getClient, listCompliance } from "@/lib/db";
import { date, fail, handle, ok, pick, readBody, str } from "@/lib/api";
import type { Compliance } from "@/lib/types";

export const dynamic = "force-dynamic";

export function GET() {
  try {
    return ok(listCompliance());
  } catch (err) {
    return handle(err);
  }
}

export async function POST(req: Request) {
  try {
    const body = await readBody(req);
    const client = getClient(str(body.client_id, "Client"));
    if (!client) return fail("Client not found", 404);
    const item = createCompliance({
      client_id: client.client_id,
      client_name: client.name,
      compliance_type: str(body.compliance_type, "Compliance type", { max: 120 }),
      period: str(body.period, "Period", { optional: true, max: 60 }) || "Current",
      due_date: date(body.due_date, "Due date"),
      status: pick<Compliance["status"]>(body.status, ["Pending", "In Progress", "Filed", "Overdue"], "Status", "Pending"),
      filed_date: null,
      ack_number: null,
      assigned_to: str(body.assigned_to, "Assigned to", { optional: true, max: 80 }) || client.contact_person,
      notes: str(body.notes, "Notes", { optional: true, max: 300 }),
    });
    return ok(item, 201);
  } catch (err) {
    return handle(err);
  }
}
