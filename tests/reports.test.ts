import { describe, expect, it } from "vitest";
import { withIsolatedDataDir } from "./helpers/setup";

withIsolatedDataDir();

const { getDb } = await import("../lib/db");
const { parseReportFilters, getUnifiedReports, invoicePaise } = await import("../lib/reports");
const { todayISO, dayDiff } = await import("../lib/format");

const rel = (days: number) =>
  new Date(Date.parse(`${todayISO()}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

const run = (sql: string, ...args: unknown[]) => getDb().prepare(sql).run(...(args as never[]));

function seed(): void {
  run(
    `INSERT INTO users (user_id,username,name,email,role,password_hash,created_at) VALUES
    ('U1','asha','Asha Partner','asha@example.com','partner','x','2026-01-05T00:00:00Z'),
    ('U2','vik','Vikram Article','vik@example.com','article','x','2026-01-05T00:00:00Z'),
    ('U3','meg','Megha Manager','meg@example.com','manager','x','2026-01-05T00:00:00Z')`,
  );
  run(
    `INSERT INTO clients (client_id,name,created_at,client_status) VALUES
    ('C1','Alpha Enterprises',?, 'Active'),
    ('C2','Beta Industries',?, 'Active'),
    ('C3','Gamma Traders',?, 'Exited')`,
    "2026-02-01T00:00:00Z",
    rel(-10),
    "2026-01-20T00:00:00Z",
  );

  // GST engagement overdue by 10 days for Alpha — never filed.
  run(
    `INSERT INTO compliance (compliance_id,client_id,client_name,compliance_type,period,due_date,status,service_code,fy,stage,assigned_to,preparer,reviewer,assessment_year)
     VALUES ('CMP1','C1','Alpha Enterprises','GST Return GSTR-1','August 2026',?, 'Open','gstr1','FY 2026-27','preparation','Vikram Article','Vikram Article','Megha Manager','2026-27')`,
    rel(-10),
  );
  // Tax audit for Beta: at sign-off, blocked explicitly, never filed.
  run(
    `INSERT INTO compliance (compliance_id,client_id,client_name,compliance_type,period,due_date,status,service_code,fy,stage,assigned_to,preparer,reviewer,blocked_reason,assessment_year)
     VALUES ('CMP2','C2','Beta Industries','Tax Audit Report','FY 2025-26',?, 'Open','tax_audit','FY 2025-26','signoff','Vikram Article','Vikram Article','Asha Partner','Missing tax computation from client','2026-27')`,

    rel(20),
  );
  run(`INSERT INTO task_blockers (blocker_id,compliance_id,client_id,category,description,owner,status,blocks_progress,created_by,created_at) VALUES ('BLK1','CMP2','C2','other','Missing tax computation from client','Asha Partner','open',1,'Asha Partner',?)`, new Date().toISOString());
  // Completed ITR for Alpha: filed ON time with filing evidence.
  run(
    `INSERT INTO compliance (compliance_id,client_id,client_name,compliance_type,period,due_date,status,service_code,fy,stage,filed_date,assessment_year,internal_target_date,filing_recorded_at,ack_number)
     VALUES ('CMP3','C1','Alpha Enterprises','ITR Return FY','FY 2025-26',?, 'Filed','itr','FY 2025-26','done',?, '2026-27',?, ?, 'ACK-3')`,
    rel(-8),
    rel(-12),
    rel(-10),
    rel(-12),
  );
  // Completed ITR for Beta: filed LATE but with filing evidence.
  run(
    `INSERT INTO compliance (compliance_id,client_id,client_name,compliance_type,period,due_date,status,service_code,fy,stage,filed_date,assessment_year,filing_recorded_at,ack_number)
     VALUES ('CMP4','C2','Beta Industries','ITR Return FY','FY 2025-26',?, 'Filed','itr','FY 2025-26','done',?, '2026-27', ?, 'ACK-4')`,
    rel(-40),
    rel(-31),
    rel(-31),
  );
  // Filed row WITHOUT filing evidence — must count as awaiting_filing_evidence.
  run(
    `INSERT INTO compliance (compliance_id,client_id,client_name,compliance_type,period,due_date,status,service_code,fy,stage,filed_date)
     VALUES ('CMP5','C1','Alpha Enterprises','TDS Return 26Q','Q2 FY25-26',?, 'Filed','tds','FY 2025-26','done',?)`,
    rel(-2),
    rel(-3),
  );
  // Review queue: AY progresses reviewed → sent back → back in review again.
  run(
    `INSERT INTO compliance (compliance_id,client_id,client_name,compliance_type,period,due_date,status,service_code,fy,stage,preparer,reviewer,stage_updated_at)
     VALUES ('CMP6','C2','Beta Industries','GST Return GSTR-3B','September 2026',?, 'Open','gstr3b','FY 2026-27','review','Vikram Article','Megha Manager',?)`,
    rel(+5),
    rel(-6),
  );
  run(
    `INSERT INTO task_events (event_id,compliance_id,from_stage,to_stage,actor,role,note,created_at) VALUES
    ('EV1','CMP6','preparation','review','Vikram Article','article','submit','${rel(-6)}T10:00:00Z'),
    ('EV2','CMP6','review','preparation','Megha Manager','manager','reconcile turnover', '${rel(-4)}T10:00:00Z'),
    ('EV3','CMP6','preparation','review','Vikram Article','article','resubmit','${rel(-1)}T10:00:00Z')`,
  );

  // Document requests: one open + old, one cleared, one at reminder cap.
  run(
    `INSERT INTO document_requests (request_id,client_id,client_name,compliance_id,service_code,period,fy,due_date,status,reminder_cap,reminders_sent,created_at,cleared_at) VALUES
    ('RQ1','C1','Alpha Enterprises','CMP1','gstr1','August 2026','FY 2026-27',?, 'Open',3,3,?, NULL),
    ('RQ2','C2','Beta Industries','CMP4','itr-annual','FY 2025-26','FY 2025-26','', 'Cleared',3,3,?, ?)`,
    rel(-3),
    rel(-30),
    rel(-20),
    rel(-19),
  );

  // Invoices: settled (with a recorded payment), partially paid, overdue and paid-up.
  run(
    `INSERT INTO invoices (invoice_id,client_id,client_name,invoice_date,due_date,total_amount,paid_amount,total_paise,paid_paise,status,lifecycle,invoice_number,fy)
     VALUES ('INV1','C1','Alpha Enterprises',?, ?, 1180, 1180, 118000, 118000, 'Paid','finalised','NEX/26-27/001','FY 2026-27')`,
    rel(-45),
    rel(-15),
  );
  run(
    `INSERT INTO invoices (invoice_id,client_id,client_name,invoice_date,due_date,total_amount,paid_amount,total_paise,paid_paise,status,lifecycle,invoice_number,fy)
     VALUES ('INV2','C2','Beta Industries',?, ?, 5900, 3540, 590000, 354000, 'Partial','finalised','NEX/26-27/002','FY 2026-27')`,
    rel(-70),
    rel(-40),
  );
  run(
    `INSERT INTO invoices (invoice_id,client_id,client_name,invoice_date,due_date,total_amount,total_paise,paid_amount,paid_paise,status,lifecycle,invoice_number,fy)
     VALUES ('INV3','C1','Alpha Enterprises',?, ?, 2360, 236000, 0, 0, 'Sent','finalised','NEX/26-27/003','FY 2026-27')`,
    rel(-25),
    rel(-5),
  );
  run(
    `INSERT INTO invoices (invoice_id,client_id,client_name,invoice_date,due_date,total_amount,total_paise,paid_amount,paid_paise,status,lifecycle,invoice_number,fy)
     VALUES ('INV4','C2','Beta Industries',?, ?, 3540, 354000, 0, 0, 'Cancelled','draft','NEX/26-27/004','FY 2026-27')`,
    rel(-20),
    rel(-10),
  );
  run(
    `INSERT INTO payments (payment_id,invoice_id,client_name,amount,paid_on,mode,reference,created_at) VALUES
    ('PAY1','INV1','Alpha Enterprises',1180,?,'UPI','UPI-1','2026-01-01T00:00:00Z'),
    ('PAY2','INV2','Beta Industries',3540,?,'NEFT','NEFT-2','2026-01-01T00:00:00Z')`,
    rel(-30),
    rel(-35),
  );

  run(
    `INSERT INTO messages (message_id,channel,recipient_name,to_address,subject,body,related_type,related_id,status,created_at,kind,error) VALUES
    ('M1','whatsapp','Alpha Enterprises','+911234567890','Invoice NEX/26-27/001','','invoice','INV1','Sent',?, 'invoice_sent',''),
    ('M2','whatsapp','Beta Industries','+911234567891','Doc reminder','','document_reminder','CMP1','Failed',?, 'document_reminder','provider timeout'),
    ('M3','app','Megha Manager','meg','Assigned','','', '', 'Sent',?, 'manual','')`,
    rel(-4),
    rel(-4),
    rel(-6),
  );

  run(
    `INSERT INTO timesheets (timesheet_id,user_name,client_name,date,task_type,description,hours,billable,status,created_at) VALUES
    ('TS1','Vikram Article','Alpha Enterprises',?,'GST','GSTR-1 filing prep',4,1,'Approved',?),
    ('TS2','Vikram Article','Alpha Enterprises',?,'Tax Audit','workpaper cleanup',2,0,'Approved',?)`,
    rel(-5),
    "2026-10-20T00:00:00Z",
    rel(-4),
    "2026-10-21T00:00:00Z",
  );
  run(
    `INSERT INTO automation_runs (run_id,rule_id,rule_name,status,summary,detail,actor,started_at,finished_at) VALUES
    ('RUN1','RULE-1','Daily reminder sweep','failed','3 messages could not be delivered','{}','system',?,?)`,
    new Date().toISOString(),
    new Date().toISOString(),
  );
}

const PARTNER = {
  user_id: "U1",
  username: "asha",
  name: "Asha Partner",
  email: "asha@example.com",
  role: "partner",
  created_at: "2026-01-05T00:00:00Z",
  last_login: null,
} as const;
const ARTICLE = {
  user_id: "U2",
  username: "vik",
  name: "Vikram Article",
  email: "vik@example.com",
  role: "article",
  created_at: "2026-01-05T00:00:00Z",
  last_login: null,
} as const;

run("PRAGMA foreign_keys = ON");

describe("prompt-13: report filter parsing", () => {
  it("accepts valid filters and drops unknown keys", () => {
    const { filters, invalid } = parseReportFilters({
      fy: "2026-27",
      from: todayISO(),
      to: rel(30),
      client_id: "C1",
      bogus: "nope",
    });
    expect(filters).toEqual({ fy: "2026-27", from: todayISO(), to: rel(30), client_id: "C1" });
    expect(invalid).toEqual([]);
  });

  it("rejects malformed dates, FYs and ranges with reasons", () => {
    const { filters, invalid } = parseReportFilters({ from: "31-10-2026", fy: "2026", to: "2020-1-1" });
    expect(invalid.length).toBeGreaterThanOrEqual(2);
    expect(filters.fy).toBeUndefined();
    expect(filters.from).toBeUndefined();
    expect(filters.to).toBeUndefined();
    const reversed = parseReportFilters({ from: "2026-10-10", to: "2026-10-01" });
    expect(reversed.invalid.some((s: string) => /after/.test(s))).toBe(true);
    expect(reversed.filters.from).toBeUndefined();
  });
});

describe("prompt-13: unified reporting pack (partner scope)", () => {
  seed();

  it("computes the overview from seeded records only", () => {
    const pack = getUnifiedReports({}, { ...PARTNER });
    expect(pack.scope).toBe("full");
    // Open work: CMP1, CMP2, CMP6 (three Filed rows excluded).
    expect(pack.overview.engagements.open).toBe(3);
    expect(pack.overview.engagements.overdue).toBe(1); // CMP1
    expect(pack.overview.engagements.awaiting_documents).toBe(0); // none blocked by docs
    expect(pack.overview.engagements.completed_with_evidence).toBe(2); // CMP3, CMP4
    expect(pack.overview.engagements.filed_without_evidence).toBe(1); // CMP5
    expect(pack.overview.engagements.unassigned).toBe(0);
    // Clients counted once regardless of registrations/engagements.
    expect(pack.overview.clients.total).toBe(3);
    expect(pack.overview.clients.active).toBe(2);
    expect(pack.overview.clients.with_open_engagements).toBe(2);
    expect(pack.overview.clients.with_outstanding_documents).toBe(1);
    expect(pack.overview.clients.onboarded_in_window).toBe(1); // Beta only (last 30 days)
    expect(pack.overview.billing?.outstanding_rupees).toBe(4720);
  });

  it("classifies deadlines: on-time vs late completion, filed-without-evidence, overdue", () => {
    const pack = getUnifiedReports({}, { ...PARTNER });
    expect(pack.deadlines.buckets.completed_on_time).toBe(1); // CMP3
    expect(pack.deadlines.buckets.completed_late).toBe(1); // CMP4
    expect(pack.deadlines.buckets.awaiting_filing_evidence).toBe(1); // CMP5
    expect(pack.deadlines.buckets.overdue).toBe(1); // CMP1
    expect(pack.deadlines.rows.find((r) => r.compliance_id === "CMP1")?.days_overdue).toBe(10);
    expect(pack.deadlines.rows.find((r) => r.compliance_id === "CMP5")?.filing_evidence_recorded).toBe(false);
  });

  it("measures review dwelling and detects correction loops from task events", () => {
    const pack = getUnifiedReports({}, { ...PARTNER });
    expect(pack.reviews.rejected_back_to_prep.get("CMP6")).toBe(1);
    const row = pack.reviews.rows.find((r) => r.compliance_id === "CMP6");
    expect(row?.review_rounds).toBe(2); // two entries into review
    expect(row?.days_in_review).toBe(1); // latest entry was yesterday
  });

  it("bills in paise and ages receivables without cancelling invoices", () => {
    const pack = getUnifiedReports({}, { ...PARTNER });
    const c = pack.collections!;
    // INV2 partial ₹2,360 balance + INV3 ₹2,360 → ₹4,720 outstanding; INV4 cancelled.
    expect(c.totals.outstanding_rupees).toBe(4720);
    expect(c.totals.overdue_rupees).toBe(4720);
    expect(c.totals.open_count).toBe(2);
    expect(c.aging.find((b) => b.bucket === "Not due")!.count).toBe(0);
    expect(c.aging.find((b) => b.bucket === "1–30 days")!.amount_rupees).toBe(2360);
    expect(c.aging.find((b) => b.bucket === "31–60 days")!.amount_rupees).toBe(2360);
    // Overdue register is sorted by days late and excludes cancelled invoices.
    expect(c.overdueRows.map((r) => r.invoice_id)).toEqual(["INV2", "INV3"]);
    expect(c.overdueRows[0]!.balance_rupees).toBe(2360);
  });

  it("counts annual ITR/audit progress only with recorded filing evidence", () => {
    const pack = getUnifiedReports({}, { ...PARTNER });
    const y = pack.annual.byAssessmentYear.find((row) => row.assessment_year === "2026-27")!;
    expect(y.itr_total).toBe(2); // CMP3 + CMP4
    expect(y.itr_filed).toBe(2);
    expect(y.itr_filing_evidence).toBe(2);
    expect(y.audit_total).toBe(1); // CMP2 sits at sign-off
    expect(y.audit_completed).toBe(0); // not filed
  });

  it("builds the management-attention queue with reasons and links", () => {
    const pack = getUnifiedReports({}, { ...PARTNER });
    const kinds = pack.exceptions.map((e) => e.kind);
    expect(kinds).toContain("overdue_filing"); // CMP1
    expect(kinds).toContain("blocked_engagement"); // CMP2 has an open blocker
    expect(kinds).toContain("overdue_invoice"); // INV2, INV3
    expect(kinds).toContain("failed_job"); // automation RUN1
    expect(kinds).toContain("failed_communication"); // M2
    const linked = pack.exceptions.filter((e) => e.href.startsWith("/workflow"));
    expect(linked.length).toBeGreaterThan(0);
  });

  it("filters by client and FY so rows narrow but totals stay consistent", () => {
    const alpha = getUnifiedReports({ client_id: "C1" }, { ...PARTNER });
    expect(alpha.deadlines.rows.every((r) => r.client_id === "C1")).toBe(true);
    expect(alpha.collections!.totals.outstanding_rupees).toBe(2360);

    const lastY = getUnifiedReports({ fy: "FY 2025-26" }, { ...PARTNER });
    expect(lastY.deadlines.rows.every((r) => r.fy === "FY 2025-26")).toBe(true);
    expect(lastY.deadlines.buckets.completed_late + lastY.deadlines.buckets.completed_on_time).toBeGreaterThanOrEqual(2);
  });
});

describe("prompt-13: tenant-safe scope for non-supervisory roles", () => {
  it("withholds financial and team sections server-side for articles", () => {
    const pack = getUnifiedReports({}, { ...ARTICLE });
    expect(pack.scope).toBe("personal");
    expect(pack.collections).toBeNull();
    expect(pack.staff).toEqual([]);
    expect(pack.overview.billing).toBeNull();
    // Delivery rows never carry another role's financial context either.
    expect(pack.clientDelivery.every((c) => c.outstanding_rupees === null && c.overdue_invoices === null)).toBe(true);
  });
});

describe("prompt-13: legacy-invoice paise canonicalisation", () => {
  it("derives paise from REAL amounts when paise columns are null", () => {
    const inv = {
      invoice_id: "X", client_id: "C", client_name: "Legacy Test Client", invoice_date: rel(-1), due_date: rel(10),
      amount: 100, gst_amount: 18, total_amount: 118, paid_amount: 58.655, status: "Partially Paid" as const,
      service_description: "", paid_date: null, service_id: "", compliance_id: "", period: "",
      auto_generated: false, reminder_count: 0, last_reminded_at: null,
    };
    expect(invoicePaise({ ...inv, total_paise: null as unknown as number, paid_paise: null as unknown as number })).toEqual({
      total: 11800,
      paid: 5866,
      balance: 5934,
    });
  });
});
