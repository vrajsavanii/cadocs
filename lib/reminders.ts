/**
 * The client-side automation engine.
 *
 * Four rules, in the order a practice needs them:
 *
 *   1. Every active service gets its current period created (monthly, quarterly,
 *      annual ITR) with its own document checklist.
 *   2. The client is asked once for the packet, then reminded at a fixed gap —
 *      and never more than three reminders. The cap is enforced here and in the
 *      database, and it is not configurable above three.
 *   3. The moment nothing is pending, the packet clears and reminders stop.
 *   4. Completed work gets a DRAFT invoice — issuance and WhatsApp delivery
 *      are separate, explicit steps in the billing engine.
 *
 * Everything lands in the same outbox as manual messages. Without WhatsApp Cloud
 * API credentials the firm sends each prepared message with one tap; with them
 * and `WHATSAPP_AUTO_SEND=1`, the same message is sent as an approved template.
 */
import type {
  Client,
  Compliance,
  DocumentItem,
  DocumentRequest,
  ReminderEngineConfig,
  ReminderRunSummary,
} from "./types";
import {
  getClient,
  getSettings,
  listDocuments,
  logAudit,
  one,
  updateSettings,
} from "./db";
import {
  ensureCurrentCycles,
  getDocumentRequest,
  listDocumentRequests,
  listMessagesFor,
  refreshRequestStatus,
  updateDocumentRequest,
} from "./engagements-db";
import { billingBacklog, billingFlags, invoiceCompletedCycles } from "./billing";
import { addDaysISO, getService, requestByDate } from "./services";
import { prettyDate, todayISO } from "./format";
import { deliverWhatsApp, whatsappConfig } from "./whatsapp";

const HARD_CAP = 3;

export function getEngineConfig(): ReminderEngineConfig {
  const settings = getSettings();
  const cap = Number(settings.reminder_cap);
  const gap = Number(settings.reminder_gap_days);
  const flags = billingFlags();
  const wa = whatsappConfig();
  return {
    reminder_cap: Number.isFinite(cap) ? Math.min(HARD_CAP, Math.max(1, Math.round(cap))) : HARD_CAP,
    reminder_gap_days: Number.isFinite(gap) ? Math.min(30, Math.max(1, Math.round(gap))) : 3,
    auto_billing: flags.auto_billing,
    invoice_due_days: 7,
    gst_rate: 0,
    auto_send: wa.autoSend,
    provider: wa.provider,
    last_run_at: settings.client_engine_last_run || null,
    last_run_summary: settings.client_engine_last_summary || "",
  };
}

export function saveEngineConfig(
  patch: {
    reminder_cap?: number;
    reminder_gap_days?: number;
    auto_billing?: boolean;
    invoice_due_days?: number;
    gst_rate?: number;
  },
  actor: string,
): ReminderEngineConfig {
  const next: Record<string, string> = {};
  if (patch.reminder_cap !== undefined) next.reminder_cap = String(Math.min(HARD_CAP, Math.max(1, Math.round(Number(patch.reminder_cap) || HARD_CAP))));
  if (patch.reminder_gap_days !== undefined) next.reminder_gap_days = String(Math.min(30, Math.max(1, Math.round(Number(patch.reminder_gap_days) || 3))));
  if (patch.auto_billing !== undefined) {
    // The real billing gate for the engine lives in the firm billing settings;
    // auto_billing here only records whether the sweep should run at all.
    next.auto_billing = patch.auto_billing ? "on" : "off";
  }  if (patch.invoice_due_days !== undefined) next.invoice_due_days = String(Math.min(90, Math.max(1, Math.round(Number(patch.invoice_due_days) || 7))));
  if (patch.gst_rate !== undefined) next.gst_rate = String(Math.min(28, Math.max(0, Number(patch.gst_rate) || 0)));
  if (Object.keys(next).length) {
    updateSettings(next);
    logAudit({
      action: "REMINDER_SETTINGS",
      entity_type: "settings",
      entity_id: "client_engine",
      detail: Object.entries(next)
        .map(([k, v]) => `${k}=${v}`)
        .join(", "),
    });
  }
  return getEngineConfig();
}

function pendingDocs(requestId: string): DocumentItem[] {
  return listDocuments().filter((d) => d.request_id === requestId && (d.status === "Pending" || d.status === "Rejected"));
}

function documentsFor(requestId: string): DocumentItem[] {
  return listDocuments().filter((d) => d.request_id === requestId);
}

function taskFor(request: DocumentRequest): Compliance | null {
  return one<Compliance>("SELECT * FROM compliance WHERE compliance_id = ?", request.compliance_id);
}

function alreadyQueued(key: string): boolean {
  const row = one<{ message_id: string }>(
    "SELECT message_id FROM messages WHERE automation_key = ? AND status <> 'Failed' LIMIT 1",
    key,
  );
  return Boolean(row);
}

function buildBody(input: {
  client: Client;
  request: DocumentRequest;
  task: Compliance | null;
  docs: DocumentItem[];
  number: number;
  cap: number;
  due: string;
  serviceName: string;
  firm: string;
}): string {
  const contact = input.client.contact_person || input.client.name;
  const listed = input.docs.slice(0, 10).map((doc, index) => `${index + 1}. ${doc.document_name}`);
  const more = input.docs.length > 10 ? `\n…and ${input.docs.length - 10} more item(s) in your folder.` : "";
  const intro =
    input.number === 0
      ? `We are starting ${input.serviceName} for ${input.request.period}. Please share the documents below.`
      : `Reminder ${input.number} of ${input.cap} for ${input.serviceName} (${input.request.period}). We are still waiting on the documents below.`;
  const closing =
    input.number === 0
      ? `Kindly send them by ${prettyDate(input.due)} so we can file on time.`
      : input.number >= input.cap
        ? `This is the last automatic reminder. Please send them today, or call the office so we can help.`
        : `Please send them at the earliest. Reminders stop as soon as the papers are received.`;
  return [
    `Dear ${contact},`,
    ``,
    intro,
    ``,
    listed.join("\n") + more,
    ``,
    closing,
    ``,
    `Regards,`,
    input.firm,
  ].join("\n");
}

type SendOutcome = {
  status: "queued" | "sent" | "failed" | "skipped" | "cleared" | "capped" | "duplicate";
  reason?: string;
  reminderNumber?: number;
};

/**
 * Sends (or queues) one request/reminder for a packet. `force` is used by the
 * manual Chase button; the cap still applies.
 */
export async function sendRequestMessage(
  requestId: string,
  actor: string,
  opts: { force?: boolean; dryRun?: boolean } = {},
): Promise<SendOutcome> {
  const request = getDocumentRequest(requestId);
  if (!request) return { status: "skipped", reason: "Request not found" };
  const refreshed = refreshRequestStatus(requestId) ?? request;
  if (refreshed.status === "Cleared" || refreshed.status === "Closed") {
    return { status: "cleared", reason: refreshed.status === "Cleared" ? "All documents are in — reminders stopped" : "Request closed" };
  }
  const docs = pendingDocs(requestId);
  if (docs.length === 0) {
    refreshRequestStatus(requestId);
    return { status: "cleared", reason: "Nothing pending" };
  }
  const client = getClient(request.client_id);
  if (!client) return { status: "skipped", reason: "Client not found" };
  if (!client.whatsapp_opt_in) return { status: "skipped", reason: `${client.name} has not consented to WhatsApp updates` };
  if (!client.phone) return { status: "skipped", reason: `${client.name} has no WhatsApp number` };

  const prior = listMessagesFor(requestId).filter((m) => m.kind === "document_request" || m.kind === "document_reminder");
  const initialSent = prior.some((m) => m.kind === "document_request" && m.status !== "Failed");
  const number = initialSent ? refreshed.reminders_sent + 1 : 0;
  if (initialSent && refreshed.reminders_sent >= refreshed.reminder_cap) {
    return { status: "capped", reason: `All ${refreshed.reminder_cap} reminders have been used` };
  }
  if (!opts.force && refreshed.next_reminder_on && refreshed.next_reminder_on > todayISO()) {
    return { status: "skipped", reason: `Next reminder is due ${prettyDate(refreshed.next_reminder_on)}` };
  }

  const key = `${requestId}:${number}`;
  if (alreadyQueued(key)) return { status: "duplicate", reason: "Already prepared" };

  const task = taskFor(request);
  const def = getService(request.service_code);
  const firm = getSettings().firm_name || "your CA firm";
  const due = task?.due_date ?? request.due_date;
  const body = buildBody({
    client,
    request,
    task,
    docs,
    number,
    cap: refreshed.reminder_cap,
    due,
    serviceName: def.name,
    firm,
  });
  const subject = `${number === 0 ? "Documents needed" : `Reminder ${number}/${refreshed.reminder_cap}`} — ${def.short} ${request.period}`;
  if (opts.dryRun) {
    return { status: "queued", reason: `Would ${number === 0 ? "send the request" : `send reminder ${number} of ${refreshed.reminder_cap}`} to ${client.name}`, reminderNumber: number };
  }

  const message = await deliverWhatsApp({
    to: client.phone,
    recipient: client.contact_person || client.name,
    subject,
    body,
    kind: number === 0 ? "document_request" : "document_reminder",
    relatedType: number === 0 ? "document_request" : "document_reminder",
    relatedId: requestId,
    reminderNumber: number,
    automationKey: key,
    templateParams: [client.contact_person || client.name, def.name, request.period, String(docs.length)],
  });
  const config = getEngineConfig();
  const nextAt = number >= refreshed.reminder_cap ? null : addDaysISO(todayISO(), config.reminder_gap_days);
  const now = new Date().toISOString();
  updateDocumentRequest(requestId, {
    reminders_sent: initialSent ? number : refreshed.reminders_sent,
    last_sent_at: now,
    next_reminder_on: nextAt,
    status: "Open",
  });
  for (const doc of docs) {
    one(
      "UPDATE documents SET reminder_count=?, last_reminded_at=?, next_reminder_on=? WHERE doc_id=?",
      initialSent ? number : 0,
      now,
      nextAt,
      doc.doc_id,
    );
  }
  logAudit({
    action: "DOCUMENT_REMINDER",
    entity_type: "document_request",
    entity_id: requestId,
    detail: `${number === 0 ? "Request" : `Reminder ${number}/${refreshed.reminder_cap}`} to ${client.name} — ${docs.length} pending (${message.status})`,
  });
  return {
    status: message.status === "Sent" ? "sent" : message.status === "Failed" ? "failed" : "queued",
    reason: message.error || undefined,
    reminderNumber: number,
  };
}

/** Manual chase from the Documents/Folders screen; the cap still applies. */
export async function chaseRequest(requestId: string, actor: string) {
  return sendRequestMessage(requestId, actor, { force: true });
}

/**
 * The sweep. Runs current-cycle generation, requests/reminders, clearance and
 * auto-billing. Safe to run repeatedly: every write is duplicate-guarded.
 */
export async function runClientAutomation(opts: {
  actor: string;
  role?: string;
  dryRun?: boolean;
}): Promise<ReminderRunSummary> {
  const now = new Date().toISOString();
  const config = getEngineConfig();
  const details: ReminderRunSummary["details"] = [];
  let cyclesCreated = 0;
  if (!opts.dryRun) cyclesCreated = ensureCurrentCycles(30);

  const requests = listDocumentRequests().filter((r) => r.status === "Open");
  const summary: ReminderRunSummary = {
    ran_at: now,
    requests_considered: requests.length,
    requests_cleared: 0,
    requests_closed: 0,
    messages_queued: 0,
    messages_sent: 0,
    invoices_created: 0,
    skipped_opt_out: 0,
    skipped_cap: 0,
    cycles_created: cyclesCreated,
    details,
  };

  for (const request of requests) {
    const pending = pendingDocs(request.request_id);
    if (pending.length === 0) {
      if (!opts.dryRun) refreshRequestStatus(request.request_id);
      summary.requests_cleared++;
      continue;
    }
    if (request.reminders_sent >= request.reminder_cap) {
      summary.skipped_cap++;
      continue;
    }
    const client = getClient(request.client_id);
    if (!client?.whatsapp_opt_in || !client.phone) {
      summary.skipped_opt_out++;
      continue;
    }
    if (request.next_reminder_on && request.next_reminder_on > todayISO()) continue;

    const result = await sendRequestMessage(request.request_id, opts.actor, { dryRun: opts.dryRun });
    if (result.status === "queued") {
      summary.messages_queued++;
      details.push({ client: request.client_name, action: "Queued message", detail: result.reason ?? `Reminder ${result.reminderNumber ?? 0}` });
    } else if (result.status === "sent") {
      summary.messages_sent++;
      details.push({ client: request.client_name, action: "Sent WhatsApp", detail: `Reminder ${result.reminderNumber ?? 0}` });
    } else if (result.status === "cleared") {
      summary.requests_cleared++;
    } else if (result.status === "capped") {
      summary.skipped_cap++;
    } else if (result.status === "failed") {
      details.push({ client: request.client_name, action: "Send failed", detail: result.reason ?? "WhatsApp API error" });
    }
  }

  const billing = await invoiceCompletedCycles(opts.actor, { dryRun: opts.dryRun });
  summary.invoices_created = billing.created;
  if (billing.details.length) {
    billing.details.slice(0, 8).forEach((detail) => details.push({ client: "Billing", action: billing.created ? "Draft invoice created" : "Billing preview", detail }));
  }

  const summaryLine = `${summary.messages_queued + summary.messages_sent} client message(s), ${summary.invoices_created} draft invoice(s), ${summary.requests_cleared} packet(s) cleared, ${summary.skipped_cap} at the ${config.reminder_cap}-reminder cap`;
  if (!opts.dryRun) {
    updateSettings({ client_engine_last_run: now, client_engine_last_summary: summaryLine });
    logAudit({ action: "CLIENT_AUTOMATION_RUN", entity_type: "automation", entity_id: now, detail: summaryLine });
  }
  return summary;
}

export type EngineStatus = {
  config: ReminderEngineConfig;
  open_requests: number;
  due_now: number;
  exhausted: number;
  cleared_this_month: number;
  opted_out: number;
  queued_messages: number;
  invoices_waiting: number;
  billing_value: number;
  whatsapp: { provider: string; configured: boolean; autoSend: boolean; missing: string[] };
};

export function engineStatus(): EngineStatus {
  const requests = listDocumentRequests();
  const open = requests.filter((r) => r.status === "Open");
  const today = todayISO();
  const month = today.slice(0, 7);
  const clients = new Map<string, Client>();
  for (const request of requests) if (!clients.has(request.client_id)) clients.set(request.client_id, getClient(request.client_id) as Client);
  const optedOut = Array.from(clients.values()).filter((c) => c && !c.whatsapp_opt_in).length;
  const backlog = billingBacklog();
  const wa = whatsappConfig();
  return {
    config: getEngineConfig(),
    open_requests: open.length,
    due_now: open.filter((r) => (!r.next_reminder_on || r.next_reminder_on <= today) && r.reminders_sent < r.reminder_cap).length,
    exhausted: open.filter((r) => r.reminders_sent >= r.reminder_cap).length,
    cleared_this_month: requests.filter((r) => r.cleared_at && r.cleared_at.startsWith(month)).length,
    opted_out: optedOut,
    queued_messages: Number(one<{ n: number }>("SELECT COUNT(*) AS n FROM messages WHERE status='Queued'")?.n ?? 0),
    invoices_waiting: backlog.unbilled,
    billing_value: backlog.value,
    whatsapp: { provider: wa.provider, configured: wa.configured, autoSend: wa.autoSend, missing: wa.missing },
  };
}

/** Service enrolment defaults for the onboarding wizard. */
export function suggestedReminderPolicy(serviceCode: string): { cap: number; gap: number; requestBy: string } {
  const def = getService(serviceCode);
  return { cap: HARD_CAP, gap: 3, requestBy: requestByDate(todayISO(), def.frequency) };
}
