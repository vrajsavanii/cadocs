import { createTimesheet, listTimesheets } from "@/lib/db";
import { date, handle, num, ok, readBody, str, today } from "@/lib/api";

export const dynamic = "force-dynamic";

export function GET() {
  try {
    return ok(listTimesheets());
  } catch (err) {
    return handle(err);
  }
}

export async function POST(req: Request) {
  try {
    const body = await readBody(req);
    const item = createTimesheet({
      user_name: str(body.user_name, "Staff member", { max: 100 }),
      client_name: str(body.client_name, "Client", { max: 140 }),
      date: body.date ? date(body.date, "Date") : today(),
      task_type: str(body.task_type, "Task type", { optional: true, max: 60 }) || "GST Filing",
      description: str(body.description, "Description", { optional: true, max: 300 }) || "Practice work",
      hours: num(body.hours, "Hours", { min: 0.25, max: 24 }),
      billable: body.billable === undefined ? true : Boolean(body.billable),
      status: "Pending",
    });
    return ok(item, 201);
  } catch (err) {
    return handle(err);
  }
}
