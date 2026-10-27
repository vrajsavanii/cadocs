import { getSessionUser } from "@/lib/auth";
import { ensureEngagementData } from "@/lib/engagements-db";
import { engineStatus, getEngineConfig, runClientAutomation, saveEngineConfig } from "@/lib/reminders";
import { fail, handle, ok, readBody } from "@/lib/api";

export const dynamic = "force-dynamic";

export function GET() {
  try {
    ensureEngagementData();
    return ok(engineStatus());
  } catch (err) {
    return handle(err);
  }
}

export async function POST(req: Request) {
  try {
    ensureEngagementData();
    const user = await getSessionUser();
    if (!user) return fail("Sign in required", 401);
    if (user.role === "article") return fail("Only a manager or partner can run client automation", 403);
    const body = await readBody(req);
    const dryRun = Boolean(body.dry_run);
    const result = await runClientAutomation({ actor: user.name, role: user.role, dryRun });
    return ok({ ...result, status: engineStatus(), dry_run: dryRun });
  } catch (err) {
    return handle(err);
  }
}

export async function PATCH(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return fail("Sign in required", 401);
    if (user.role === "article") return fail("Only a manager or partner can change automation settings", 403);
    const body = await readBody(req);
    const config = saveEngineConfig(
      {
        reminder_cap: body.reminder_cap === undefined ? undefined : Number(body.reminder_cap),
        reminder_gap_days: body.reminder_gap_days === undefined ? undefined : Number(body.reminder_gap_days),
        auto_billing: body.auto_billing === undefined ? undefined : Boolean(body.auto_billing),
        invoice_due_days: body.invoice_due_days === undefined ? undefined : Number(body.invoice_due_days),
        gst_rate: body.gst_rate === undefined ? undefined : Number(body.gst_rate),
      },
      user.name,
    );
    return ok({ config, status: engineStatus() });
  } catch (err) {
    return handle(err);
  }
}
