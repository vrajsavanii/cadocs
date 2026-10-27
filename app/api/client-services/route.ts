import { fail, handle, ok, readBody, str } from "@/lib/api";
import { getSessionUser } from "@/lib/auth";
import { ensureEngagementData, listClientServices } from "@/lib/engagements-db";
import { OnboardingError, addService, canManageOnboarding } from "@/lib/onboarding";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return fail("Sign in required", 401);
    ensureEngagementData();
    const clientId = new URL(req.url).searchParams.get("client_id") ?? undefined;
    return ok(listClientServices(clientId));
  } catch (err) {
    return handle(err);
  }
}

export async function POST(req: Request) {
  try {
    ensureEngagementData();
    const user = await getSessionUser();
    if (!user) return fail("Sign in required", 401);
    if (!canManageOnboarding(user.role)) return fail("Only partners and managers can add services", 403);
    const body = await readBody(req);
    const result = addService({
      clientId: str(body.client_id, "Client", { max: 80 }),
      code: str(body.code, "Service code", { max: 40 }),
      registration_id: str(body.registration_id, "Registration", { optional: true, max: 80 }),
      frequency: str(body.frequency, "Frequency", { optional: true, max: 20 }),
      fee: body.fee === undefined || body.fee === "" ? undefined : Number(body.fee),
      owner: str(body.owner, "Preparer", { optional: true, max: 80 }),
      reviewer: str(body.reviewer, "Reviewer", { optional: true, max: 80 }),
      manager: str(body.manager, "Manager", { optional: true, max: 80 }),
      partner: str(body.partner, "Authorised CA", { optional: true, max: 80 }),
      auto_invoice: body.auto_invoice === undefined ? undefined : Boolean(body.auto_invoice),
      actor: user.name,
      idempotency_key: str(body.idempotency_key, "Idempotency key", { optional: true, max: 120 }),
    });
    return ok(result, 201);
  } catch (err) {
    if (err instanceof OnboardingError) return ok({ error: err.message, issues: err.issues }, 422);
    return handle(err);
  }
}
