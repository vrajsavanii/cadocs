/**
 * Recurring engagement engine.
 *
 * A client service is the configuration; an engagement is one period's work.
 * Generation is a dry-run first, then an explicitly confirmed commit. Both use
 * the same plan, so the preview can never promise work the commit will not do.
 * The database's unique cycle index is the final duplicate guard.
 */
import type {
  Client,
  ClientRegistration,
  ClientService,
  Compliance,
  GenerationPlanItem,
  GenerationRun,
  ServiceFrequency,
} from "./types";
import {
  all,
  getClient,
  getDb,
  listClients,
  logAudit,
  nextId,
  one,
  withTransaction,
} from "./db";
import {
  checklistTemplate,
  createEngagementPeriod,
  listClientServices,
} from "./engagements-db";
import { decryptField } from "./crypto";
import { resolveDueDates } from "./due-dates";
import {
  enumeratePeriods,
  latestCompletedPeriodEnd,
  parseFrequency,
  periodWithinService,
} from "./periods";
import { getService } from "./services";
import { todayISO } from "./format";

export type GenerationWindow = {
  from: string;
  to: string;
};

export type GenerationPlan = {
  window: GenerationWindow;
  items: GenerationPlanItem[];
  summary: {
    processed: number;
    create: number;
    exists: number;
    skipped: number;
    invalid: number;
    warnings: number;
  };
};

type RegistrationRow = {
  registration_id: string;
  client_id: string;
  kind: string;
  identifier_enc: string;
  legal_name: string;
  state: string;
  status: string;
  effective_from: string;
  effective_to: string;
  filing_frequency: string;
};

function maskIdentifier(kind: string, value: string): string {
  const raw = (value || "").trim();
  if (!raw) return "";
  if (kind === "GST" && raw.length >= 10) return `${raw.slice(0, 2)}••••••${raw.slice(-4)}`;
  if (raw.length <= 4) return "••••";
  return `${raw.slice(0, 2)}••••${raw.slice(-2)}`;
}

function registrationRows(): Map<string, RegistrationRow> {
  const rows = all<RegistrationRow>("SELECT * FROM client_registrations");
  return new Map(rows.map((row) => [row.registration_id, row]));
}

function maskRegistration(row: RegistrationRow | null): string {
  if (!row) return "";
  const value = (() => {
    try {
      return decryptField(row.identifier_enc || "");
    } catch {
      return "";
    }
  })();
  return maskIdentifier(row.kind, value);
}

function staffNames(): Set<string> {
  return new Set(
    all<{ name: string }>("SELECT name FROM users WHERE name IS NOT NULL AND name <> ''").map((row) => row.name),
  );
}

function userRole(name: string): string {
  return one<{ role: string }>("SELECT role FROM users WHERE name = ?", name)?.role ?? "";
}

export function generationWindow(
  frequency: ServiceFrequency,
  today = todayISO(),
  serviceCode = "",
  from?: string,
  to?: string,
): GenerationWindow {
  const end = latestCompletedPeriodEnd(frequency, today, serviceCode);
  return { from: from?.trim() || end, to: to?.trim() || end };
}

export type PlanInput = {
  from?: string;
  to?: string;
  clientId?: string;
  serviceId?: string;
  today?: string;
  /** Safety cap for bulk plans; the caller may narrow the window instead. */
  limit?: number;
};

export class GenerationError extends Error {
  constructor(message: string, readonly items: GenerationPlanItem[] = []) {
    super(message);
    this.name = "GenerationError";
  }
}

/**
 * Builds the full proposal without writing anything. Existing engagements are
 * reported as `exists` and keep their current stage, assignment and evidence.
 */
export function previewGeneration(input: PlanInput = {}): GenerationPlan {
  const today = input.today ?? todayISO();
  const clients = new Map(listClients().map((client) => [client.client_id, client]));
  const registrations = registrationRows();
  const users = staffNames();
  const services = listClientServices(input.clientId).filter(
    (service) => !input.serviceId || service.service_id === input.serviceId,
  );
  const items: GenerationPlanItem[] = [];
  const seen = new Set<string>();
  const limit = Math.min(Math.max(Number(input.limit) || 500, 1), 2000);

  const push = (item: GenerationPlanItem) => {
    if (items.length < limit) items.push(item);
  };

  for (const service of services) {
    const client = clients.get(service.client_id);
    const def = getService(service.service_code);
    const frequency = parseFrequency(service.frequency);
    const base = {
      service_id: service.service_id,
      client_id: service.client_id,
      client_name: client?.name ?? "",
      service_code: service.service_code,
      service_name: service.service_name,
      frequency,
      manager: service.manager ?? "",
      partner: service.partner ?? "",
      preparer: service.owner ?? "",
      reviewer: service.reviewer ?? "",
      checklist_version: checklistTemplate(service.service_code).version,
    };

    const invalid = (reason: string, registrationId = service.registration_id ?? "", masked = "", warnings: string[] = []) =>
      push({
        ...base,
        registration_id: registrationId,
        registration_masked: masked,
        period: "",
        period_type: "custom",
        period_start: "",
        period_end: "",
        fy: "",
        assessment_year: null,
        internal_target_date: "",
        statutory_due_date: null,
        statutory_rule_status: "missing",
        due_rule_id: null,
        due_rule_version: null,
        due_date_source: "",
        action: "invalid",
        warnings,
        reason,
      });

    if (!client) {
      invalid("Client record no longer exists");
      continue;
    }
    if ((client.client_status ?? "Active") !== "Active") {
      invalid(`Client is ${client.client_status || "not active"}; no new work is generated`);
      continue;
    }
    if (service.status !== "Active") {
      invalid(`Service is ${service.status}; only active services generate work`);
      continue;
    }

    const registrationId = service.registration_id ?? "";
    const registration = registrationId ? registrations.get(registrationId) ?? null : null;
    const masked = maskRegistration(registration);
    const serviceWarnings: string[] = [];

    if (registrationId && !registration) {
      invalid(`Registration ${registrationId} no longer exists`, registrationId, masked);
      continue;
    }
    if (registration && registration.client_id !== client.client_id) {
      invalid("Registration belongs to a different client", registrationId, masked);
      continue;
    }
    if (registration && registration.status !== "Active") {
      invalid(`Registration is ${registration.status}; no new GST work is generated`, registrationId, masked);
      continue;
    }
    if ((def.line === "gst" || /gst|gstr/i.test(service.service_code)) && !registration) {
      invalid("GST service has no registration configured — select the GSTIN before generating work");
      continue;
    }
    if (registration?.filing_frequency) {
      const regFreq = parseFrequency(registration.filing_frequency.replace(/^gst\s*/i, ""));
      if (registration.filing_frequency.toLowerCase().includes("quarter") && frequency === "monthly") {
        serviceWarnings.push("Registration says quarterly filing but the service is configured monthly — confirm the frequency.");
      } else if (registration.filing_frequency.toLowerCase().includes("month") && frequency === "quarterly") {
        serviceWarnings.push("Registration says monthly filing but the service is configured quarterly — confirm the frequency.");
      } else if (regFreq !== "one_time" && regFreq !== frequency && !/gst/i.test(registration.filing_frequency)) {
        serviceWarnings.push(`Registration frequency (${registration.filing_frequency}) differs from the service frequency (${frequency}).`);
      }
    }
    if (!base.preparer) serviceWarnings.push("Preparer is not assigned.");
    if (!base.reviewer) serviceWarnings.push("Reviewer is not assigned.");
    if (base.preparer && base.reviewer && base.preparer === base.reviewer && (service.approval_stage ?? "none") !== "none") {
      serviceWarnings.push("Preparer and reviewer are the same person; the independent-review rule requires different staff.");
    }
    for (const [label, name] of [
      ["Preparer", base.preparer],
      ["Reviewer", base.reviewer],
      ["Manager", base.manager],
      ["Partner", base.partner],
    ] as Array<[string, string]>) {
      if (name && !users.has(name)) serviceWarnings.push(`${label} ${name} is not an active firm user.`);
    }

    const window = generationWindow(frequency, today, service.service_code, input.from, input.to);
    const periods = enumeratePeriods(frequency, window.from, window.to, service.service_code);
    if (periods.length === 0) {
      invalid(`No ${frequency.replace("_", " ")} period falls inside ${window.from} → ${window.to}`, registrationId, masked, serviceWarnings);
      continue;
    }

    for (const period of periods) {
      const effective = periodWithinService(period, service);
      const due = resolveDueDates(service.service_code, frequency, period.period_end);
      const warnings = [...serviceWarnings, ...due.warnings];
      const key = `${service.client_id}|${service.service_code}|${period.period}|${registrationId}`;
      const exists = one<{ compliance_id: string }>(
        "SELECT compliance_id FROM compliance WHERE client_id = ? AND service_code = ? AND period = ? AND IFNULL(registration_id,'') = IFNULL(?,'')",
        service.client_id,
        service.service_code,
        period.period,
        registrationId,
      );
      const item: GenerationPlanItem = {
        ...base,
        registration_id: registrationId,
        registration_masked: masked,
        period: period.period,
        period_type: period.period_type,
        period_start: period.period_start,
        period_end: period.period_end,
        fy: period.fy,
        assessment_year: period.assessment_year,
        internal_target_date: due.internal_target_date,
        statutory_due_date: due.statutory_due_date,
        statutory_rule_status: due.rule_status,
        due_rule_id: due.due_rule_id,
        due_rule_version: due.due_rule_version,
        due_date_source: due.due_date_source,
        action: "create",
        warnings,
        reason: "",
      };
      if (!effective.ok) {
        push({ ...item, action: "skip", reason: effective.reason });
        continue;
      }
      if (exists || seen.has(key)) {
        push({ ...item, action: "exists", reason: "An engagement already exists for this service, registration and period" });
        continue;
      }
      if (!due.internal_target_date) {
        push({ ...item, action: "invalid", reason: due.warnings[0] || "No internal target date could be resolved" });
        continue;
      }
      seen.add(key);
      push(item);
    }
  }

  const summary = {
    processed: items.length,
    create: items.filter((i) => i.action === "create").length,
    exists: items.filter((i) => i.action === "exists").length,
    skipped: items.filter((i) => i.action === "skip").length,
    invalid: items.filter((i) => i.action === "invalid").length,
    warnings: items.reduce((n, i) => n + i.warnings.length, 0),
  };
  const dated = items.filter((item) => item.period_end);
  const window = {
    from: input.from?.trim() || dated.map((item) => item.period_end).sort()[0] || "",
    to: input.to?.trim() || dated.map((item) => item.period_end).sort().at(-1) || "",
  };
  return { window, items, summary };
}

export type GenerateResult = {
  run: GenerationRun;
  items: GenerationPlanItem[];
  created: Array<{ compliance_id: string; period: string; service_id: string }>;
  failed: Array<{ period: string; service_id: string; error: string }>;
};

function recordRun(run: GenerationRun): void {
  getDb()
    .prepare(
      `INSERT INTO engagement_generation_runs
       (run_id,trigger,actor,window_from,window_to,client_id,service_id,status,processed,created,skipped,failed,warnings,detail,started_at,finished_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      run.run_id,
      run.trigger,
      run.actor,
      run.window_from,
      run.window_to,
      run.client_id,
      run.service_id,
      run.status,
      run.processed,
      run.created,
      run.skipped,
      run.failed,
      run.warnings,
      JSON.stringify(run.detail),
      run.started_at,
      run.finished_at,
    );
}

/**
 * Commits a generation plan. Each engagement is its own transaction, so one
 * bad row cannot discard work already committed; re-running is safe because
 * exists rows are skipped and the database uniqueness key is authoritative.
 */
export function generateEngagements(
  input: PlanInput & { actor: string; role?: string; trigger?: "manual" | "scheduled"; confirmed?: boolean },
): GenerateResult {
  const plan = previewGeneration(input);
  const max = 500;
  const creating = plan.items.filter((item) => item.action === "create");
  if (!input.confirmed) {
    throw new GenerationError("Generation must be explicitly confirmed after reviewing the preview", plan.items);
  }
  if (creating.length > max) {
    throw new GenerationError(
      `This run would create ${creating.length} engagements; narrow the window or client scope to ${max} or fewer.`,
      plan.items,
    );
  }

  const runId = nextId("GEN", "engagement_generation_runs", "run_id");
  const startedAt = new Date().toISOString();
  const created: GenerateResult["created"] = [];
  const failed: GenerateResult["failed"] = [];

  for (const item of creating) {
    const client = getClient(item.client_id);
    const service = listClientServices(item.client_id).find((s) => s.service_id === item.service_id);
    if (!client || !service) {
      failed.push({ period: item.period, service_id: item.service_id, error: "Client or service disappeared before commit" });
      continue;
    }
    try {
      const result = withTransaction(() =>
        createEngagementPeriod({
          client,
          service,
          period: {
            period: item.period,
            period_type: item.period_type,
            period_start: item.period_start,
            period_end: item.period_end,
            fy: item.fy,
            assessment_year: item.assessment_year,
          },
          due: {
            internal_target_date: item.internal_target_date,
            statutory_due_date: item.statutory_due_date,
            rule_status: item.statutory_rule_status,
            due_rule_id: item.due_rule_id,
            due_rule_version: item.due_rule_version,
            due_date_source: item.due_date_source,
            warnings: item.warnings,
          },
          actor: input.actor,
          role: input.role ?? "system",
          source: input.trigger === "scheduled" ? "automatic" : "manual",
        }),
      );
      if (result.created) {
        created.push({ compliance_id: result.task.compliance_id, period: result.task.period, service_id: service.service_id });
      }
    } catch (err) {
      const message = (err as Error).message;
      if (/UNIQUE constraint|idx_compliance_cycle/i.test(message)) {
        // A concurrent worker won the race; the existing engagement is the
        // correct outcome, not a failure.
        continue;
      }
      failed.push({ period: item.period, service_id: item.service_id, error: message.slice(0, 300) });
    }
  }

  const run: GenerationRun = {
    run_id: runId,
    trigger: input.trigger ?? "manual",
    actor: input.actor,
    window_from: plan.window.from,
    window_to: plan.window.to,
    client_id: input.clientId ?? "",
    service_id: input.serviceId ?? "",
    status: failed.length === 0 ? "completed" : created.length === 0 ? "failed" : "partial",
    processed: plan.summary.processed,
    created: created.length,
    skipped: plan.summary.exists + plan.summary.skipped + plan.summary.invalid,
    failed: failed.length,
    warnings: plan.summary.warnings,
    detail: {
      plan: plan.summary,
      failed: failed.slice(0, 50),
      invalid: plan.items.filter((i) => i.action === "invalid").slice(0, 50).map((i) => ({ service_id: i.service_id, period: i.period, reason: i.reason })),
    },
    started_at: startedAt,
    finished_at: new Date().toISOString(),
  };
  recordRun(run);
  logAudit({
    actor: input.actor,
    action: input.trigger === "scheduled" ? "ENGAGEMENTS_GENERATED_SCHEDULED" : "ENGAGEMENTS_GENERATED",
    entity_type: "generation_run",
    entity_id: runId,
    detail: `${created.length} created · ${run.skipped} skipped · ${failed.length} failed · window ${run.window_from} → ${run.window_to}`,
  });
  return { run, items: plan.items, created, failed };
}

/** Scheduled worker: current completed period for every eligible active service. */
export function generateCurrentPeriod(actor: string): GenerateResult {
  const today = todayISO();
  const services = listClientServices().filter((s) => s.status === "Active");
  let from = "";
  let to = "";
  for (const service of services) {
    const window = generationWindow(parseFrequency(service.frequency), today, service.service_code);
    if (!from || window.from < from) from = window.from;
    if (!to || window.to > to) to = window.to;
  }
  return generateEngagements({
    actor,
    role: "system",
    trigger: "scheduled",
    confirmed: true,
    from: from || today,
    to: to || today,
    today,
  });
}

export function listGenerationRuns(limit = 20): GenerationRun[] {
  const rows = all<Record<string, unknown>>(
    "SELECT * FROM engagement_generation_runs ORDER BY started_at DESC LIMIT ?",
    Math.min(Math.max(limit, 1), 100),
  );
  return rows.map((row) => ({
    ...(row as unknown as GenerationRun),
    processed: Number(row.processed) || 0,
    created: Number(row.created) || 0,
    skipped: Number(row.skipped) || 0,
    failed: Number(row.failed) || 0,
    warnings: Number(row.warnings) || 0,
    detail: typeof row.detail === "string" ? safeJson(row.detail) : {},
  }));
}

function safeJson(value: string): Record<string, unknown> {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Assignment helper for the workflow UI. Returns a clear error instead of
 * silently accepting a name that is not a firm user.
 */
export function assertAssignable(name: string, label: string): void {
  if (!name) return;
  const role = userRole(name);
  if (!role) throw new Error(`${label} "${name}" is not an active firm user`);
}

/** Used by tests and the API to verify the cycle identity that protects idempotency. */
export function existingEngagement(
  clientId: string,
  serviceCode: string,
  period: string,
  registrationId = "",
): Compliance | null {
  return one<Compliance>(
    "SELECT * FROM compliance WHERE client_id = ? AND service_code = ? AND period = ? AND IFNULL(registration_id,'') = IFNULL(?,'')",
    clientId,
    serviceCode,
    period,
    registrationId,
  );
}

/** Exposed for the client 360 panel: the registrations an engagement may use. */
export function clientRegistrationLabels(clientId: string): ClientRegistration[] {
  const rows = all<RegistrationRow>("SELECT * FROM client_registrations WHERE client_id = ?", clientId);
  return rows.map((row) => ({
    registration_id: row.registration_id,
    client_id: row.client_id,
    kind: row.kind as ClientRegistration["kind"],
    identifier_masked: maskRegistration(row),
    legal_name: row.legal_name,
    state: row.state,
    state_code: "",
    status: row.status as ClientRegistration["status"],
    effective_from: row.effective_from,
    effective_to: row.effective_to,
    place_of_business: "",
    filing_frequency: row.filing_frequency,
    is_primary: false,
    verification_status: "User entered",
    migration_note: "",
    created_at: "",
    updated_at: "",
    created_by: "",
    updated_by: "",
  }));
}

export type { Client, ClientService };
