import { createUdin, getSettings, getUdinByValue, listUdin } from "@/lib/db";
import { date, fail, handle, ok, readBody, str, today } from "@/lib/api";

export const dynamic = "force-dynamic";

export function GET() {
  try {
    return ok(listUdin());
  } catch (err) {
    return handle(err);
  }
}

export async function POST(req: Request) {
  try {
    const body = await readBody(req);
    const settings = getSettings();
    // UDINs are issued on the ICAI portal; the firm records the real number here.
    const udin = str(body.udin, "UDIN", { max: 24 }).toUpperCase().replace(/\s+/g, "");
    if (getUdinByValue(udin)) return fail(`${udin} is already recorded in the register`, 409);
    // New UDINs are 18 characters; 10–24 keeps imported legacy registers usable.
    if (!/^[A-Z0-9]{10,24}$/.test(udin)) return fail("UDIN must be the alphanumeric number issued by the ICAI portal");

    const item = createUdin({
      udin,
      client_name: str(body.client_name, "Client", { max: 140 }),
      document_type: str(body.document_type, "Document type", { max: 140 }),
      financial_year: str(body.financial_year, "Financial year", { optional: true, max: 20 }) || "FY 2025-26",
      generated_date: body.generated_date ? date(body.generated_date, "Generated date") : today(),
      ca_member_no: str(body.ca_member_no, "CA membership no.", { optional: true, max: 20 }) || settings.ca_member_no || "154789",
      notes: str(body.notes, "Notes", { optional: true, max: 300 }),
    });
    return ok(item, 201);
  } catch (err) {
    return handle(err);
  }
}
