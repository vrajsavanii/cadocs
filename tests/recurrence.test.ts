import { describe, expect, it } from "vitest";
import { withIsolatedDataDir } from "./helpers/setup";

withIsolatedDataDir();

const {
  onboardClient,
  addRegistration,
  listRegistrations,
} = await import("../lib/onboarding");
const {
  createClientService,
  listClientServices,
} = await import("../lib/engagements-db");
const {
  getDb,
  listCompliance,
  listUsers,
  listComplianceHistory,
} = await import("../lib/db");
const {
  previewGeneration,
  generateEngagements,
  existingEngagement,
} = await import("../lib/engagement-engine");
const {
  periodForEnd,
  latestCompletedPeriodEnd,
  enumeratePeriods,
  currentPeriodEnd,
  previousPeriodEnd,
  assessmentYearForPeriod,
} = await import("../lib/periods");
const {
  resolveDueDates,
  createDueRuleVersion,
  listDueRules,
} = await import("../lib/due-dates");
const {
  advanceTask,
  assignTask,
  recordFilingEvidence,
  overrideStatutoryDate,
  effectiveStage,
  getTaskDetail,
} = await import("../lib/workflow");
const { queryEngagements } = await import("../lib/engagement-queries");
const { enqueueRecurrence } = await import("../lib/engagement-jobs");

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
  return `AAPCR${String(1000 + seq).slice(-4)}F`;
}

function onboardClientWithGst(overrides: Record<string, unknown> = {}) {
  const pan = nextPan();
  return onboardClient({
    legal_name: `Recurrence Test ${seq} Private Limited`,
    entity_type: "Private Limited",
    pan,
    date_of_incorporation: "2019-04-01",
    address: "1 Engine Road",
    city: "Mumbai",
    state: "Maharashtra",
    pincode: "400001",
    contact_person: "Test Contact",
    phone: "9820011223",
    email: `recurrence${seq}@example.com`,
    engagement_letter_status: "Approved",
    gst_number: gstin("27", pan),
    services: [{ code: "gstr3b" }],
    actor: partner.name,
    ...overrides,
  });
}

function activeService(clientId: string, registrationId: string, code = "gstr1") {
  return createClientService({
    client_id: clientId,
    service_code: code,
    service_name: code === "gstr1" ? "GST Filing (GSTR-1)" : "TDS Return (26Q)",
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
  });
}

describe("prompt-05: period and financial-year arithmetic", () => {
  it("calculates Indian FY boundaries and assessment years", () => {
    expect(periodForEnd("annual", "2026-03-31", "itr")).toMatchObject({
      fy: "2025-26",
      assessment_year: "2026-27",
      period_start: "2025-04-01",
      period_end: "2026-03-31",
    });
    expect(periodForEnd("monthly", "2026-09-30").period).toBe("Sep 2026");
    expect(periodForEnd("quarterly", "2026-09-30").period).toBe("Q2 FY 2026-27");
    expect(periodForEnd("half_yearly", "2026-09-30").period).toBe("H1 FY 2026-27");
    expect(periodForEnd("half_yearly", "2026-03-31").period).toBe("H2 FY 2025-26");
  });

  it("finds the last completed period for every supported frequency", () => {
    expect(latestCompletedPeriodEnd("monthly", "2026-10-26")).toBe("2026-09-30");
    expect(latestCompletedPeriodEnd("quarterly", "2026-10-26")).toBe("2026-09-30");
    expect(latestCompletedPeriodEnd("half_yearly", "2026-10-26")).toBe("2026-09-30");
    expect(latestCompletedPeriodEnd("annual", "2026-10-26")).toBe("2026-03-31");
    expect(currentPeriodEnd("monthly", "2026-10-26")).toBe("2026-10-31");
    expect(currentPeriodEnd("quarterly", "2026-10-26")).toBe("2026-12-31");
    expect(previousPeriodEnd("quarterly", "2026-09-30")).toBe("2026-06-30");
  });

  it("enumerates a bounded window and never invents a period", () => {
    const periods = enumeratePeriods("monthly", "2026-04-30", "2026-09-30");
    expect(periods.map((period) => period.period)).toEqual([
      "Apr 2026",
      "May 2026",
      "Jun 2026",
      "Jul 2026",
      "Aug 2026",
      "Sep 2026",
    ]);
    expect(enumeratePeriods("monthly", "2026-10-01", "2026-10-20")).toEqual([]);
  });
});

describe("prompt-05: due-date rules", () => {
  it("ships unverified planning rules and never calls them statutory", () => {
    const rules = listDueRules("gstr1");
    expect(rules.length).toBeGreaterThan(0);
    expect(rules.every((rule) => rule.verification_status === "unverified")).toBe(true);
    const resolved = resolveDueDates("gstr1", "monthly", "2026-09-30");
    expect(resolved.statutory_due_date).toBeNull();
    expect(resolved.rule_status).toBe("unverified");
    expect(resolved.internal_target_date).toBe("2026-10-11");
  });

  it("uses a verified rule only inside its effective window", () => {
    createDueRuleVersion(
      {
        service_code: "rule_test",
        frequency: "monthly",
        effective_from: "2026-04-01",
        due_month_offset: 1,
        due_day: 11,
        source: "Test notification",
        authority_reference: "Notification 99/2026",
        verification_status: "verified",
      },
      partner.name,
    );
    expect(resolveDueDates("rule_test", "monthly", "2026-09-30").statutory_due_date).toBe("2026-10-11");
    expect(resolveDueDates("rule_test", "monthly", "2025-09-30").rule_status).toBe("missing");
  });

  it("does not choose between conflicting verified rules", () => {
    for (const day of [11, 13]) {
      createDueRuleVersion(
        {
          service_code: "conflict_test",
          frequency: "monthly",
          effective_from: "2026-04-01",
          due_month_offset: 1,
          due_day: day,
          source: "Two sources",
          authority_reference: `Notification ${day}`,
          verification_status: "verified",
        },
        partner.name,
      );
    }
    const resolved = resolveDueDates("conflict_test", "monthly", "2026-09-30");
    expect(resolved.rule_status).toBe("conflicting");
    expect(resolved.statutory_due_date).toBeNull();
    expect(resolved.warnings[0]).toMatch(/Conflicting/);
  });
});

describe("prompt-05: idempotent registration-aware generation", () => {
  it("creates one registration-aware engagement, reruns safely and preserves progress", () => {
    const created = onboardClientWithGst();
    const registration = created.registrations[0]!;
    const service = activeService(created.client.client_id, registration.registration_id);

    const preview = previewGeneration({
      clientId: created.client.client_id,
      serviceId: service.service_id,
      from: "2026-09-30",
      to: "2026-09-30",
      today: "2026-10-26",
    });
    expect(preview.items.filter((item) => item.action === "create")).toHaveLength(1);
    expect(preview.items[0]?.registration_id).toBe(registration.registration_id);
    expect(preview.items[0]?.statutory_due_date).toBeNull();
    expect(preview.items[0]?.warnings.some((warning) => /not verified/i.test(warning))).toBe(true);

    const first = generateEngagements({
      clientId: created.client.client_id,
      serviceId: service.service_id,
      from: "2026-09-30",
      to: "2026-09-30",
      today: "2026-10-26",
      actor: partner.name,
      role: "partner",
      confirmed: true,
    });
    expect(first.run.created).toBe(1);
    const engagement = existingEngagement(created.client.client_id, "gstr1", "Sep 2026", registration.registration_id)!;
    expect(engagement).toBeTruthy();
    expect(engagement.internal_target_date).toBe("2026-10-11");
    expect(engagement.statutory_due_date).toBeNull();
    expect(engagement.period_start).toBe("2026-09-01");
    expect(engagement.period_end).toBe("2026-09-30");
    expect(listComplianceHistory(engagement.compliance_id).length).toBeGreaterThan(0);

    // Advance the existing work; a retried generation must not reset the stage.
    getDb().prepare("UPDATE documents SET status='Received' WHERE compliance_id=?").run(engagement.compliance_id);
    return advanceTask({ complianceId: engagement.compliance_id, target: "preparation", user: article }).then((advanced) => {
      expect(advanced.task.stage).toBe("preparation");

      const retry = generateEngagements({
        clientId: created.client.client_id,
        serviceId: service.service_id,
        from: "2026-09-30",
        to: "2026-09-30",
        today: "2026-10-26",
        actor: partner.name,
        role: "partner",
        confirmed: true,
      });
      expect(retry.run.created).toBe(0);
      expect(listCompliance().filter((task) => task.service_id === service.service_id)).toHaveLength(1);
      expect(listCompliance().find((task) => task.compliance_id === engagement.compliance_id)!.stage).toBe("preparation");
    });
  });

  it("creates separate engagements for two GST registrations without duplicating the client", () => {
    const created = onboardClientWithGst();
    const first = created.registrations[0]!;
    const existingPan = listRegistrations(created.client.client_id, "partner")[0]!.identifier!.slice(2, 12);
    const second = addRegistration(
      created.client.client_id,
      { kind: "GST", identifier: gstin("29", existingPan), legal_name: created.client.name, state: "Karnataka" },
      partner.name,
    );
    const serviceA = activeService(created.client.client_id, first.registration_id);
    const serviceB = activeService(created.client.client_id, second.registration_id);

    const firstRun = generateEngagements({
      clientId: created.client.client_id,
      serviceId: serviceA.service_id,
      from: "2026-09-30",
      to: "2026-09-30",
      today: "2026-10-26",
      actor: partner.name,
      role: "partner",
      confirmed: true,
    });
    const secondRun = generateEngagements({
      clientId: created.client.client_id,
      serviceId: serviceB.service_id,
      from: "2026-09-30",
      to: "2026-09-30",
      today: "2026-10-26",
      actor: partner.name,
      role: "partner",
      confirmed: true,
    });
    expect(firstRun.run.created).toBe(1);
    expect(secondRun.run.created).toBe(1);
    const tasks = listCompliance().filter((task) => task.service_id === serviceA.service_id || task.service_id === serviceB.service_id);
    expect(tasks).toHaveLength(2);
    expect(new Set(tasks.map((task) => task.registration_id)).size).toBe(2);
  });

  it("never generates work for paused, inactive or out-of-window services", () => {
    const created = onboardClientWithGst();
    const registration = created.registrations[0]!;
    const service = activeService(created.client.client_id, registration.registration_id);
    getDb().prepare("UPDATE client_services SET status='Paused' WHERE service_id=?").run(service.service_id);

    const preview = previewGeneration({
      clientId: created.client.client_id,
      serviceId: service.service_id,
      from: "2026-09-30",
      to: "2026-09-30",
      today: "2026-10-26",
    });
    expect(preview.items.some((item) => item.action === "invalid" && /Paused/.test(item.reason))).toBe(true);
    expect(listCompliance().filter((task) => task.service_id === service.service_id)).toHaveLength(0);
  });

  it("flags paused clients and missing GST registrations instead of guessing", () => {
    const created = onboardClientWithGst();
    const registration = created.registrations[0]!;
    const service = activeService(created.client.client_id, "");
    getDb().prepare("UPDATE client_services SET registration_id='' WHERE service_id=?").run(service.service_id);
    const preview = previewGeneration({
      clientId: created.client.client_id,
      serviceId: service.service_id,
      from: "2026-09-30",
      to: "2026-09-30",
      today: "2026-10-26",
    });
    expect(preview.items[0]?.action).toBe("invalid");
    expect(preview.items[0]?.reason).toMatch(/registration/i);
    expect(listRegistrations(created.client.client_id, "partner")).toHaveLength(1);
    expect(listCompliance().filter((task) => task.service_id === service.service_id)).toHaveLength(0);
    expect(registration.registration_id).toBeTruthy();
  });
});

describe("prompt-05: workflow evidence and permissions", () => {
  it("requires filing evidence and records it separately from task completion", async () => {
    const created = onboardClientWithGst();
    const registration = created.registrations[0]!;
    const service = activeService(created.client.client_id, registration.registration_id);
    generateEngagements({
      clientId: created.client.client_id,
      serviceId: service.service_id,
      from: "2026-09-30",
      to: "2026-09-30",
      today: "2026-10-26",
      actor: partner.name,
      role: "partner",
      confirmed: true,
    });
    const task = listCompliance().find((entry) => entry.service_id === service.service_id)!;

    await expect(
      advanceTask({ complianceId: task.compliance_id, target: "preparation", user: article }),
    ).rejects.toThrow(/required document/i);

    getDb().prepare("UPDATE documents SET status='Verified' WHERE compliance_id=?").run(task.compliance_id);
    await advanceTask({ complianceId: task.compliance_id, target: "preparation", user: article });
    await advanceTask({ complianceId: task.compliance_id, target: "review", user: article });
    await advanceTask({ complianceId: task.compliance_id, target: "filing", user: manager });
    const beforeEvidence = listCompliance().find((entry) => entry.compliance_id === task.compliance_id)!;
    expect(effectiveStage(beforeEvidence)).toBe("filing");
    expect(beforeEvidence.filing_reference ?? null).toBeNull();

    await expect(
      advanceTask({ complianceId: task.compliance_id, target: "signoff", user: partner }),
    ).rejects.toThrow(/acknowledgement|filing evidence/i);

    recordFilingEvidence({ complianceId: task.compliance_id, reference: "ARN-REAL-1234", user: manager });
    const afterEvidence = listCompliance().find((entry) => entry.compliance_id === task.compliance_id)!;
    expect(afterEvidence.filing_reference).toBe("ARN-REAL-1234");
    expect(afterEvidence.filing_confirmed_by_integration).toBe(false);

    await advanceTask({ complianceId: task.compliance_id, target: "signoff", user: partner });
    await advanceTask({ complianceId: task.compliance_id, target: "done", user: partner });
    const done = listCompliance().find((entry) => entry.compliance_id === task.compliance_id)!;
    expect(done.status).toBe("Filed");
    expect(done.ack_number).toBe("ARN-REAL-1234");
  });

  it("refuses role-inappropriate filing, statutory overrides and assignments", async () => {
    const created = onboardClientWithGst();
    const registration = created.registrations[0]!;
    const service = activeService(created.client.client_id, registration.registration_id);
    generateEngagements({
      clientId: created.client.client_id,
      serviceId: service.service_id,
      from: "2026-09-30",
      to: "2026-09-30",
      today: "2026-10-26",
      actor: partner.name,
      role: "partner",
      confirmed: true,
    });
    const task = listCompliance().find((entry) => entry.service_id === service.service_id)!;

    expect(() => recordFilingEvidence({ complianceId: task.compliance_id, reference: "ARN-1234", user: article })).toThrow(/manager or partner/i);
    expect(() =>
      overrideStatutoryDate({
        complianceId: task.compliance_id,
        date: "2026-11-20",
        authorityReference: "Notification 1",
        reason: "extension",
        user: manager,
      }),
    ).toThrow(/partner/i);
    expect(() => assignTask(task.compliance_id, { preparer: "Outsider", reviewer: manager.name }, manager)).toThrow(/firm user/i);
    expect(() => assignTask(task.compliance_id, { preparer: manager.name, reviewer: manager.name }, manager)).toThrow(/different people/i);

    const detail = getTaskDetail(task.compliance_id, manager)!;
    expect(detail.history.length).toBeGreaterThan(0);
    expect(detail.task.registration_masked).toBeTruthy();
  });

  it("keeps compliance status history append-only", () => {
    const created = onboardClientWithGst();
    const task = listCompliance().find((entry) => entry.client_id === created.client.client_id)!;
    expect(() =>
      getDb().prepare("UPDATE compliance_status_history SET reason='rewritten' WHERE compliance_id=?").run(task.compliance_id),
    ).toThrow(/append-only/i);
    expect(() =>
      getDb().prepare("DELETE FROM compliance_status_history WHERE compliance_id=?").run(task.compliance_id),
    ).toThrow(/append-only/i);
  });
});

describe("prompt-05: queries, jobs and migration", () => {
  it("scopes article queries to their own desk and paginates", () => {
    const created = onboardClientWithGst();
    const registration = created.registrations[0]!;
    const service = activeService(created.client.client_id, registration.registration_id);
    generateEngagements({
      clientId: created.client.client_id,
      serviceId: service.service_id,
      from: "2026-09-30",
      to: "2026-09-30",
      today: "2026-10-26",
      actor: partner.name,
      role: "partner",
      confirmed: true,
    });
    const articleResult = queryEngagements(article, { page: 1, pageSize: 10 });
    expect(articleResult.items.every((task) => task.preparer === article.name || task.reviewer === article.name)).toBe(true);
    const managerResult = queryEngagements(manager, { client_id: created.client.client_id, page: 1, pageSize: 10 });
    expect(managerResult.items.length).toBeGreaterThan(0);
    expect(managerResult.pageSize).toBe(10);
  });

  it("enqueues the daily recurrence job idempotently", () => {
    const first = enqueueRecurrence(partner.name);
    const second = enqueueRecurrence(partner.name);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.job.job_id).toBe(first.job.job_id);
  });

  it("has a migration report and period fields on legacy-created work", () => {
    const report = getDb().prepare("SELECT value FROM settings WHERE key='engagement_migration_report_v1'").get() as { value: string } | undefined;
    expect(report).toBeTruthy();
    expect(JSON.parse(report!.value).scanned).toBeGreaterThanOrEqual(0);
    expect(getDb().prepare("SELECT COUNT(*) AS n FROM due_date_rules").get()).toMatchObject({ n: expect.any(Number) });
    expect(latestCompletedPeriodEnd("annual", "2026-10-26")).toBe("2026-03-31");
    expect(assessmentYearForPeriod("2025-26")).toBe("2026-27");
  });
});
