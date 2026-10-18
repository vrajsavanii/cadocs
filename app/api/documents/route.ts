import { createDocument, getClient, listDocuments } from "@/lib/db";
import { date, fail, handle, ok, readBody, str, today } from "@/lib/api";

export const dynamic = "force-dynamic";

export function GET() {
  try {
    return ok(listDocuments());
  } catch (err) {
    return handle(err);
  }
}

export async function POST(req: Request) {
  try {
    const body = await readBody(req);
    const client = getClient(str(body.client_id, "Client"));
    if (!client) return fail("Client not found", 404);
    const doc = createDocument({
      client_id: client.client_id,
      client_name: client.name,
      document_name: str(body.document_name, "Document name", { max: 160 }),
      status: "Pending",
      requested_date: body.requested_date ? date(body.requested_date, "Requested date") : today(),
      received_date: null,
      notes: str(body.notes, "Notes", { optional: true, max: 300 }),
    });
    return ok(doc, 201);
  } catch (err) {
    return handle(err);
  }
}
