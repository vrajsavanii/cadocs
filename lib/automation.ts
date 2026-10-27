/**
 * The automation layer: the repetitive half of a CA firm's week, run as rules.
 *
 * A rule is a **standing approval**. A partner or manager configures it once
 * ("chase documents older than 5 days, every morning") and the sweep executes
 * it unattended. Two execution modes keep that honest:
 *
 *   - `auto`     — the sweep executes the action and writes a run record.
 *                  Used for low-risk, reversible work: queuing a chaser,
 *                  creating statutory tasks, recording an escalation.
 *   - `approval` — the sweep prepares the action as a pending ai_action; a
 *                  partner approves it in the copilot before anything runs.
 *
 * Nothing here sends a message by itself — client communication is queued as
 * `Queued` outbox items with a deep link, exactly like the manual reminder
 * flow. Every run lands in automation_runs and the audit log.
 *
 * Keyless by design: rules execute through the same typed tool registry the
 * chat agent uses (`lib/ai-tools.ts`), so validation, role scoping and
 * argument re-checks apply identically. The natural-language planner works
 * without a provider and only *polishes* its answer with one.
 */
import type { AuthUser, AutomationCadence, AutomationKind, AutomationMode, AutomationRule, AutomationRun } from "./types";
import {
  createAiAction,
  listAutomationRules,
  listClients,
  listCompliance,
  listDocuments,
  listDsc,
  listInvoices,
  listNotices,
  logAudit,
  logAutomationRun,
  markAutomationRuleRun,
} from "./db";
import { getTool } from "./ai-tools";
import { inr, prettyDate } from "./format";
import { complete } from "./ai";

// ── Action catalogue ──────────────────────────────────────────────────────────

export type AutomationActionInfo = {
  kind: AutomationKind;
  label: string;
  blurb: string;
  /** `auto` may execute unattended; every kind here is reversible + audited. */
  internal: boolean;
  defaultMode: AutomationMode;
  defaultCadence: AutomationCadence;
};

export const AUTOMATION_ACTIONS: AutomationActionInfo[] = [
  {
    kind: "chase_documents",
    label: "Chase pending documents",
    blurb: "One WhatsApp/email chaser per client for every request older than N days — queued in the outbox.",
    internal: false,
    defaultMode: "auto",
    defaultCadence: "daily",
  },
  {
    kind: "dunning",
    label: "Recover overdue fees",
    blurb: "A reminder per client for invoices past N days, with tone escalating gentle → firm → final.",
    internal: false,
    defaultMode: "auto",
    defaultCadence: "daily",
  },
  {
    kind: "generate_compliance",
    label: "Generate recurring filings",
    blurb: "Create the month's GSTR-3B/1, TDS, ITR or ROC tasks for every client in one sweep, duplicate-safe.",
    internal: false,
    defaultMode: "auto",
    defaultCadence: "monthly",
  },
  {
    kind: "escalate_overdue",
    label: "Escalate overdue filings",
    blurb: "Flag filings past their due date by more than N days to the partner, with the owners named.",
    internal: true,
    defaultMode: "auto",
    defaultCadence: "daily",
  },
  {
    kind: "dsc_watch",
    label: "Watch DSC expiry",
    blurb: "Raise a warning when any DSC expires within N days, before filing rejections start.",
    internal: true,
    defaultMode: "auto",
    defaultCadence: "daily",
  },
  {
    kind: "notice_watch",
    label: "Watch notice deadlines",
    blurb: "Alert when a tax notice response is due within N days — and again when it is overdue.",
    internal: true,
    defaultMode: "auto",
    defaultCadence: "daily",
  },
];

export function actionInfo(kind: AutomationKind): AutomationActionInfo {
  return AUTOMATION_ACTIONS.find((a) => a.kind === kind) ?? AUTOMATION_ACTIONS[0]!;
}

// ── Parameter model ───────────────────────────────────────────────────────────

export type AutomationParams = {
  /** chase_documents / dunning */
  older_than_days?: number;
  min_days_late?: number;
  min_balance?: number;
  channel?: "WhatsApp" | "Email";
  limit?: number;
  /** generate_compliance */
  compliance_type?: string;
  due_day?: number;
  months_ahead?: number;
  period_mode?: "month" | "fy";
  assigned_to?: string;
  period?: string;
  due_date?: string;
  /** escalate_overdue */
  escalate_days?: number;
  /** dsc_watch / notice_watch */
  within_days?: number;
};

const num = (value: unknown, fallback: number, min: number, max: number): number => {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
};

const COMPLIANCE_TYPE_LIST = [
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

/**
 * Normalises any params object into the shape the action understands.
 * Model output and hand-written JSON both pass through here, so a rule can
 * never carry an argument the executor does not expect.
 */
export function sanitizeParams(kind: AutomationKind, raw: unknown): AutomationParams {
  const input = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const channel: "WhatsApp" | "Email" = input.channel === "Email" ? "Email" : "WhatsApp";

  if (kind === "chase_documents") {
    return {
      older_than_days: num(input.older_than_days, 5, 0, 120),
      channel,
      limit: num(input.limit, 20, 1, 40),
    };
  }
  if (kind === "dunning") {
    return {
      min_days_late: num(input.min_days_late, 30, 1, 365),
      min_balance: num(input.min_balance, 0, 0, 100_000_000),
      channel,
      limit: num(input.limit, 20, 1, 40),
    };
  }
  if (kind === "generate_compliance") {
    const type = COMPLIANCE_TYPE_LIST.includes(String(input.compliance_type) as (typeof COMPLIANCE_TYPE_LIST)[number])
      ? String(input.compliance_type)
      : "GST Filing (GSTR-3B)";
    const out: AutomationParams = {
      compliance_type: type,
      due_day: num(input.due_day, 20, 1, 28),
      months_ahead: num(input.months_ahead, 1, 0, 3),
      period_mode: input.period_mode === "fy" ? "fy" : "month",
    };
    if (typeof input.assigned_to === "string" && input.assigned_to.trim()) out.assigned_to = input.assigned_to.trim().slice(0, 60);
    return out;
  }
  if (kind === "escalate_overdue") {
    return { escalate_days: num(input.escalate_days, 3, 1, 60) };
  }
  if (kind === "dsc_watch") {
    return { within_days: num(input.within_days, 30, 1, 180) };
  }
  return { within_days: num(input.within_days, 3, 1, 60) };
}

/** Short human sentence for a rule's configured behaviour (UI + planner). */
export function explainRule(rule: Pick<AutomationRule, "action" | "params" | "cadence">): string {
  const p = sanitizeParams(rule.action, rule.params);
  const every = rule.cadence === "daily" ? "Every day" : rule.cadence === "weekly" ? "Every week" : "Every month";
  switch (rule.action) {
    case "chase_documents":
      return `${every}: one ${p.channel} chaser per client for documents waiting ${p.older_than_days}+ days (up to ${p.limit} clients).`;
    case "dunning":
      return `${every}: one ${p.channel} reminder per client for invoices ${p.min_days_late}+ days late${p.min_balance ? ` above ${inr(p.min_balance)}` : ""} (tone escalates with age).`;
    case "generate_compliance":
      return `${every}: create ${p.compliance_type} for all clients, period ${
        p.period_mode === "fy" ? "FY label" : "month label"
      }, due on the ${p.due_day}${ordinal(p.due_day!)}, ${p.months_ahead === 0 ? "this month" : `${p.months_ahead} month(s) ahead`}.`;
    case "escalate_overdue":
      return `${every}: escalate filings more than ${p.escalate_days} day(s) overdue to the partner, naming owners.`;
    case "dsc_watch":
      return `${every}: warn about DSCs expiring within ${p.within_days} days.`;
    case "notice_watch":
      return `${every}: alert on notice responses due within ${p.within_days} day(s).`;
  }
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] ?? s[v] ?? s[0]!;
}

// ── Presets (the CA-firm playbook) ────────────────────────────────────────────

export type RulePreset = {
  id: string;
  name: string;
  action: AutomationKind;
  params: AutomationParams;
  mode: AutomationMode;
  cadence: AutomationCadence;
  why: string;
};

export const RULE_PRESETS: RulePreset[] = [
  {
    id: "chase-5",
    name: "Chase documents after 5 days",
    action: "chase_documents",
    params: { older_than_days: 5, channel: "WhatsApp", limit: 25 },
    mode: "auto",
    cadence: "daily",
    why: "The #1 cited pain point: bank statements and purchase registers that arrive in pieces.",
  },
  {
    id: "dunning-30",
    name: "Dun invoices after 30 days",
    action: "dunning",
    params: { min_days_late: 30, min_balance: 0, channel: "WhatsApp", limit: 25 },
    mode: "auto",
    cadence: "daily",
    why: "Fees cross 30/60/90 days quietly; a standing rule stops the awkward call being optional.",
  },
  {
    id: "gstr-3b",
    name: "Raise GSTR-3B for all clients",
    action: "generate_compliance",
    params: { compliance_type: "GST Filing (GSTR-3B)", due_day: 20, months_ahead: 1, period_mode: "month" },
    mode: "auto",
    cadence: "monthly",
    why: "Monthly filings are identical every month — one sweep replaces the whole spreadsheet ritual.",
  },
  {
    id: "tds-26q",
    name: "Raise TDS 26Q for all clients",
    action: "generate_compliance",
    params: { compliance_type: "TDS Payment (26Q)", due_day: 7, months_ahead: 1, period_mode: "month" },
    mode: "auto",
    cadence: "monthly",
    why: "A missed TDS cycle costs interest and a notice; the calendar should create itself.",
  },
  {
    id: "escalate-3",
    name: "Escalate filings 3 days overdue",
    action: "escalate_overdue",
    params: { escalate_days: 3 },
    mode: "auto",
    cadence: "daily",
    why: "Overdue statutory work should reach the partner before it reaches the client's notice inbox.",
  },
  {
    id: "dsc-30",
    name: "Warn on DSC expiring in 30 days",
    action: "dsc_watch",
    params: { within_days: 30 },
    mode: "auto",
    cadence: "daily",
    why: "An expired token at filing time is a rejected return and a wasted day.",
  },
  {
    id: "notice-3",
    name: "Watch notice deadlines",
    action: "notice_watch",
    params: { within_days: 3 },
    mode: "auto",
    cadence: "daily",
    why: "A response window missed by a day can double the exposure.",
  },
];

// ── Scheduling ────────────────────────────────────────────────────────────────

/** Local calendar day (YYYY-MM-DD) for cadence comparisons. */
function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/**
 * Elapsed-time scheduling rather than cron-string matching: the app may be
 * swept by a daily cron, by the operator pressing Run, or not at all for a
 * few days. A rule is due when its cadence window has elapsed.
 */
export function ruleIsDue(rule: AutomationRule, now = new Date()): boolean {
  if (!rule.last_run_at) return true;
  const last = new Date(rule.last_run_at);
  if (Number.isNaN(last.getTime())) return true;
  const days = (now.getTime() - last.getTime()) / 86_400_000;
  if (rule.cadence === "daily") return dayKey(last) !== dayKey(now);
  if (rule.cadence === "weekly") return days >= 6;
  return days >= 27;
}

// ── Execution ─────────────────────────────────────────────────────────────────

export type RuleExecution = {
  status: AutomationRun["status"];
  summary: string;
  detail: Record<string, unknown>;
  actions: number;
};

type ExecContext = { user: AuthUser; dryRun?: boolean };

/** Runs one rule and returns what happened (without recording the run). */
export function executeRule(rule: AutomationRule, ctx: ExecContext): RuleExecution {
  const params = sanitizeParams(rule.action, rule.params);

  if (rule.action === "escalate_overdue") return escalateOverdue(params, ctx);
  if (rule.action === "dsc_watch") return dscWatch(params, ctx);
  if (rule.action === "notice_watch") return noticeWatch(params, ctx);

  // Tool-backed actions: chase, dunning, generate.
  const toolName =
    rule.action === "chase_documents" ? "chase_documents_bulk" : rule.action === "dunning" ? "dunning_bulk" : "generate_compliance_batch";
  const tool = getTool(toolName);
  if (!tool) return { status: "failed", summary: `Action ${rule.action} is unavailable`, detail: {}, actions: 0 };

  let args: Record<string, unknown>;
  try {
    args = tool.validate({ ...resolvedArgs(rule.action, params) });
  } catch (err) {
    return { status: "failed", summary: `Invalid rule configuration: ${(err as Error).message}`, detail: {}, actions: 0 };
  }

  if (rule.mode === "approval") {
    if (ctx.dryRun) {
      return { status: "ok", summary: `[dry run] would prepare: ${tool.preview?.(args) ?? tool.name}`, detail: { mode: "approval", preview: tool.preview?.(args) ?? tool.name }, actions: 0 };
    }
    const row = createAiAction({ user_id: ctx.user.user_id, tool: tool.name, args, title: tool.preview?.(args) ?? tool.name });
    return {
      status: "pending-approval",
      summary: `Prepared for approval: ${row.title}`,
      detail: { action_id: row.action_id, tool: tool.name },
      actions: 0,
    };
  }

  if (ctx.dryRun) {
    const preview = tool.preview?.(args) ?? tool.name;
    return { status: "ok", summary: `[dry run] would run: ${preview}`, detail: { preview }, actions: 0 };
  }

  try {
    const outcome = tool.execute(args, { user: ctx.user });
    const created = Number((outcome.data as { created?: number; queued?: number } | undefined)?.created ?? 0);
    const queued = Number((outcome.data as { queued?: number } | undefined)?.queued ?? 0);
    return {
      status: "ok",
      summary: outcome.summary,
      detail: { ...(outcome.data ?? {}), tool: tool.name },
      actions: created + queued,
    };
  } catch (err) {
    return { status: "failed", summary: `Execution failed: ${(err as Error).message}`, detail: {}, actions: 0 };
  }
}

/** Rule params → concrete tool arguments (resolves dates and client scope). */
function resolvedArgs(kind: AutomationKind, params: AutomationParams): Record<string, unknown> {
  if (kind === "chase_documents") {
    return { older_than_days: params.older_than_days, channel: params.channel, limit: params.limit };
  }
  if (kind === "dunning") {
    return { min_days_late: params.min_days_late, min_balance: params.min_balance, channel: params.channel, limit: params.limit };
  }
  // generate_compliance — turn "due day 20, next month" into a period + date.
  const base = new Date();
  const target = new Date(base.getFullYear(), base.getMonth() + (params.months_ahead ?? 1), 1);
  const dueDay = Math.min(params.due_day ?? 20, new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate());
  const due = new Date(target.getFullYear(), target.getMonth(), dueDay);
  const dueDate = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, "0")}-${String(due.getDate()).padStart(2, "0")}`;
  const period =
    params.period_mode === "fy"
      ? `FY ${fyLabel(due)}`
      : target.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
  return {
    compliance_type: params.compliance_type,
    period,
    due_date: dueDate,
    assigned_to: params.assigned_to ?? "",
    client_ids: listClients().map((c) => c.client_id),
  };
}

/** Indian financial year label for a date: Apr 2026 → "2026-27". */
function fyLabel(date: Date): string {
  const year = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
  return `${year}-${String((year + 1) % 100).padStart(2, "0")}`;
}

// ── Internal watch actions ────────────────────────────────────────────────────

function escalateOverdue(params: AutomationParams, ctx: ExecContext): RuleExecution {
  const days = params.escalate_days ?? 3;
  const items = listCompliance()
    .filter((c) => c.status !== "Filed")
    .map((c) => ({ ...c, late: Math.max(0, -dayDiffLocal(c.due_date)) }))
    .filter((c) => c.late >= days)
    .sort((a, b) => b.late - a.late);

  if (items.length === 0) {
    return { status: "skipped", summary: `No filing is ${days}+ days overdue.`, detail: { checked: days }, actions: 0 };
  }
  const owners = [...new Set(items.map((i) => i.assigned_to || "unassigned"))];
  const summary = `${items.length} filing(s) ${days}+ days overdue — oldest ${items[0]!.client_name} (${items[0]!.late}d). Owners: ${owners.slice(0, 4).join(", ")}.`;
  const detail = {
    escalations: items.slice(0, 10).map((i) => ({ client: i.client_name, type: i.compliance_type, due: i.due_date, days_late: i.late, owner: i.assigned_to || "unassigned" })),
  };
  if (!ctx.dryRun) {
    logAudit({
      actor: ctx.user.name,
      action: "AUTOMATION_ESCALATION",
      entity_type: "compliance",
      entity_id: "overdue",
      detail: summary,
    });
  }
  return { status: "ok", summary, detail, actions: items.length };
}

function dscWatch(params: AutomationParams, ctx: ExecContext): RuleExecution {
  const within = params.within_days ?? 30;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const items = listDsc()
    .map((d) => {
      const until = new Date(`${d.valid_until?.slice(0, 10) || "1970-01-01"}T00:00:00`);
      const daysLeft = Math.round((until.getTime() - today.getTime()) / 86_400_000);
      return { ...d, daysLeft };
    })
    .filter((d) => d.status !== "Revoked" && d.daysLeft <= within)
    .sort((a, b) => a.daysLeft - b.daysLeft);

  if (items.length === 0) {
    return { status: "skipped", summary: `No DSC expires within ${within} days.`, detail: { within_days: within }, actions: 0 };
  }
  const expired = items.filter((i) => i.daysLeft < 0).length;
  const next = items[0]!;
  const nextPhrase =
    next.daysLeft < 0
      ? `${next.holder_name || next.client_name} expired ${Math.abs(next.daysLeft)} day(s) ago`
      : `${next.holder_name || next.client_name} expires in ${next.daysLeft} day(s)`;
  const summary = `${items.length} DSC(s) at risk — ${expired ? `${expired} expired · ` : ""}${nextPhrase}.`;
  const detail = { alerts: items.slice(0, 10).map((i) => ({ holder: i.holder_name || i.client_name, client: i.client_name, expires: i.valid_until, days_left: i.daysLeft })) };
  if (!ctx.dryRun) {
    logAudit({ actor: ctx.user.name, action: "AUTOMATION_DSC_ALERT", entity_type: "dsc", entity_id: "expiry", detail: summary });
  }
  return { status: "ok", summary, detail, actions: items.length };
}

function noticeWatch(params: AutomationParams, ctx: ExecContext): RuleExecution {
  const within = params.within_days ?? 3;
  const items = listNotices()
    .filter((n) => n.status === "Open" || n.status === "Escalated")
    .map((n) => ({ ...n, daysLeft: dayDiffLocal(n.response_deadline) }))
    .filter((n) => n.daysLeft <= within)
    .sort((a, b) => a.daysLeft - b.daysLeft);

  if (items.length === 0) {
    return { status: "skipped", summary: `No notice response due within ${within} day(s).`, detail: { within_days: within }, actions: 0 };
  }
  const overdue = items.filter((i) => i.daysLeft < 0).length;
  const summary = `${items.length} notice(s) need attention${overdue ? ` — ${overdue} already overdue` : ""}; next ${items[0]!.client_name} (${items[0]!.notice_type}) ${items[0]!.daysLeft < 0 ? `${Math.abs(items[0]!.daysLeft)}d late` : `due ${prettyDate(items[0]!.response_deadline)}`}.`;
  const detail = { alerts: items.slice(0, 10).map((i) => ({ client: i.client_name, type: i.notice_type, deadline: i.response_deadline, days_left: i.daysLeft })) };
  if (!ctx.dryRun) {
    logAudit({ actor: ctx.user.name, action: "AUTOMATION_NOTICE_ALERT", entity_type: "notice", entity_id: "deadline", detail: summary });
  }
  return { status: "ok", summary, detail, actions: items.length };
}

/** Local midnight-difference in days (negative = past). */
function dayDiffLocal(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${dateStr.slice(0, 10)}T00:00:00`);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

// ── Sweep ─────────────────────────────────────────────────────────────────────

export type SweepResult = {
  runs: AutomationRun[];
  summary: string;
  actions: number;
  considered: number;
};

/**
 * Runs the enabled rules that are due (or the explicitly requested ones).
 * `includeNotDue` powers the "Run now" button; the cron path omits it.
 */
export function runAutomationSweep(opts: {
  user: AuthUser;
  ruleIds?: string[];
  includeNotDue?: boolean;
  dryRun?: boolean;
  actorLabel?: string;
}): SweepResult {
  const started = new Date().toISOString();
  const all = listAutomationRules();
  const selected = opts.ruleIds?.length
    ? all.filter((r) => opts.ruleIds!.includes(r.rule_id))
    : all.filter((r) => r.enabled && (opts.includeNotDue ? true : ruleIsDue(r)));

  const runs: AutomationRun[] = [];
  let actions = 0;
  const parts: string[] = [];

  for (const rule of selected) {
    // Explicitly requested rules run even when paused — that is the point of
    // "run this one now" — and the pause state is recorded in the run detail.
    const ruleStarted = new Date().toISOString();
    let execution: RuleExecution;
    try {
      execution = executeRule(rule, { user: opts.user, dryRun: opts.dryRun });
    } catch (err) {
      execution = { status: "failed", summary: `Unexpected error: ${(err as Error).message}`, detail: {}, actions: 0 };
    }
    actions += execution.actions;
    if (!opts.dryRun) {
      markAutomationRuleRun(rule.rule_id);
      runs.push(
        logAutomationRun({
          rule_id: rule.rule_id,
          rule_name: rule.name,
          status: execution.status,
          summary: execution.summary,
          detail: { ...execution.detail, actions: execution.actions, mode: rule.mode, action: rule.action },
          actor: opts.actorLabel ?? opts.user.name,
          started_at: ruleStarted,
        }),
      );
    } else {
      runs.push({
        run_id: "dry",
        rule_id: rule.rule_id,
        rule_name: rule.name,
        status: execution.status,
        summary: execution.summary,
        detail: execution.detail,
        actor: opts.user.name,
        started_at: ruleStarted,
        finished_at: new Date().toISOString(),
      });
    }
    if (execution.status !== "failed" && execution.status !== "skipped") {
      parts.push(`${rule.name}: ${execution.summary}`);
    }
  }

  const summary = selected.length
    ? `${selected.length} rule(s) ${opts.dryRun ? "previewed" : "run"}${actions ? `, ${actions} action(s) taken` : ""}${parts.length ? ` — ${parts.slice(0, 3).join(" · ")}` : ""}`
    : "No automation is enabled yet. Add a rule to start.";

  if (!opts.dryRun && selected.length > 0) {
    logAudit({
      actor: opts.actorLabel ?? opts.user.name,
      action: "AUTOMATION_SWEEP",
      entity_type: "automation",
      entity_id: started,
      detail: summary,
    });
  }

  return { runs, summary, actions, considered: selected.length };
}

// ── Natural-language planner ──────────────────────────────────────────────────

export type RuleDraft = {
  name: string;
  action: AutomationKind;
  params: AutomationParams;
  mode: AutomationMode;
  cadence: AutomationCadence;
  explanation: string;
  source: "rules" | "ai-assisted";
};

function draftFrom(action: AutomationKind, params: AutomationParams, name?: string): RuleDraft {
  const info = actionInfo(action);
  const clean = sanitizeParams(action, params);
  const rule = { action, params: clean, cadence: info.defaultCadence };
  return {
    name: name ?? info.label,
    action,
    params: clean,
    mode: info.defaultMode,
    cadence: info.defaultCadence,
    explanation: explainRule(rule),
    source: "rules",
  };
}

/**
 * Deterministic planner: recognises the phrasings a CA actually types.
 * Runs without a provider, so rule creation never depends on a network call.
 */
export function planRuleFromText(text: string): RuleDraft | null {
  const q = text.toLowerCase().replace(/\s+/g, " ").trim();
  if (!q) return null;

  const days = (match: RegExpMatchArray | null, fallback: number): number => {
    const n = match?.[1] ? Number(match[1]) : NaN;
    return Number.isFinite(n) ? n : fallback;
  };

  // Documents
  if (/(document|paperwork|statement|challan|form 16|kyc)/.test(q) && /(chase|follow|remind|collect|ask|nudge)/.test(q)) {
    const older = q.match(/(?:older than|over|after|more than|past)\s*(\d+)\s*day/) ?? q.match(/(\d+)\s*days?\s*(?:old|later|late)/);
    return draftFrom("chase_documents", { older_than_days: days(older, 5), channel: q.includes("email") ? "Email" : "WhatsApp", limit: 25 });
  }

  // Money
  if (/(invoice|fee|payment|dues|money|receivab|outstanding|collection)/.test(q) && /(overdue|late|remind|chase|dun|collect|follow)/.test(q)) {
    const late = q.match(/(?:after|over|older than|more than|past|beyond)\s*(\d+)\s*day/) ?? q.match(/(\d+)\s*days?\s*(?:late|overdue|past)/);
    return draftFrom("dunning", {
      min_days_late: days(late, 30),
      min_balance: 0,
      channel: q.includes("email") ? "Email" : "WhatsApp",
      limit: 25,
    });
  }

  // Recurring compliance generation
  const filing = q.match(/(gstr[-\s]?[139]b?|gstr[-\s]?1|tds|itr|tax audit|roc|mgt[-\s]?7|aoc[-\s]?4)/);
  if (filing && /(generate|create|raise|open|set up|schedule|every month|monthly|recurring)/.test(q)) {
    const typeMap: Record<string, string> = {
      "gstr-1": "GST Filing (GSTR-1)",
      gstr1: "GST Filing (GSTR-1)",
      "gstr-3b": "GST Filing (GSTR-3B)",
      gstr3b: "GST Filing (GSTR-3B)",
      "gstr-9": "GST Filing (GSTR-9)",
      gstr9: "GST Filing (GSTR-9)",
      tds: "TDS Payment (26Q)",
      itr: "ITR Filing",
      "tax audit": "Tax Audit Report",
      roc: "ROC Annual Filing (AOC-4)",
      "mgt-7": "ROC Annual Filing (MGT-7)",
      mgt7: "ROC Annual Filing (MGT-7)",
      "aoc-4": "ROC Annual Filing (AOC-4)",
      aoc4: "ROC Annual Filing (AOC-4)",
    };
    const key = filing[1]!.replace(/\s+/g, "-").replace(/--+/g, "-");
    const type = typeMap[key] ?? typeMap[key.replace(/-/g, "")];
    if (type) {
      const dueDay = q.match(/due (?:on |by )?(?:the )?(\d{1,2})/);
      const fy = /(itr|tax audit|roc|mgt|aoc)/.test(key);
      return draftFrom("generate_compliance", {
        compliance_type: type,
        due_day: dueDay?.[1] ? Number(dueDay[1]) : fy ? 31 : 20,
        months_ahead: /(this month|current month)/.test(q) ? 0 : 1,
        period_mode: fy ? "fy" : "month",
      });
    }
  }

  // Escalations
  if (/escalat|alert the partner|flag (?:the )?(?:partner|managing)/.test(q) && /(overdue|late|pending)/.test(q)) {
    const d = q.match(/(\d+)\s*days?/);
    return draftFrom("escalate_overdue", { escalate_days: days(d, 3) });
  }

  // DSC
  if (/dsc|digital signature|token/.test(q)) {
    const d = q.match(/(?:within|in|expiring in|expire in)\s*(\d+)\s*days?/);
    return draftFrom("dsc_watch", { within_days: days(d, 30) });
  }

  // Notices
  if (/notice|scrutiny|demand|assessment/.test(q)) {
    const d = q.match(/(?:within|in|due in|deadline of)\s*(\d+)\s*days?/);
    return draftFrom("notice_watch", { within_days: days(d, 3) });
  }

  // Whole-list phrasing fallbacks
  if (/document/.test(q)) return draftFrom("chase_documents", { older_than_days: 5, channel: "WhatsApp", limit: 25 });
  if (/(fee|invoice|payment|collection)/.test(q)) return draftFrom("dunning", { min_days_late: 30, channel: "WhatsApp", limit: 25 });
  if (/(overdue|pending)/.test(q)) return draftFrom("escalate_overdue", { escalate_days: 3 });

  return null;
}


type AiDraftShape = {
  action?: string;
  name?: string;
  explanation?: string;
  params?: Record<string, unknown>;
  mode?: string;
  cadence?: string;
};

/**
 * Provider-assisted planning. The model only *maps language to parameters*;
 * the result is re-validated by `sanitizeParams`, so a bad or hostile answer
 * degrades to the deterministic plan instead of creating a rogue rule.
 */
export async function planRuleWithAi(text: string): Promise<RuleDraft | null> {
  const fallback = planRuleFromText(text);
  const schemaHint = AUTOMATION_ACTIONS.map((a) => `${a.kind}: ${a.blurb}`).join("\n");
  const result = await complete({
    system: [
      "You configure automation rules for an Indian chartered-accountancy practice app.",
      "Return ONLY a JSON object with keys: action, name, params, mode, cadence, explanation.",
      `action must be one of: ${AUTOMATION_ACTIONS.map((a) => a.kind).join(", ")}.`,
      "mode is 'auto' or 'approval'. cadence is 'daily', 'weekly' or 'monthly'.",
      "Allowed params: older_than_days, min_days_late, min_balance, channel (WhatsApp|Email), limit,",
      "compliance_type, due_day, months_ahead, period_mode (month|fy), assigned_to, escalate_days, within_days.",
      `Available actions:\n${schemaHint}`,
      "Never invent a param outside that list. No prose outside the JSON.",
    ].join("\n"),
    user: `Rule request: ${text}`,
    maxTokens: 400,
    temperature: 0.1,
  });
  if (!result) return fallback;

  const json = result.text.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return fallback;
  let parsed: AiDraftShape;
  try {
    parsed = JSON.parse(json) as AiDraftShape;
  } catch {
    return fallback;
  }
  const action = AUTOMATION_ACTIONS.find((a) => a.kind === parsed.action)?.kind;
  if (!action) return fallback;

  const params = sanitizeParams(action, parsed.params);
  const info = actionInfo(action);
  const mode: AutomationMode = parsed.mode === "approval" ? "approval" : "auto";
  const cadence: AutomationCadence =
    parsed.cadence === "weekly" || parsed.cadence === "monthly" || parsed.cadence === "daily" ? parsed.cadence : info.defaultCadence;
  return {
    name: (parsed.name || info.label).slice(0, 120),
    action,
    params,
    mode,
    cadence,
    explanation: explainRule({ action, params, cadence }),
    source: "ai-assisted",
  };
}

// ── Digest helpers (dashboard / copilot) ──────────────────────────────────────

/** One-line status of the automation layer for dashboards and briefs. */
export function automationHeadline(queued: number, overdueFilings: number, expiringDsc: number): string {
  const parts: string[] = [];
  if (queued > 0) parts.push(`${queued} prepared message(s) waiting in the outbox`);
  if (overdueFilings > 0) parts.push(`${overdueFilings} filing(s) overdue`);
  if (expiringDsc > 0) parts.push(`${expiringDsc} DSC(s) expiring`);
  return parts.length ? parts.join(" · ") : "Nothing waiting — automation has the day under control.";
}

/** Outstanding work the automation layer can pick up immediately (UI hint). */
export function automationBacklog(): { documents: number; invoices: number; clients: number } {
  const olderThan = 5;
  const documents = listDocuments().filter((d) => d.status === "Pending" && -dayDiffLocal(d.requested_date) >= olderThan).length;
  const invoices = listInvoices().filter((i) => i.status !== "Paid" && i.status !== "Cancelled" && -dayDiffLocal(i.due_date) >= 30 && i.total_amount - (i.paid_amount ?? 0) > 0).length;
  return { documents, invoices, clients: listClients().length };
}
