import { getSessionUser } from "@/lib/auth";
import { getDocument } from "@/lib/db";
import { refreshRequestStatus } from "@/lib/engagements-db";
import {
  DocumentOpError,
  archiveDocument,
  classifyDocument,
  listDocumentHistory,
  restoreDocument,
  reviewDocument,
} from "@/lib/documents";
import { fail, handle, ok, readBody } from "@/lib/api";
import type { DocumentItem } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser();
    if (!user) return fail("Sign in required", 401);
    const { id } = await ctx.params;
    const doc = getDocument(id);
    if (!doc) return fail("Document not found", 404);
    return ok({ document: doc, history: listDocumentHistory(id) });
  } catch (err) {
    return handle(err);
  }
}

/**
 * State changes on a document. The action decides which fields the handler
 * reads — review status changes go through reviewDocument's server rules
 * (manager+ for verify/reject, rejection reason required), folder moves
 * through classifyDocument, archival is soft.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser();
    if (!user) return fail("Sign in required", 401);
    const { id } = await ctx.params;
    const body = await readBody(req);
    const action = String(body.action || "status");

    let updated: DocumentItem | null = null;
    if (action === "status") {
      const status = String(body.status || "") as DocumentItem["status"];
      if (!["Pending", "Received", "Verified", "Rejected", "Waived"].includes(status)) {
        return fail('"status" must be one of: Pending, Received, Verified, Rejected, Waived');
      }
      updated = reviewDocument(id, { status, actor: user.name, role: user.role, reason: typeof body.reason === "string" ? body.reason : "" });
    } else if (action === "classify") {
      updated = classifyDocument(id, {
        category: typeof body.category === "string" ? body.category : undefined,
        fy: typeof body.fy === "string" ? body.fy : undefined,
        period: typeof body.period === "string" ? body.period : undefined,
        service_code: typeof body.service_code === "string" ? body.service_code : undefined,
        compliance_id: typeof body.compliance_id === "string" ? body.compliance_id : undefined,
        registration_id: typeof body.registration_id === "string" ? body.registration_id : undefined,
        needs_classification: typeof body.needs_classification === "boolean" ? body.needs_classification : undefined,
      }, user.name);
    } else if (action === "archive") {
      if (user.role === "article") return fail("Only a manager or partner can archive a document", 403);
      updated = archiveDocument(id, user.name, typeof body.reason === "string" ? body.reason : "");
    } else if (action === "restore") {
      if (user.role === "article") return fail("Only a manager or partner can restore a document", 403);
      updated = restoreDocument(id, user.name);
    } else {
      return fail("Unknown document action");
    }

    const doc = getDocument(id);
    if (doc?.request_id) refreshRequestStatus(doc.request_id);
    return ok(updated);
  } catch (err) {
    if (err instanceof DocumentOpError) return fail(err.message, err.status);
    return handle(err);
  }
}
