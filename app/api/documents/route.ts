import { getSessionUser } from "@/lib/auth";
import { createDocument, getClient, listDocuments } from "@/lib/db";
import { getDocumentRequest, refreshRequestStatus } from "@/lib/engagements-db";
import { queryDocuments } from "@/lib/documents";
import { date, fail, handle, ok, readBody, str, today } from "@/lib/api";
import { fyForDate } from "@/lib/services";

export const dynamic = "force-dynamic";

/**
 * Server-side filtering and pagination. `?legacy=1` keeps the old
 * unfiltered shape for older callers; every other call goes through
 * queryDocuments, which never returns rows it does not filter for.
 */
export async function GET(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return fail("Sign in required", 401);
    const params = new URL(req.url).searchParams;
    const q = (key: string) => params.get(key) || undefined;
    if (params.get("legacy")) return ok(listDocuments());
    const result = queryDocuments({
      client_id: q("client_id"),
      status: q("status"),
      fy: q("fy"),
      period: q("period"),
      service_code: q("service_code"),
      category: q("category"),
      compliance_id: q("compliance_id"),
      request_id: q("request_id"),
      q: q("q"),
      include_archived: params.get("include_archived") === "1",
      only_needs_classification: params.get("needs_classification") === "1",
      page: Number(params.get("page")) || 1,
      pageSize: Number(params.get("pageSize")) || 50,
    });
    return ok(result);
  } catch (err) {
    return handle(err);
  }
}

export async function POST(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return fail("Sign in required", 401);
    if (user.role === "article") return fail("Only a manager or partner can add document requests", 403);
    const body = await readBody(req);
    const client = getClient(str(body.client_id, "Client", { max: 40 }));
    if (!client) return fail("Client not found", 404);
    const requestId = str(body.request_id, "Request", { optional: true, max: 40 });
    const request = requestId ? getDocumentRequest(requestId) : null;
    if (request && request.client_id !== client.client_id) return fail("That request belongs to another client", 409);
    const requestedDate = body.requested_date ? date(body.requested_date, "Requested date") : today();
    const doc = createDocument({
      client_id: client.client_id,
      client_name: client.name,
      document_name: str(body.document_name, "Document name", { max: 160 }),
      status: "Pending",
      requested_date: requestedDate,
      received_date: null,
      notes: str(body.notes, "Notes", { optional: true, max: 300 }),
      request_id: request?.request_id ?? "",
      compliance_id: request?.compliance_id ?? str(body.compliance_id, "Filing", { optional: true, max: 40 }),
      service_code: request?.service_code ?? str(body.service_code, "Service", { optional: true, max: 40 }),
      category: str(body.category, "Category", { optional: true, max: 60 }) || "General",
      fy: request?.fy ?? (str(body.fy, "Financial year", { optional: true, max: 10 }) || fyForDate(requestedDate)),
      period: request?.period ?? str(body.period, "Period", { optional: true, max: 60 }),
      reminder_count: 0,
      last_reminded_at: null,
      next_reminder_on: requestId ? today() : null,
      verified_by: "",
      source: "manual",
      sort_order: 999,
    });
    if (request) refreshRequestStatus(request.request_id);
    return ok(doc, 201);
  } catch (err) {
    return handle(err);
  }
}
