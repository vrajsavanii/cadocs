/**
 * The filing workflow: documents → preparation → review → portal filing →
 * CA sign-off → done.
 *
 * The stages encode the handoff the practice already makes verbally:
 * the accountant verifies the papers and prepares the return, a manager
 * reviews it and files it online, and the partner signs off before it closes.
 * Gates are enforced here, server-side, so a dashboard button cannot skip the
 * partner's audit or close a filing without an acknowledgement number.
 */
import type {
  AuthUser,
  ClientService,
  Compliance,
  DocumentItem,
  DocumentRequest,
  Invoice,
  Message,
  StatusHistoryEntry,
  TaskAssignmentEntry,
  TaskBlocker,
  TaskEvent,
  TeamWorkload,
  WorkStage,
  WorkflowData,
  WorkflowTask,
} from "./types";
import {
  getClient,
  getDb,
  listCompliance,
  listComplianceHistory,
  listDocuments,
  listInvoices,
  listUsers,
  logAudit,
  one,
  recordComplianceHistory,
} from "./db";
import { assertAssignable } from "./engagement-engine";
import { decryptField } from "./crypto";
import { listTaskAssignments, recordTaskAssignment } from "./engagements-db";
import { listBlockers, openBlockingFor } from "./blockers";
import {
  getClientService,
  getClientServiceByCode,
  listDocumentRequests,
  listMessagesFor,
  listTaskEvents,
  logTaskEvent,
} from "./engagements-db";
import { getService, SERVICE_LINES, STAGE_ORDER, stageIndex, type ServiceDef } from "./services";
import { invoiceCycleFor } from "./billing";
import { hasInvoicePermission } from "./invoicing";
import { todayISO } from "./format";

const ROLE_STAGES: Record<string, WorkStage[]> = {
  article: ["documents", "preparation"],
  manager: ["review", "filing"],
  partner: ["signoff"],
};

/** Two people saved the same engagement at once — the browser lost the race. */
export class StaleWorkflowError extends Error {
  constructor(message = "This engagement was just updated by someone else — reopen it and try again") {
    super(message);
    this.name = "StaleWorkflowError";
  }
}

function assignmentState(preparer: string, reviewer: string): NonNullable<Compliance["assignment_state"]> {
  if (preparer && reviewer) return "assigned";
  if (!preparer && !reviewer) return "missing_both";
  return preparer ? "missing_reviewer" : "missing_preparer";
}

export function effectiveStage(task: Compliance): WorkStage {
  if (task.stage && STAGE_ORDER.includes(task.stage)) return task.stage;
  if (task.status === "Filed") return "done";
  if (task.status === "In Progress") return "preparation";
  return "documents";
}

function taskService(task: Compliance): ClientService | null {
  return (
    (task.service_id ? getClientService(task.service_id) : null) ??
    (task.service_code ? getClientServiceByCode(task.client_id, task.service_code) : null)
  );
}

function taskDocs(task: Compliance): DocumentItem[] {
  return listDocuments().filter((d) => d.compliance_id === task.compliance_id);
}

function taskRequest(task: Compliance): DocumentRequest | null {
  return listDocumentRequests().find((r) => r.compliance_id === task.compliance_id) ?? null;
}

function taskInvoice(task: Compliance): Invoice | null {
  return listInvoices().find((i) => i.compliance_id === task.compliance_id) ?? null;
}

function taskRegistration(task: Compliance): { masked: string; state: string; status: string } {
  if (!task.registration_id) return { masked: "", state: "", status: "" };
  const row = one<{ kind: string; identifier_enc: string; state: string; status: string }>(
    "SELECT kind, identifier_enc, state, status FROM client_registrations WHERE registration_id = ?",
    task.registration_id,
  );
  if (!row) return { masked: "", state: "", status: "" };
  let raw = "";
  try {
    raw = row.identifier_enc ? decryptField(row.identifier_enc) : "";
  } catch {
    raw = "";
  }
  const masked =
    row.kind === "GST" && raw.length >= 10
      ? `${raw.slice(0, 2)}••••••${raw.slice(-4)}`
      : raw.length > 4
        ? `${raw.slice(0, 2)}••••${raw.slice(-2)}`
        : raw
          ? "••••"
          : "";
  return { masked, state: row.state || "", status: row.status || "" };
}

export function deadlineState(
  task: Compliance,
  stage: WorkStage,
  docs: DocumentItem[],
  preparer: string,
  reviewer: string,
): WorkflowTask["deadline_state"] {
  if (stage === "done") return "completed";
  if (!task.due_date) return "statutory_unknown";
  if (!preparer && !reviewer) return "blocked_assignment";
  if (docs.some((doc) => (doc.status === "Pending" || doc.status === "Rejected") && !/optional/i.test(doc.notes || ""))) {
    return "blocked_documents";
  }
  if (stage === "review") return "awaiting_review";
  if ((stage === "filing" || stage === "signoff") && !task.filing_reference) return "awaiting_filing_evidence";
  const today = todayISO();
  if (task.due_date < today) return "overdue";
  if (task.due_date === today) return "due_today";
  if (task.due_date <= addDays(today, 7)) return "due_soon";
  return "not_due";
}

export function toWorkflowTask(task: Compliance): WorkflowTask {
  const def = getService(task.service_code || "other");
  const docs = taskDocs(task);
  const request = taskRequest(task);
  const invoice = taskInvoice(task);
  const stage = effectiveStage(task);
  const preparer = task.preparer || task.assigned_to || "";
  const reviewer = task.reviewer || "";
  const registration = taskRegistration(task);
  return {
    ...task,
    stage,
    service_code: task.service_code || def.code,
    fy: task.fy || "",
    preparer,
    reviewer,
    service_name: def.name,
    line: def.line,
    frequency: def.frequency,
    docs_total: docs.length,
    docs_pending: docs.filter((d) => d.status === "Pending" || d.status === "Rejected").length,
    docs_received: docs.filter((d) => d.status === "Received").length,
    docs_verified: docs.filter((d) => d.status === "Verified").length,
    request_id: request?.request_id ?? null,
    invoice_id: invoice?.invoice_id ?? null,
    open_invoice_total: invoice && invoice.paid_amount < invoice.total_amount ? invoice.total_amount - invoice.paid_amount : 0,
    due_date_verified: Boolean(task.due_date_verified),
    billed: Boolean(task.billed),
    registration_masked: registration.masked,
    registration_state: registration.state,
    registration_status: registration.status,
    deadline_state: deadlineState(task, stage, docs, preparer, reviewer),
    assignment_state: assignmentState(preparer, reviewer),
    has_open_blockers: openBlockingFor(task.compliance_id).length > 0,
    config_warnings: [
      ...(!preparer ? ["Preparer unassigned"] : []),
      ...(!reviewer ? ["Reviewer unassigned"] : []),
      ...(task.statutory_rule_status === "unverified" ? ["Statutory due date unverified — internal target shown"] : []),
      ...(task.statutory_rule_status === "conflicting" ? ["Conflicting statutory rules — resolve before filing"] : []),
      ...(registration.status && registration.status !== "Active" ? [`Registration is ${registration.status}`] : []),
    ],
  };
}

export function buildWorkflow(user: AuthUser | null): WorkflowData {
  const tasks = listCompliance().map(toWorkflowTask);
  const open = tasks.filter((t) => t.stage !== "done");
  const stageCounts = Object.fromEntries(STAGE_ORDER.map((stage) => [stage, tasks.filter((t) => t.stage === stage).length])) as Record<
    WorkStage,
    number
  >;
  const serviceLines = new Map<WorkflowTask["line"], number>();
  open.forEach((task) => serviceLines.set(task.line, (serviceLines.get(task.line) ?? 0) + 1));
  const month = todayISO().slice(0, 7);
  const totals = {
    open: open.length,
    dueThisWeek: open.filter((t) => {
      const due = t.due_date;
      return due >= todayISO() && due <= addDays(todayISO(), 7);
    }).length,
    overdue: open.filter((t) => t.due_date < todayISO()).length,
    docsPending: tasks.reduce((sum, t) => sum + t.docs_pending, 0),
    awaitingSignoff: stageCounts.signoff,
    completedThisMonth: tasks.filter((t) => t.stage === "done" && (t.completed_at ?? t.filed_date ?? "").startsWith(month)).length,
    unassigned: open.filter((t) => t.assignment_state === "missing_both" || t.assignment_state === "missing_preparer" || t.assignment_state === "missing_reviewer").length,
    blocked: open.filter(
      (t) => t.has_open_blockers || t.deadline_state === "blocked_documents" || t.deadline_state === "blocked_assignment",
    ).length,
    awaitingReview: open.filter((t) => t.stage === "review").length,
  };
  const myWork = user ? tasks.filter((task) => isMine(task, user)).sort(byUrgency) : [];

  // Role-gated operational sections. Articles never receive these aggregates —
  // a hidden UI element is not a permission boundary, so the server omits the
  // data entirely for roles whose policy excludes team oversight.
  const supervisory = user?.role === "manager" || user?.role === "partner";
  const unassigned = supervisory ? open.filter((t) => t.assignment_state !== "assigned") : [];
  const blocked = supervisory
    ? open.filter((t) => t.has_open_blockers || t.deadline_state === "blocked_documents" || t.deadline_state === "blocked_assignment")
    : [];
  const team = supervisory ? buildTeamWorkload(tasks, month) : undefined;

  return {
    tasks: tasks.sort(byUrgency),
    stageCounts,
    serviceLines: SERVICE_LINES.map((line) => ({ key: line.key, label: line.label, open: serviceLines.get(line.key) ?? 0 })),
    totals,
    myWork,
    unassigned,
    blocked,
    ...(team ? { team } : {}),
    viewer_role: user?.role ?? "",
  };
}

function buildTeamWorkload(tasks: WorkflowTask[], month: string): TeamWorkload[] {
  return listUsers().map((user) => {
    const open = tasks.filter(
      (t) => t.stage !== "done" && ((t.preparer ?? "") === user.name || (t.reviewer ?? "") === user.name || t.assigned_to === user.name),
    );
    const reviewerOpen = open.filter((t) => t.reviewer === user.name);
    const done = tasks.filter(
      (t) =>
        t.stage === "done" &&
        (t.completed_at ?? t.filed_date ?? "").startsWith(month) &&
        ((t.preparer ?? "") === user.name || (t.reviewer ?? "") === user.name),
    );
    return {
      name: user.name,
      user_id: user.user_id,
      role: user.role,
      service_lines: user.service_lines ?? "",
      preparer_open: open.filter((t) => (t.preparer ?? t.assigned_to) === user.name).length,
      reviewer_open: reviewerOpen.length,
      overdue: open.filter((t) => t.deadline_state === "overdue").length,
      due_soon: open.filter((t) => t.deadline_state === "due_today" || t.deadline_state === "due_soon").length,
      awaiting_review: reviewerOpen.filter((t) => t.stage === "review").length,
      blocked: open.filter(
        (t) => t.has_open_blockers || t.deadline_state === "blocked_documents" || t.deadline_state === "blocked_assignment",
      ).length,
      completed_this_month: done.length,
    };
  });
}

function byUrgency(a: WorkflowTask, b: WorkflowTask): number {
  if (a.stage === "done" && b.stage !== "done") return 1;
  if (b.stage === "done" && a.stage !== "done") return -1;
  return a.due_date.localeCompare(b.due_date);
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days));
  return dt.toISOString().slice(0, 10);
}

/** Tasks that belong on this person's desk, by assignment first and role second. */
export function isMine(task: WorkflowTask, user: AuthUser): boolean {
  if (task.stage === "done") return false;
  const assigned = task.preparer === user.name || task.reviewer === user.name;
  if (assigned) return true;
  const roleStages = ROLE_STAGES[user.role] ?? [];
  if (!roleStages.includes(task.stage)) return false;
  if (user.role === "article") return !task.preparer;
  if (user.role === "manager") return !task.reviewer || task.stage === "review";
  return true;
}

export type TransitionCheck = {
  ok: boolean;
  reason: string;
  requiresNote?: boolean;
  requiresAck?: boolean;
};

/**
 * One step at a time. Managers and partners may also send work back, with a
 * reason; nobody but a partner can close a cycle.
 *
 * Gates enforced here, server-side:
 *  - an open progress-blocking blocker holds every transition;
 *  - submitting for review needs a named preparer;
 *  - moving to portal filing needs a named reviewer;
 *  - separation of duties follows the service's `approval_stage` policy:
 *    "review"/"partner" require a different reviewer, "none" allows the firm
 *    to accept self-review (still audited).
 */
export function checkTransition(
  task: WorkflowTask,
  target: WorkStage,
  user: AuthUser,
  docs: DocumentItem[],
): TransitionCheck {
  const from = task.stage;
  if (openBlockingFor(task.compliance_id).length > 0) {
    return { ok: false, reason: "This engagement is blocked — resolve the open blocker before moving it" };
  }
  if (from === target) return { ok: false, reason: `Already in ${target}` };
  const fromIndex = stageIndex(from);
  const targetIndex = stageIndex(target);
  const forward = targetIndex === fromIndex + 1;
  const backward = targetIndex < fromIndex;

  // Reopening completed work may need to resume anywhere upstream; re-reviews
  // can go straight back to the partner-signable stages.
  const reopenPath = from === "done" || (from === "filing" && backward);
  if (Math.abs(targetIndex - fromIndex) > 1 && !reopenPath) {
    return { ok: false, reason: "Move one stage at a time — the handoff is the audit trail" };
  }

  if (user.role === "article") {
    const allowed = (from === "documents" && target === "preparation") || (from === "preparation" && target === "review");
    if (!allowed) return { ok: false, reason: "Article assistants can complete documents and preparation, then hand over for review" };
  }
  if (user.role === "manager" && (from === "signoff" || target === "done")) {
    return { ok: false, reason: "Only a partner can sign off or close a filing" };
  }
  if (from === "done" && user.role !== "partner") {
    return { ok: false, reason: "Only a partner can reopen completed work" };
  }
  if (backward && user.role !== "partner" && user.role !== "manager") {
    return { ok: false, reason: "Ask a manager or partner to reopen this stage" };
  }
  if (!forward && !backward) return { ok: false, reason: "Invalid stage move" };

  if (target === "done" && user.role !== "partner") {
    return { ok: false, reason: "The final CA audit is a partner step" };
  }

  if (from === "documents" && forward) {
    const required = docs.filter((d) => !/optional/i.test(d.notes));
    const blocking = required.filter((d) => d.status === "Pending" || d.status === "Rejected");
    if (blocking.length > 0) {
      return {
        ok: false,
        reason: `${blocking.length} required document${blocking.length === 1 ? "" : "s"} still pending — receive or mark not applicable first`,
      };
    }
  }

  // Separation of duties is a service-level policy, not a global rule. Firms
  // that configure `approval_stage: none` accept self-review (audited); the
  // stricter policies require two different people.
  const service = taskService(task);
  const approvalPolicy = service?.approval_stage ?? "none";
  if (target === "review" && task.preparer && task.preparer === task.reviewer) {
    if (approvalPolicy !== "none") {
      return { ok: false, reason: "Independent review is required for this service — the reviewer must be a different person from the preparer" };
    }
  }
  if (target === "review" && !task.preparer) {
    return { ok: false, reason: "Assign a preparer before submitting for review" };
  }
  if (target === "signoff" && !(task.filing_reference || task.ack_number)) {
    return { ok: false, reason: "Record the portal acknowledgement / ARN before sending for CA sign-off", requiresAck: true };
  }
  if (target === "done" && !(task.filing_reference || task.ack_number)) {
    return { ok: false, reason: "A filing cannot close without recorded filing evidence", requiresAck: true };
  }
  if (target === "filing" && from === "review" && !task.reviewer) {
    return { ok: false, reason: "Assign a reviewer before moving to portal filing" };
  }
  if (target === "filing" && !task.preparer) {
    return { ok: false, reason: "Assign a preparer before portal filing" };
  }

  return { ok: true, reason: forward ? "Ready to advance" : "This will reopen the previous stage", requiresNote: backward };
}

export type AdvanceResult = {
  task: WorkflowTask;
  events: TaskEvent[];
  invoice: Invoice | null;
  invoiceMessage: string;
  notified: string;
};

export async function advanceTask(input: {
  complianceId: string;
  target: WorkStage;
  user: AuthUser;
  note?: string;
  ackNumber?: string;
  /** Optimistic-lock token: the `stage_updated_at` the client saw. */
  expectedStageUpdatedAt?: string;
}): Promise<AdvanceResult> {
  const raw = one<Compliance>("SELECT * FROM compliance WHERE compliance_id = ?", input.complianceId);
  if (!raw) throw new Error("Filing not found");
  if (
    input.expectedStageUpdatedAt !== undefined &&
    input.expectedStageUpdatedAt !== null &&
    input.expectedStageUpdatedAt !== "" &&
    (raw.stage_updated_at ?? "") !== input.expectedStageUpdatedAt
  ) {
    throw new StaleWorkflowError();
  }
  const task = toWorkflowTask(raw);
  const docs = taskDocs(raw);
  const check = checkTransition(task, input.target, input.user, docs);
  if (!check.ok) throw new Error(check.reason);
  if (check.requiresNote && !(input.note ?? "").trim()) throw new Error("Add a short note explaining why this is going back");
  if (check.requiresAck && !(input.ackNumber ?? "").trim() && !task.ack_number && !task.filing_reference) {
    throw new Error("Enter the portal acknowledgement / ARN first");
  }

  const ack = (input.ackNumber ?? "").trim() || task.ack_number || task.filing_reference || null;
  const done = input.target === "done";
  const status = done ? "Filed" : input.target === "documents" ? "Pending" : "In Progress";
  const now = new Date().toISOString();
  const service = taskService(raw);
  const def = getService(task.service_code || "other");
  const filingRecorded = Boolean(ack);

  getDb()
    .prepare(`UPDATE compliance SET stage=?, stage_updated_at=?, status=?, ack_number=?, filed_date=?, completed_at=?,
      blocked_reason='', preparer=COALESCE(NULLIF(preparer,''),?), reviewer=COALESCE(NULLIF(reviewer,''),?),
      filing_reference=CASE WHEN ? THEN COALESCE(NULLIF(filing_reference,''), ?) ELSE filing_reference END,
      filing_recorded_at=CASE WHEN ? THEN COALESCE(filing_recorded_at, ?) ELSE filing_recorded_at END,
      filing_recorded_by=CASE WHEN ? THEN COALESCE(NULLIF(filing_recorded_by,''), ?) ELSE filing_recorded_by END,
      filing_confirmed_by_integration=0
      WHERE compliance_id=?`)
    .run(
      input.target,
      now,
      status,
      ack,
      filingRecorded ? raw.filed_date || todayISO() : raw.filed_date,
      done ? now : null,
      service?.owner ?? raw.preparer ?? raw.assigned_to ?? "",
      service?.reviewer ?? raw.reviewer ?? "",
      filingRecorded ? 1 : 0,
      ack,
      filingRecorded ? 1 : 0,
      now,
      filingRecorded ? 1 : 0,
      input.user.name,
      input.complianceId,
    );

  recordComplianceHistory({
    compliance_id: input.complianceId,
    from_status: task.status,
    to_status: status,
    from_stage: task.stage,
    to_stage: input.target,
    actor: input.user.name,
    role: input.user.role,
    reason: (input.note ?? "").trim() || `${stageLabel(task.stage)} → ${stageLabel(input.target)}`,
    at: now,
  });

  logTaskEvent({
    compliance_id: input.complianceId,
    from_stage: task.stage,
    to_stage: input.target,
    actor: input.user.name,
    role: input.user.role,
    note: (input.note ?? "").trim() || `${stageLabel(task.stage)} → ${stageLabel(input.target)}`,
  });
  logAudit({
    action: "WORKFLOW_STAGE",
    entity_type: "compliance",
    entity_id: input.complianceId,
    detail: `${task.client_name} · ${def.short} · ${task.period}: ${stageLabel(task.stage)} → ${stageLabel(input.target)} (${input.user.name})`,
  });

  let invoice: Invoice | null = null;
  let invoiceMessage = "none";
  // Auto-billing only drafts: submission to approval / issue is separate, so
  // ordinary workflow users cannot trigger delivery of a financial document.
  if (done && service?.auto_invoice && hasInvoicePermission(input.user, "approve")) {
    const result = await invoiceCycleFor(input.complianceId, input.user.name);
    invoice = result.invoice;
    invoiceMessage = result.created ? "draft queued" : result.reason || "none";
  }

  const updated = one<Compliance>("SELECT * FROM compliance WHERE compliance_id = ?", input.complianceId)!;
  return {
    task: toWorkflowTask(updated),
    events: listTaskEvents(input.complianceId),
    invoice,
    invoiceMessage,
    notified: input.target === "done" ? "Cycle closed" : `${stageLabel(input.target)} assigned to ${nextOwner(updated, input.target, service)}`,
  };
}

function nextOwner(task: Compliance, target: WorkStage, service: ClientService | null): string {
  if (target === "preparation" || target === "documents") return task.preparer || service?.owner || "the preparer";
  if (target === "review" || target === "filing") return task.reviewer || service?.reviewer || "the reviewer";
  return "the partner";
}

export function stageLabel(stage: WorkStage): string {
  return (
    {
      documents: "Documents",
      preparation: "Preparation",
      review: "Review",
      filing: "Portal filing",
      signoff: "CA sign-off",
      done: "Done",
    } as Record<WorkStage, string>
  )[stage];
}

export function assignTask(
  complianceId: string,
  patch: { preparer?: string; reviewer?: string },
  actor: AuthUser,
  reason = "",
): WorkflowTask {
  if (actor.role !== "partner" && actor.role !== "manager") {
    throw new Error("Only a manager or partner can change engagement assignments");
  }
  const raw = one<Compliance>("SELECT * FROM compliance WHERE compliance_id = ?", complianceId);
  if (!raw) throw new Error("Filing not found");
  const previousPreparer = raw.preparer ?? raw.assigned_to ?? "";
  const previousReviewer = raw.reviewer ?? "";
  const preparer = patch.preparer?.trim() ?? previousPreparer;
  const reviewer = patch.reviewer?.trim() ?? previousReviewer;
  assertAssignable(preparer, "Preparer");
  assertAssignable(reviewer, "Reviewer");
  if (preparer && reviewer && preparer === reviewer) {
    const service = taskService(raw);
    if (!service || (service.approval_stage ?? "none") !== "none") {
      throw new Error("The preparer and reviewer must be different people for an independent review");
    }
  }
  const note = reason.trim().slice(0, 300) || "Assignment updated";
  getDb()
    .prepare("UPDATE compliance SET preparer=?, reviewer=?, assigned_to=?, stage_updated_at = CASE WHEN (preparer <> ? OR IFNULL(reviewer,'') <> ?) THEN ? ELSE stage_updated_at END, blocked_reason='' WHERE compliance_id=?")
    .run(preparer, reviewer, preparer, preparer, reviewer, new Date().toISOString(), complianceId);
  // Append the assignment ledger BEFORE the audit log; both are history here.
  if (preparer !== previousPreparer) {
    recordTaskAssignment({
      compliance_id: complianceId,
      client_id: raw.client_id,
      responsibility: "preparer",
      previous_assignee: previousPreparer,
      new_assignee: preparer,
      actor: actor.name,
      actor_role: actor.role,
      reason: note,
    });
  }
  if (reviewer !== previousReviewer) {
    recordTaskAssignment({
      compliance_id: complianceId,
      client_id: raw.client_id,
      responsibility: "reviewer",
      previous_assignee: previousReviewer,
      new_assignee: reviewer,
      actor: actor.name,
      actor_role: actor.role,
      reason: note,
    });
  }
  recordComplianceHistory({
    compliance_id: complianceId,
    from_status: raw.status,
    to_status: raw.status,
    from_stage: effectiveStage(raw),
    to_stage: effectiveStage(raw),
    actor: actor.name,
    role: actor.role,
    reason: `Assignment — preparer ${previousPreparer || "unassigned"} → ${preparer || "unassigned"}, reviewer ${previousReviewer || "unassigned"} → ${reviewer || "unassigned"}: ${note}`,
  });
  logTaskEvent({
    compliance_id: complianceId,
    from_stage: effectiveStage(raw),
    to_stage: effectiveStage(raw),
    actor: actor.name,
    role: actor.role,
    note: `Owners set — preparer ${preparer || "unassigned"}, reviewer ${reviewer || "unassigned"}`,
  });
  logAudit({
    actor: actor.name,
    action: "WORKFLOW_ASSIGNED",
    entity_type: "compliance",
    entity_id: complianceId,
    detail: `preparer ${previousPreparer || "unassigned"} → ${preparer || "unassigned"}; reviewer ${previousReviewer || "unassigned"} → ${reviewer || "unassigned"}`,
  });
  return toWorkflowTask(one<Compliance>("SELECT * FROM compliance WHERE compliance_id = ?", complianceId)!);
}

function assertIsoDate(value: string, label: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label} must be a YYYY-MM-DD date`);
}

/**
 * Records filing evidence supplied by a user. This is deliberately not a
 * government confirmation: `filing_confirmed_by_integration` stays false until
 * a real filing integration verifies the acknowledgement.
 */
export function recordFilingEvidence(input: {
  complianceId: string;
  reference: string;
  filedOn?: string;
  note?: string;
  user: AuthUser;
}): WorkflowTask {
  if (input.user.role !== "partner" && input.user.role !== "manager") {
    throw new Error("Only a manager or partner can record filing evidence");
  }
  const raw = one<Compliance>("SELECT * FROM compliance WHERE compliance_id = ?", input.complianceId);
  if (!raw) throw new Error("Filing not found");
  const reference = input.reference.trim();
  if (!reference) throw new Error("The acknowledgement / ARN is required as filing evidence");
  if (reference.length < 4) throw new Error("The acknowledgement / ARN looks too short to be evidence");
  const filedOn = input.filedOn?.trim() || todayISO();
  assertIsoDate(filedOn, "Filed on");
  if (effectiveStage(raw) === "done" && input.user.role !== "partner") {
    throw new Error("Only a partner can correct the evidence on a completed engagement");
  }
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE compliance SET ack_number=?, filing_reference=?, filing_recorded_at=?, filing_recorded_by=?, filed_date=?,
        filing_notes=?, filing_confirmed_by_integration=0 WHERE compliance_id=?`,
    )
    .run(
      reference,
      reference,
      now,
      input.user.name,
      filedOn,
      (input.note ?? "").trim().slice(0, 500),
      input.complianceId,
    );
  recordComplianceHistory({
    compliance_id: input.complianceId,
    from_status: raw.status,
    to_status: raw.status,
    from_stage: effectiveStage(raw),
    to_stage: effectiveStage(raw),
    actor: input.user.name,
    role: input.user.role,
    reason: `Filing evidence recorded manually: ${reference}`,
    at: now,
  });
  logAudit({
    actor: input.user.name,
    action: "FILING_EVIDENCE_RECORDED",
    entity_type: "compliance",
    entity_id: input.complianceId,
    detail: `${raw.client_name} · ${raw.period} · reference ${reference} (user-recorded, not integration-confirmed)`,
  });
  return toWorkflowTask(one<Compliance>("SELECT * FROM compliance WHERE compliance_id = ?", input.complianceId)!);
}

export function overrideInternalTarget(input: {
  complianceId: string;
  date: string;
  reason: string;
  user: AuthUser;
}): WorkflowTask {
  if (input.user.role !== "partner" && input.user.role !== "manager") {
    throw new Error("Only a manager or partner can override an internal target date");
  }
  const raw = one<Compliance>("SELECT * FROM compliance WHERE compliance_id = ?", input.complianceId);
  if (!raw) throw new Error("Filing not found");
  assertIsoDate(input.date, "Internal target date");
  if (!input.reason.trim()) throw new Error("A reason is required for a target-date override");
  const now = new Date().toISOString();
  getDb()
    .prepare("UPDATE compliance SET internal_target_date=?, due_date=?, due_date_source=? WHERE compliance_id=?")
    .run(input.date, input.date, `Internal target overridden by ${input.user.name}`, input.complianceId);
  recordComplianceHistory({
    compliance_id: input.complianceId,
    from_status: raw.status,
    to_status: raw.status,
    from_stage: effectiveStage(raw),
    to_stage: effectiveStage(raw),
    actor: input.user.name,
    role: input.user.role,
    reason: `Internal target ${raw.internal_target_date || raw.due_date} → ${input.date}: ${input.reason.trim()}`,
    at: now,
  });
  logAudit({ actor: input.user.name, action: "INTERNAL_TARGET_OVERRIDDEN", entity_type: "compliance", entity_id: input.complianceId, detail: `${input.date} · ${input.reason.trim()}` });
  return toWorkflowTask(one<Compliance>("SELECT * FROM compliance WHERE compliance_id = ?", input.complianceId)!);
}

/** A statutory correction is a partner-only, audited manual override with a source. */
export function overrideStatutoryDate(input: {
  complianceId: string;
  date: string;
  authorityReference: string;
  reason: string;
  user: AuthUser;
}): WorkflowTask {
  if (input.user.role !== "partner") throw new Error("Only a partner can override a statutory due date");
  const raw = one<Compliance>("SELECT * FROM compliance WHERE compliance_id = ?", input.complianceId);
  if (!raw) throw new Error("Filing not found");
  assertIsoDate(input.date, "Statutory due date");
  if (!input.authorityReference.trim()) throw new Error("The authority reference (notification/circular) is required");
  if (!input.reason.trim()) throw new Error("A reason is required for a statutory override");
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `UPDATE compliance SET statutory_due_date=?, due_date_verified=1, statutory_rule_status='manual_override',
        due_date_source=? WHERE compliance_id=?`,
    )
    .run(input.date, `Manual statutory override · ${input.authorityReference.trim()}`, input.complianceId);
  recordComplianceHistory({
    compliance_id: input.complianceId,
    from_status: raw.status,
    to_status: raw.status,
    from_stage: effectiveStage(raw),
    to_stage: effectiveStage(raw),
    actor: input.user.name,
    role: input.user.role,
    reason: `Statutory due date overridden to ${input.date} · ${input.authorityReference.trim()} · ${input.reason.trim()}`,
    at: now,
  });
  logAudit({
    actor: input.user.name,
    action: "STATUTORY_DUE_DATE_OVERRIDDEN",
    entity_type: "compliance",
    entity_id: input.complianceId,
    detail: `${raw.client_name} · ${raw.period} → ${input.date} · ${input.authorityReference.trim()}`,
  });
  return toWorkflowTask(one<Compliance>("SELECT * FROM compliance WHERE compliance_id = ?", input.complianceId)!);
}

export type TaskDetail = {
  task: WorkflowTask;
  documents: DocumentItem[];
  request: DocumentRequest | null;
  events: TaskEvent[];
  history: StatusHistoryEntry[];
  messages: Message[];
  invoice: Invoice | null;
  service: ServiceDef;
  transitions: Array<{ stage: WorkStage; label: string; check: TransitionCheck }>;
  blockers: TaskBlocker[];
  assignment_history: TaskAssignmentEntry[];
};

export function getTaskDetail(complianceId: string, user: AuthUser): TaskDetail | null {
  const raw = one<Compliance>("SELECT * FROM compliance WHERE compliance_id = ?", complianceId);
  if (!raw) return null;
  const task = toWorkflowTask(raw);
  const docs = taskDocs(raw);
  const request = taskRequest(raw);
  const invoice = taskInvoice(raw);
  const transitions = STAGE_ORDER.filter((stage) => stage !== task.stage)
    .filter((stage) => Math.abs(stageIndex(stage) - stageIndex(task.stage)) === 1)
    .map((stage) => ({ stage, label: stageLabel(stage), check: checkTransition(task, stage, user, docs) }));
  return {
    task,
    documents: docs,
    request,
    events: listTaskEvents(complianceId),
    history: listComplianceHistory(complianceId),
    messages: request ? listMessagesFor(request.request_id) : [],
    invoice,
    service: getService(task.service_code),
    transitions,
    blockers: listBlockers({ complianceId }),
    assignment_history: listTaskAssignments(complianceId),
  };
}

/** Workload per person, used to auto-assign the least-loaded matching role. */
export function staffWorkload(): Array<{ name: string; role: string; open: number; service_lines: string }> {
  const users = listUsers();
  const tasks = listCompliance().filter((t) => effectiveStage(t) !== "done");
  return users.map((user) => ({
    name: user.name,
    role: user.role,
    service_lines: user.service_lines ?? "",
    open: tasks.filter((t) => t.preparer === user.name || t.reviewer === user.name).length,
  }));
}

/** Default owners for a new engagement, by service line and load. */
export function autoAssignOwners(line: string): { owner: string; reviewer: string } {
  const users = listUsers();
  const load = staffWorkload();
  const matches = (user: { service_lines: string; role: string }) =>
    !user.service_lines || user.service_lines.split(",").map((s) => s.trim()).includes(line);
  const prepCandidates = load
    .filter((u) => (u.role === "article" || u.role === "manager") && matches(u))
    .sort((a, b) => a.open - b.open);
  const reviewCandidates = load.filter((u) => (u.role === "manager" || u.role === "partner") && matches(u)).sort((a, b) => a.open - b.open);
  const fallback = users.find((u) => u.role === "partner")?.name ?? "";
  return {
    owner: prepCandidates[0]?.name ?? fallback,
    reviewer: reviewCandidates[0]?.name ?? fallback,
  };
}

export function openTaskCount(clientId: string): number {
  return listCompliance().filter((c) => c.client_id === clientId && effectiveStage(c) !== "done").length;
}

export function clientForTask(task: Compliance) {
  return getClient(task.client_id);
}

export { taskService as serviceForTask, taskDocs as documentsForTask, taskRequest as requestForTask, taskInvoice as invoiceForTask };
