import { fail, handle, ok, readBody, str } from "@/lib/api";
import { getSessionUser, isPartner } from "@/lib/auth";
import { OnboardingError, serviceCatalogue, updateCatalogueSetting } from "@/lib/onboarding";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) return fail("Sign in required", 401);
    return ok(serviceCatalogue());
  } catch (err) {
    return handle(err);
  }
}

export async function PATCH(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return fail("Sign in required", 401);
    if (!isPartner(user)) return fail("Only a partner can change the service catalogue", 403);
    const body = await readBody(req);
    const code = str(body.code, "Service code", { max: 40 });
    const entry = serviceCatalogue().find((item) => item.code === code);
    if (!entry) return fail("Unknown service code", 404);
    const frequency = body.default_frequency !== undefined ? str(body.default_frequency, "Default frequency", { max: 20 }) : undefined;
    if (frequency && !["monthly", "quarterly", "annual", "one_time"].includes(frequency)) {
      return fail("Default frequency must be monthly, quarterly, annual or one_time");
    }
    const fee = body.default_fee !== undefined ? Number(body.default_fee) : undefined;
    if (fee !== undefined && (!Number.isFinite(fee) || fee < 0)) return fail("Default fee must be zero or positive");
    const updated = updateCatalogueSetting(
      code,
      {
        enabled: body.enabled === undefined ? undefined : Boolean(body.enabled),
        default_frequency: frequency,
        default_fee: fee,
        requires_engagement_letter: body.requires_engagement_letter === undefined ? undefined : Boolean(body.requires_engagement_letter),
        requires_approval: body.requires_approval === undefined ? undefined : Boolean(body.requires_approval),
      },
      user.name,
    );
    return ok(updated);
  } catch (err) {
    if (err instanceof OnboardingError) return ok({ error: err.message, issues: err.issues }, 422);
    return handle(err);
  }
}
