import { describe, expect, it } from "vitest";
import { withIsolatedDataDir } from "./helpers/setup";

withIsolatedDataDir();

const { onboardClient } = await import("../lib/onboarding");
const { createClientService, updateClientService, listTaskAssignments } = await import(
  "../lib/engagements-db"
);
const { listUsers, getCompliance } = await import("../lib/db");
const { previewGeneration, generateEngagements } = await import("../lib/engagement-engine");
const {
  advanceTask,
  assignTask,
  buildWorkflow,
  checkTransition,
  getTaskDetail,
  StaleWorkflowError,
  toWorkflowTask,
} = await import("../lib/workflow");
const blocker = await import("../lib/blockers");
const { getDb } = await import("../lib/db");

const users = listUsers();
const partner = users.find((user) => user.role === "partner")!;
const manager = users.find((user) => user.role === "manager")!;
const article = users.find((user) => user.role === "article")!;

function gstin(state: string, pan: string): string {
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const base = `${state}${pan}1Z`;
  let sum = 0;
  for (let i = 0; i < base.length; i += 1) {
    const value = chars.indexOf(base[i]!);
    const product = value * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return `${base}${chars[(36 - (sum % 36)) % 36]}`;
}

let seq = 0;
function nextPan(): string {
  seq += 1;
  // 5 letters + 4 digits + check letter, holder type 'C' (company) in position 4.
  return `AAPCR${String(1000 + seq).slice(-4)}K`;
}

function onboardClientWithGst() {
  const pan = nextPan();
  return onboardClient({
    legal_name: `Staff Test ${seq} Private Limited`,
    entity_type: "Private Limited",
    pan,
    date_of_incorporation: "2019-04-01",
    address: "2 Test Lane",
    city: "Pune",
    state: "Maharashtra",
    pincode: "411001",
    contact_person: "Test Contact",
    phone: "9820044556",
    email: `staff${seq}@example.com`,
    engagement_letter_status: "Approved",
    gst_number: gstin("27", pan),
    services: [{ code: "gstr3b" }],
    actor: partner.name,
  });
}

function activeService(
  clientId: string,
  registrationId: string,
  overrides: Record<string, unknown> = {},
) {
  return createClientService({
    client_id: clientId,
    service_code: "gstr1",
    service_name: "GST Filing (GSTR-1)",
    line: "gst",
    frequency: "monthly",
    fee: 1500,
    billing_cycle: "monthly",
    auto_invoice: false,
    owner: article.name,
    reviewer: manager.name,
    manager: manager.name,
    partner: partner.name,
    status: "Active",
    start_date: "2025-04-01",
    end_date: "",
    reminder_cap: 3,
    reminder_gap_days: 3,
    next_cycle_on: null,
    created_at: "2025-04-01T00:00:00.000Z",
    registration_id: registrationId,
    fee_model: "recurring",
    setup_fee: 0,
    payment_terms_days: 30,
    fee_effective_from: "2025-04-01",
    approval_stage: "review",
    created_by: partner.name,
    updated_by: partner.name,
    ...overrides,
  } as never);
}

/** One GST monthly engagement, fully assigned: article prepares, manager reviews. */
function createAssignedEngagement() {
  const created = onboardClientWithGst();
  const registration = created.registrations[0]!;
  const service = activeService(created.client.client_id, registration.registration_id);
  const result = generateEngagements({
    clientId: created.client.client_id,
    serviceId: service.service_id,
    from: "2026-09-30",
    to: "2026-09-30",
    today: "2026-10-26",
    actor: manager.name,
    role: manager.role,
    confirmed: true,
  });
  expect(result.created).toHaveLength(1);
  const engagement = result.created[0]!;
  return { engagement, client: created.client, service, registration };
}

describe("prompt-07: assignment rules", () => {
  it("records the initial assignment from service configuration in the ledger", () => {
    const { engagement } = createAssignedEngagement();
    const history = listTaskAssignments(engagement.compliance_id);
    const preparer = history.find((row) => row.responsibility === "preparer");
    expect(preparer).toBeDefined();
    expect(preparer!.new_assignee).toBe(article.name);
    expect(preparer!.previous_assignee).toBe("");
  });

  it("preserves every previous assignee when work is reassigned", () => {
    const { engagement } = createAssignedEngagement();
    // Partner shifts the reviewer up and swaps the preparer, then swaps back:
    // both preparer hops stay in the ledger.
    assignTask(engagement.compliance_id, { preparer: manager.name, reviewer: partner.name }, partner, "covering while articles are on filing week");
    assignTask(engagement.compliance_id, { preparer: article.name }, partner, "back to the named preparer");
    const preparerRows = listTaskAssignments(engagement.compliance_id).filter(
      (row) => row.responsibility === "preparer",
    );
    expect(preparerRows.map((row) => row.new_assignee)).toEqual([article.name, manager.name, article.name]);
    expect(preparerRows[1]!.previous_assignee).toBe(article.name);
    expect(preparerRows[1]!.reason).toMatch(/covering/);
    const task = getCompliance(engagement.compliance_id)!;
    expect(task.preparer).toBe(article.name);
  });

  it("rejects staff who are not firm users and refuses article self-service reassignment", () => {
    const { engagement } = createAssignedEngagement();
    expect(() => assignTask(engagement.compliance_id, { preparer: "Ghost Person" }, manager)).toThrow(/not an active firm user/i);
    expect(() => assignTask(engagement.compliance_id, { preparer: partner.name }, article)).toThrow(/Only a manager or partner/);
    const still = getCompliance(engagement.compliance_id)!;
    expect(still.preparer).toBe(article.name);
  });

  it("exposes missing assignments to managers but not to articles, and prevents undefined owners from progressing", () => {
    const created = onboardClientWithGst();
    const registration = created.registrations[0]!;
    // Owner intentionally left blank: the classic misconfigured service.
    activeService(created.client.client_id, registration.registration_id, {
      owner: "",
      reviewer: "",
    });
    const missing = generateEngagements({
      clientId: created.client.client_id,
      from: "2026-09-30",
      to: "2026-09-30",
      today: "2026-10-26",
      actor: manager.name,
      confirmed: true,
    });
    expect(missing.created).toHaveLength(1);
    const task = missing.created[0]!;

    const asManager = buildWorkflow(manager);
    const asArticle = buildWorkflow(article);
    expect(asArticle.team).toBeUndefined();
    expect(asManager.team?.length).toBeGreaterThan(0);
    expect((asManager.totals.unassigned ?? 0)).toBeGreaterThan(0);
    expect(asManager.unassigned.some((t) => t.compliance_id === task.compliance_id)).toBe(true);
    expect(asArticle.unassigned).toHaveLength(0);

    const workflowTask = toWorkflowTask(getCompliance(task.compliance_id)!);
    expect(workflowTask.assignment_state).toBe("missing_both");
    // No preparer configured: nobody may submit this work for review.
    const check = checkTransition(
      workflowTask,
      "review",
      manager,
      [],
    );
    expect(check.ok).toBe(false);
  });

  it("never creates a duplicate engagement when generation reruns", () => {
    const { client, service } = createAssignedEngagement();
    const rerun = generateEngagements({
      clientId: client.client_id,
      serviceId: service.service_id,
      from: "2026-09-30",
      to: "2026-09-30",
      today: "2026-10-26",
      actor: manager.name,
      confirmed: true,
    });
    expect(rerun.created).toHaveLength(0);
    // Onboarding activation opens the current-cycle GSTR-3B task, so the count
    // is scoped to the service this test generates for.
    const count = getDb().prepare("SELECT COUNT(*) n FROM compliance WHERE client_id = ? AND service_id = ?").get(client.client_id, service.service_id) as { n: number };
    expect(count).toMatchObject({ n: 1 });
  });
});

/** Marks generated checklist documents as received so happy-path moves can pass the gate. */
function settleWork(complianceId: string): void {
  getDb().prepare("UPDATE documents SET status='Received' WHERE compliance_id = ?").run(complianceId);
}

describe("prompt-07: workflow transitions and review", () => {
  it("advances one stage at a time and never skips review", () => {
    const { engagement } = createAssignedEngagement();
    const detail = getTaskDetail(engagement.compliance_id, article)!;
    // An article may not leap documents → review.
    const skip = checkTransition(detail.task, "review", article, detail.documents);
    expect(skip.ok).toBe(false);
    expect(skip.reason).toMatch(/one stage at a time/i);
  });

  it("blocks submission while required documents are still pending", () => {
    const { engagement } = createAssignedEngagement();
    const detail = getTaskDetail(engagement.compliance_id, article)!;
    const check = checkTransition(detail.task, "preparation", article, detail.documents);
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/required document/);
  });

  it("requires a manager or partner to move review onwards, and the partner to close", () => {
    const { engagement } = createAssignedEngagement();
    const detail = getTaskDetail(engagement.compliance_id, manager)!;
    expect(checkTransition(detail.task, "done", manager, detail.documents).ok).toBe(false);
    expect(checkTransition(detail.task, "filing", article, detail.documents).ok).toBe(false);
  });

  it("rejecting work demands a written reason and keeps it in history", async () => {
    const { engagement } = createAssignedEngagement();
    settleWork(engagement.compliance_id);
    // Push the preparer to review.
    await advanceTask({ complianceId: engagement.compliance_id, target: "preparation", user: article, note: "" });
    await advanceTask({ complianceId: engagement.compliance_id, target: "review", user: article, note: "" });
    // Manager sends it back with NO note → refused.
    await expect(
      advanceTask({ complianceId: engagement.compliance_id, target: "preparation", user: manager, note: "" }),
    ).rejects.toThrow(/short note/);
    // With a note it works, and the note outlives both moves.
    await advanceTask({
      complianceId: engagement.compliance_id,
      target: "preparation",
      user: manager,
      note: "Ledger totals do not agree with the GSTR-1 summary — recast and resubmit",
    });
    const history = getTaskDetail(engagement.compliance_id, manager)!.history;
    expect(history.some((row) => row.reason.includes("Ledger totals"))).toBe(true);
  });

  it("blocks a fourth-party approval: only the partner closes, after filing evidence exists", async () => {
    const { engagement } = createAssignedEngagement();
    settleWork(engagement.compliance_id);
    await advanceTask({ complianceId: engagement.compliance_id, target: "preparation", user: article });
    await advanceTask({ complianceId: engagement.compliance_id, target: "review", user: article });
    // Filing itself does not need the ack; the CA sign-off step does.
    await advanceTask({ complianceId: engagement.compliance_id, target: "filing", user: manager });
    // Still no acknowledgement recorded → even the partner cannot declare it done.
    await expect(
      advanceTask({ complianceId: engagement.compliance_id, target: "signoff", user: partner }),
    ).rejects.toThrow(/acknowledgement/i);
  });

  it("refuses stale browser writes against a newer workflow update", async () => {
    const { engagement } = createAssignedEngagement();
    settleWork(engagement.compliance_id);
    await advanceTask({ complianceId: engagement.compliance_id, target: "preparation", user: article });
    // Browser A holds the token it read after advancing.
    const staleToken = getTaskDetail(engagement.compliance_id, article)!.task.stage_updated_at ?? "";
    expect(staleToken).toBeTruthy();
    // Meanwhile the manager changes the reviewer — browser A's view is stale.
    assignTask(engagement.compliance_id, { reviewer: partner.name }, manager, "senior review policy");
    await expect(
      advanceTask({
        complianceId: engagement.compliance_id,
        target: "review",
        user: article,
        expectedStageUpdatedAt: staleToken,
      }),
    ).rejects.toBeInstanceOf(StaleWorkflowError);
    // A fresh client that re-reads the task still works.
    const fresh = getTaskDetail(engagement.compliance_id, article)!;
    await expect(
      advanceTask({
        complianceId: engagement.compliance_id,
        target: "review",
        user: article,
        expectedStageUpdatedAt: fresh.task.stage_updated_at ?? "",
      }),
    ).resolves.toBeDefined();
  });

  it("separation of duties follows the service policy, not a global rule", () => {
    const { service, engagement } = createAssignedEngagement();
    // Default policy is strict: same person on both sides is refused.
    expect(() => assignTask(engagement.compliance_id, { preparer: manager.name, reviewer: manager.name }, manager)).toThrow(
      /different people/,
    );
    // The firm may allow self-review by configuring approval_stage = none.
    updateClientService(service.service_id, { approval_stage: "none" });
    const okSame = assignTask(engagement.compliance_id, { preparer: manager.name, reviewer: manager.name }, manager);
    expect(okSame.preparer).toBe(manager.name);
    // ...and can switch back before generating work.
    updateClientService(service.service_id, { approval_stage: "review", owner: article.name, reviewer: manager.name });
    assignTask(engagement.compliance_id, { preparer: article.name, reviewer: manager.name }, manager, "restore independent review");
    expect(getCompliance(engagement.compliance_id)!.reviewer).toBe(manager.name);
  });

  it("reopening completed work is partner-only and preserves the closed history", async () => {
    const { engagement } = createAssignedEngagement();
    settleWork(engagement.compliance_id);
    await advanceTask({ complianceId: engagement.compliance_id, target: "preparation", user: article });
    await advanceTask({ complianceId: engagement.compliance_id, target: "review", user: article });
    await advanceTask({ complianceId: engagement.compliance_id, target: "filing", user: manager, ackNumber: "ARN1234567890" });
    await advanceTask({ complianceId: engagement.compliance_id, target: "signoff", user: partner });
    await advanceTask({ complianceId: engagement.compliance_id, target: "done", user: partner });
    await expect(
      advanceTask({ complianceId: engagement.compliance_id, target: "filing", user: manager, note: "manager cannot reopen" }),
    ).rejects.toThrow();
    await advanceTask({
      complianceId: engagement.compliance_id,
      target: "filing",
      user: partner,
      note: "Department issued an amended notice — reopen and refile",
    });
    const reopened = getCompliance(engagement.compliance_id)!;
    expect(reopened.stage).toBe("filing");
    // Prior completion history is untouched.
    const history = getTaskDetail(engagement.compliance_id, partner)!.history;
    expect(history.filter((row) => row.to_stage === "done").length).toBe(1);
    expect(history.filter((row) => row.reason.includes("reopen")).length).toBeGreaterThan(0);
  });
});

describe("prompt-07: blockers", () => {
  it("holds every transition while an explicit blocker is open", () => {
    const { engagement } = createAssignedEngagement();
    settleWork(engagement.compliance_id);
    blocker.createBlocker({
      complianceId: engagement.compliance_id,
      category: "missing_information",
      description: "Client must confirm turnover split for May before return can be drafted",
      user: article,
    });
    const detail = getTaskDetail(engagement.compliance_id, article)!;
    expect(checkTransition(detail.task, "preparation", article, detail.documents).ok).toBe(false);
    // Articles cannot clear their own blocker.
    expect(() =>
      blocker.resolveBlocker({
        blockerId: blocker.listBlockers({ complianceId: engagement.compliance_id })[0]!.blocker_id,
        user: article,
      }),
    ).toThrow(/manager or partner/);
    const resolved = blocker.resolveBlocker({
      blockerId: blocker.listBlockers({ complianceId: engagement.compliance_id, status: "open" })[0]!.blocker_id,
      resolutionNote: "Client emailed the split on call",
      user: manager,
    });
    expect(resolved.status).toBe("resolved");
    expect(checkTransition(detail.task, "preparation", article, detail.documents).ok).toBe(true);
  });

  it("keeps only authorized people close to the task able to record blockers", () => {
    const { engagement, client } = createAssignedEngagement();
    // Preparer can raise one on their own task.
    expect(
      blocker.createBlocker({
        complianceId: engagement.compliance_id,
        category: "preparation_issue",
        description: "Working papers need recasting",
        user: article,
      }).status,
    ).toBe("open");
    // ...but not on an engagement they were never assigned to.
    const created = onboardClientWithGst();
    const registration = created.registrations[0]!;
    const other = activeService(created.client.client_id, registration.registration_id);
    const otherRun = generateEngagements({
      clientId: created.client.client_id,
      serviceId: other.service_id,
      from: "2026-09-30",
      to: "2026-09-30",
      today: "2026-10-26",
      actor: manager.name,
      confirmed: true,
    });
    const otherTask = otherRun.created[0]!;
    const otherOwnerTask = getCompliance(otherTask.compliance_id)!;
    if (otherOwnerTask.preparer !== article.name) {
      assignTask(otherTask.compliance_id, { preparer: article.name }, manager, "restore");
    }
    // Make it someone else's desk (reviewer moves up to keep duties separate), then try again.
    assignTask(otherTask.compliance_id, { preparer: manager.name, reviewer: partner.name }, manager, "moved to partner-assist");
    expect(() =>
      blocker.createBlocker({
        complianceId: otherTask.compliance_id,
        category: "other",
        description: "Not my task anymore",
        user: article,
      }),
    ).toThrow(/task team|manager or partner/);
    expect(client.client_id).toBeDefined();
  });

  it("requires a known category and refuses unknown ones", () => {
    const { engagement } = createAssignedEngagement();
    expect(() =>
      blocker.createBlocker({
        complianceId: engagement.compliance_id,
        category: "meteor_strike",
        description: "Not a real category",
        user: manager,
      }),
    ).toThrow(/Category must be one of/);
  });
});

describe("prompt-07: dashboards respect roles", () => {
  it("counts blocked, unassigned and review queues consistently", () => {
    const before = buildWorkflow(manager);
    const { engagement } = createAssignedEngagement();
    blocker.createBlocker({
      complianceId: engagement.compliance_id,
      category: "filing_dependent",
      description: "Portal maintenance window",
      user: manager,
    });
    const after = buildWorkflow(manager);
    expect((after.totals.blocked ?? 0)).toBeGreaterThan(before.totals.blocked ?? 0);
    expect(after.viewer_role).toBe("manager");
  });

  it("never hands team aggregates to articles", async () => {
    const { engagement } = createAssignedEngagement();
    settleWork(engagement.compliance_id);
    await advanceTask({ complianceId: engagement.compliance_id, target: "preparation", user: article });
    const view = buildWorkflow(article);
    expect(view.team).toBeUndefined();
    expect(view.unassigned).toHaveLength(0);
    expect(view.blocked).toHaveLength(0);
    expect(view.viewer_role).toBe("article");
    // ...but their own work list still works.
    expect(view.myWork.some((t) => t.compliance_id === engagement.compliance_id)).toBe(true);
  });

  it("classifies completed and reopened work correctly in the lists", async () => {
    const { engagement } = createAssignedEngagement();
    settleWork(engagement.compliance_id);
    await advanceTask({ complianceId: engagement.compliance_id, target: "preparation", user: article });
    await advanceTask({ complianceId: engagement.compliance_id, target: "review", user: article });
    await advanceTask({ complianceId: engagement.compliance_id, target: "filing", user: manager, ackNumber: "ARN9876543210" });
    await advanceTask({ complianceId: engagement.compliance_id, target: "signoff", user: partner });
    await advanceTask({ complianceId: engagement.compliance_id, target: "done", user: partner });
    const view = buildWorkflow(manager);
    expect(view.tasks.find((t) => t.compliance_id === engagement.compliance_id)!.deadline_state).toBe("completed");
    await reopenDone(engagement.compliance_id);
    const reopened = buildWorkflow(manager).tasks.find((t) => t.compliance_id === engagement.compliance_id)!;
    expect(reopened.stage).toBe("filing");
    expect(reopened.deadline_state).not.toBe("completed");
  });

  async function reopenDone(complianceId: string): Promise<void> {
    await advanceTask({ complianceId, target: "filing", user: partner, note: "reopen for test verification" });
  }
});
