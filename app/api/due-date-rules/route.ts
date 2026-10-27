import { getSessionUser } from "@/lib/auth";
import { createDueRuleVersion, DueRuleError, listDueRules } from "@/lib/due-dates";
import { fail, handle, ok, readBody, str } from "@/lib/api";
import type { ServiceFrequency } from "@/lib/types";

export const dynamic = "force-dynamic";

const FREQUENCIES: ServiceFrequency[] = ["monthly", "quarterly", "half_yearly", "annual", "one_time"];

export async function GET(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return fail("Sign in required", 401);
    const service = new URL(req.url).searchParams.get("service_code") || undefined;
    return ok({ rules: listDueRules(service), note: "Unverified rules supply internal targets only; they are never shown as statutory deadlines." });
  } catch (err) {
    return handle(err);
  }
}

export async function POST(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return fail("Sign in required", 401);
    if (user.role !== "partner") return fail("Only a partner can version or verify due-date rules", 403);
    const body = await readBody(req);
    const frequency = String(body.frequency || "");
    if (!FREQUENCIES.includes(frequency as ServiceFrequency)) {
      return fail(`"frequency" must be one of: ${FREQUENCIES.join(", ")}`, 400);
    }
    const rule = createDueRuleVersion(
      {
        service_code: str(body.service_code, "Service code", { max: 60 }),
        frequency: frequency as ServiceFrequency,
        effective_from: str(body.effective_from, "Effective from", { max: 10 }),
        effective_to: typeof body.effective_to === "string" ? body.effective_to : undefined,
        due_month_offset: Number(body.due_month_offset),
        due_day: Number(body.due_day),
        internal_lead_days: Number(body.internal_lead_days) || 0,
        source: str(body.source, "Source", { max: 300 }),
        authority_reference: typeof body.authority_reference === "string" ? body.authority_reference : "",
        verification_status: body.verification_status === "verified" ? "verified" : "unverified",
        notes: typeof body.notes === "string" ? body.notes : "",
      },
      user.name,
    );
    return ok({ rule }, 201);
  } catch (err) {
    if (err instanceof DueRuleError) return fail(err.message, 400);
    return handle(err);
  }
}
