import { getClient, updateClient } from "@/lib/db";
import { fail, handle, ok, readBody, str } from "@/lib/api";
import { getSessionUser } from "@/lib/auth";
import { getClientService, listClientServices } from "@/lib/engagements-db";
import {
  OnboardingError,
  activateService,
  assessOnboarding,
  canManageOnboarding,
  listOnboardingTasks,
  listRegistrations,
  type OnboardingIssue,
} from "@/lib/onboarding";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser();
    if (!user) return fail("Sign in required", 401);
    const { id } = await ctx.params;
    if (!getClient(id)) return fail("Client not found", 404);
    return ok({
      onboarding: assessOnboarding(id, user.role),
      tasks: listOnboardingTasks(id),
      registrations: listRegistrations(id, user.role),
      services: listClientServices(id),
    });
  } catch (err) {
    return handle(err);
  }
}

/**
 * Activates one service or every configured draft. The operation is
 * idempotent: retrying the same activation key returns the existing cycle
 * instead of creating a second engagement.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser();
    if (!user) return fail("Sign in required", 401);
    if (!canManageOnboarding(user.role)) return fail("Only partners and managers can activate services", 403);
    const { id } = await ctx.params;
    const client = getClient(id);
    if (!client) return fail("Client not found", 404);
    const body = await readBody(req);
    const requestedId = str(body.service_id, "Service", { optional: true, max: 80 });
    const services = requestedId
      ? [getClientService(requestedId)].filter((service): service is NonNullable<typeof service> => Boolean(service))
      : listClientServices(id).filter((service) => service.status === "Draft");
    if (requestedId && services.length === 0) return fail("Service not found for this client", 404);
    if (services.length === 0) return fail("There are no draft services to activate", 409);

    const results: Array<{ service_id: string; created: boolean; period?: string; documents: number; issues: OnboardingIssue[] }> = [];
    const issues: OnboardingIssue[] = [];
    const requestedKey = str(body.idempotency_key, "Idempotency key", { optional: true, max: 120 });
    for (const service of services) {
      if (service.client_id !== id) return fail("Service does not belong to this client", 403);
      try {
        // The idempotency key is scoped to the service: activating three drafts
        // in one request must open three periods, while retrying the same
        // request must still open none.
        const activation = activateService(
          service.service_id,
          user.name,
          `${requestedKey || "onboarding"}:${service.service_id}`,
        );
        results.push({
          service_id: service.service_id,
          created: activation.created,
          period: activation.cycle?.task.period,
          documents: activation.cycle?.documents.length ?? 0,
          issues: activation.issues,
        });
        issues.push(...activation.issues);
      } catch (err) {
        if (err instanceof OnboardingError) {
          results.push({ service_id: service.service_id, created: false, documents: 0, issues: err.issues });
          issues.push(...err.issues);
        } else {
          throw err;
        }
      }
    }
    const assessment = assessOnboarding(id, user.role)!;
    const hasErrors = issues.some((issue) => issue.severity === "error");
    if (!hasErrors && assessment.active_services > 0) {
      updateClient(id, {
        onboarding_status: "Active",
        onboarding_stage: "complete",
        onboarding_completed_at: new Date().toISOString(),
        updated_by: user.name,
      });
    }
    return ok({ results, issues, onboarding: assessOnboarding(id, user.role) });
  } catch (err) {
    return handle(err);
  }
}
