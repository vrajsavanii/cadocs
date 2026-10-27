import { getSessionUser } from "@/lib/auth";
import { createCycleForService, ensureChecklistForCycle, getClientServiceByCode, listDocumentRequests, listClientServices } from "@/lib/engagements-db";
import { getClient } from "@/lib/db";
import { sendRequestMessage } from "@/lib/reminders";
import { fail, handle, ok, readBody } from "@/lib/api";
import { currentCycle, getService } from "@/lib/services";
import { todayISO } from "@/lib/format";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  try {
    const clientId = new URL(req.url).searchParams.get("client_id") ?? undefined;
    return ok(listDocumentRequests(clientId));
  } catch (err) {
    return handle(err);
  }
}

export async function POST(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return fail("Sign in required", 401);
    const body = await readBody(req);
    const complianceId = typeof body.compliance_id === "string" ? body.compliance_id : "";

    if (complianceId) {
      const result = ensureChecklistForCycle(complianceId, user.name);
      if (!result.request) return fail("Filing not found", 404);
      let message = "Request packet ready";
      if (body.send) {
        const sent = await sendRequestMessage(result.request.request_id, user.name, { force: true });
        message = sent.reason ?? sent.status;
      }
      return ok({ ...result, message }, result.created ? 201 : 200);
    }

    const clientId = typeof body.client_id === "string" ? body.client_id : "";
    const code = typeof body.service_code === "string" ? body.service_code : "";
    if (!clientId || !code) return fail("Client and service are required");
    const client = getClient(clientId);
    if (!client) return fail("Client not found", 404);
    let service = getClientServiceByCode(clientId, code);
    if (!service) {
      const active = listClientServices(clientId).find((s) => s.service_code === code);
      service = active ?? null;
    }
    if (!service) return fail("This client is not enrolled in that service", 409);
    const cycle = createCycleForService({ client, service, actor: user.name, role: user.role });
    let message = "Request packet ready";
    if (body.send) {
      const sent = await sendRequestMessage(cycle.request.request_id, user.name, { force: true });
      message = sent.reason ?? sent.status;
    }
    return ok({ ...cycle, message, period: cycle.task.period, cycle: currentCycle(getService(code), todayISO()) }, cycle.created ? 201 : 200);
  } catch (err) {
    return handle(err);
  }
}
