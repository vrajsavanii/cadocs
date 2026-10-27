import { getClient } from "@/lib/db";
import { fail, handle, ok, readBody, str } from "@/lib/api";
import { getSessionUser } from "@/lib/auth";
import { listClientServices } from "@/lib/engagements-db";
import {
  OnboardingError,
  activateService,
  assessOnboarding,
  canManageOnboarding,
  createServiceDraft,
  type ServiceInput,
} from "@/lib/onboarding";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser();
    if (!user) return fail("Sign in required", 401);
    const { id } = await ctx.params;
    if (!getClient(id)) return fail("Client not found", 404);
    return ok(listClientServices(id));
  } catch (err) {
    return handle(err);
  }
}

function number(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error("A numeric value was expected");
  return n;
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser();
    if (!user) return fail("Sign in required", 401);
    if (!canManageOnboarding(user.role)) return fail("Only partners and managers can configure services", 403);
    const { id } = await ctx.params;
    if (!getClient(id)) return fail("Client not found", 404);
    const body = await readBody(req);
    const input: ServiceInput = {
      code: str(body.code, "Service code", { max: 40 }),
      registration_id: str(body.registration_id, "Registration", { optional: true, max: 80 }),
      frequency: str(body.frequency, "Frequency", { optional: true, max: 20 }),
      fee: number(body.fee),
      billing_cycle: str(body.billing_cycle, "Billing cycle", { optional: true, max: 20 }),
      auto_invoice: body.auto_invoice === undefined ? undefined : Boolean(body.auto_invoice),
      owner: str(body.owner, "Preparer", { optional: true, max: 80 }),
      reviewer: str(body.reviewer, "Reviewer", { optional: true, max: 80 }),
      manager: str(body.manager, "Manager", { optional: true, max: 80 }),
      partner: str(body.partner, "Authorised CA", { optional: true, max: 80 }),
      start_date: str(body.start_date, "Start date", { optional: true, max: 10 }),
      end_date: str(body.end_date, "End date", { optional: true, max: 10 }),
      fee_model: str(body.fee_model, "Fee model", { optional: true, max: 20 }),
      setup_fee: number(body.setup_fee),
      payment_terms_days: number(body.payment_terms_days),
      fee_effective_from: str(body.fee_effective_from, "Fee effective from", { optional: true, max: 10 }),
      approval_stage: str(body.approval_stage, "Approval stage", { optional: true, max: 20 }),
      reminder_cap: number(body.reminder_cap),
      reminder_gap_days: number(body.reminder_gap_days),
    };
    const draft = createServiceDraft(id, input, user.name);
    if (body.activate === false) {
      return ok({ service: draft.service, issues: draft.issues, onboarding: assessOnboarding(id, user.role) }, 201);
    }
    const activation = activateService(draft.service.service_id, user.name, str(body.idempotency_key, "Idempotency key", { optional: true, max: 120 }));
    return ok(
      {
        service: activation.service,
        cycle: activation.cycle,
        created: activation.created,
        issues: [...draft.issues, ...activation.issues],
        onboarding: assessOnboarding(id, user.role),
      },
      201,
    );
  } catch (err) {
    if (err instanceof OnboardingError) return ok({ error: err.message, issues: err.issues }, 422);
    return handle(err);
  }
}
