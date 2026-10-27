import { deleteClientService, getClientService } from "@/lib/engagements-db";
import { fail, handle, ok, readBody, str } from "@/lib/api";
import { getSessionUser } from "@/lib/auth";
import {
  OnboardingError,
  assessOnboarding,
  canManageOnboarding,
  setServiceStatus,
  updateServiceConfig,
  type ServiceInput,
} from "@/lib/onboarding";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser();
    if (!user) return fail("Sign in required", 401);
    if (!canManageOnboarding(user.role)) return fail("Only partners and managers can edit services", 403);
    const { id } = await ctx.params;
    const current = getClientService(id);
    if (!current) return fail("Service not found", 404);
    const body = await readBody(req);

    // A status-only change is a distinct operation: pause/resume/cancel must
    // leave the configured fee, team and frequency exactly as they are.
    const fields = Object.keys(body).filter((key) => !["status", "idempotency_key"].includes(key));
    if (fields.length === 0 && body.status !== undefined) {
      const status = str(body.status, "Status", { max: 20 });
      const result = setServiceStatus(id, status as typeof current.status, user.name);
      return ok({ ...result, onboarding: assessOnboarding(current.client_id, user.role) });
    }
    if (body.activate === true) {
      const result = setServiceStatus(id, "Active", user.name);
      return ok({ ...result, onboarding: assessOnboarding(current.client_id, user.role) });
    }

    const patch: Partial<ServiceInput> & { status?: string } = {};
    if (body.fee !== undefined) patch.fee = Number(body.fee);
    if (body.frequency !== undefined) patch.frequency = str(body.frequency, "Frequency", { max: 20 });
    if (body.billing_cycle !== undefined) patch.billing_cycle = str(body.billing_cycle, "Billing cycle", { max: 20 });
    if (body.auto_invoice !== undefined) patch.auto_invoice = Boolean(body.auto_invoice);
    if (body.owner !== undefined) patch.owner = str(body.owner, "Preparer", { optional: true, max: 80 });
    if (body.reviewer !== undefined) patch.reviewer = str(body.reviewer, "Reviewer", { optional: true, max: 80 });
    if (body.manager !== undefined) patch.manager = str(body.manager, "Manager", { optional: true, max: 80 });
    if (body.partner !== undefined) patch.partner = str(body.partner, "Authorised CA", { optional: true, max: 80 });
    if (body.registration_id !== undefined) patch.registration_id = str(body.registration_id, "Registration", { optional: true, max: 80 });
    if (body.start_date !== undefined) patch.start_date = str(body.start_date, "Start date", { optional: true, max: 10 });
    if (body.end_date !== undefined) patch.end_date = str(body.end_date, "End date", { optional: true, max: 10 });
    if (body.fee_model !== undefined) patch.fee_model = str(body.fee_model, "Fee model", { max: 20 });
    if (body.setup_fee !== undefined) patch.setup_fee = Number(body.setup_fee);
    if (body.payment_terms_days !== undefined) patch.payment_terms_days = Number(body.payment_terms_days);
    if (body.approval_stage !== undefined) patch.approval_stage = str(body.approval_stage, "Approval stage", { max: 20 });
    if (body.reminder_cap !== undefined) patch.reminder_cap = Number(body.reminder_cap);
    if (body.reminder_gap_days !== undefined) patch.reminder_gap_days = Number(body.reminder_gap_days);
    if (body.status !== undefined) patch.status = str(body.status, "Status", { max: 20 });
    if (Object.keys(patch).length === 0) return fail("No service fields supplied");
    const updated = updateServiceConfig(id, patch, user.name);
    return ok({ service: updated, onboarding: assessOnboarding(current.client_id, user.role) });
  } catch (err) {
    if (err instanceof OnboardingError) return ok({ error: err.message, issues: err.issues }, 422);
    return handle(err);
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser();
    if (!user) return fail("Sign in required", 401);
    if (!canManageOnboarding(user.role)) return fail("Only partners and managers can remove services", 403);
    const { id } = await ctx.params;
    const current = getClientService(id);
    if (!current) return fail("Service not found", 404);
    const result = deleteClientService(id);
    if (!result.ok) return fail(`Cannot remove this service: ${result.blockers.join(", ")}`, 409);
    return ok({ deleted: id, onboarding: assessOnboarding(current.client_id, user.role) });
  } catch (err) {
    return handle(err);
  }
}
