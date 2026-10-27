import { updateClient, getClient, logAudit } from "@/lib/db";
import { fail, handle, ok, pick, readBody, str } from "@/lib/api";
import { getSessionUser } from "@/lib/auth";
import { OnboardingError, bulkAssignManager, canManageOnboarding } from "@/lib/onboarding";

export const dynamic = "force-dynamic";

const MAX_CLIENTS = 200;

export async function POST(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return fail("Sign in required", 401);
    if (!canManageOnboarding(user.role)) return fail("Only partners and managers can run bulk operations", 403);
    const body = await readBody(req);
    const clientIds = Array.isArray(body.client_ids) ? [...new Set(body.client_ids.map((id: unknown) => String(id)))].slice(0, MAX_CLIENTS + 1) : [];
    if (clientIds.length === 0) return fail("Select at least one client");
    if (clientIds.length > MAX_CLIENTS) return fail(`Bulk operations are limited to ${MAX_CLIENTS} clients at a time`);
    if (clientIds.length > 1 && body.confirm !== true) {
      return fail(`This operation will update ${clientIds.length} clients. Re-send with confirm: true.`, 428);
    }
    const action = pick(body.action, ["assign_manager", "set_relationship_status", "set_client_status"] as const, "Action");

    if (action === "assign_manager") {
      const manager = str(body.relationship_manager, "Relationship manager", { max: 80 });
      try {
        const result = bulkAssignManager(clientIds, manager, user.name);
        return ok({ action, ...result, total: clientIds.length });
      } catch (err) {
        if (err instanceof OnboardingError) return ok({ error: err.message, issues: err.issues }, 422);
        throw err;
      }
    }

    const value = action === "set_relationship_status"
      ? pick(body.value, ["Primary", "Adhoc", "Pending", "Exited", "Client"] as const, "Relationship status")
      : pick(body.value, ["Active", "Paused", "Exited"] as const, "Client status");
    const updated: string[] = [];
    const skipped: Array<{ client_id: string; reason: string }> = [];
    for (const clientId of clientIds) {
      const client = getClient(clientId);
      if (!client) {
        skipped.push({ client_id: clientId, reason: "Client not found" });
        continue;
      }
      updateClient(clientId, {
        ...(action === "set_relationship_status" ? { relationship_status: value as "Primary" | "Adhoc" | "Pending" | "Exited" } : {}),
        ...(action === "set_client_status" ? { client_status: value as "Active" | "Paused" | "Exited" } : {}),
        updated_by: user.name,
        updated_at: new Date().toISOString(),
      });
      logAudit({
        actor: user.name,
        action: "CLIENT_BULK_UPDATED",
        entity_type: "client",
        entity_id: clientId,
        detail: `${client.name} · ${action} → ${value}`,
      });
      updated.push(clientId);
    }
    return ok({ action, updated: updated.length, skipped, total: clientIds.length });
  } catch (err) {
    return handle(err);
  }
}
