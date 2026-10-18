import { createNotice, listNotices } from "@/lib/db";
import { date, handle, num, ok, pick, readBody, str, today } from "@/lib/api";
import type { Notice } from "@/lib/types";

export const dynamic = "force-dynamic";

export function GET() {
  try {
    return ok(listNotices());
  } catch (err) {
    return handle(err);
  }
}

export async function POST(req: Request) {
  try {
    const body = await readBody(req);
    const item = createNotice({
      client_name: str(body.client_name, "Client", { max: 140 }),
      notice_type: str(body.notice_type, "Notice type", { max: 160 }),
      portal: str(body.portal, "Portal", { optional: true, max: 40 }) || "GST",
      notice_date: body.notice_date ? date(body.notice_date, "Notice date") : today(),
      response_deadline: date(body.response_deadline, "Response deadline"),
      reference_number: str(body.reference_number, "Reference number", { optional: true, max: 80 }),
      amount: num(body.amount, "Amount in dispute", { optional: true, min: 0 }),
      status: pick<Notice["status"]>(body.status, ["Open", "Response Filed", "Closed", "Escalated"], "Status", "Open"),
      notes: str(body.notes, "Notes", { optional: true, max: 400 }),
    });
    return ok(item, 201);
  } catch (err) {
    return handle(err);
  }
}
