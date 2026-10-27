import { fail, handle, ok, readBody, str } from "@/lib/api";
import { getSessionUser } from "@/lib/auth";
import {
  OnboardingError,
  canManageOnboarding,
  deleteRegistration,
  getRegistration,
  listRegistrations,
  updateRegistration,
} from "@/lib/onboarding";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser();
    if (!user) return fail("Sign in required", 401);
    if (!canManageOnboarding(user.role)) return fail("Only partners and managers can edit registrations", 403);
    const { id } = await ctx.params;
    const current = getRegistration(id);
    if (!current) return fail("Registration not found", 404);
    const body = await readBody(req);
    const patch = {
      ...(body.kind !== undefined ? { kind: str(body.kind, "Registration kind", { max: 10 }).toUpperCase() } : {}),
      ...(body.identifier !== undefined ? { identifier: str(body.identifier, "Registration number", { max: 40 }) } : {}),
      ...(body.legal_name !== undefined ? { legal_name: str(body.legal_name, "Legal name", { optional: true, max: 160 }) } : {}),
      ...(body.state !== undefined ? { state: str(body.state, "State", { optional: true, max: 80 }) } : {}),
      ...(body.state_code !== undefined ? { state_code: str(body.state_code, "State code", { optional: true, max: 2 }) } : {}),
      ...(body.status !== undefined ? { status: str(body.status, "Status", { max: 20 }) } : {}),
      ...(body.effective_from !== undefined ? { effective_from: str(body.effective_from, "Effective from", { optional: true, max: 10 }) } : {}),
      ...(body.effective_to !== undefined ? { effective_to: str(body.effective_to, "Closure date", { optional: true, max: 10 }) } : {}),
      ...(body.place_of_business !== undefined
        ? { place_of_business: str(body.place_of_business, "Place of business", { optional: true, max: 200 }) }
        : {}),
      ...(body.filing_frequency !== undefined
        ? { filing_frequency: str(body.filing_frequency, "Filing frequency", { optional: true, max: 40 }) }
        : {}),
      ...(body.is_primary !== undefined ? { is_primary: Boolean(body.is_primary) } : {}),
    };
    if (Object.keys(patch).length === 0) return fail("No registration fields supplied");
    const updated = updateRegistration(id, patch, user.name);
    return ok({ registration: { ...updated, identifier: undefined }, registrations: listRegistrations(current.client_id, user.role) });
  } catch (err) {
    if (err instanceof OnboardingError) return ok({ error: err.message, issues: err.issues }, 422);
    return handle(err);
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser();
    if (!user) return fail("Sign in required", 401);
    if (!canManageOnboarding(user.role)) return fail("Only partners and managers can remove registrations", 403);
    const { id } = await ctx.params;
    const result = deleteRegistration(id, user.name);
    if (!result.ok) return fail(`Cannot remove this registration: ${result.blockers.join(", ")}`, 409);
    return ok({ deleted: id });
  } catch (err) {
    return handle(err);
  }
}
