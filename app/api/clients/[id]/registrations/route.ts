import { getClient } from "@/lib/db";
import { fail, handle, ok, readBody, str } from "@/lib/api";
import { getSessionUser } from "@/lib/auth";
import {
  OnboardingError,
  REGISTRATION_KINDS,
  addRegistration,
  canManageOnboarding,
  listRegistrations,
} from "@/lib/onboarding";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser();
    if (!user) return fail("Sign in required", 401);
    const { id } = await ctx.params;
    if (!getClient(id)) return fail("Client not found", 404);
    return ok(listRegistrations(id, user.role));
  } catch (err) {
    return handle(err);
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser();
    if (!user) return fail("Sign in required", 401);
    if (!canManageOnboarding(user.role)) return fail("Only partners and managers can add registrations", 403);
    const { id } = await ctx.params;
    if (!getClient(id)) return fail("Client not found", 404);
    const body = await readBody(req);
    const kind = str(body.kind, "Registration kind", { max: 10 }).toUpperCase();
    if (!REGISTRATION_KINDS.includes(kind as (typeof REGISTRATION_KINDS)[number])) {
      return fail("Choose GST, TAN, CIN, PAN or Other", 422);
    }
    const registration = addRegistration(
      id,
      {
        kind,
        identifier: str(body.identifier, "Registration number", { max: 40 }),
        legal_name: str(body.legal_name, "Legal name on the registration", { optional: true, max: 160 }),
        state: str(body.state, "State", { optional: true, max: 80 }),
        state_code: str(body.state_code, "State code", { optional: true, max: 2 }),
        status: str(body.status, "Status", { optional: true, max: 20 }) || "Active",
        effective_from: str(body.effective_from, "Effective from", { optional: true, max: 10 }),
        effective_to: str(body.effective_to, "Closure date", { optional: true, max: 10 }),
        place_of_business: str(body.place_of_business, "Place of business", { optional: true, max: 200 }),
        filing_frequency: str(body.filing_frequency, "Filing frequency", { optional: true, max: 40 }),
        is_primary: Boolean(body.is_primary),
      },
      user.name,
    );
    return ok({ registration, registrations: listRegistrations(id, user.role) }, 201);
  } catch (err) {
    if (err instanceof OnboardingError) return ok({ error: err.message, issues: err.issues }, 422);
    return handle(err);
  }
}
