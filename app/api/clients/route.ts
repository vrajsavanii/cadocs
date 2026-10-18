import { createClient, listClients } from "@/lib/db";
import { fail, handle, ok, readBody, str } from "@/lib/api";

export const dynamic = "force-dynamic";

export function GET() {
  try {
    return ok(listClients());
  } catch (err) {
    return handle(err);
  }
}

export async function POST(req: Request) {
  try {
    const body = await readBody(req);
    const name = str(body.name, "Client name", { max: 120 });
    const phone = str(body.phone, "Phone (WhatsApp)", { max: 20 }).replace(/\D/g, "");
    if (phone.length < 10) return fail("Phone must contain at least 10 digits");

    const client = createClient({
      name,
      contact_person: str(body.contact_person, "Contact person", { optional: true, max: 120 }) || name,
      phone,
      email: str(body.email, "Email", { optional: true, max: 160 }),
      entity_type: str(body.entity_type, "Entity type", { optional: true }) || "Private Limited",
      gst_number: str(body.gst_number, "GSTIN", { optional: true, max: 20 }).toUpperCase(),
      pan: str(body.pan, "PAN", { optional: true, max: 12 }).toUpperCase(),
      services_opted: str(body.services_opted, "Services", { optional: true, max: 200 }) || "GST Filing, ITR",
      city: str(body.city, "City", { optional: true, max: 80 }) || "Mumbai",
      state: str(body.state, "State", { optional: true, max: 80 }) || "Maharashtra",
    });
    return ok(client, 201);
  } catch (err) {
    return handle(err);
  }
}
