/**
 * Auto-billing on the Prompt 10 invoice engine.
 *
 * When a filing cycle reaches Done and its client service has
 * `auto_invoice`, the service fee becomes a DRAFT invoice — once,
 * idempotently (stable billing_event_key = `compliance:{id}`). Delivery is
 * separate and gated: nothing is ever sent at creation; an explicit issue by
 * an authorized user triggers delivery through the billing engine.
 *
 * The legacy direct-mark-Paid behaviour and silently applied GST rates are
 * gone: tax treatment comes from the firm's configured treatments, approval
 * follows the firm's billing settings, and the human number is allocated
 * inside the finalisation transaction.
 */
import type { Client, ClientService, Compliance, Invoice } from "./types";
import { all, getDb, one } from "./db";
import { todayISO } from "./format";
import { getClientService, getClientServiceByCode } from "./engagements-db";
import { createDraftInvoice, hasInvoicePermission, submitForApproval } from "./invoicing";
import type { DraftLineInput } from "./invoicing";
import { getService } from "./services";
import { HttpError } from "./api";

export type BillingFlags = {
  auto_billing: boolean;
  approval_required: boolean;
};

/**
 * Auto-billing flags. Auto-billing is implicit in the configured
 * billing rule (`service.auto_invoice`); approval is ALWAYS required for
 * engine-generated drafts — a sweep never issues by itself.
 */
export function billingFlags(): BillingFlags {
  return { auto_billing: true, approval_required: true };
}

export type InvoiceResult = {
  invoice: Invoice | null;
  created: boolean;
  message: "none";
  reason?: string;
};

function serviceForTask(task: Compliance): ClientService | null {
  if (task.service_id) {
    const direct = getClientService(task.service_id);
    if (direct) return direct;
  }
  if (task.service_code) return getClientServiceByCode(task.client_id, task.service_code);
  return null;
}

/**
 * Creates the draft invoice for one completed cycle. Safe to call repeatedly:
 * the billing_event_key unique index plus the explicit lookup both stop
 * duplicates, and a retry that races the key degrades to a no-op read.
 */
export async function invoiceCycleFor(
  complianceId: string,
  actor: string,
  opts: { dryRun?: boolean; force?: boolean } = {},
): Promise<InvoiceResult> {
  const task = one<Compliance>("SELECT * FROM compliance WHERE compliance_id = ?", complianceId);
  if (!task) return { invoice: null, created: false, message: "none", reason: "Cycle not found" };
  if (task.stage !== "done" && !opts.force) {
    return { invoice: null, created: false, message: "none", reason: "Only completed work is billed automatically" };
  }
  const eventKey = `compliance:${complianceId}`;
  const existing = one<Invoice>("SELECT * FROM invoices WHERE billing_event_key = ?", eventKey);
  if (existing) return { invoice: existing, created: false, message: "none", reason: "Already invoiced" };

  const service = serviceForTask(task);
  if (!service) return { invoice: null, created: false, message: "none", reason: "No engagement fee is configured" };
  if (service.fee <= 0) return { invoice: null, created: false, message: "none", reason: "Fee is zero" };
  const def = getService(service.service_code);

  if (opts.dryRun) {
    return {
      invoice: null,
      created: false,
      message: "none",
      reason: `Would draft a ${def.name} invoice (${task.period}) for ${task.client_name}`,
    };
  }

  const lines: DraftLineInput[] = [
    {
      description: `${def.name} — ${task.period || "Work done"}`,
      service_code: service.service_code,
      client_service_id: service.service_id,
      compliance_id: complianceId,
      quantity: 1,
      unit_price: service.fee,
    },
  ];
  // Invoice row + billed flag commit atomically; the unique index on
  // invoices(billing_event_key) makes a raced duplicate impossible.
  const result = createDraftInvoice(
    {
      client_id: task.client_id,
      lines,
      invoice_date: todayISO(),
      notes: "",
      service_id: service.service_id,
      period: task.period || "",
      compliance_id: complianceId,
      auto_generated: true,
      billing_event_key: eventKey,
      approval_required: true,
    },
    { name: actor, role: "automation" },
  );
  if (result.created) {
    getDb().prepare("UPDATE compliance SET billed = 1 WHERE compliance_id = ? AND IFNULL(billed,0) = 0").run(complianceId);
  }
  const refreshed = one<Invoice>("SELECT * FROM invoices WHERE invoice_id = ?", result.invoice.invoice_id);
  return {
    invoice: refreshed ?? result.invoice,
    created: result.created,
    message: "none",
    reason: result.created ? `Drafted ${task.period} for ${task.client_name}` : "Already invoiced",
  };
}

/** Drafts invoices for every completed, unbilled cycle with auto-invoice on. */
export async function invoiceCompletedCycles(
  actor: string,
  opts: { dryRun?: boolean; limit?: number } = {},
): Promise<{ created: number; messages: number; details: string[]; skipped: number }> {
  let created = 0;
  let skipped = 0;
  const details: string[] = [];
  const tasks = all<Compliance>(
    "SELECT * FROM compliance WHERE stage = 'done' AND IFNULL(billed,0) = 0 AND service_id IS NOT NULL AND service_id <> '' LIMIT ?",
    opts.limit ?? 50,
  );

  for (const task of tasks) {
    const service = task.service_id ? getClientService(task.service_id) : null;
    if (!service || !service.auto_invoice) {
      skipped++;
      continue;
    }
    try {
      const result = await invoiceCycleFor(task.compliance_id, actor, { dryRun: opts.dryRun });
      if (result.created) {
        created++;
        details.push(result.reason ?? task.compliance_id);
      } else {
        skipped++;
        if (result.reason && result.reason !== "Already invoiced") details.push(result.reason);
      }
    } catch (err) {
      // One bad task must not abort the sweep for the rest of the firm.
      skipped++;
      details.push(`${task.compliance_id}: billing failed — ${String((err as Error).message).slice(0, 120)}`);
    }
  }
  return { created, messages: 0, details: details.slice(0, 20), skipped };
}

/** What auto-billing would do next, for the UI. */
export function billingBacklog(): { completed: number; unbilled: number; value: number } {
  const completed = getDb()
    .prepare("SELECT COUNT(*) AS n FROM compliance WHERE stage = 'done'")
    .get() as { n: number };
  const unbilledRows = getDb()
    .prepare(
      `SELECT c.compliance_id, c.client_id, s.fee FROM compliance c
       LEFT JOIN client_services s ON s.service_id = c.service_id
       WHERE c.stage = 'done' AND IFNULL(c.billed,0) = 0
         AND c.service_id IS NOT NULL AND c.service_id <> ''
         AND s.fee IS NOT NULL AND s.fee > 0`,
    )
    .all() as Array<{ compliance_id: string; client_id: string; fee: number }>;
  return { completed: completed.n, unbilled: unbilledRows.length, value: unbilledRows.reduce((sum, r) => sum + (r.fee || 0), 0) };
}

export function invoiceForClient(client: Client): Invoice[] {
  return all<Invoice>(
    "SELECT * FROM invoices WHERE client_id = ? ORDER BY invoice_date DESC, invoice_id DESC",
    client.client_id,
  );
}
