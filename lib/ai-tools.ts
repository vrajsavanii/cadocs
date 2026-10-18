/**
 * AI tool registry — the only capabilities the model can reach.
 *
 * Rules enforced here (see docs/AI-LAYER.md):
 *   - Tools are narrow and typed; no SQL, URLs or arbitrary mutation.
 *   - `roles` is the allow-list. Article accounts never receive write tools.
 *   - `validate` runs on model arguments AND again at approval time.
 *   - Read tools never return PAN/GSTIN, email or phone values.
 *   - Writes are returned as proposals by the agent; execution happens only
 *     through the explicit approval endpoint.
 */
import type { AuthUser } from "./types";
import {
  createCompliance,
  createDocument,
  createMessage,
  getClient,
  getClientDetail,
  getDashboard,
  listClients,
  listCompliance,
  listDocuments,
  listInvoices,
  listLeads,
  listNotices,
  listProposals,
  listTimesheets,
} from "./db";
import { dayDiff, inr, prettyDate } from "./format";
import { buildInsights } from "./insights";

type Role = AuthUser["role"];
type Args = Record<string, unknown>;

export type ToolSchema = {
  type: "object";
  properties: Record<string, { type: "string" | "number" | "boolean"; description: string; enum?: string[] }>;
  required?: string[];
  additionalProperties?: false;
};

export type ToolOutcome = { summary: string; data?: Record<string, unknown> };

export type ToolDef = {
  name: string;
  description: string;
  kind: "read" | "write";
  roles: Role[];
  parameters: ToolSchema;
  validate: (raw: unknown) => Args;
  preview?: (args: Args) => string;
  execute: (args: Args, ctx: { user: AuthUser }) => ToolOutcome;
};

// ── Argument validation ───────────────────────────────────────────────────────

function asObject(raw: unknown): Args {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Arguments must be a JSON object");
  }
  return raw as Args;
}

function strArg(raw: Args, key: string, opts: { max?: number; optional?: boolean } = {}): string {
  const value = raw[key];
  if (value === undefined || value === null || value === "") {
    if (opts.optional) return "";
    throw new Error(`Missing required field: ${key}`);
  }
  if (typeof value !== "string") throw new Error(`${key} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length > (opts.max ?? 200)) throw new Error(`${key} is too long`);
  return trimmed;
}

function dateArg(raw: Args, key: string): string {
  const value = strArg(raw, key, { max: 10 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(new Date(`${value}T12:00:00`).getTime())) {
    throw new Error(`${key} must be a date in YYYY-MM-DD form`);
  }
  return value;
}

function intArg(raw: Args, key: string, opts: { min: number; max: number; fallback: number }): number {
  const value = raw[key];
  if (value === undefined || value === null || value === "") return opts.fallback;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) throw new Error(`${key} must be a number`);
  return Math.min(opts.max, Math.max(opts.min, Math.round(n)));
}

function enumArg<T extends string>(raw: Args, key: string, allowed: readonly T[]): T {
  const value = strArg(raw, key, { max: 80 });
  if (!allowed.includes(value as T)) throw new Error(`${key} must be one of: ${allowed.join(", ")}`);
  return value as T;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── Read tools ────────────────────────────────────────────────────────────────

const READ_ROLES: Role[] = ["partner", "manager", "article"];
const WRITE_ROLES: Role[] = ["partner", "manager"];

const practiceOverview: ToolDef = {
  name: "practice_overview",
  description: "Top-level practice KPIs and the highest-priority risk right now.",
  kind: "read",
  roles: READ_ROLES,
  parameters: { type: "object", properties: {}, additionalProperties: false },
  validate: (raw) => asObject(raw),
  execute: () => {
    const k = getDashboard().kpis;
    const insight = buildInsights()[0];
    return {
      summary: `${k.activeClients} clients, ${k.overdueCompliance} overdue filings, ${inr(k.overdueFees)} overdue fees, collection rate ${k.collectionRate}%, ${k.pendingDocuments} pending documents.`,
      data: {
        clients: k.activeClients,
        overdue_compliance: k.overdueCompliance,
        due_this_week: k.complianceDueThisWeek,
        overdue_fees: k.overdueFees,
        collection_rate: k.collectionRate,
        pending_documents: k.pendingDocuments,
        open_leads: k.openLeads,
        hot_leads: k.hotLeads,
        top_risk: insight ? `${insight.title}: ${insight.body}` : null,
      },
    };
  },
};

const findClient: ToolDef = {
  name: "find_client",
  description: "Find clients by name, city, entity type or contact person. Returns ids for follow-up tools.",
  kind: "read",
  roles: READ_ROLES,
  parameters: {
    type: "object",
    properties: { query: { type: "string", description: "Name, city, entity or contact to search" } },
    required: ["query"],
    additionalProperties: false,
  },
  validate: (raw) => {
    const args = asObject(raw);
    return { query: strArg(args, "query", { max: 80 }) };
  },
  execute: (args) => {
    const q = String(args.query).toLowerCase();
    const matches = listClients()
      .filter((c) =>
        [c.name, c.city, c.entity_type, c.contact_person].filter(Boolean).some((v) => String(v).toLowerCase().includes(q)),
      )
      .slice(0, 6)
      .map((c) => ({ client_id: c.client_id, name: c.name, entity: c.entity_type, city: c.city }));
    return {
      summary: matches.length ? `${matches.length} matching client(s): ${matches.map((m) => m.name).join(", ")}` : "No client matched.",
      data: { matches },
    };
  },
};

const client360: ToolDef = {
  name: "client_360",
  description: "Full relationship view for one client: balances, open compliance, pending documents, overdue invoices, last reminder. Excludes identifiers and contact details.",
  kind: "read",
  roles: READ_ROLES,
  parameters: {
    type: "object",
    properties: { client_id: { type: "string", description: "Client id from find_client" } },
    required: ["client_id"],
    additionalProperties: false,
  },
  validate: (raw) => {
    const args = asObject(raw);
    return { client_id: strArg(args, "client_id", { max: 30 }) };
  },
  execute: (args) => {
    const detail = getClientDetail(String(args.client_id));
    if (!detail) throw new Error("Unknown client id");
    const open = detail.compliance.filter((c) => c.status !== "Filed");
    const pendingDocs = detail.documents.filter((d) => d.status === "Pending");
    const openInvoices = detail.invoices.filter((i) => i.status !== "Paid" && i.status !== "Cancelled");
    const lastMessage = detail.messages[0];
    return {
      summary: `${detail.client.name}: billed ${inr(detail.totals.billed)}, outstanding ${inr(detail.totals.outstanding)}, ${open.length} open filings, ${pendingDocs.length} pending documents.`,
      data: {
        name: detail.client.name,
        entity: detail.client.entity_type,
        city: detail.client.city,
        services: detail.client.services_opted,
        totals: detail.totals,
        open_compliance: open.slice(0, 8).map((c) => ({
          type: c.compliance_type, period: c.period, due: c.due_date, status: c.status,
        })),
        pending_documents: pendingDocs.slice(0, 6).map((d) => ({
          document: d.document_name, requested: d.requested_date, days_waiting: Math.max(0, -dayDiff(d.requested_date)),
        })),
        open_invoices: openInvoices.slice(0, 6).map((i) => ({
          invoice: i.invoice_id, total: i.total_amount, balance: i.total_amount - (i.paid_amount ?? 0),
          due: i.due_date, status: i.status, days_late: Math.max(0, -dayDiff(i.due_date)),
        })),
        last_reminder: lastMessage ? { channel: lastMessage.channel, date: lastMessage.created_at.slice(0, 10) } : null,
      },
    };
  },
};

const listDeadlines: ToolDef = {
  name: "list_deadlines",
  description: "Open compliance tasks due within N days, including overdue items, ranked by urgency.",
  kind: "read",
  roles: READ_ROLES,
  parameters: {
    type: "object",
    properties: {
      days: { type: "number", description: "Window in days (default 7, max 60)" },
      limit: { type: "number", description: "Maximum rows (default 10, max 25)" },
    },
    additionalProperties: false,
  },
  validate: (raw) => {
    const args = asObject(raw);
    return {
      days: intArg(args, "days", { min: 0, max: 60, fallback: 7 }),
      limit: intArg(args, "limit", { min: 1, max: 25, fallback: 10 }),
    };
  },
  execute: (args) => {
    const days = Number(args.days);
    const limit = Number(args.limit);
    const rows = listCompliance()
      .filter((c) => c.status !== "Filed" && dayDiff(c.due_date) <= days)
      .sort((a, b) => dayDiff(a.due_date) - dayDiff(b.due_date))
      .slice(0, limit)
      .map((c) => ({
        client: c.client_name,
        type: c.compliance_type,
        due: c.due_date,
        status: c.status,
        days_until: dayDiff(c.due_date),
        assigned_to: c.assigned_to || null,
      }));
    const overdue = rows.filter((r) => r.days_until < 0).length;
    return {
      summary: `${rows.length} open task(s) within ${days} days (${overdue} overdue).`,
      data: { tasks: rows },
    };
  },
};

const listPendingDocuments: ToolDef = {
  name: "list_pending_documents",
  description: "Document requests still pending from clients, with how many days they have been waiting.",
  kind: "read",
  roles: READ_ROLES,
  parameters: {
    type: "object",
    properties: { older_than_days: { type: "number", description: "Only items waiting at least this many days (default 0)" } },
    additionalProperties: false,
  },
  validate: (raw) => {
    const args = asObject(raw);
    return { older_than_days: intArg(args, "older_than_days", { min: 0, max: 365, fallback: 0 }) };
  },
  execute: (args) => {
    const minDays = Number(args.older_than_days);
    const rows = listDocuments()
      .filter((d) => d.status === "Pending")
      .map((d) => ({
        client: d.client_name,
        document: d.document_name,
        requested: d.requested_date,
        days_waiting: Math.max(0, -dayDiff(d.requested_date)),
      }))
      .filter((d) => d.days_waiting >= minDays)
      .sort((a, b) => b.days_waiting - a.days_waiting)
      .slice(0, 12);
    return {
      summary: `${rows.length} pending document request(s)${rows.length ? `, oldest ${rows[0]!.days_waiting} days` : ""}.`,
      data: { documents: rows },
    };
  },
};

const listOverdueInvoices: ToolDef = {
  name: "list_overdue_invoices",
  description: "Unpaid invoices past their due date, with balance and days late, oldest first.",
  kind: "read",
  roles: READ_ROLES,
  parameters: {
    type: "object",
    properties: { min_days: { type: "number", description: "Minimum days past due (default 0)" } },
    additionalProperties: false,
  },
  validate: (raw) => {
    const args = asObject(raw);
    return { min_days: intArg(args, "min_days", { min: 0, max: 365, fallback: 0 }) };
  },
  execute: (args) => {
    const minDays = Number(args.min_days);
    const rows = listInvoices()
      .filter((i) => i.status !== "Paid" && i.status !== "Cancelled")
      .map((i) => ({
        client: i.client_name,
        invoice: i.invoice_id,
        balance: i.total_amount - (i.paid_amount ?? 0),
        due: i.due_date,
        days_late: Math.max(0, -dayDiff(i.due_date)),
        status: i.status,
      }))
      .filter((i) => i.days_late >= minDays && i.days_late > 0)
      .sort((a, b) => b.days_late - a.days_late)
      .slice(0, 12);
    const total = rows.reduce((s, r) => s + r.balance, 0);
    return {
      summary: `${rows.length} overdue invoice(s) worth ${inr(total)}.`,
      data: { invoices: rows, total_overdue: total },
    };
  },
};

const revenueSummary: ToolDef = {
  name: "revenue_summary",
  description: "Billed, collected, outstanding and receivables ageing buckets.",
  kind: "read",
  roles: READ_ROLES,
  parameters: { type: "object", properties: {}, additionalProperties: false },
  validate: (raw) => asObject(raw),
  execute: () => {
    const invoices = listInvoices().filter((i) => i.status !== "Cancelled");
    const billed = invoices.reduce((s, i) => s + i.total_amount, 0);
    const collected = invoices.reduce((s, i) => s + (i.paid_amount ?? 0), 0);
    const open = invoices.filter((i) => i.total_amount > (i.paid_amount ?? 0));
    const buckets = { not_due: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
    for (const inv of open) {
      const balance = inv.total_amount - (inv.paid_amount ?? 0);
      const late = -dayDiff(inv.due_date);
      if (late <= 0) buckets.not_due += balance;
      else if (late <= 30) buckets.d1_30 += balance;
      else if (late <= 60) buckets.d31_60 += balance;
      else if (late <= 90) buckets.d61_90 += balance;
      else buckets.d90_plus += balance;
    }
    const outstanding = billed - collected;
    return {
      summary: `Billed ${inr(billed)}, collected ${inr(collected)}, outstanding ${inr(outstanding)} (${billed > 0 ? Math.round((collected / billed) * 100) : 0}% collected).`,
      data: { billed, collected, outstanding, buckets, open_invoices: open.length },
    };
  },
};

const utilizationSummary: ToolDef = {
  name: "utilization_summary",
  description: "Logged hours, billable share and approval status by staff member.",
  kind: "read",
  roles: READ_ROLES,
  parameters: { type: "object", properties: {}, additionalProperties: false },
  validate: (raw) => asObject(raw),
  execute: () => {
    const entries = listTimesheets();
    const byStaff = new Map<string, { hours: number; billable: number; approved: number; clients: Set<string> }>();
    for (const t of entries) {
      const row = byStaff.get(t.user_name) ?? { hours: 0, billable: 0, approved: 0, clients: new Set<string>() };
      row.hours += t.hours;
      if (t.billable) row.billable += t.hours;
      if (t.status === "Approved") row.approved += t.hours;
      row.clients.add(t.client_name);
      byStaff.set(t.user_name, row);
    }
    const totalHours = entries.reduce((s, t) => s + t.hours, 0);
    const billableHours = entries.filter((t) => t.billable).reduce((s, t) => s + t.hours, 0);
    const staff = [...byStaff.entries()].map(([name, r]) => ({
      name,
      hours: r.hours,
      billable_hours: r.billable,
      approved_hours: r.approved,
      clients: r.clients.size,
      billable_pct: r.hours > 0 ? Math.round((r.billable / r.hours) * 100) : 0,
    })).sort((a, b) => b.hours - a.hours);
    return {
      summary: `${totalHours.toFixed(1)} hours logged, ${totalHours > 0 ? Math.round((billableHours / totalHours) * 100) : 0}% billable.`,
      data: { total_hours: totalHours, billable_hours: billableHours, staff },
    };
  },
};

const pipelineSummary: ToolDef = {
  name: "pipeline_summary",
  description: "Lead pipeline by stage, hot leads and live proposals.",
  kind: "read",
  roles: READ_ROLES,
  parameters: { type: "object", properties: {}, additionalProperties: false },
  validate: (raw) => asObject(raw),
  execute: () => {
    const leads = listLeads();
    const stages = ["New", "Contacted", "Qualified", "Proposal Sent", "Won", "Lost"] as const;
    const counts = Object.fromEntries(stages.map((s) => [s, leads.filter((l) => l.status === s).length])) as Record<string, number>;
    const hot = leads.filter((l) => l.category === "Hot" && !["Won", "Lost"].includes(l.status));
    const proposals = listProposals();
    return {
      summary: `${leads.filter((l) => !["Won", "Lost"].includes(l.status)).length} open leads, ${hot.length} hot, ${proposals.filter((p) => p.status === "Sent").length} proposals sent.`,
      data: {
        stages: counts,
        hot_leads: hot.slice(0, 6).map((l) => ({ name: l.name, company: l.company_name, status: l.status, score: l.lead_score })),
        proposals_sent: proposals.filter((p) => p.status === "Sent").length,
        proposals_accepted: proposals.filter((p) => p.status === "Accepted").length,
      },
    };
  },
};

const getNotice: ToolDef = {
  name: "get_notice",
  description: "One notice or order record: type, portal, deadline, amount, status and notes — basis for drafting a reply.",
  kind: "read",
  roles: READ_ROLES,
  parameters: {
    type: "object",
    properties: { notice_id: { type: "string", description: "Notice id from the notices module" } },
    required: ["notice_id"],
    additionalProperties: false,
  },
  validate: (raw) => {
    const args = asObject(raw);
    return { notice_id: strArg(args, "notice_id", { max: 30 }) };
  },
  execute: (args) => {
    const notice = listNotices().find((n) => n.notice_id === args.notice_id);
    if (!notice) throw new Error("Unknown notice id");
    return {
      summary: `${notice.notice_type} for ${notice.client_name}, response due ${prettyDate(notice.response_deadline)} (${notice.status}).`,
      data: {
        client: notice.client_name,
        type: notice.notice_type,
        portal: notice.portal,
        received: notice.notice_date,
        deadline: notice.response_deadline,
        reference: notice.reference_number,
        amount: notice.amount,
        status: notice.status,
        notes: notice.notes,
      },
    };
  },
};

// ── Write tools (proposal → approval → execution) ─────────────────────────────

const requestDocument: ToolDef = {
  name: "request_document",
  description: "Create a document request for a client. Requires human approval before it is saved.",
  kind: "write",
  roles: WRITE_ROLES,
  parameters: {
    type: "object",
    properties: {
      client_id: { type: "string", description: "Client id from find_client" },
      document_name: { type: "string", description: "Document to request, e.g. 'Bank statement — Oct 2026'" },
      notes: { type: "string", description: "Optional instructions for the client" },
    },
    required: ["client_id", "document_name"],
    additionalProperties: false,
  },
  validate: (raw) => {
    const args = asObject(raw);
    const clientId = strArg(args, "client_id", { max: 30 });
    if (!getClient(clientId)) throw new Error("Unknown client id");
    return {
      client_id: clientId,
      document_name: strArg(args, "document_name", { max: 160 }),
      notes: strArg(args, "notes", { max: 300, optional: true }),
    };
  },
  preview: (args) => `Request "${args.document_name}" from ${getClient(String(args.client_id))?.name ?? args.client_id}`,
  execute: (args) => {
    const client = getClient(String(args.client_id));
    if (!client) throw new Error("Unknown client id");
    const doc = createDocument({
      client_id: client.client_id,
      client_name: client.name,
      document_name: String(args.document_name),
      status: "Pending",
      requested_date: today(),
      received_date: null,
      notes: String(args.notes ?? ""),
    });
    return { summary: `Document request ${doc.doc_id} created for ${client.name}.` };
  },
};

const COMPLIANCE_TYPES = [
  "GST Filing (GSTR-1)",
  "GST Filing (GSTR-3B)",
  "GST Filing (GSTR-9)",
  "TDS Payment (26Q)",
  "TDS Return (24Q)",
  "ITR Filing",
  "Tax Audit Report",
  "ROC Annual Filing (AOC-4)",
  "ROC Annual Filing (MGT-7)",
  "Trust Audit",
] as const;

const createComplianceTask: ToolDef = {
  name: "create_compliance_task",
  description: "Create one statutory compliance task for a client. Requires human approval before it is saved.",
  kind: "write",
  roles: WRITE_ROLES,
  parameters: {
    type: "object",
    properties: {
      client_id: { type: "string", description: "Client id from find_client" },
      compliance_type: { type: "string", description: "Statutory task type", enum: [...COMPLIANCE_TYPES] },
      period: { type: "string", description: "Period label, e.g. 'Sep 2026' or 'FY 2025-26'" },
      due_date: { type: "string", description: "Due date (YYYY-MM-DD)" },
    },
    required: ["client_id", "compliance_type", "period", "due_date"],
    additionalProperties: false,
  },
  validate: (raw) => {
    const args = asObject(raw);
    const clientId = strArg(args, "client_id", { max: 30 });
    if (!getClient(clientId)) throw new Error("Unknown client id");
    return {
      client_id: clientId,
      compliance_type: enumArg(args, "compliance_type", COMPLIANCE_TYPES),
      period: strArg(args, "period", { max: 40 }),
      due_date: dateArg(args, "due_date"),
    };
  },
  preview: (args) => `Create ${args.compliance_type} for ${getClient(String(args.client_id))?.name ?? args.client_id} (${args.period}, due ${args.due_date})`,
  execute: (args) => {
    const client = getClient(String(args.client_id));
    if (!client) throw new Error("Unknown client id");
    const task = createCompliance({
      client_id: client.client_id,
      client_name: client.name,
      compliance_type: String(args.compliance_type),
      period: String(args.period),
      due_date: String(args.due_date),
      status: "Pending",
      filed_date: null,
      ack_number: "",
      assigned_to: "",
      notes: "Created from the AI assistant (approved)",
    });
    return { summary: `${task.compliance_type} created for ${client.name}, due ${prettyDate(task.due_date)}.` };
  },
};

const logReminder: ToolDef = {
  name: "log_reminder",
  description: "Record that a reminder was sent to a client (does not send anything itself). Requires human approval.",
  kind: "write",
  roles: WRITE_ROLES,
  parameters: {
    type: "object",
    properties: {
      client_id: { type: "string", description: "Client id from find_client" },
      channel: { type: "string", description: "WhatsApp or Email", enum: ["WhatsApp", "Email"] },
      body: { type: "string", description: "Message body that was sent" },
    },
    required: ["client_id", "channel", "body"],
    additionalProperties: false,
  },
  validate: (raw) => {
    const args = asObject(raw);
    const clientId = strArg(args, "client_id", { max: 30 });
    if (!getClient(clientId)) throw new Error("Unknown client id");
    return {
      client_id: clientId,
      channel: enumArg(args, "channel", ["WhatsApp", "Email"] as const),
      body: strArg(args, "body", { max: 800 }),
    };
  },
  preview: (args) => `Log a ${args.channel} reminder to ${getClient(String(args.client_id))?.name ?? args.client_id}`,
  execute: (args) => {
    const client = getClient(String(args.client_id));
    if (!client) throw new Error("Unknown client id");
    const channel = args.channel === "Email" ? "Email" : "WhatsApp";
    const address = channel === "WhatsApp" ? client.phone : client.email;
    if (!address) throw new Error(`No ${channel} address on file for ${client.name}`);
    const message = createMessage({
      channel,
      recipient_name: client.name,
      to_address: address,
      subject: "",
      body: String(args.body),
      related_type: "client",
      related_id: client.client_id,
      status: "Logged",
    });
    return { summary: `Reminder ${message.message_id} logged for ${client.name}.` };
  },
};

// ── Registry ──────────────────────────────────────────────────────────────────

export const TOOLS: ToolDef[] = [
  practiceOverview,
  findClient,
  client360,
  listDeadlines,
  listPendingDocuments,
  listOverdueInvoices,
  revenueSummary,
  utilizationSummary,
  pipelineSummary,
  getNotice,
  requestDocument,
  createComplianceTask,
  logReminder,
];

export function getTool(name: string): ToolDef | undefined {
  return TOOLS.find((t) => t.name === name);
}

/** Tools this role may use at all (read always; writes for partner/manager). */
export function toolsForRole(role: string): ToolDef[] {
  return TOOLS.filter((t) => t.roles.includes(role as Role));
}

/** Provider-facing schemas (OpenAI/Gemini shape). */
export function providerSchemas(tools: ToolDef[]): Array<{ name: string; description: string; parameters: ToolSchema }> {
  return tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
}

/** Serialises a tool outcome for the model as compact JSON (already identifier-free). */
export function outcomeForModel(outcome: ToolOutcome): string {
  return JSON.stringify(outcome.data ?? outcome.summary);
}