/**
 * Due-date rules and resolution.
 *
 * A statutory deadline is only ever surfaced when a partner has verified a
 * rule against an authority and recorded that authority. The product ships
 * with planning defaults that are explicitly unverified: they drive the firm's
 * internal target date, never a claim of legal lateness.
 */
import type { DueDateRule, DueRuleVerification, ServiceFrequency, StatutoryRuleStatus } from "./types";
import { addDaysISO, diffDays, fyForDate } from "./services";
import { todayISO } from "./format";
import { all, getDb, one, withTransaction } from "./db";

export type DueResolution = {
  /** The date the practice schedules its own work against. */
  internal_target_date: string;
  /** Present only when a verified rule (or audited manual override) exists. */
  statutory_due_date: string | null;
  rule_status: StatutoryRuleStatus;
  due_rule_id: string | null;
  due_rule_version: number | null;
  due_date_source: string;
  warnings: string[];
};

function clampDay(year: number, monthIndex: number, day: number): number {
  return Math.min(day, new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate());
}

function parse(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return { y: y ?? 1970, m: (m ?? 1) - 1, d: d ?? 1 };
}

/** Applies a rule's month offset/day to the period end, clamping short months. */
export function ruleDueDate(periodEnd: string, rule: Pick<DueDateRule, "due_month_offset" | "due_day">): string {
  const { y, m } = parse(periodEnd);
  const total = y * 12 + m + Number(rule.due_month_offset || 0);
  const ny = Math.floor(total / 12);
  const nm = ((total % 12) + 12) % 12;
  return `${ny}-${String(nm + 1).padStart(2, "0")}-${String(clampDay(ny, nm, Number(rule.due_day) || 1)).padStart(2, "0")}`;
}

function normaliseRule(row: DueDateRule): DueDateRule {
  return {
    ...row,
    due_month_offset: Number(row.due_month_offset) || 0,
    due_day: Number(row.due_day) || 1,
    internal_lead_days: Number(row.internal_lead_days) || 0,
    version: Number(row.version) || 1,
    effective_from: row.effective_from || "",
    effective_to: row.effective_to || "",
    authority_reference: row.authority_reference || "",
    notes: row.notes || "",
  };
}

export function listDueRules(serviceCode?: string): DueDateRule[] {
  const rows = serviceCode
    ? all<DueDateRule>(
        "SELECT * FROM due_date_rules WHERE service_code = ? ORDER BY service_code, frequency, version DESC",
        serviceCode,
      )
    : all<DueDateRule>("SELECT * FROM due_date_rules ORDER BY service_code, frequency, version DESC");
  return rows.map(normaliseRule);
}

export function getDueRule(ruleId: string): DueDateRule | null {
  const row = one<DueDateRule>("SELECT * FROM due_date_rules WHERE rule_id = ?", ruleId);
  return row ? normaliseRule(row) : null;
}

function effectiveRules(serviceCode: string, frequency: ServiceFrequency, periodEnd: string): DueDateRule[] {
  const bounds = periodEnd || new Date().toISOString().slice(0, 10);
  return all<DueDateRule>(
    `SELECT * FROM due_date_rules
     WHERE service_code = ? AND frequency = ?
       AND (effective_from = '' OR effective_from <= ?)
       AND (effective_to = '' OR effective_to >= ?)
     ORDER BY version DESC`,
    serviceCode,
    frequency,
    bounds,
    bounds,
  ).map(normaliseRule);
}

/**
 * Resolves a statutory date only when a single verified rule covers the period.
 * Two verified rules that disagree are treated as a conflict, never as an
 * arbitrary pick.
 */
export function resolveDueDates(
  serviceCode: string,
  frequency: ServiceFrequency,
  periodEnd: string,
): DueResolution {
  const rules = effectiveRules(serviceCode, frequency, periodEnd);
  const verified = rules.filter((r) => r.verification_status === "verified");
  const fallback = verified[0] ?? rules[0] ?? null;

  if (verified.length > 0) {
    const dated = verified.map((rule) => ({ rule, date: ruleDueDate(periodEnd, rule) }));
    const dates = [...new Set(dated.map((d) => d.date))];
    if (dates.length > 1) {
      return {
        internal_target_date: addDaysISO([...dates].sort()[0]!, -Math.max(...verified.map((r) => r.internal_lead_days || 0))),
        statutory_due_date: null,
        rule_status: "conflicting",
        due_rule_id: dated[0]!.rule.rule_id,
        due_rule_version: dated[0]!.rule.version,
        due_date_source: "Conflicting verified due-date rules",
        warnings: [`Conflicting verified due-date rules for ${serviceCode}: ${dates.join(", ")}. No statutory date chosen.`],
      };
    }
    const chosen = dated[0]!;
    const statutory = chosen.date;
    return {
      internal_target_date: addDaysISO(statutory, -Math.max(0, chosen.rule.internal_lead_days)),
      statutory_due_date: statutory,
      rule_status: "verified",
      due_rule_id: chosen.rule.rule_id,
      due_rule_version: chosen.rule.version,
      due_date_source: `${chosen.rule.source}${chosen.rule.authority_reference ? ` · ${chosen.rule.authority_reference}` : ""}`,
      warnings: [],
    };
  }

  if (fallback) {
    const internal = ruleDueDate(periodEnd, fallback);
    return {
      internal_target_date: internal,
      statutory_due_date: null,
      rule_status: "unverified",
      due_rule_id: fallback.rule_id,
      due_rule_version: fallback.version,
      due_date_source: "Unverified planning default — internal target only",
      warnings: [
        `Statutory due date for ${serviceCode} (${fyForDate(periodEnd)}) is not verified. ` +
          `The engagement is scheduled against an internal target and must be reviewed by a partner.`,
      ],
    };
  }

  return {
    internal_target_date: "",
    statutory_due_date: null,
    rule_status: "missing",
    due_rule_id: null,
    due_rule_version: null,
    due_date_source: "No due-date rule configured",
    warnings: [`No due-date rule covers ${serviceCode} from ${periodEnd}; configure one before generating this engagement.`],
  };
}

export type DueRuleInput = {
  service_code: string;
  frequency: ServiceFrequency;
  effective_from: string;
  effective_to?: string;
  due_month_offset: number;
  due_day: number;
  internal_lead_days?: number;
  source: string;
  authority_reference?: string;
  verification_status?: DueRuleVerification;
  notes?: string;
};

export class DueRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DueRuleError";
  }
}

function assertIso(value: string, label: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new DueRuleError(`${label} must be a YYYY-MM-DD date`);
}

/**
 * Appends a new rule version. History is never overwritten, and a version that
 * claims verification must name a real source and authority.
 */
export function createDueRuleVersion(input: DueRuleInput, actor: string): DueDateRule {
  if (!input.service_code.trim()) throw new DueRuleError("Service code is required");
  if (!Number.isInteger(input.due_month_offset) || input.due_month_offset < 0 || input.due_month_offset > 18) {
    throw new DueRuleError("Due month offset must be a whole number between 0 and 18");
  }
  if (!Number.isInteger(input.due_day) || input.due_day < 1 || input.due_day > 31) {
    throw new DueRuleError("Due day must be a whole number between 1 and 31");
  }
  assertIso(input.effective_from, "Effective from");
  if (input.effective_to) assertIso(input.effective_to, "Effective to");
  if (input.verification_status === "verified") {
    if (!input.source.trim()) throw new DueRuleError("A verified rule needs a source");
    if (!(input.authority_reference ?? "").trim()) {
      throw new DueRuleError("A verified rule needs an authority reference (notification, circular or portal source)");
    }
  }
  const existing = all<{ version: number }>(
    "SELECT version FROM due_date_rules WHERE service_code = ? AND frequency = ? ORDER BY version DESC LIMIT 1",
    input.service_code,
    input.frequency,
  );
  const version = (existing[0]?.version ?? 0) + 1;
  const now = new Date().toISOString();
  const ruleId = `DDR-${input.service_code.toUpperCase()}-${input.frequency.toUpperCase()}-V${version}`;
  const lead = Math.max(0, Math.round(Number(input.internal_lead_days) || 0));
  const verified = input.verification_status === "verified";
  withTransaction(() => {
    getDb()
      .prepare(
        `INSERT INTO due_date_rules
         (rule_id,service_code,frequency,effective_from,effective_to,due_month_offset,due_day,internal_lead_days,
          source,authority_reference,verification_status,verified_at,verified_by,version,notes,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        ruleId,
        input.service_code,
        input.frequency,
        input.effective_from,
        input.effective_to ?? "",
        input.due_month_offset,
        input.due_day,
        lead,
        input.source.trim(),
        (input.authority_reference ?? "").trim(),
        verified ? "verified" : "unverified",
        verified ? now : null,
        verified ? actor : "",
        version,
        (input.notes ?? "").trim().slice(0, 1000),
        now,
        now,
      );
    getDb()
      .prepare(
        "INSERT INTO audit_log (actor,action,entity_type,entity_id,detail,created_at) VALUES (?,?,?,?,?,?)",
      )
      .run(
        actor,
        verified ? "DUE_RULE_VERIFIED" : "DUE_RULE_VERSIONED",
        "due_date_rule",
        ruleId,
        `${input.service_code} ${input.frequency} v${version} · ${verified ? "verified" : "unverified"} · offset ${input.due_month_offset}m day ${input.due_day}`,
        now,
      );
  });
  return getDueRule(ruleId)!;
}

/** Human-readable difference used by the UI; never claims lateness from an unverified date. */
export function dueDateSummary(task: {
  due_date?: string;
  internal_target_date?: string | null;
  statutory_due_date?: string | null;
  due_date_verified?: boolean;
  statutory_rule_status?: string;
}): { label: string; date: string; verified: boolean; days: number } {
  const verified = Boolean(task.due_date_verified && task.statutory_due_date);
  const date = verified ? String(task.statutory_due_date) : String(task.internal_target_date || task.due_date || "");
  return {
    label: verified ? "Statutory due date" : "Internal target (statutory date unverified)",
    date,
    verified,
    days: date ? diffDays(todayISO(), date) : 0,
  };
}
