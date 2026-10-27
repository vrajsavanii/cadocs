import { getSessionUser } from "@/lib/auth";
import { fail, handle, ok, num, readBody, str } from "@/lib/api";
import { actorFrom, notSignedIn } from "@/lib/billing-actor";
import { getInvoice } from "@/lib/db";
import {
  approveInvoice,
  lifecycleOf,
  cancelIssuedInvoice,
  createDraftInvoice,
  deliverIssuedInvoice,
  issueCreditNote,
  issueInvoice,
  linesToDraftInput,
  rejectInvoiceDraft,
  submitForApproval,
  updateDraftInvoice,
  validateInvoiceForIssue,
  voidDraftInvoice,
} from "@/lib/invoicing";

export const dynamic = "force-dynamic";

type LifecycleAction =
  | "submit"
  | "approve"
  | "reject"
  | "issue"
  | "update-draft"
  | "void"
  | "cancel"
  | "credit-note"
  | "deliver"
  | "validate"
  | "duplicate-draft";

/**
 * Every lifecycle transition runs through the billing engine's server-side
 * permission gate (`assertInvoicePermission`); this route never decides
 * authority itself. Actions and their consequences:
 *
 *  submit        draft → pending_approval
 *  approve       pending_approval → approved (self-approval refused)
 *  reject        pending_approval → draft, reason required
 *  issue         allocates the human number, freezes the issue snapshot
 *  void          unissued draft → cancelled
 *  cancel        issued invoice → cancelled (partner, reason required)
 *  credit-note   partner-issued correction that reduces the balance
 *  deliver       WhatsApp delivery of an ISSUED invoice via the Prompt 8 outbox
 *  validate      dry validation, no state change
 *  duplicate-draft  re-opens the lines of an issued invoice into a new draft
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser();
    if (!user) return notSignedIn();
    const actor = actorFrom(user);
    const { id } = await ctx.params;
    const body = await readBody(req);
    const action = str(body.action, "action", { max: 40 }) as LifecycleAction;

    switch (action) {
      case "submit":
        return ok({ invoice: submitForApproval(id, actor) });
      case "approve":
        return ok({ invoice: approveInvoice(id, actor, str(body.note, "note", { optional: true, max: 300 })) });
      case "reject":
        return ok({ invoice: rejectInvoiceDraft(id, actor, str(body.reason, "reason", { max: 300 })) });
      case "issue": {
        const issued = issueInvoice(id, actor);
        // Delivery is a separate, separately-gated step — never coupled to issue.
        return ok({ invoice: issued, delivery: "not-requested" });
      }
      case "update-draft":
        return ok({
          invoice: updateDraftInvoice(
            id,
            {
              lines: Array.isArray(body.lines)
                ? (body.lines as Array<Record<string, unknown>>).slice(0, 50).map((line, index) => ({
                    description: str(line.description, `Line ${index + 1} description`, { max: 300 }),
                    quantity: num(line.quantity, `Line ${index + 1} quantity`, { min: 1, max: 100_000 }),
                    unit_price: num(line.unit_price, `Line ${index + 1} unit price`, { max: 50_000_000 }),
                    discount: num(line.discount, `Line ${index + 1} discount`, { optional: true, min: 0, max: 50_000_000 }),
                    treatment_id: str(line.treatment_id, `Line ${index + 1} treatment`, { optional: true, max: 60 }),
                  }))
                : undefined,
              due_date: body.due_date ? str(body.due_date, "Due date", { max: 10 }) : undefined,
              invoice_date: body.invoice_date ? str(body.invoice_date, "Invoice date", { max: 10 }) : undefined,
              notes: body.notes !== undefined ? str(body.notes, "Notes", { optional: true, max: 500 }) : undefined,
            },
            actor,
          ),
        });
      case "void":
        return ok({ invoice: voidDraftInvoice(id, actor, str(body.reason, "reason", { optional: true, max: 300 })) });
      case "cancel":
        return ok({ invoice: cancelIssuedInvoice(id, actor, str(body.reason, "reason", { max: 300 })) });
      case "credit-note":
        return ok(
          issueCreditNote(
            id,
            {
              reason: str(body.reason, "reason", { max: 300 }),
              credit_total: num(body.credit_total, "Credit amount", { max: 50_000_000 }),
            },
            actor,
          ),
        );
      case "deliver": {
        const result = await deliverIssuedInvoice(id, actor);
        if (result === "skipped") return fail("Delivery skipped: not issued, delivery disabled, or the client is not WhatsApp-eligible", 409);
        return ok({ invoice_id: id, delivery: result });
      }
      case "validate":
        return ok({ problems: validateInvoiceForIssue(id).problems });
      case "duplicate-draft": {
        const original = getInvoice(id);
        if (!original) return fail("Invoice not found", 404);
        if (lifecycleOf(original) !== "issued") return fail("Only an issued invoice can be duplicated for correction", 409);
        const lines = linesToDraftInput(id);
        const created = createDraftInvoice(
          {
            client_id: original.client_id,
            lines,
            notes: str(body.notes, "Notes", { optional: true, max: 500 }),
            service_id: original.service_id || undefined,
            period: original.period || undefined,
            auto_generated: false,
            approval_required: true,
          },
          actor,
        );
        return ok(created, created.created ? 201 : 200);
      }
      default:
        return fail(`Unknown lifecycle action "${action}"`, 400);
    }
  } catch (err) {
    return handle(err);
  }
}
