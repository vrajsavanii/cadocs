/**
 * Engagement data access: service enrolments, document request packets, the
 * stage timeline, and the one-time backfill that brings an existing practice
 * into the workflow model.
 *
 * Kept beside `lib/db.ts` rather than inside it because these are the new
 * bounded context: the practice ledger and the engagement engine share SQLite,
 * but not their table ownership.
 */
import type {
  Client,
  ClientService,
  Compliance,
  DocumentItem,
  DocumentRequest,
  Message,
  TaskAssignmentEntry,
  TaskEvent,
  WorkStage,
} from "./types";
import {
  all,
  createCompliance,
  createDocument,
  getClient,
  getDb,
  listClients,
  logAudit,
  nextId,
  one,
  recordComplianceHistory,
  withTransaction,
} from "./db";
import { fyForDate, getService, requestByDate, serviceCodeFromLabel, type ServiceDef } from "./services";
import { currentPeriodEnd, latestCompletedPeriodEnd, periodForEnd, type EngagementPeriod } from "./periods";
import { resolveDueDates, type DueResolution } from "./due-dates";
import { todayISO } from "./format";

const REMINDER_CAP = 3;

/**
 * The checklist version in force for a service. Templates are versioned rows,
 * never overwritten, so a request generated today keeps the items it was
 * created from even after the firm edits the template tomorrow.
 */
export function checklistTemplate(serviceCode: string): { version: number; items: Array<{ name: string; category: string; optional?: boolean }> } {
  const row = one<{ version: number; items_json: string }>(
    "SELECT version, items_json FROM checklist_templates WHERE service_code = ? AND active = 1 ORDER BY version DESC LIMIT 1",
    serviceCode,
  );
  if (row) {
    try {
      const items = JSON.parse(row.items_json) as Array<{ name: string; category: string; optional?: boolean; mandatory?: boolean }>;
      if (Array.isArray(items) && items.length > 0) {
        return {
          version: Number(row.version) || 1,
          items: items.map((item) => ({ ...item, optional: item.optional ?? item.mandatory === false })),
        };
      }
    } catch {
      // A malformed template must not stop a filing cycle; fall back to code.
    }
  }
  const def = getService(serviceCode);
  return { version: 1, items: def.checklist };
}

function clampCap(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return REMINDER_CAP;
  return Math.min(REMINDER_CAP, Math.max(1, Math.round(n)));
}

// ── Period engagement creation ──────────────────────────────────────────────

/**
 * Creates (or returns) one engagement for an explicit period. This is the only
 * write path used by onboarding activation and the recurrence engine, so both
 * obey the same uniqueness key, checklist version and status-history rules.
 */
export function createEngagementPeriod(input: {
  client: Client;
  service: ClientService;
  period: EngagementPeriod;
  due: DueResolution;
  actor: string;
  role?: string;
  source?: Compliance["generation_source"];
  stage?: WorkStage;
}): CycleResult {
  const def = getService(input.service.service_code);
  const registrationId = input.service.registration_id ?? "";
  const template = checklistTemplate(def.code);
  const existing = one<Compliance>(
    "SELECT * FROM compliance WHERE client_id = ? AND service_code = ? AND period = ? AND IFNULL(registration_id,'') = IFNULL(?,'')",
    input.client.client_id,
    input.service.service_code,
    input.period.period,
    registrationId,
  );
  if (existing) {
    const request =
      one<DocumentRequest>("SELECT * FROM document_requests WHERE compliance_id = ?", existing.compliance_id) ??
      createRequestPacket({
        client_id: input.client.client_id,
        client_name: input.client.name,
        compliance_id: existing.compliance_id,
        service_code: input.service.service_code,
        period: existing.period,
        fy: existing.fy ?? input.period.fy,
        due_date: requestByDate(existing.due_date, input.service.frequency),
        status: existing.stage === "done" ? "Cleared" : "Open",
        reminder_cap: input.service.reminder_cap,
        reminders_sent: 0,
        last_sent_at: null,
        next_reminder_on: todayISO(),
        cleared_at: existing.stage === "done" ? new Date().toISOString() : null,
        registration_id: existing.registration_id ?? registrationId,
        template_version: template.version,
      });
    return {
      task: existing,
      request,
      documents: all<DocumentItem>("SELECT * FROM documents WHERE request_id = ?", request.request_id),
      created: false,
    };
  }

  if (!input.due.internal_target_date) {
    throw new Error(
      input.due.warnings[0] || `No internal target date could be resolved for ${def.name} ${input.period.period}`,
    );
  }
  const preparer = input.service.owner ?? "";
  const reviewer = input.service.reviewer ?? "";
  const blocked = [
    !preparer ? "preparer unassigned" : "",
    !reviewer ? "reviewer unassigned" : "",
    ...input.due.warnings,
  ].filter(Boolean).join(" · ");

  return withTransaction(() => {
    const task = createCompliance({
      client_id: input.client.client_id,
      client_name: input.client.name,
      compliance_type: def.name,
      period: input.period.period,
      due_date: input.due.internal_target_date,
      status: "Pending",
      filed_date: null,
      ack_number: null,
      assigned_to: preparer,
      notes: `${def.short} · ${input.period.fy} · ${input.period.period_start} → ${input.period.period_end} · generated from ${input.service.service_name}`,
      service_id: input.service.service_id,
      service_code: def.code,
      fy: input.period.fy,
      stage: input.stage ?? "documents",
      stage_updated_at: new Date().toISOString(),
      preparer,
      reviewer,
      blocked_reason: blocked,
      billed: false,
      registration_id: registrationId,
      period_type: input.period.period_type,
      period_start: input.period.period_start,
      period_end: input.period.period_end,
      assessment_year: input.period.assessment_year,
      internal_target_date: input.due.internal_target_date,
      statutory_due_date: input.due.statutory_due_date,
      due_rule_id: input.due.due_rule_id,
      due_rule_version: input.due.due_rule_version,
      due_date_source: input.due.due_date_source,
      due_date_verified: Boolean(input.due.statutory_due_date) && input.due.rule_status === "verified",
      statutory_rule_status: input.due.rule_status,
      generation_source: input.source ?? "automatic",
      generated_at: new Date().toISOString(),
    });

    const request = createRequestPacket({
      client_id: input.client.client_id,
      client_name: input.client.name,
      compliance_id: task.compliance_id,
      service_code: def.code,
      period: input.period.period,
      fy: input.period.fy,
      due_date: requestByDate(input.due.internal_target_date, input.service.frequency),
      status: "Open",
      reminder_cap: input.service.reminder_cap,
      reminders_sent: 0,
      last_sent_at: null,
      next_reminder_on: todayISO(),
      cleared_at: null,
      registration_id: registrationId,
      template_version: template.version,
    });

    const documents = template.items.map((item, index) =>
      createDocument({
        client_id: input.client.client_id,
        client_name: input.client.name,
        document_name: item.name,
        status: "Pending",
        requested_date: todayISO(),
        received_date: null,
        notes: item.optional ? "Optional — request if available" : "",
        request_id: request.request_id,
        compliance_id: task.compliance_id,
        service_code: def.code,
        category: item.category,
        fy: input.period.fy,
        period: input.period.period,
        reminder_count: 0,
        last_reminded_at: null,
        next_reminder_on: requestByDate(input.due.internal_target_date, input.service.frequency),
        verified_by: "",
        source: "checklist",
        sort_order: index,
        registration_id: registrationId,
        template_version: template.version,
      }),
    );

    recordComplianceHistory({
      compliance_id: task.compliance_id,
      from_status: null,
      to_status: task.status,
      from_stage: null,
      to_stage: task.stage ?? "documents",
      actor: input.actor,
      role: input.role ?? "system",
      reason: `Generated from ${input.service.service_name} for ${input.period.period}`,
    });
    logTaskEvent({
      compliance_id: task.compliance_id,
      from_stage: null,
      to_stage: input.stage ?? "documents",
      actor: input.actor,
      role: input.role ?? "system",
      note: `${input.period.period} cycle opened · ${documents.length} documents requested${preparer ? ` · owner ${preparer}` : " · owner unassigned"}`,
    });
    // Seed the assignment ledger so the first configuration is history too,
    // not just an invisible starting state that the first reassignment erases.
    if (preparer) {
      recordTaskAssignment({
        compliance_id: task.compliance_id,
        client_id: input.client.client_id,
        responsibility: "preparer",
        previous_assignee: "",
        new_assignee: preparer,
        actor: input.actor,
        actor_role: input.role ?? "system",
        reason: `Initial assignment from ${input.service.service_name} configuration`,
      });
    }
    if (reviewer) {
      recordTaskAssignment({
        compliance_id: task.compliance_id,
        client_id: input.client.client_id,
        responsibility: "reviewer",
        previous_assignee: "",
        new_assignee: reviewer,
        actor: input.actor,
        actor_role: input.role ?? "system",
        reason: `Initial assignment from ${input.service.service_name} configuration`,
      });
    }
    logAudit({
      actor: input.actor,
      action: "ENGAGEMENT_GENERATED",
      entity_type: "compliance",
      entity_id: task.compliance_id,
      detail: `${def.name} · ${input.period.period} · ${input.due.internal_target_date}${input.due.statutory_due_date ? " (statutory verified)" : " (internal target; statutory unverified)"}`,
    });

    return { task, request, documents, created: true };
  });
}

// ── Client services ──────────────────────────────────────────────────────────

export function listClientServices(clientId?: string): ClientService[] {
  const rows = clientId
    ? all<ClientService>("SELECT * FROM client_services WHERE client_id = ? ORDER BY service_name", clientId)
    : all<ClientService>("SELECT * FROM client_services ORDER BY service_name");
  return rows.map(normaliseService);
}

export function getClientService(serviceId: string): ClientService | null {
  const row = one<ClientService>("SELECT * FROM client_services WHERE service_id = ?", serviceId);
  return row ? normaliseService(row) : null;
}

export function getClientServiceByCode(
  clientId: string,
  serviceCode: string,
  registrationId?: string,
): ClientService | null {
  const row =
    registrationId === undefined
      ? one<ClientService>(
          "SELECT * FROM client_services WHERE client_id = ? AND service_code = ? ORDER BY CASE WHEN IFNULL(registration_id,'') = '' THEN 0 ELSE 1 END, created_at LIMIT 1",
          clientId,
          serviceCode,
        )
      : one<ClientService>(
          "SELECT * FROM client_services WHERE client_id = ? AND service_code = ? AND IFNULL(registration_id,'') = IFNULL(?,'') LIMIT 1",
          clientId,
          serviceCode,
          registrationId,
        );
  return row ? normaliseService(row) : null;
}

function normaliseService(row: ClientService): ClientService {
  return {
    ...row,
    registration_id: row.registration_id ?? "",
    manager: row.manager ?? "",
    partner: row.partner ?? "",
    end_date: row.end_date ?? "",
    fee_model: row.fee_model ?? "recurring",
    setup_fee: Number(row.setup_fee) || 0,
    payment_terms_days: Number(row.payment_terms_days) || 30,
    fee_effective_from: row.fee_effective_from ?? "",
    approval_stage: row.approval_stage ?? "none",
    paused_at: row.paused_at ?? null,
    completed_at: row.completed_at ?? null,
    cancelled_at: row.cancelled_at ?? null,
    updated_at: row.updated_at ?? row.created_at,
    auto_invoice: Boolean(row.auto_invoice),
    fee: Number(row.fee) || 0,
    reminder_cap: clampCap(row.reminder_cap),
    reminder_gap_days: Math.min(30, Math.max(1, Number(row.reminder_gap_days) || 3)),
  };
}

export function createClientService(
  input: Omit<ClientService, "service_id" | "created_at"> & Partial<Pick<ClientService, "created_at">>,
): ClientService {
  const existing = getClientServiceByCode(input.client_id, input.service_code, input.registration_id);
  if (existing) return updateClientService(existing.service_id, input) ?? existing;
  const service: ClientService = {
    ...input,
    service_id: nextId("SRV", "client_services", "service_id"),
    created_at: input.created_at ?? new Date().toISOString(),
    reminder_cap: clampCap(input.reminder_cap ?? REMINDER_CAP),
    reminder_gap_days: Math.min(30, Math.max(1, Number(input.reminder_gap_days) || 3)),
    auto_invoice: input.auto_invoice ?? true,
  };
  withTransaction(() => {
    getDb()
      .prepare(`INSERT INTO client_services (service_id,client_id,service_code,service_name,line,frequency,fee,billing_cycle,auto_invoice,
      owner,reviewer,status,start_date,reminder_cap,reminder_gap_days,next_cycle_on,created_at,
      registration_id,manager,partner,end_date,fee_model,setup_fee,payment_terms_days,fee_effective_from,
      approval_stage,paused_at,completed_at,cancelled_at,updated_at,created_by,updated_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(
      service.service_id,
      service.client_id,
      service.service_code,
      service.service_name,
      service.line,
      service.frequency,
      service.fee,
      service.billing_cycle,
      service.auto_invoice ? 1 : 0,
      service.owner,
      service.reviewer,
      service.status,
      service.start_date,
      service.reminder_cap,
      service.reminder_gap_days,
      service.next_cycle_on ?? null,
      service.created_at,
      service.registration_id ?? "",
      service.manager ?? "",
      service.partner ?? "",
      service.end_date ?? "",
      service.fee_model ?? "recurring",
      service.setup_fee ?? 0,
      service.payment_terms_days ?? 30,
      service.fee_effective_from ?? "",
      service.approval_stage ?? "none",
      service.paused_at ?? null,
      service.completed_at ?? null,
      service.cancelled_at ?? null,
      service.updated_at ?? service.created_at,
      service.created_by ?? "",
      service.updated_by ?? "",
      );
    logAudit({
      action: "SERVICE_ENROLLED",
      entity_type: "client",
      entity_id: service.client_id,
      detail: `${service.service_name} · ${service.frequency} · ₹${Math.round(service.fee).toLocaleString("en-IN")}`,
    });
  });
  return service;
}

export function updateClientService(serviceId: string, patch: Partial<ClientService>): ClientService | null {
  const current = getClientService(serviceId);
  if (!current) return null;
  const next = { ...current, ...patch };
  getDb()
    .prepare(`UPDATE client_services SET service_code=?,service_name=?,line=?,frequency=?,fee=?,billing_cycle=?,auto_invoice=?,
      owner=?,reviewer=?,status=?,start_date=?,reminder_cap=?,reminder_gap_days=?,next_cycle_on=?,
      registration_id=?,manager=?,partner=?,end_date=?,fee_model=?,setup_fee=?,payment_terms_days=?,fee_effective_from=?,
      approval_stage=?,paused_at=?,completed_at=?,cancelled_at=?,updated_at=?,updated_by=? WHERE service_id=?`)
    .run(
      next.service_code,
      next.service_name,
      next.line,
      next.frequency,
      next.fee,
      next.billing_cycle,
      next.auto_invoice ? 1 : 0,
      next.owner,
      next.reviewer,
      next.status,
      next.start_date,
      clampCap(next.reminder_cap),
      Math.min(30, Math.max(1, Number(next.reminder_gap_days) || 3)),
      next.next_cycle_on ?? null,
      next.registration_id ?? "",
      next.manager ?? "",
      next.partner ?? "",
      next.end_date ?? "",
      next.fee_model ?? "recurring",
      next.setup_fee ?? 0,
      next.payment_terms_days ?? 30,
      next.fee_effective_from ?? "",
      next.approval_stage ?? "none",
      next.paused_at ?? null,
      next.completed_at ?? null,
      next.cancelled_at ?? null,
      next.updated_at ?? new Date().toISOString(),
      next.updated_by ?? "",
      serviceId,
    );
  logAudit({ action: "SERVICE_UPDATED", entity_type: "client", entity_id: current.client_id, detail: `${next.service_name} updated` });
  return getClientService(serviceId);
}

export function deleteClientService(serviceId: string): { ok: boolean; blockers: string[] } {
  const service = getClientService(serviceId);
  if (!service) return { ok: false, blockers: ["Service not found"] };
  const cycles = Number(one<{ n: number }>("SELECT COUNT(*) AS n FROM compliance WHERE service_id = ?", serviceId)?.n ?? 0);
  if (cycles > 0) return { ok: false, blockers: [`${cycles} filing cycle${cycles === 1 ? "" : "s"} already generated`] };
  getDb().prepare("DELETE FROM client_services WHERE service_id = ?").run(serviceId);
  logAudit({ action: "SERVICE_REMOVED", entity_type: "client", entity_id: service.client_id, detail: `${service.service_name} removed` });
  return { ok: true, blockers: [] };
}

// ── Document request packets ─────────────────────────────────────────────────

export function listDocumentRequests(clientId?: string): DocumentRequest[] {
  const rows = clientId
    ? all<DocumentRequest>(
        "SELECT * FROM document_requests WHERE client_id = ? ORDER BY CASE status WHEN 'Open' THEN 0 ELSE 1 END, due_date",
        clientId,
      )
    : all<DocumentRequest>("SELECT * FROM document_requests ORDER BY CASE status WHEN 'Open' THEN 0 ELSE 1 END, due_date");
  return rows.map((row) => ({
    ...row,
    missing_note: row.missing_note ?? "",
    reminder_cap: clampCap(row.reminder_cap),
    reminders_sent: Number(row.reminders_sent) || 0,
  }));
}

export function getDocumentRequest(requestId: string): DocumentRequest | null {
  const row = one<DocumentRequest>("SELECT * FROM document_requests WHERE request_id = ?", requestId);
  return row ? { ...row, missing_note: row.missing_note ?? "", reminder_cap: clampCap(row.reminder_cap), reminders_sent: Number(row.reminders_sent) || 0 } : null;
}

export function createRequestPacket(
  input: Omit<DocumentRequest, "request_id" | "created_at"> & Partial<Pick<DocumentRequest, "created_at">>,
): DocumentRequest {
  const request: DocumentRequest = {
    ...input,
    request_id: nextId("REQ", "document_requests", "request_id"),
    created_at: input.created_at ?? new Date().toISOString(),
    missing_note: (input.missing_note ?? "").slice(0, 500),
    reminder_cap: clampCap(input.reminder_cap ?? REMINDER_CAP),
    reminders_sent: Math.max(0, Number(input.reminders_sent) || 0),
  };
  getDb()
    .prepare(`INSERT INTO document_requests (request_id,client_id,client_name,compliance_id,service_code,period,fy,due_date,status,
      reminder_cap,reminders_sent,last_sent_at,next_reminder_on,created_at,cleared_at,registration_id,template_version,missing_note)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(
      request.request_id,
      request.client_id,
      request.client_name,
      request.compliance_id,
      request.service_code,
      request.period,
      request.fy,
      request.due_date,
      request.status,
      request.reminder_cap,
      request.reminders_sent,
      request.last_sent_at ?? null,
      request.next_reminder_on ?? null,
      request.created_at,
      request.cleared_at ?? null,
      request.registration_id ?? "",
      request.template_version ?? null,
      request.missing_note ?? "",
    );
  return request;
}

export function updateDocumentRequest(requestId: string, patch: Partial<DocumentRequest>): DocumentRequest | null {
  const current = getDocumentRequest(requestId);
  if (!current) return null;
  const next = { ...current, ...patch };
  getDb()
    .prepare(
      `UPDATE document_requests SET status=?,reminder_cap=?,reminders_sent=?,last_sent_at=?,next_reminder_on=?,cleared_at=?,missing_note=? WHERE request_id=?`,
    )
    .run(
      next.status,
      clampCap(next.reminder_cap),
      Math.min(clampCap(next.reminder_cap), Math.max(0, Number(next.reminders_sent) || 0)),
      next.last_sent_at ?? null,
      next.next_reminder_on ?? null,
      next.cleared_at ?? null,
      (next.missing_note ?? "").slice(0, 500),
      requestId,
    );
  return getDocumentRequest(requestId);
}

/**
 * Clears a packet the moment nothing is pending — client-side automation stops
 * for *received* documents, not when somebody remembers to switch it off.
 */
export function refreshRequestStatus(requestId: string): DocumentRequest | null {
  if (!requestId) return null;
  const request = getDocumentRequest(requestId);
  if (!request) return null;
  const docs = all<DocumentItem>("SELECT * FROM documents WHERE request_id = ?", requestId);
  if (docs.length === 0) return request;
  const pending = docs.filter((d) => d.status === "Pending" || d.status === "Rejected").length;
  if (pending === 0 && request.status !== "Cleared") {
    getDb()
      .prepare("UPDATE document_requests SET status='Cleared', cleared_at=?, next_reminder_on=NULL WHERE request_id=?")
      .run(new Date().toISOString(), requestId);
    getDb().prepare("UPDATE documents SET next_reminder_on=NULL WHERE request_id=? AND status IN ('Received','Verified')").run(requestId);
    logAudit({
      action: "DOCUMENTS_CLEARED",
      entity_type: "document_request",
      entity_id: requestId,
      detail: `All papers received from ${request.client_name} — reminders stopped`,
    });
    return getDocumentRequest(requestId);
  }
  if (pending > 0 && request.status === "Cleared") {
    getDb().prepare("UPDATE document_requests SET status='Open', cleared_at=NULL WHERE request_id=?").run(requestId);
    return getDocumentRequest(requestId);
  }
  return request;
}

// ── Timeline ─────────────────────────────────────────────────────────────────

export function listTaskEvents(complianceId: string): TaskEvent[] {
  return all<TaskEvent>("SELECT * FROM task_events WHERE compliance_id = ? ORDER BY created_at ASC", complianceId);
}

export function recentTaskEvents(limit = 20): TaskEvent[] {
  return all<TaskEvent>("SELECT * FROM task_events ORDER BY created_at DESC LIMIT ?", limit);
}

// ── Task assignment ledger (Prompt 07) ────────────────────────────────────

/**
 * One append-only row per preparer/reviewer decision on an engagement.
 * Reassignment never rewrites history: the previous assignee is preserved in
 * the row, and older rows stay queryable from task-level and client-360 views.
 */
export function recordTaskAssignment(input: {
  compliance_id: string;
  client_id: string;
  responsibility: TaskAssignmentEntry["responsibility"];
  previous_assignee: string;
  new_assignee: string;
  actor: string;
  actor_role: string;
  reason: string;
}): TaskAssignmentEntry {
  const entry: TaskAssignmentEntry = {
    assignment_id: nextId("ASN", "task_assignments", "assignment_id"),
    compliance_id: input.compliance_id,
    client_id: input.client_id,
    responsibility: input.responsibility,
    previous_assignee: input.previous_assignee ?? "",
    new_assignee: input.new_assignee ?? "",
    actor: input.actor,
    actor_role: input.actor_role,
    reason: (input.reason ?? "").slice(0, 400),
    created_at: new Date().toISOString(),
  };
  getDb()
    .prepare(
      "INSERT INTO task_assignments (assignment_id,compliance_id,client_id,responsibility,previous_assignee,new_assignee,actor,actor_role,reason,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      entry.assignment_id,
      entry.compliance_id,
      entry.client_id,
      entry.responsibility,
      entry.previous_assignee,
      entry.new_assignee,
      entry.actor,
      entry.actor_role,
      entry.reason,
      entry.created_at,
    );
  return entry;
}

export function listTaskAssignments(complianceId: string): TaskAssignmentEntry[] {
  return all<TaskAssignmentEntry>(
    "SELECT * FROM task_assignments WHERE compliance_id = ? ORDER BY created_at ASC, assignment_id ASC",
    complianceId,
  );
}

export function logTaskEvent(input: {
  compliance_id: string;
  from_stage: WorkStage | null;
  to_stage: WorkStage;
  actor: string;
  role: string;
  note?: string;
}): TaskEvent {
  const event: TaskEvent = {
    event_id: nextId("EVT", "task_events", "event_id"),
    compliance_id: input.compliance_id,
    from_stage: input.from_stage,
    to_stage: input.to_stage,
    actor: input.actor,
    role: input.role,
    note: input.note ?? "",
    created_at: new Date().toISOString(),
  };
  getDb()
    .prepare("INSERT INTO task_events (event_id,compliance_id,from_stage,to_stage,actor,role,note,created_at) VALUES (?,?,?,?,?,?,?,?)")
    .run(event.event_id, event.compliance_id, event.from_stage, event.to_stage, event.actor, event.role, event.note, event.created_at);
  return event;
}

export function listMessagesFor(relatedId: string): Message[] {
  return all<Message>("SELECT * FROM messages WHERE related_id = ? ORDER BY created_at DESC", relatedId);
}

// ── Period generation ────────────────────────────────────────────────────────

export type CycleResult = {
  task: Compliance;
  request: DocumentRequest;
  documents: DocumentItem[];
  created: boolean;
};

/**
 * Creates one period's engagement: the filing task, its document request packet
 * and the checklist. Duplicate-safe on client + service + period, so onboarding,
 * the cron sweep and "Run now" can all call it.
 */
export function createCycleForService(input: {
  client: Client;
  service: ClientService;
  actor: string;
  role?: string;
  dueDateOverride?: string;
  periodOverride?: string;
  stage?: WorkStage;
}): CycleResult {
  const frequency = input.service.frequency;
  const today = todayISO();
  let end = latestCompletedPeriodEnd(frequency, today, input.service.service_code);
  // Activation mid-period: the last completed period may pre-date the service.
  // Use the in-progress period instead of inventing historical work.
  if (input.service.start_date && end < input.service.start_date) {
    end = currentPeriodEnd(frequency, today, input.service.service_code);
  }
  const period = periodForEnd(frequency, end, input.service.service_code);
  if (input.periodOverride?.trim()) period.period = input.periodOverride.trim();
  const due = resolveDueDates(input.service.service_code, frequency, period.period_end);
  if (input.dueDateOverride) {
    due.internal_target_date = input.dueDateOverride;
    due.statutory_due_date = null;
    due.rule_status = "unverified";
    due.due_date_source = "Explicit manual date supplied without verification";
    due.warnings = ["Internal target date was set manually; no statutory date is claimed."];
  }
  return createEngagementPeriod({
    client: input.client,
    service: input.service,
    period,
    due,
    actor: input.actor,
    role: input.role,
    source: "activation",
    stage: input.stage,
  });
}

/** Re-materialises a cycle's checklist if rows are missing or a service was added late. */
export function ensureChecklistForCycle(
  complianceId: string,
  actor: string,
): { request: DocumentRequest | null; created: number; task: Compliance | null } {
  const task = one<Compliance>("SELECT * FROM compliance WHERE compliance_id = ?", complianceId);
  if (!task) return { request: null, created: 0, task: null };
  const client = getClient(task.client_id);
  if (!client) return { request: null, created: 0, task };
  const service =
    (task.service_id ? getClientService(task.service_id) : null) ??
    (task.service_code ? getClientServiceByCode(task.client_id, task.service_code) : null);
  const def = getService(task.service_code || service?.service_code || "other");
  const template = checklistTemplate(def.code);
  let request = one<DocumentRequest>("SELECT * FROM document_requests WHERE compliance_id = ?", complianceId);
  if (!request) {
    request = createRequestPacket({
      client_id: client.client_id,
      client_name: client.name,
      compliance_id: complianceId,
      service_code: def.code,
      period: task.period,
      fy: task.fy || fyForDate(task.due_date),
      due_date: requestByDate(task.due_date, def.frequency),
      status: "Open",
      reminder_cap: service?.reminder_cap ?? 3,
      reminders_sent: 0,
      last_sent_at: null,
      next_reminder_on: todayISO(),
      cleared_at: null,
      registration_id: task.registration_id ?? service?.registration_id ?? "",
      template_version: template.version,
    });
  }
  const existing = new Set(
    all<{ document_name: string }>("SELECT document_name FROM documents WHERE request_id = ?", request.request_id).map((d) => d.document_name),
  );
  let created = 0;
  template.items.forEach((item, index) => {
    if (existing.has(item.name)) return;
    createDocument({
      client_id: client.client_id,
      client_name: client.name,
      document_name: item.name,
      status: "Pending",
      requested_date: todayISO(),
      received_date: null,
      notes: item.optional ? "Optional — request if available" : "",
      request_id: request!.request_id,
      compliance_id: complianceId,
      service_code: def.code,
      category: item.category,
      fy: task.fy || fyForDate(task.due_date),
      period: task.period,
      reminder_count: 0,
      last_reminded_at: null,
      next_reminder_on: requestByDate(task.due_date, def.frequency),
      verified_by: "",
      source: "checklist",
      sort_order: index,
      registration_id: task.registration_id ?? service?.registration_id ?? "",
      template_version: template.version,
    });
    created++;
  });
  if (created && request.status === "Cleared") refreshRequestStatus(request.request_id);
  logAudit({ action: "CHECKLIST_ENSURE", entity_type: "compliance", entity_id: complianceId, detail: `${created} missing checklist item(s) added by ${actor}` });
  return { request: getDocumentRequest(request.request_id), created, task };
}

/** Creates the current period for every active service that is missing one. */
export function ensureCurrentCycles(limit = 40): number {
  const clients = listClients().filter((c) => (c.client_status ?? "Active") === "Active");
  const services = listClientServices().filter((s) => s.status === "Active");
  let created = 0;
  for (const service of services) {
    if (created >= limit) break;
    const client = clients.find((c) => c.client_id === service.client_id);
    if (!client) continue;
    const result = createCycleForService({ client, service, actor: "Client cycle engine", role: "system" });
    if (result.created) created++;
  }
  return created;
}

// ── One-time backfill ────────────────────────────────────────────────────────

let ensuredThisProcess = false;

/**
 * Brings rows created before the workflow release into the engagement model.
 * Idempotent via a settings marker; also fills the current period once so the
 * board is usable immediately after an upgrade.
 */
export function ensureEngagementData(): void {
  if (ensuredThisProcess) return;
  ensuredThisProcess = true;
  const db = getDb();

  const flag = db.prepare("SELECT value FROM settings WHERE key = 'workflow_backfill_v1'").get() as { value: string } | undefined;
  if (!flag) {
    const stampNow = new Date().toISOString();
    const today = todayISO();
    const users = db
      .prepare("SELECT name, role FROM users ORDER BY CASE role WHEN 'partner' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END")
      .all() as unknown as Array<{ name: string; role: string }>;
    const partner = users.find((u) => u.role === "partner")?.name ?? "Partner";
    const manager = users.find((u) => u.role === "manager")?.name ?? partner;
    const article = users.find((u) => u.role === "article")?.name ?? manager;

    const clientRows = db.prepare("SELECT * FROM clients").all() as unknown as Array<Record<string, string | number | null>>;
    let serviceCounter = 0;
    for (const row of clientRows) {
      const id = String(row.client_id);
      const name = String(row.name ?? "");
      db.prepare(
        `UPDATE clients SET legal_name=COALESCE(NULLIF(legal_name,''),?), gst_state_code=COALESCE(NULLIF(gst_state_code,''),?),
         whatsapp_opt_in=COALESCE(whatsapp_opt_in,1), onboarding_status=COALESCE(NULLIF(onboarding_status,''),'Active'),
         client_status=COALESCE(NULLIF(client_status,''),'Active'), fy_end_month=COALESCE(fy_end_month,3) WHERE client_id=?`,
      ).run(name, String(row.gst_number ?? "").slice(0, 2), id);

      const count = db.prepare("SELECT COUNT(*) AS n FROM client_services WHERE client_id = ?").get(id) as { n: number };
      if (count.n > 0) continue;

      const labels = String(row.services_opted ?? "GST Filing, ITR")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const codes = [...new Set(labels.map((label) => serviceCodeFromLabel(label)).filter((c): c is string => Boolean(c)))];
      if (codes.length === 0) codes.push("other");
      const insert = db.prepare(`INSERT INTO client_services (service_id,client_id,service_code,service_name,line,frequency,fee,billing_cycle,auto_invoice,
        owner,reviewer,status,start_date,reminder_cap,reminder_gap_days,next_cycle_on,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      codes.forEach((code) => {
        const def = getService(code);
        serviceCounter++;
        insert.run(
          `SRV-B${serviceCounter}`,
          id,
          code,
          def.name,
          def.line,
          def.frequency,
          def.defaultFee,
          def.billingCycle,
          1,
          article,
          manager,
          "Active",
          String(row.created_at ?? stampNow).slice(0, 10),
          3,
          3,
          null,
          stampNow,
        );
      });
    }

    const complianceRows = db.prepare("SELECT * FROM compliance").all() as unknown as Array<Record<string, string | number | null>>;
    for (const row of complianceRows) {
      const type = String(row.compliance_type ?? "");
      const code = String(row.service_code ?? "") || serviceCodeFromLabel(type) || "other";
      const service = db
        .prepare("SELECT service_id FROM client_services WHERE client_id = ? AND service_code = ?")
        .get(String(row.client_id), code) as { service_id: string } | undefined;
      const status = String(row.status ?? "Pending");
      const stage = String(row.stage ?? "") || (status === "Filed" ? "done" : status === "In Progress" ? "preparation" : "documents");
      const due = String(row.due_date ?? today);
      db.prepare(
        `UPDATE compliance SET service_code=?, service_id=COALESCE(NULLIF(service_id,''),?), fy=COALESCE(NULLIF(fy,''),?), stage=?,
         preparer=COALESCE(NULLIF(preparer,''),NULLIF(assigned_to,''),?), reviewer=COALESCE(NULLIF(reviewer,''),?),
         completed_at=CASE WHEN ?='done' THEN COALESCE(completed_at, ?) ELSE completed_at END WHERE compliance_id=?`,
      ).run(code, service?.service_id ?? "", fyForDate(due), stage, article, manager, stage, stampNow, String(row.compliance_id));
    }

    const orphans = db
      .prepare("SELECT * FROM documents WHERE request_id IS NULL OR request_id = ''")
      .all() as unknown as Array<Record<string, string | number | null>>;
    const groups = new Map<string, Array<Record<string, string | number | null>>>();
    for (const doc of orphans) {
      const key = `${doc.client_id}|${String(doc.requested_date ?? today).slice(0, 7)}`;
      groups.set(key, [...(groups.get(key) ?? []), doc]);
    }
    let index = 0;
    for (const [, docs] of groups) {
      const first = docs[0]!;
      const clientId = String(first.client_id);
      const requested = String(first.requested_date ?? today);
      const service = db
        .prepare("SELECT service_code FROM client_services WHERE client_id = ? ORDER BY CASE status WHEN 'Active' THEN 0 ELSE 1 END LIMIT 1")
        .get(clientId) as { service_code: string } | undefined;
      const code = service?.service_code ?? serviceCodeFromLabel(String(first.document_name ?? "")) ?? "other";
      const due = `${requested.slice(0, 7)}-${String(Math.min(28, Number(requested.slice(8, 10)) || 7)).padStart(2, "0")}`;
      const pending = docs.some((d) => d.status === "Pending" || d.status === "Rejected");
      const requestId = `REQ-B${++index}`;
      db.prepare(`INSERT OR IGNORE INTO document_requests (request_id,client_id,client_name,compliance_id,service_code,period,fy,due_date,status,
        reminder_cap,reminders_sent,last_sent_at,next_reminder_on,created_at,cleared_at)
        VALUES (?,?,?,?,?,?,?,?,?,3,0,NULL,NULL,?,?)`).run(
        requestId,
        clientId,
        String(first.client_name ?? ""),
        "",
        code,
        requested.slice(0, 7),
        fyForDate(requested),
        due,
        pending ? "Open" : "Cleared",
        stampNow,
        pending ? null : stampNow,
      );
      for (const doc of docs) {
        db.prepare(
          `UPDATE documents SET request_id=?, service_code=COALESCE(NULLIF(service_code,''),?), category=COALESCE(NULLIF(category,''),?), fy=COALESCE(NULLIF(fy,''),?),
           period=COALESCE(NULLIF(period,''),?), source=COALESCE(source,'manual'), next_reminder_on=CASE WHEN status='Pending' THEN COALESCE(next_reminder_on, ?) ELSE NULL END WHERE doc_id=?`,
        ).run(requestId, code, "General", fyForDate(requested), requested.slice(0, 7), today, String(doc.doc_id));
      }
    }

    db.prepare("INSERT INTO settings (key,value) VALUES ('workflow_backfill_v1', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(stampNow);
  }

  const cyclesFlag = db.prepare("SELECT value FROM settings WHERE key = 'workflow_cycles_v1'").get() as { value: string } | undefined;
  if (!cyclesFlag) {
    const created = ensureCurrentCycles(30);
    db.prepare("INSERT INTO settings (key,value) VALUES ('workflow_cycles_v1', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(
      `${new Date().toISOString()}|${created}`,
    );
  }
}

/** A client's folder root: client → FY → category. */
export function folderPath(clientName: string, fy: string, category: string): string {
  return [clientName, fy || "Unfiled", category || "General"].join(" / ");
}

export function serviceDefFor(code: string): ServiceDef {
  return getService(code);
}

export function getClientForCycle(complianceId: string): Client | null {
  const row = one<{ client_id: string }>("SELECT client_id FROM compliance WHERE compliance_id = ?", complianceId);
  return row ? getClient(row.client_id) : null;
}
