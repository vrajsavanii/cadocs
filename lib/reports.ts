/**
 * Unified reporting & BI layer (Prompt 13).
 *
 * Every number here is computed from records the application actually stores.
 * Nothing is modelled, sampled or extrapolated. Where a metric cannot be
 * calculated reliably (for example: message history is capped at the most
 * recent 500 rows), the pack says so explicitly via `basis` notes.
 *
 * All sections accept the same validated `ReportFilters`, and drill-down rows
 * carry ids the UI can link to (/workflow?task=…, /clients?client=…).
 *
 * Access shaping: financial and team sections are computed only for
 * partner/manager viewers; for every other signed-in role those fields are
 * omitted server-side rather than hidden client-side.
 */
import type { AuthUser, Client, DocumentRequest, Invoice, ReportFilters, WorkflowTask } from "./types";
import { all, listAutomationRuns, listClients, listCompliance, listInvoices, listMessages, listPayments, listTimesheets } from "./db";
import { listDocumentRequests } from "./engagements-db";
import { toWorkflowTask } from "./workflow";
import { getService, fyForDate } from "./services";
import { dayDiff, todayISO } from "./format";
import { billingBacklog } from "./billing";

// ── Filter validation ────────────────────────────────────────────────────────

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const YEAR_RANGE = /^\d{4}-\d{2}$/;
const MAX_TEXT = 60;

/**
 * Parses and validates report filters from raw query params or a JSON body.
 * Unknown keys are ignored; invalid values are reported in `invalid` with a
 * human reason while valid parts of the request still parse.
 */
export function parseReportFilters(raw: Record<string, unknown> = {}): { filters: ReportFilters; invalid: string[] } {
  const filters: ReportFilters = {};
  const invalid: string[] = [];
  const text = (key: string, max = MAX_TEXT): string | undefined => {
    if (raw[key] === undefined || raw[key] === null) return undefined;
    const clean = String(raw[key]).trim();
    if (!clean) return undefined;
    if (clean.length > max) {
      invalid.push(`${key}: too long (max ${max} characters)`);
      return undefined;
    }
    return clean;
  };
  const date = (key: "from" | "to"): string | undefined => {
    const value = text(key, 10);
    if (!value) return undefined;
    if (!ISO_DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
      invalid.push(`${key}: must be a calendar date (YYYY-MM-DD)`);
      return undefined;
    }
    return value;
  };

  for (const [key, hint] of [
    ["fy", "fy: use the financial-year form, e.g. 2026-27"] as const,
    ["assessment_year", "assessment_year: use e.g. 2026-27"] as const,
  ] as const) {
    const value = text(key);
    if (!value) continue;
    if (!YEAR_RANGE.test(value)) invalid.push(hint);
    else if (key === "fy") filters.fy = value;
    else filters.assessment_year = value;
  }

  filters.from = date("from");
  filters.to = date("to");
  if (filters.from && filters.to && filters.from > filters.to) {
    invalid.push("from: must not be after to");
    delete filters.from;
    delete filters.to;
  }

  for (const key of [
    "client_id", "compliance_id", "period", "compliance_type", "service_code",
    "assigned_to", "preparer", "reviewer", "manager",
    "invoice_status", "payment_status", "communication_status",
  ] as const) {
    const value = text(key);
    if (value) filters[key] = value;
  }
  return { filters, invalid };
}

/** True when the workflow-enriched engagement satisfies the shared filters. */
function taskMatches(task: WorkflowTask, f: ReportFilters): boolean {
  if (f.fy && (task.fy || fyForDate(task.due_date)) !== f.fy) return false;
  if (f.assessment_year && (task.assessment_year ?? "") !== f.assessment_year) return false;
  if (f.from && task.due_date.slice(0, 10) < f.from) return false;
  if (f.to && task.due_date.slice(0, 10) > f.to) return false;
  if (f.client_id && task.client_id !== f.client_id) return false;
  if (f.compliance_id && task.compliance_id !== f.compliance_id) return false;
  if (f.compliance_type && task.compliance_type !== f.compliance_type) return false;
  if (f.service_code && (task.service_code || "") !== f.service_code) return false;
  if (f.period && task.period !== f.period) return false;
  if (f.assigned_to && task.assigned_to !== f.assigned_to) return false;
  if (f.preparer && task.preparer !== f.preparer) return false;
  if (f.reviewer && task.reviewer !== f.reviewer) return false;
  return true;
}

function invoiceMatches(inv: Invoice, f: ReportFilters): boolean {
  const day = inv.invoice_date.slice(0, 10);
  if (f.fy && (inv.fy || fyForDate(day)) !== f.fy) return false;
  if (f.from && day < f.from) return false;
  if (f.to && day > f.to) return false;
  if (f.client_id && inv.client_id !== f.client_id) return false;
  if (f.invoice_status && inv.status !== f.invoice_status) return false;
  return true;
}

function requestMatches(req: DocumentRequest, f: ReportFilters): boolean {
  if (f.fy && req.fy !== f.fy) return false;
  if (f.from && req.created_at.slice(0, 10) < f.from) return false;
  if (f.to && req.created_at.slice(0, 10) > f.to) return false;
  if (f.client_id && req.client_id !== f.client_id) return false;
  if (f.service_code && req.service_code !== f.service_code) return false;
  if (f.period && req.period !== f.period) return false;
  return true;
}

/** Paise-canonical invoice math with legacy fallbacks. */
export function invoicePaise(inv: Invoice): { total: number; paid: number; balance: number } {
  const total = inv.total_paise ?? Math.round((inv.total_amount || 0) * 100);
  const paid = inv.paid_paise ?? Math.round((inv.paid_amount || 0) * 100);
  return { total, paid, balance: Math.max(0, total - paid) };
}

const rupees = (paise: number): number => Math.round(paise) / 100;

function stateOf(task: WorkflowTask): NonNullable<WorkflowTask["deadline_state"]> {
  return task.deadline_state ?? "not_due";
}

/** Filing evidence = a recorded manual reference XR.integration confirmation. */
function hasFilingEvidence(task: WorkflowTask): boolean {
  return Boolean(task.filing_recorded_at || task.filing_confirmed_by_integration);
}

function isoDaysAgo(days: number): string {
  return new Date(Date.parse(`${todayISO()}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
}

// ── Section 1: firm overview ─────────────────────────────────────────────────

export type FirmOverviewReport = {
  clients: {
    /** Distinct client records — registrations/engagements never multiply this. */
    total: number;
    active: number;
    onboarded_in_window: number;
    with_open_engagements: number;
    with_overdue_work: number;
    with_outstanding_documents: number;
  };
  engagements: {
    total: number;
    open: number;
    due_soon: number;
    due_today: number;
    overdue: number;
    awaiting_documents: number;
    in_preparation: number;
    awaiting_review: number;
    awaiting_correction: number;
    awaiting_filing_or_signoff: number;
    filed_without_evidence: number;
    completed_with_evidence: number;
    blocked: number;
    unassigned: number;
  };
  documents: { requests_open: number; reminders_sent_window: number };
  billing:
    | {
        invoices_open: number;
        overdue_invoices: number;
        outstanding_rupees: number;
        overdue_rupees: number;
        unbilled_completed_cycles: number;
        unbilled_value_rupees: number;
      }
    | null;
  communications: { sent_window: number; failed_window: number };
};

export function buildOverview(args: {
  tasks: WorkflowTask[];
  clients: Client[];
  requests: DocumentRequest[];
  invoices: Invoice[];
  messages: Array<Pick<ReportMessage, "status" | "kind" | "created_at">>;
  reviewReturns: Map<string, number>;
  windowFrom?: string;
  to?: string;
  canSeeMoney: boolean;
}): FirmOverviewReport {
  const { tasks, clients, requests, messages, invoices, reviewReturns, windowFrom, to, canSeeMoney } = args;
  const inRange = (day: string) => (!windowFrom || day >= windowFrom) && (!to || day <= to);
  const openTasks = tasks.filter((t) => t.status !== "Filed");

  const clientIdsWithOpen = new Set(openTasks.map((t) => t.client_id));
  const clientIdsOverdue = new Set(openTasks.filter((t) => dayDiff(t.due_date) < 0).map((t) => t.client_id));
  const clientIdsDocs = new Set(requests.filter((r) => r.status === "Open").map((r) => r.client_id));
  const onboardedWindow = clients.filter((c) => (c.created_at ?? "").slice(0, 10) && inRange((c.created_at ?? "").slice(0, 10))).length;

  const msgWindow = messages.filter((m) => inRange(m.created_at.slice(0, 10)));
  const openInvoices = invoices.filter((i) => i.status !== "Cancelled" && invoicePaise(i).balance > 0);
  const overdueRows = openInvoices.filter((i) => dayDiff(i.due_date) < 0);
  const backlog = billingBacklog();

  return {
    clients: {
      total: clients.length,
      active: clients.filter((c) => (c.client_status ?? "Active") !== "Exited").length,
      onboarded_in_window: windowFrom || to ? onboardedWindow : clients.filter((c) => (c.created_at ?? "").slice(0, 10) >= isoDaysAgo(30)).length,
      with_open_engagements: clientIdsWithOpen.size,
      with_overdue_work: clientIdsOverdue.size,
      with_outstanding_documents: clientIdsDocs.size,
    },
    engagements: {
      total: tasks.length,
      open: openTasks.length,
      due_soon: openTasks.filter((t) => dayDiff(t.due_date) >= 0 && dayDiff(t.due_date) <= 7).length,
      due_today: openTasks.filter((t) => dayDiff(t.due_date) === 0).length,
      overdue: openTasks.filter((t) => dayDiff(t.due_date) < 0).length,
      awaiting_documents: openTasks.filter((t) => stateOf(t) === "blocked_documents").length,
      in_preparation: openTasks.filter((t) => t.stage === "preparation").length,
      awaiting_review: openTasks.filter((t) => t.stage === "review").length,
      awaiting_correction: openTasks.filter((t) => (reviewReturns.get(t.compliance_id) ?? 0) > 0).length,
      awaiting_filing_or_signoff: openTasks.filter((t) => t.stage === "filing" || t.stage === "signoff").length,
      filed_without_evidence: tasks.filter((t) => t.status === "Filed" && !hasFilingEvidence(t)).length,
      completed_with_evidence: tasks.filter((t) => t.status === "Filed" && hasFilingEvidence(t)).length,
      blocked: openTasks.filter((t) => t.has_open_blockers || stateOf(t) === "blocked_documents" || stateOf(t) === "blocked_assignment").length,
      unassigned: openTasks.filter((t) => !t.preparer || !t.reviewer).length,
    },
    documents: {
      requests_open: requests.filter((r) => r.status === "Open").length,
      reminders_sent_window: msgWindow.filter((m) => m.kind === "document_reminder").length,
    },
    billing: canSeeMoney
      ? {
          invoices_open: openInvoices.length,
          overdue_invoices: overdueRows.length,
          outstanding_rupees: rupees(openInvoices.reduce((s, i) => s + invoicePaise(i).balance, 0)),
          overdue_rupees: rupees(overdueRows.reduce((s, i) => s + invoicePaise(i).balance, 0)),
          unbilled_completed_cycles: backlog.unbilled,
          unbilled_value_rupees: rupees(Math.round(backlog.value * 100)),
        }
      : null,
    communications: {
      sent_window: msgWindow.filter((m) => m.status === "Sent").length,
      failed_window: msgWindow.filter((m) => m.status === "Failed").length,
    },
  };
}

type ReportMessage = { message_id: string; status: string; kind?: string; recipient_name: string; error?: string; created_at: string };

// ── Section 2: compliance & deadlines ────────────────────────────────────────

export type DeadlineRow = {
  compliance_id: string;
  client_id: string;
  client: string;
  type: string;
  period: string;
  fy: string;
  assessment_year: string | null;
  due_date: string;
  internal_target_date: string | null;
  statutory_due_date: string | null;
  due_date_source: string;
  state: string;
  stage: string;
  preparer: string;
  reviewer: string;
  docs_pending: number;
  filing_evidence_recorded: boolean;
  ack_number: string | null;
  days_overdue: number;
};

export type DeadlinesReport = {
  buckets: {
    overdue: number;
    due_today: number;
    due_soon: number;
    not_yet_due: number;
    awaiting_review: number;
    awaiting_filing_evidence: number;
    blocked: number;
    completed_on_time: number;
    completed_late: number;
  };
  byService: Array<{ service_code: string; label: string; open: number; overdue: number; completed: number }>;
  byStaff: Array<{ staff: string; open: number; overdue: number }>;
  rows: DeadlineRow[];
  rows_capped: boolean;
};

/**
 * Classifies one engagement for the deadline report. On-time/late compares the
 * recorded filing date against the internal target (falling back to the
 * operative due date) — statutory dates are never used for judgements unless
 * the record carries one.
 */
export function deadlineBucketOf(task: WorkflowTask): keyof DeadlinesReport["buckets"] {
  if (task.status === "Filed") {
    if (!hasFilingEvidence(task)) return "awaiting_filing_evidence";
    return (task.filed_date ?? "") <= (task.internal_target_date ?? task.due_date) ? "completed_on_time" : "completed_late";
  }
  const days = dayDiff(task.due_date);
  if (days < 0) return "overdue";
  if (days === 0) return "due_today";
  if (days <= 7) return "due_soon";
  const state = stateOf(task);
  if (state === "blocked_documents" || state === "blocked_assignment") return "blocked";
  if (state === "awaiting_review" || task.stage === "review") return "awaiting_review";
  return "not_yet_due";
}

function buildDeadlines(tasks: WorkflowTask[]): DeadlinesReport {
  const buckets: DeadlinesReport["buckets"] = {
    overdue: 0, due_today: 0, due_soon: 0, not_yet_due: 0, awaiting_review: 0,
    awaiting_filing_evidence: 0, blocked: 0, completed_on_time: 0, completed_late: 0,
  };
  const serviceMap = new Map<string, { label: string; open: number; overdue: number; completed: number }>();
  const staffMap = new Map<string, { open: number; overdue: number }>();
  const rows: DeadlineRow[] = [];
  let capped = false;
  for (const task of tasks) {
    const bucket = deadlineBucketOf(task);
    buckets[bucket] += 1;
    const complete = bucket === "completed_on_time" || bucket === "completed_late";
    const svc = serviceMap.get(task.service_code) ?? { label: getService(task.service_code)?.name ?? task.compliance_type, open: 0, overdue: 0, completed: 0 };
    if (complete) svc.completed += 1;
    else {
      svc.open += 1;
      if (bucket === "overdue") svc.overdue += 1;
    }
    serviceMap.set(task.service_code, svc);

    const owner = task.preparer || task.assigned_to || "Unassigned";
    const staff = staffMap.get(owner) ?? { open: 0, overdue: 0 };
    if (!complete) {
      staff.open += 1;
      if (bucket === "overdue") staff.overdue += 1;
    }
    staffMap.set(owner, staff);

    if (rows.length >= 400) {
      capped = true;
      continue;
    }
    rows.push({
      compliance_id: task.compliance_id,
      client_id: task.client_id,
      client: task.client_name,
      type: task.compliance_type,
      period: task.period,
      fy: task.fy || fyForDate(task.due_date),
      assessment_year: task.assessment_year ?? null,
      due_date: task.due_date.slice(0, 10),
      internal_target_date: task.internal_target_date ?? null,
      statutory_due_date: task.statutory_due_date ?? null,
      due_date_source: task.due_date_source ?? "",
      state: stateOf(task),
      stage: task.stage,
      preparer: task.preparer,
      reviewer: task.reviewer,
      docs_pending: task.docs_pending,
      filing_evidence_recorded: hasFilingEvidence(task),
      ack_number: task.ack_number ?? null,
      days_overdue: Math.max(0, -dayDiff(task.due_date)),
    });
  }
  return {
    buckets,
    byService: Array.from(serviceMap.entries()).map(([service_code, v]) => ({ service_code, ...v })).sort((a, b) => b.open - a.open),
    byStaff: Array.from(staffMap.entries()).map(([staff, v]) => ({ staff, ...v })).sort((a, b) => b.overdue - a.overdue || b.open - a.open),
    rows: rows.sort((a, b) => a.due_date.localeCompare(b.due_date) || b.days_overdue - a.days_overdue),
    rows_capped: capped,
  };
}

// ── Section 3: client service delivery ───────────────────────────────────────

export type ClientDeliveryRow = {
  client_id: string;
  client: string;
  status: string;
  services: string[];
  open_engagements: number;
  current_stage: string | null;
  preparer: string;
  reviewer: string;
  outstanding_requirements: number;
  next_deadline: string | null;
  open_blockers: number;
  outstanding_rupees: number | null;
  overdue_invoices: number | null;
};

export function buildClientDelivery(
  tasks: WorkflowTask[],
  clients: Client[],
  requests: DocumentRequest[],
  invoices: Invoice[],
  canSeeMoney: boolean,
): ClientDeliveryRow[] {
  const byClient = new Map<string, ClientDeliveryRow>();
  for (const client of clients) {
    byClient.set(client.client_id, {
      client_id: client.client_id,
      client: client.name,
      status: client.client_status ?? client.onboarding_status ?? "Active",
      services: [],
      open_engagements: 0,
      current_stage: null,
      preparer: "",
      reviewer: "",
      outstanding_requirements: 0,
      next_deadline: null,
      open_blockers: 0,
      outstanding_rupees: canSeeMoney ? 0 : null,
      overdue_invoices: canSeeMoney ? 0 : null,
    });
  }
  for (const task of tasks) {
    const row = byClient.get(task.client_id);
    if (!row) continue;
    const svcName = getService(task.service_code)?.name ?? task.service_code;
    if (svcName && !row.services.includes(svcName)) row.services.push(svcName);
    if (task.status !== "Filed") {
      row.open_engagements += 1;
      if (!row.current_stage) row.current_stage = task.stage;
      if (!row.preparer) row.preparer = task.preparer;
      if (!row.reviewer) row.reviewer = task.reviewer;
      const day = task.due_date.slice(0, 10);
      if (!row.next_deadline || day < row.next_deadline) row.next_deadline = day;
    }
    if (task.has_open_blockers) row.open_blockers += 1;
  }
  for (const req of requests) {
    if (req.status !== "Open") continue;
    const row = byClient.get(req.client_id);
    if (row) row.outstanding_requirements += 1;
  }
  if (canSeeMoney) {
    for (const inv of invoices) {
      if (inv.status === "Cancelled") continue;
      const row = byClient.get(inv.client_id);
      if (!row) continue;
      const p = invoicePaise(inv);
      row.outstanding_rupees = (row.outstanding_rupees ?? 0) + rupees(p.balance);
      if (p.balance > 0 && dayDiff(inv.due_date) < 0) row.overdue_invoices = (row.overdue_invoices ?? 0) + 1;
    }
  }
  return Array.from(byClient.values()).sort((a, b) => a.client.localeCompare(b.client));
}

// ── Section 4: document collection ───────────────────────────────────────────

export type DocumentsReport = {
  totals: {
    requirements_open: number;
    cleared: number;
    cleared_rate_percent: number;
    at_reminder_cap: number;
    avg_days_to_clear: number | null;
  };
  byService: Array<{ service_code: string; open: number; cleared: number }>;
  oldest: Array<{ request_id: string; client_id: string; client: string; service_code: string; period: string; created_at: string; days_open: number; reminders_sent: number; reminder_cap: number }>;
};

function buildDocuments(requests: DocumentRequest[]): DocumentsReport {
  const open = requests.filter((r) => r.status === "Open");
  const cleared = requests.filter((r) => r.status !== "Open" && r.cleared_at);
  const avg = cleared.length
    ? Math.round(
        cleared.reduce((s, r) => {
          const a = Date.parse(`${r.created_at.slice(0, 10)}T00:00:00Z`);
          const b = Date.parse(`${(r.cleared_at ?? "").slice(0, 10)}T00:00:00Z`);
          return s + (Number.isNaN(a) || Number.isNaN(b) ? 0 : Math.max(0, Math.round((b - a) / 86_400_000)));
        }, 0) / cleared.length,
      )
    : null;
  const byService = new Map<string, { open: number; cleared: number }>();
  for (const r of requests) {
    const entry = byService.get(r.service_code) ?? { open: 0, cleared: 0 };
    if (r.status === "Open") entry.open += 1;
    else entry.cleared += 1;
    byService.set(r.service_code, entry);
  }
  return {
    totals: {
      requirements_open: open.length,
      cleared: cleared.length,
      cleared_rate_percent: requests.length ? Math.round((cleared.length / requests.length) * 100) : 0,
      at_reminder_cap: open.filter((r) => r.reminders_sent >= r.reminder_cap).length,
      avg_days_to_clear: avg,
    },
    byService: Array.from(byService.entries()).map(([service_code, v]) => ({ service_code, ...v })).sort((a, b) => b.open - a.open),
    oldest: open
      .map((r) => ({
        request_id: r.request_id,
        client_id: r.client_id,
        client: r.client_name,
        service_code: r.service_code,
        period: r.period,
        created_at: r.created_at.slice(0, 10),
        days_open: Math.max(0, -dayDiff(r.created_at.slice(0, 10))),
        reminders_sent: r.reminders_sent,
        reminder_cap: r.reminder_cap,
      }))
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .slice(0, 100),
  };
}

// ── Section 5: staff workload ────────────────────────────────────────────────

export type StaffRow = {
  staff: string;
  role: string;
  open_engagements: number;
  overdue: number;
  due_soon: number;
  awaiting_their_review: number;
  completed_in_window: number;
  billable_hours: number;
  total_hours: number;
};

export function buildStaffWorkload(
  tasks: WorkflowTask[],
  timesheets: Array<{ user_name: string; hours: number; billable: boolean; status: string; date: string }>,
  staffDirectory: Map<string, string>,
  windowFrom?: string,
  to?: string,
): StaffRow[] {
  const names = new Set<string>();
  for (const t of tasks) {
    if (t.preparer) names.add(t.preparer);
    if (t.reviewer) names.add(t.reviewer);
    if (t.assigned_to) names.add(t.assigned_to);
  }
  for (const name of staffDirectory.keys()) names.add(name);
  const rows: StaffRow[] = [];
  for (const staff of Array.from(names).sort((a, b) => a.localeCompare(b))) {
    const mine = tasks.filter((t) => t.assigned_to === staff || t.preparer === staff);
    const open = mine.filter((t) => t.status !== "Filed");
    rows.push({
      staff,
      role: staffDirectory.get(staff) ?? "article",
      open_engagements: open.length,
      overdue: open.filter((t) => dayDiff(t.due_date) < 0).length,
      due_soon: open.filter((t) => dayDiff(t.due_date) >= 0 && dayDiff(t.due_date) <= 7).length,
      awaiting_their_review: tasks.filter((t) => t.stage === "review" && t.reviewer === staff && t.status !== "Filed").length,
      completed_in_window: mine.filter((t) => {
        const day = (t.completed_at ?? "").slice(0, 10);
        return t.status === "Filed" && day && (!windowFrom || day >= windowFrom) && (!to || day <= to);
      }).length,
      billable_hours: 0,
      total_hours: 0,
    });
  }
  for (const sheet of timesheets) {
    const row = rows.find((r) => r.staff === sheet.user_name);
    if (!row) continue;
    row.total_hours += sheet.hours;
    if (sheet.billable) row.billable_hours += sheet.hours;
  }
  return rows.sort((a, b) => b.overdue - a.overdue || b.open_engagements - a.open_engagements);
}

// ── Section 6: review bottlenecks ────────────────────────────────────────────

export type ReviewRow = {
  compliance_id: string;
  client: string;
  type: string;
  period: string;
  reviewer: string;
  stage_since: string | null;
  days_in_review: number;
  review_rounds: number;
};

export function buildReviewBottlenecks(
  tasks: WorkflowTask[],
  stageEvents: Array<{ compliance_id: string; from_stage: string | null; to_stage: string; created_at: string }>,
): { rows: ReviewRow[]; total_pending: number; oldest_days: number | null; rejected_back_to_prep: Map<string, number> } {
  const rows: ReviewRow[] = [];
  const rejected = new Map<string, number>();
  for (const event of stageEvents) {
    if (event.from_stage === "review" && event.to_stage === "preparation") {
      rejected.set(event.compliance_id, (rejected.get(event.compliance_id) ?? 0) + 1);
    }
  }
  for (const task of tasks) {
    if (task.status === "Filed" || task.stage !== "review") continue;
    const enters = stageEvents.filter((e) => e.compliance_id === task.compliance_id && e.to_stage === "review").map((e) => e.created_at).sort();
    const entered = enters.length ? enters[enters.length - 1]! : task.stage_updated_at ?? null;
    rows.push({
      compliance_id: task.compliance_id,
      client: task.client_name,
      type: task.compliance_type,
      period: task.period,
      reviewer: task.reviewer,
      stage_since: entered ? entered.slice(0, 10) : null,
      days_in_review: entered ? Math.max(0, -dayDiff(entered.slice(0, 10))) : 0,
      review_rounds: enters.length,
    });
  }
  rows.sort((a, b) => b.days_in_review - a.days_in_review);
  return {
    rows: rows.slice(0, 200),
    total_pending: rows.length,
    oldest_days: rows.length ? rows[0]!.days_in_review : null,
    rejected_back_to_prep: rejected,
  };
}

// ── Section 7: invoices & collections ────────────────────────────────────────

export type CollectionsReport = {
  basis_note: string;
  totals: { billed_rupees: number; collected_rupees: number; outstanding_rupees: number; overdue_rupees: number; open_count: number; overdue_count: number };
  aging: Array<{ bucket: string; amount_rupees: number; count: number }>;
  monthly: { month: string; billed_rupees: number; collected_rupees: number }[];
  overdueRows: Array<{ invoice_id: string; client_id: string; client: string; number: string; due_date: string; balance_rupees: number; days_overdue: number }>;
};

export function buildCollections(
  invoices: Invoice[],
  payments: Array<{ amount: number; paid_on: string }>,
  filters: ReportFilters,
): CollectionsReport {
  const active = invoices.filter((i) => invoiceMatches(i, filters) && i.status !== "Cancelled");
  const totalPaise = active.reduce((s, i) => s + invoicePaise(i).total, 0);
  const paidPaise = active.reduce((s, i) => s + invoicePaise(i).paid, 0);
  const open = active.filter((i) => invoicePaise(i).balance > 0);
  const overdueRows = open.filter((i) => dayDiff(i.due_date) < 0);
  const buckets: CollectionsReport["aging"] = [
    { bucket: "Not due", amount_rupees: 0, count: 0 },
    { bucket: "1–30 days", amount_rupees: 0, count: 0 },
    { bucket: "31–60 days", amount_rupees: 0, count: 0 },
    { bucket: "61–90 days", amount_rupees: 0, count: 0 },
    { bucket: "90+ days", amount_rupees: 0, count: 0 },
  ];
  for (const inv of open) {
    const days = -dayDiff(inv.due_date);
    const idx = days <= 0 ? 0 : days <= 30 ? 1 : days <= 60 ? 2 : days <= 90 ? 3 : 4;
    buckets[idx].amount_rupees += rupees(invoicePaise(inv).balance);
    buckets[idx].count += 1;
  }
  const monthly: CollectionsReport["monthly"] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    monthly.push({
      month: d.toLocaleDateString("en-IN", { month: "short" }),
      billed_rupees: rupees(active.filter((inv) => inv.invoice_date.slice(0, 7) === key).reduce((s, inv) => s + invoicePaise(inv).total, 0)),
      collected_rupees: Math.round(payments.filter((p) => p.paid_on.slice(0, 7) === key).reduce((s, p) => s + p.amount, 0) * 100) / 100,
    });
  }
  return {
    basis_note: "Billed uses invoice issue dates; collected uses recorded ledger payment dates; balances are net of credit notes.",
    totals: {
      billed_rupees: rupees(totalPaise),
      collected_rupees: rupees(paidPaise),
      outstanding_rupees: rupees(totalPaise - paidPaise),
      overdue_rupees: rupees(overdueRows.reduce((s, i) => s + invoicePaise(i).balance, 0)),
      open_count: open.length,
      overdue_count: overdueRows.length,
    },
    aging: buckets,
    monthly,
    overdueRows: overdueRows
      .map((i) => ({
        invoice_id: i.invoice_id,
        client_id: i.client_id,
        client: i.client_name,
        number: i.invoice_number || i.invoice_id,
        due_date: i.due_date.slice(0, 10),
        balance_rupees: rupees(invoicePaise(i).balance),
        days_overdue: -dayDiff(i.due_date),
      }))
      .sort((a, b) => b.days_overdue - a.days_overdue)
      .slice(0, 100),
  };
}

// ── Section 8: annual ITR / audit progress ───────────────────────────────────

export type AnnualProgressReport = {
  basis_note: string;
  byAssessmentYear: Array<{
    assessment_year: string;
    itr_total: number;
    itr_filed: number;
    itr_filing_evidence: number;
    audit_total: number;
    audit_completed: number;
  }>;
  rows: Array<{ compliance_id: string; client: string; kind: "ITR" | "Audit"; type: string; assessment_year: string; stage: string; state: string; filing_evidence_recorded: boolean }>;
};

export function buildAnnualProgress(tasks: WorkflowTask[]): AnnualProgressReport {
  const ayMap = new Map<string, { itr_total: number; itr_filed: number; itr_filing_evidence: number; audit_total: number; audit_completed: number }>();
  const rows: AnnualProgressReport["rows"] = [];
  for (const task of tasks) {
    const line = getService(task.service_code)?.line;
    const kind: "ITR" | "Audit" | null = line === "income_tax" ? "ITR" : line === "audit" ? "Audit" : null;
    if (!kind) continue;
    const ay = task.assessment_year || "";
    const entry = ayMap.get(ay) ?? { itr_total: 0, itr_filed: 0, itr_filing_evidence: 0, audit_total: 0, audit_completed: 0 };
    if (kind === "ITR") {
      entry.itr_total += 1;
      if (task.status === "Filed") entry.itr_filed += 1;
      if (hasFilingEvidence(task)) entry.itr_filing_evidence += 1;
    } else {
      entry.audit_total += 1;
      if (task.status === "Filed" && hasFilingEvidence(task)) entry.audit_completed += 1;
    }
    ayMap.set(ay, entry);
    rows.push({
      compliance_id: task.compliance_id,
      client: task.client_name,
      kind,
      type: task.compliance_type,
      assessment_year: ay || "not recorded",
      stage: task.stage,
      state: stateOf(task),
      filing_evidence_recorded: hasFilingEvidence(task),
    });
  }
  return {
    basis_note: "Engagements count as completed only when filing evidence (recorded reference or integration confirmation) exists — a Filed flag alone is never counted.",
    byAssessmentYear: Array.from(ayMap.entries()).map(([assessment_year, v]) => ({ assessment_year: assessment_year || "not recorded", ...v })),
    rows,
  };
}

// ── Section 9: communications ────────────────────────────────────────────────

export type CommunicationsReport = {
  basis_note: string;
  window_days: number;
  byStatus: Record<string, number>;
  byKind: Record<string, number>;
  failures: Array<{ message_id: string; recipient: string; kind: string; error: string; created_at: string }>;
};

export function buildCommunications(messages: ReportMessage[], windowDays = 30): CommunicationsReport {
  const cutoff = new Date(Date.now() - windowDays * 86_400_000).toISOString();
  const scoped = messages.filter((m) => m.created_at >= cutoff);
  const byStatus: Record<string, number> = {};
  const byKind: Record<string, number> = {};
  for (const m of scoped) {
    byStatus[m.status] = (byStatus[m.status] ?? 0) + 1;
    byKind[m.kind || "manual"] = (byKind[m.kind || "manual"] ?? 0) + 1;
  }
  return {
    basis_note: `Counts cover the retained message history (storage caps mean totals are floors for older periods); window: last ${windowDays} days.`,
    window_days: windowDays,
    byStatus,
    byKind,
    failures: scoped
      .filter((m) => m.status === "Failed")
      .slice(0, 20)
      .map((m) => ({ message_id: m.message_id, recipient: m.recipient_name, kind: m.kind || "manual", error: m.error ?? "", created_at: m.created_at })),
  };
}

// ── Section 10: operational exceptions (management attention) ────────────────

export type ExceptionItem = {
  kind:
    | "overdue_filing"
    | "unassigned_engagement"
    | "long_pending_review"
    | "blocked_engagement"
    | "overdue_invoice"
    | "failed_job"
    | "failed_communication"
    | "awaiting_partner_approval";
  severity: "high" | "medium";
  title: string;
  detail: string;
  href: string;
};

export function buildExceptions(
  tasks: WorkflowTask[],
  invoices: Invoice[],
  reviews: Pick<ReturnType<typeof buildReviewBottlenecks>, "rows">,
  canSeeMoney: boolean,
  failedRuns: Array<{ rule_name: string; summary: string }>,
  failedMessages: CommunicationsReport["failures"],
): ExceptionItem[] {
  const items: ExceptionItem[] = [];
  const push = (item: ExceptionItem) => {
    if (items.length < 60) items.push(item);
  };

  for (const t of tasks.filter((t) => t.status !== "Filed" && dayDiff(t.due_date) < 0)) {
    push({
      kind: "overdue_filing",
      severity: "high",
      title: `${t.client_name} — ${t.compliance_type} (${t.period})`,
      detail: `${-dayDiff(t.due_date)} day(s) past the operative deadline; stage ${t.stage}${t.docs_pending ? `, ${t.docs_pending} document(s) pending` : ""}.`,
      href: `/workflow?task=${t.compliance_id}`,
    });
  }
  for (const t of tasks.filter((t) => t.status !== "Filed" && (!t.preparer || !t.reviewer))) {
    push({
      kind: "unassigned_engagement",
      severity: "medium",
      title: `${t.client_name} — ${t.compliance_type} (${t.period})`,
      detail: !t.preparer && !t.reviewer ? "No preparer and no reviewer assigned." : `Missing ${!t.preparer ? "preparer" : "reviewer"}.`,
      href: `/workflow?task=${t.compliance_id}`,
    });
  }
  for (const r of reviews.rows.slice(0, 10)) {
    push({
      kind: "long_pending_review",
      severity: "medium",
      title: `${r.client} — ${r.type} (${r.period})`,
      detail: `In review for ${r.days_in_review} day(s) with ${r.reviewer || "no reviewer named"}.`,
      href: `/workflow?task=${r.compliance_id}`,
    });
  }
  for (const t of tasks.filter((t) => t.status !== "Filed" && t.has_open_blockers)) {
    push({
      kind: "blocked_engagement",
      severity: "medium",
      title: `${t.client_name} — ${t.compliance_type} (${t.period})`,
      detail: `Blocked at stage ${t.stage}: ${t.blocked_reason || `${t.docs_pending} document(s) or a dependency.`}`,
      href: `/workflow?task=${t.compliance_id}`,
    });
  }
  if (canSeeMoney) {
    for (const i of invoices.filter((x) => x.status !== "Cancelled" && invoicePaise(x).balance > 0 && dayDiff(x.due_date) < 0)) {
      push({
        kind: "overdue_invoice",
        severity: "high",
        title: `${i.client_name} — invoice ${i.invoice_number || i.invoice_id}`,
        detail: `${rupees(invoicePaise(i).balance)} outstanding, ${-dayDiff(i.due_date)} day(s) past due.`,
        href: "/invoices",
      });
    }
  }
  for (const run of failedRuns) {
    push({
      kind: "failed_job",
      severity: "medium",
      title: `Automation rule failed: ${run.rule_name}`,
      detail: run.summary.slice(0, 200),
      href: "/automation",
    });
  }
  for (const m of failedMessages) {
    push({
      kind: "failed_communication",
      severity: "medium",
      title: `Message failed: ${m.recipient}`,
      detail: (m.error || "provider error").slice(0, 200),
      href: "/automation",
    });
  }
  const signoff = tasks.filter((t) => t.stage === "signoff" && t.status !== "Filed").length;
  if (signoff) {
    push({
      kind: "awaiting_partner_approval",
      severity: "medium",
      title: `${signoff} engagement(s) awaiting partner sign-off`,
      detail: "Work reached sign-off but has not been closed by a partner.",
      href: "/workflow",
    });
  }
  return items;
}

// ── Assembled pack ───────────────────────────────────────────────────────────

export type UnifiedReports = {
  generated_at: string;
  viewer_role: string;
  /** `full` = partner/manager: financial + team sections are present. */
  scope: "full" | "personal";
  filters: ReportFilters;
  /** Explicit statement of which timestamps each section is based on. */
  basis: string[];
  overview: FirmOverviewReport;
  deadlines: DeadlinesReport;
  clientDelivery: ClientDeliveryRow[];
  documents: DocumentsReport;
  staff: StaffRow[];
  reviews: ReturnType<typeof buildReviewBottlenecks>;
  collections: CollectionsReport | null;
  communications: CommunicationsReport;
  annual: AnnualProgressReport;
  exceptions: ExceptionItem[];
};

/**
 * Builds the full reporting pack for one validated filter set. Financial and
 * team-overview sections are computed only for partner/manager viewers; for
 * everyone else they are omitted (never zeroed) so the access boundary stays
 * server-side.
 */
export function getUnifiedReports(filters: ReportFilters, viewer: AuthUser | null): UnifiedReports {
  const supervisory = Boolean(viewer && (viewer.role === "partner" || viewer.role === "manager"));

  const tasks = listCompliance().map(toWorkflowTask).filter((t) => taskMatches(t, filters));
  const invoices = listInvoices().filter((i) => invoiceMatches(i, filters));
  const requests = listDocumentRequests(filters.client_id).filter((r) => requestMatches(r, filters));
  const messages: ReportMessage[] = listMessages().map((m) => ({
    message_id: m.message_id,
    status: m.status,
    kind: m.kind,
    recipient_name: m.recipient_name,
    error: m.error,
    created_at: m.created_at,
  }));
  const timesheets = listTimesheets().filter((t) => (!filters.from || t.date >= filters.from) && (!filters.to || t.date <= (filters.to ?? "9999-12-31")));
  const payments = listPayments().map((p) => ({ amount: p.amount, paid_on: p.paid_on }));
  const clients = listClients().filter((c) => (filters.client_id ? c.client_id === filters.client_id : true));
  const staffDirectory = new Map(all<{ name: string; role: string }>("SELECT name, role FROM users").map((r) => [r.name, r.role]));
  const failedRuns = supervisory
    ? listAutomationRuns(50)
        .filter((r) => r.status === "failed")
        .map((r) => ({ rule_name: r.rule_name, summary: r.summary }))
    : [];

  const deadlines = buildDeadlines(tasks);
  const documents = buildDocuments(requests);
  const reviews = buildReviewBottlenecks(
    tasks,
    all<{ compliance_id: string; from_stage: string | null; to_stage: string; created_at: string }>(
      "SELECT compliance_id, from_stage, to_stage, created_at FROM task_events ORDER BY created_at",
    ),
  );
  const communications = buildCommunications(messages, 30);
  const annual = buildAnnualProgress(tasks);
  const exceptions = buildExceptions(tasks, invoices, reviews, supervisory, failedRuns, communications.failures);
  const overview = buildOverview({
    tasks,
    clients,
    requests,
    invoices,
    messages,
    reviewReturns: reviews.rejected_back_to_prep,
    windowFrom: filters.from,
    to: filters.to,
    canSeeMoney: supervisory,
  });

  return {
    generated_at: new Date().toISOString(),
    viewer_role: viewer?.role ?? "anonymous",
    scope: supervisory ? "full" : "personal",
    filters,
    basis: [
      ...new Set(
        [
          "Deadline basis: operative internal target dates (with statutory dates from verified due-date rules or audited overrides shown separately) — never invented.",
          "Completion basis: a Filed flag counts as completion only with recorded filing evidence (reference or integration confirmation).",
          "Billing basis: invoice issue date for billed, recorded ledger payment dates for collected; balances net of credit notes.",
          `Communication basis: retained message history inside a ${communications.window_days}-day window (storage-capped).`,
          filters.fy ? "The FY filter matches each record's own financial year; records without one fall back to the FY of their date." : "",
          supervisory ? "Financial and team-overview sections are included for this role." : "Financial and team-overview sections are omitted for this role.",
        ].filter(Boolean),
      ),
    ],
    overview,
    deadlines,
    clientDelivery: buildClientDelivery(tasks, clients, requests, invoices, supervisory),
    documents,
    staff: supervisory ? buildStaffWorkload(tasks, timesheets, staffDirectory, filters.from, filters.to) : [],
    reviews,
    collections: supervisory ? buildCollections(invoices, payments, filters) : null,
    communications,
    annual,
    exceptions,
  };
}
