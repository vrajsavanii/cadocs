/**
 * Server-side engagement list queries with filtering, pagination and
 * role-aware visibility. The list API and calendar use this instead of
 * shipping the whole table to the browser.
 */
import type { AuthUser, Compliance, WorkflowTask } from "./types";
import { all, one } from "./db";
import { toWorkflowTask, effectiveStage } from "./workflow";
import { todayISO } from "./format";

export type EngagementFilters = {
  client_id?: string;
  service_code?: string;
  registration_id?: string;
  preparer?: string;
  reviewer?: string;
  status?: string;
  stage?: string;
  line?: string;
  from?: string;
  to?: string;
  overdue?: boolean;
  missing_assignment?: boolean;
  statutory?: "verified" | "unverified" | "conflicting" | "missing";
  q?: string;
  page?: number;
  pageSize?: number;
};

type Params = Array<string | number | null>;

function addDate(value: string | undefined): string | null {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

export function queryEngagements(
  user: AuthUser,
  filters: EngagementFilters,
): { items: WorkflowTask[]; total: number; page: number; pageSize: number; summary: Record<string, number> } {
  const where: string[] = [];
  const params: Params = [];
  if (filters.client_id) {
    where.push("client_id = ?");
    params.push(filters.client_id);
  }
  if (filters.service_code) {
    where.push("service_code = ?");
    params.push(filters.service_code);
  }
  if (filters.registration_id) {
    where.push("IFNULL(registration_id,'') = ?");
    params.push(filters.registration_id);
  }
  if (filters.preparer) {
    where.push("(preparer = ? OR assigned_to = ?)");
    params.push(filters.preparer, filters.preparer);
  }
  if (filters.reviewer) {
    where.push("reviewer = ?");
    params.push(filters.reviewer);
  }
  if (filters.status && ["Pending", "In Progress", "Filed", "Overdue"].includes(filters.status)) {
    where.push("status = ?");
    params.push(filters.status);
  }
  if (filters.stage) {
    where.push("stage = ?");
    params.push(filters.stage);
  }
  if (filters.line) {
    // Service codes are catalogue-controlled; match the line through them.
    const linePrefixes: Record<string, string[]> = {
      gst: ["gstr1", "gstr3b", "gstr9"],
      income_tax: ["itr", "advance_tax"],
      tds: ["tds_payment", "tds_return"],
      audit: ["tax_audit", "statutory_audit"],
      roc: ["roc_annual"],
      bookkeeping: ["bookkeeping"],
      payroll: ["payroll"],
      other: ["other"],
    };
    const codes = linePrefixes[filters.line];
    if (!codes) {
      where.push("1 = 0");
    } else {
      where.push(`service_code IN (${codes.map(() => "?").join(",")})`);
      params.push(...codes);
    }
  }
  const from = addDate(filters.from);
  const to = addDate(filters.to);
  if (from) {
    where.push("(internal_target_date >= ? OR (internal_target_date IS NULL AND due_date >= ?))");
    params.push(from, from);
  }
  if (to) {
    where.push("(internal_target_date <= ? OR (internal_target_date IS NULL AND due_date <= ?))");
    params.push(to, to);
  }
  if (filters.overdue) {
    where.push("status <> 'Filed' AND due_date < ?");
    params.push(todayISO());
  }
  if (filters.missing_assignment) {
    where.push("(IFNULL(preparer,'') = '' OR IFNULL(reviewer,'') = '')");
  }
  if (filters.statutory === "verified") where.push("due_date_verified = 1");
  if (filters.statutory === "unverified") where.push("statutory_rule_status = 'unverified'");
  if (filters.statutory === "conflicting") where.push("statutory_rule_status = 'conflicting'");
  if (filters.statutory === "missing") where.push("statutory_rule_status = 'missing'");
  if (filters.q) {
    where.push("(client_name LIKE ? OR compliance_type LIKE ? OR period LIKE ? OR IFNULL(preparer,'') LIKE ? OR IFNULL(reviewer,'') LIKE ?)");
    const like = `%${filters.q.slice(0, 80)}%`;
    params.push(like, like, like, like, like);
  }

  // Article assistants see their own desk by default. Managers and partners
  // see the whole firm. This is enforced here, not by hiding a tab.
  if (user.role === "article") {
    where.push("(preparer = ? OR reviewer = ?)");
    params.push(user.name, user.name);
  }

  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const page = Math.max(1, Math.floor(Number(filters.page) || 1));
  const pageSize = Math.min(100, Math.max(10, Math.floor(Number(filters.pageSize) || 25)));
  const total = Number(one<{ n: number }>(`SELECT COUNT(*) AS n FROM compliance ${clause}`, ...params)?.n ?? 0);
  const rows = all<Compliance>(
    `SELECT * FROM compliance ${clause} ORDER BY CASE WHEN stage = 'done' THEN 1 ELSE 0 END, due_date ASC, compliance_id DESC LIMIT ? OFFSET ?`,
    ...params,
    pageSize,
    (page - 1) * pageSize,
  );

  const summaryRow = one<Record<string, number>>(
    `SELECT COUNT(*) AS total,
       SUM(CASE WHEN status <> 'Filed' THEN 1 ELSE 0 END) AS open,
       SUM(CASE WHEN status <> 'Filed' AND due_date < ? THEN 1 ELSE 0 END) AS overdue,
       SUM(CASE WHEN status <> 'Filed' AND due_date >= ? AND due_date <= ? THEN 1 ELSE 0 END) AS due_soon,
       SUM(CASE WHEN due_date_verified = 0 THEN 1 ELSE 0 END) AS statutory_unverified,
       SUM(CASE WHEN IFNULL(preparer,'') = '' OR IFNULL(reviewer,'') = '' THEN 1 ELSE 0 END) AS missing_assignment
     FROM compliance ${clause}`,
    todayISO(),
    todayISO(),
    addDays(todayISO(), 7),
    ...params,
  );

  return {
    items: rows.map(toWorkflowTask),
    total,
    page,
    pageSize,
    summary: {
      total: Number(summaryRow?.total) || 0,
      open: Number(summaryRow?.open) || 0,
      overdue: Number(summaryRow?.overdue) || 0,
      due_soon: Number(summaryRow?.due_soon) || 0,
      statutory_unverified: Number(summaryRow?.statutory_unverified) || 0,
      missing_assignment: Number(summaryRow?.missing_assignment) || 0,
    },
  };
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days));
  return dt.toISOString().slice(0, 10);
}

export function engagementCounts(user: AuthUser): Record<string, number> {
  const base = user.role === "article" ? "WHERE preparer = ? OR reviewer = ?" : "";
  const params = user.role === "article" ? [user.name, user.name] : [];
  const rows = all<{ stage: string | null; n: number }>(
    `SELECT COALESCE(stage,'documents') AS stage, COUNT(*) AS n FROM compliance ${base} GROUP BY COALESCE(stage,'documents')`,
    ...params,
  );
  const result: Record<string, number> = {};
  for (const row of rows) result[row.stage || "documents"] = Number(row.n) || 0;
  return result;
}

export { effectiveStage };
