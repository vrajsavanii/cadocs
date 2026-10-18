import { createDsc, listDsc } from "@/lib/db";
import { date, handle, ok, readBody, str, today } from "@/lib/api";

export const dynamic = "force-dynamic";

export function GET() {
  try {
    return ok(listDsc());
  } catch (err) {
    return handle(err);
  }
}

export async function POST(req: Request) {
  try {
    const body = await readBody(req);
    const item = createDsc({
      client_name: str(body.client_name, "Client", { max: 140 }),
      holder_name: str(body.holder_name, "DSC holder", { max: 140 }),
      class_type: str(body.class_type, "Class", { optional: true, max: 40 }) || "Class 3 Signing",
      valid_from: body.valid_from ? date(body.valid_from, "Valid from") : today(),
      valid_until: date(body.valid_until, "Valid until"),
      token_serial: str(body.token_serial, "Token serial", { optional: true, max: 40 }) || `TOK-${Date.now().toString().slice(-6)}`,
      status: "Active",
    });
    return ok(item, 201);
  } catch (err) {
    return handle(err);
  }
}
