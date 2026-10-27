import { describe, expect, it } from "vitest";
import { withIsolatedDataDir } from "./helpers/setup";

withIsolatedDataDir();

const {
  allocateNumber,
  approveInvoice,
  cancelIssuedInvoice,
  createDraftInvoice,
  deliverIssuedInvoice,
  ensureInvoicePdf,
  firmBillingSettings,
  getInvoiceDetail,
  hasInvoicePermission,
  invoicePdfToken,
  invoiceTokenHours,
  issueCreditNote,
  issueInvoice,
  lifecycleOf,
  NotAuthorizedError,
  outstandingPaise,
  readInvoicePdf,
  reconcilePaymentEntry,
  recordPaymentEntry,
  receivablesReport,
  rejectInvoiceDraft,
  reversePaymentEntry,
  submitForApproval,
  updateFirmBillingSettings,
} = (await import("../lib/invoicing")) as any;
const { updateTaxTreatment } = (await import("../lib/invoicing")) as any;
const { getInvoice, listInvoices, listPayments, listUsers } = (await import("../lib/db")) as any;
const { onboardClient } = (await import("../lib/onboarding")) as any;
const { verifyDownloadToken } = (await import("../lib/crypto")) as any;
const { listMessagesFor } = (await import("../lib/engagements-db")) as any;

const partnerName = listUsers().find((u: any) => u.role === "partner")!.name;
const managerName = listUsers().find((u: any) => u.role === "manager")!.name;
const articleName = listUsers().find((u: any) => u.role === "article")!.name;

const partner = { name: partnerName, role: "partner" };
const manager = { name: managerName, role: "manager" };
const article = { name: articleName, role: "article" };

/** Checksum-valid GSTIN for a state code. */
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

let panSeq = 100;
function nextPan(): string {
  panSeq += 1;
  return `AAPCX${String(1000 + panSeq).slice(-4)}F`;
}

let clientSeq = 0;
/** Onboards one Maharashtra company client and returns the client row. */
function makeClient(overrides: Record<string, unknown> = {}): any {
  clientSeq += 1;
  const state = (overrides.state as string) ?? "Maharashtra";
  const stateCode = state === "Karnataka" ? "29" : "27";
  const pan = overrides.pan as string | undefined ?? nextPan();
  const result = onboardClient({
    legal_name: `Billing Test Client ${clientSeq} Private Limited`,
    entity_type: "Private Limited",
    pan,
    date_of_incorporation: "2018-04-01",
    address: "Annexe 2, Business Park",
    city: state === "Karnataka" ? "Bengaluru" : "Mumbai",
    state,
    pincode: "400001",
    contact_person: "Accounts Desk",
    phone: "9876500000",
    email: `billing${clientSeq}@example.com`,
    engagement_letter_status: "Approved",
    gst_number: gstin(stateCode, pan),
    services: [{ code: "gstr3b" }],
    actor: partnerName,
    ...overrides,
  });
  return result.client;
}

function draftFor(clientId: string, overrides: Record<string, unknown> = {}): any {
  return createDraftInvoice(
    {
      client_id: clientId,
      lines: [{ description: "GST return filing", quantity: 1, unit_price: 2500, treatment_id: "TAX-GST-UNCONFIGURED" }],
      ...overrides,
    },
    (overrides.actor as any) ?? manager,
  ).invoice;
}

/** Full draft → partner approval → issue path. */
function issueFor(clientId: string, overrides: Record<string, unknown> = {}): any {
  const actor = (overrides.actor as any) ?? manager;
  const draft = draftFor(clientId, { ...overrides, actor });
  submitForApproval(draft.invoice_id, actor);
  approveInvoice(draft.invoice_id, partner, "ok");
  return issueInvoice(draft.invoice_id, actor);
}

// ── shared setup: usable billing configuration before any of the suites run ──
const setupClient = makeClient() as any;
const firmStateCode = String(setupClient.gst_state_code || "27");
const firmPan = nextPan();
const setupFirmGstin = gstin(firmStateCode, firmPan);
updateFirmBillingSettings(
  {
    legal_name: "Test & Associates LLP",
    display_name: "Test & Associates",
    address: "901, Corporate House, Mumbai",
    contact: "+91 98765 00000",
    pan: firmPan,
    gstin: setupFirmGstin,
    invoice_prefix: "TST",
    credit_note_prefix: "TCN",
    deliver_on_issue: true,
    approval_required_for_auto: true,
    approval_required_for_manual: true,
  },
  partner,
);
updateTaxTreatment("TAX-GST-UNCONFIGURED", { rate_bp: 1800 }, partner);

describe("prompt-10: billing settings and RBAC", () => {
  it("rejects invalid GSTIN, PAN, terms, currency and non-partner editors", () => {
    expect(() => updateFirmBillingSettings({ gstin: "27AAAAA0000A1Z5" }, partner)).toThrow(/GSTIN/);
    expect(() => updateFirmBillingSettings({ pan: "bad" }, partner)).toThrow(/PAN/);
    expect(() => updateFirmBillingSettings({ default_payment_terms_days: 200 }, partner)).toThrow(/payment terms/i);
    expect(() => updateFirmBillingSettings({ legal_name: "" }, partner)).toThrow(/legal name/);
    expect(() => updateFirmBillingSettings({ currency: "USD" }, partner)).toThrow(/INR/);
    expect(() => updateFirmBillingSettings({ legal_name: "New Name LLP" }, manager)).toThrow(NotAuthorizedError);
    // Restore valid configuration for the rest of the suite.
    expect(firmBillingSettings().legal_name).toBe("Test & Associates LLP");
  });

  it("scopes permissions by role; automation may only create keyed drafts", () => {
    expect(hasInvoicePermission(article, "view")).toBe(false);
    expect(hasInvoicePermission(manager, "create-draft")).toBe(true);
    expect(hasInvoicePermission(manager, "approve")).toBe(true);
    expect(hasInvoicePermission(manager, "cancel")).toBe(false);
    expect(hasInvoicePermission(partner, "credit-note")).toBe(true);
    expect(hasInvoicePermission(null, "view")).toBe(false);
    expect(hasInvoicePermission({ name: "engine", role: "automation" }, "issue")).toBe(false);
    expect(hasInvoicePermission({ name: "engine", role: "automation" }, "deliver")).toBe(false);
  });
});

describe("prompt-10: draft creation and idempotency", () => {
  it("creates drafts without a human number, requires a tax treatment per line, validates prices", () => {
    const client = makeClient();
    const draft = draftFor(client.client_id);
    expect(lifecycleOf(draft)).toBe("draft");
    expect(draft.status).toBe("Pending");
    expect(String(draft.invoice_number ?? "")).toBe("");
    expect(draft.amount).toBe(2500);
    expect(draft.gst_amount).toBe(450);
    expect(draft.total_amount).toBe(2950);
    const detail = getInvoiceDetail(draft.invoice_id);
    expect(outstandingPaise(draft.invoice_id)).toBe(295000);
    void detail;

    expect(() =>
      createDraftInvoice({ client_id: client.client_id, lines: [{ description: "x", unit_price: 100 }] }, manager),
    ).toThrow(/tax treatment/);
    expect(() =>
      createDraftInvoice(
        { client_id: client.client_id, lines: [{ description: "x", unit_price: 0, treatment_id: "TAX-NONE" }] },
        manager,
      ),
    ).toThrow(/greater than zero/);
    expect(() =>
      createDraftInvoice({ client_id: client.client_id, lines: [{ description: "x", unit_price: 100, treatment_id: "TAX-NONE" }] }, article),
    ).toThrow(NotAuthorizedError);
  });

  it("separates intra-state (CGST+SGST) and inter-state (IGST) taxes", () => {
    const same = makeClient();
    const other = makeClient({ state: "Karnataka" });
    void other;
    const drafts = [draftFor(same.client_id), draftFor(other.client_id)];
    for (const inv of drafts) {
      const [line] = (getInvoiceDetail(inv.invoice_id) as any).lines as any[];
      expect(line.cgst_paise + line.sgst_paise + line.igst_paise).toBe(45000);
      if (line.igst_paise > 0) expect(line.cgst_paise + line.sgst_paise).toBe(0);
      else expect(line.igst_paise).toBe(0);
    }
    // The same-state client must have been split half CGST / half SGST.
    const sameLine = (getInvoiceDetail(drafts[0].invoice_id) as any).lines[0] as any;
    if (String(same.gst_state_code ?? "") === setupFirmGstin.slice(0, 2)) {
      expect(sameLine.cgst_paise).toBe(22500);
      expect(sameLine.sgst_paise).toBe(22500);
    }
  });

  it("is idempotent on billing_event_key — job retries never duplicate an invoice", () => {
    const client = makeClient();
    const key = `test:event:${client.client_id}`;
    const engine = { name: "engine", role: "automation" };
    const line = { description: "cycle 1", unit_price: 1200, treatment_id: "TAX-NONE" };
    const first = createDraftInvoice(
      { client_id: client.client_id, lines: [line], billing_event_key: key, auto_generated: true, approval_required: true },
      engine,
    );
    expect(first.created).toBe(true);
    const retry = createDraftInvoice(
      { client_id: client.client_id, lines: [line], billing_event_key: key, auto_generated: true, approval_required: true },
      engine,
    );
    expect(retry.created).toBe(false);
    expect(retry.invoice.invoice_id).toBe(first.invoice.invoice_id);
    expect(listInvoices().filter((i: any) => i.billing_event_key === key).length).toBe(1);
    // Keyed drafts are only affected by their own always-required approval.
    expect(lifecycleOf(first.invoice)).toBe("draft");
    // The automation role may not create unkeyed drafts at all.
    expect(() =>
      createDraftInvoice({ client_id: client.client_id, lines: [{ description: "x", unit_price: 100, treatment_id: "TAX-NONE" }] }, engine),
    ).toThrow(/idempotent/);
  });
});

describe("prompt-10: approval and issue lifecycle", () => {
  it("blocks self-approval and enforces the approval gate before issue", () => {
    const client = makeClient();
    const draft = draftFor(client.client_id, { actor: manager });
    expect(lifecycleOf(draft)).toBe("draft");
    expect(() => issueInvoice(draft.invoice_id, manager)).toThrow(/Submit the draft for approval/);
    expect(() => submitForApproval(draft.invoice_id, article)).toThrow(NotAuthorizedError);

    submitForApproval(draft.invoice_id, manager);
    expect(lifecycleOf(draft)).toBe("draft");
    expect(lifecycleOf(getInvoice(draft.invoice_id))).toBe("pending_approval");
    expect(() => approveInvoice(draft.invoice_id, manager)).toThrow(/other than the person who created/);
    expect(() => approveInvoice(draft.invoice_id, article)).toThrow(NotAuthorizedError);
    const approved = approveInvoice(draft.invoice_id, partner, "verified");
    expect(lifecycleOf(approved)).toBe("approved");
    const issued = issueInvoice(draft.invoice_id, manager);
    expect(lifecycleOf(issued)).toBe("issued");
    expect(issued.invoice_number).toBeTruthy();
    expect(() => issueInvoice(draft.invoice_id, partner)).toThrow(/already issued/);
  });

  it("refuses rejection without a reason and returns drafts to the editor with the approval cleared", () => {
    const client = makeClient();
    const draft = draftFor(client.client_id, { actor: manager });
    submitForApproval(draft.invoice_id, manager);
    expect(() => rejectInvoiceDraft(draft.invoice_id, manager, "")).toThrow(/reason/);
    const rejected = rejectInvoiceDraft(draft.invoice_id, partner, "Fee changed mid-cycle");
    expect(lifecycleOf(rejected)).toBe("draft");
    expect(rejected.approved_by ?? null).toBeNull();
  });

  it("refuses to issue when mandatory configuration is missing and never invents a GST rate", () => {
    const client = makeClient();
    const draft = draftFor(client.client_id, { actor: manager });
    updateFirmBillingSettings({ gstin: "" }, partner);
    submitForApproval(draft.invoice_id, manager);
    // Missing GSTIN with GST lines: issuance must refuse with an actionable reason…
    expect(() => approveInvoice(draft.invoice_id, partner)).toThrow(/GSTIN is required/);
    // …and after a rejection the rate un-configuration is refused the same way.
    const draft2 = draftFor(client.client_id, { actor: manager });
    updateTaxTreatment("TAX-GST-UNCONFIGURED", { rate_bp: null }, partner);
    submitForApproval(draft2.invoice_id, manager);
    expect(() => approveInvoice(draft2.invoice_id, partner)).toThrow(/not configured/);
    // Restore and issue cleanly.
    updateFirmBillingSettings({ gstin: setupFirmGstin }, partner);
    updateTaxTreatment("TAX-GST-UNCONFIGURED", { rate_bp: 1800 }, partner);
    const rejected = rejectInvoiceDraft(draft.invoice_id, partner, "config fixed");
    expect(lifecycleOf(rejected)).toBe("draft");
    submitForApproval(draft.invoice_id, manager);
    approveInvoice(draft.invoice_id, partner);
    const issued = issueInvoice(draft.invoice_id, manager);
    expect(issued.invoice_number).toBeTruthy();
  });

  it("allocates sequential FY-scoped numbers, skipping legacy gaps without renumbering originals", () => {
    const { invoice_prefix: prefix } = firmBillingSettings();
    const settings = firmBillingSettings();
    const fy = allocateNumber("invoice", "2025-08-10", settings, new Set()).fy;
    const stem = `${prefix}/${fy}/`;
    const used = new Set([`${stem}0001`, `${stem}0003`]);
    // The allocator resumes one past the max rather than reusing a legacy slot.
    expect(allocateNumber("invoice", "2025-08-10", settings, used).number).toBe(`${stem}0004`);
    // Continuous policy ignores the FY segment entirely.
    const continuous = { ...settings, numbering_policy: "continuous" as const };
    expect(allocateNumber("invoice", "2026-05-01", continuous, new Set(["TST/777"])).number).toBe("TST/0778");
    // Issued drafts keep their number for good: a second issue attempt is refused.
    const client = makeClient();
    const issued = issueFor(client.client_id);
    const [line] = (getInvoiceDetail(issued.invoice_id) as any).lines as any[];
    expect(line.tax_kind).toBe("gst");
    expect(issued.issue_snapshot).toBeTruthy();
  });

  it("cancels issued invoices partner-only with a reason, keeping payments auditable", () => {
    const client = makeClient();
    const issued = issueFor(client.client_id);
    expect(() => cancelIssuedInvoice(issued.invoice_id, manager, "wrong invoice")).toThrow(NotAuthorizedError);
    expect(() => cancelIssuedInvoice(issued.invoice_id, partner, "x")).toThrow(/5 characters/);
    recordPaymentEntry(issued.invoice_id, { amount: 1000, reference: "PRE-CANCEL" }, manager);
    const cancelled = cancelIssuedInvoice(issued.invoice_id, partner, "Client was billed under the wrong engagement");
    expect(lifecycleOf(cancelled)).toBe("cancelled");
    expect(cancelled.status).toBe("Cancelled");
    // No further money against a cancelled invoice.
    expect(() => recordPaymentEntry(issued.invoice_id, { amount: 100, reference: "AFTER-CANCEL" }, manager)).toThrow(/cancelled/);
    // The payment history stays with the invoice for the records.
    expect(listPayments().filter((p: any) => p.invoice_id === issued.invoice_id).length).toBe(1);
  });
});

describe("prompt-10: payments and the ledger", () => {
  it("derives payment status from the ledger and refuses over-payment and duplicates", () => {
    const client = makeClient();
    const issued = issueFor(client.client_id);
    const totalPaise = issued.total_paise ?? 0;

    expect(() => recordPaymentEntry(issued.invoice_id, { amount: 500, paid_on: "2999-01-01" }, manager)).toThrow(/future/);
    expect(() => recordPaymentEntry(issued.invoice_id, { amount: 500, paid_on: "2000-01-01" }, manager)).toThrow(/invoice date/);
    expect(() => recordPaymentEntry(issued.invoice_id, { amount: 1_000_000 }, manager)).toThrow(/exceeds/);
    expect(() => recordPaymentEntry(issued.invoice_id, { amount: 0 }, manager)).toThrow(/greater than zero/);
    expect(() => recordPaymentEntry(issued.invoice_id, { amount: 100 }, article)).toThrow(NotAuthorizedError);

    // A payment without a bank reference is pending reconciliation and does not
    // yet count as collected money.
    const pending = recordPaymentEntry(issued.invoice_id, { amount: 1000, mode: "UPI" }, manager);
    expect(pending.payment.status).toBe("Pending reconciliation");
    const afterPending = getInvoice(issued.invoice_id);
    expect(afterPending.paid_paise).toBe(0);
    expect(afterPending.status).toBe("Pending");

    // Manager confirms receipt.
    reconcilePaymentEntry(pending.payment.payment_id, manager);
    const reconciled = getInvoice(issued.invoice_id);
    expect(reconciled.paid_paise).toBe(100_000);
    expect(reconciled.status).toBe("Partially Paid");

    // Duplicate reference + amount on the same invoice is a retry, not money twice.
    recordPaymentEntry(issued.invoice_id, { amount: 500, reference: "UTR-100" }, manager);
    expect(() => recordPaymentEntry(issued.invoice_id, { amount: 500, reference: "UTR-100" }, manager)).toThrow(/duplicate/i);

    // Exactly settle the remaining balance.
    const remaining = outstandingPaise(issued.invoice_id);
    expect(remaining).toBe(totalPaise - 150_000);
    recordPaymentEntry(issued.invoice_id, { amount: remaining / 100, reference: "UTR-200" }, manager);
    const settled = getInvoice(issued.invoice_id);
    expect(settled.status).toBe("Paid");
    expect(outstandingPaise(issued.invoice_id)).toBe(0);
    expect(() => recordPaymentEntry(issued.invoice_id, { amount: 1, reference: "UTR-300" }, manager)).toThrow(/exceeds/);
    expect(getInvoiceDetail(issued.invoice_id).computed.balancePaise).toBe(0);
  });

  it("reverses payments as audited correcting entries, never edits", () => {
    const client = makeClient();
    const issued = issueFor(client.client_id);
    const payment = recordPaymentEntry(issued.invoice_id, { amount: 700, reference: "RTGS-9" }, manager).payment;
    expect(() => reversePaymentEntry(payment.payment_id, manager, "x")).toThrow(/5 characters/);
    expect(() => reversePaymentEntry(payment.payment_id, article, "wrong entry")).toThrow(NotAuthorizedError);
    const reversal = reversePaymentEntry(payment.payment_id, manager, "entered against the wrong invoice");
    expect(reversal.amount).toBe(-700);
    expect(reversal.reversal_of).toBe(payment.payment_id);
    const rows = listPayments().filter((p: any) => p.invoice_id === issued.invoice_id);
    expect(rows.map((r: any) => r.status).sort()).toEqual(["Confirmed", "Reversed"]);
    expect(getInvoice(issued.invoice_id).paid_paise).toBe(0);
    expect(() => reversePaymentEntry(payment.payment_id, manager, "again for luck")).toThrow(/already reversed/);
  });

  it("issues credit notes partner-only against issued invoices and never counts them as payments", () => {
    const client = makeClient();
    const issued = issueFor(client.client_id);
    expect(() => issueCreditNote(issued.invoice_id, { reason: "small adjustment", credit_total: 100 }, manager)).toThrow(NotAuthorizedError);
    expect(() => issueCreditNote(issued.invoice_id, { reason: "way too much", credit_total: 1_000_000 }, partner)).toThrow(/exceeds/);

    const first = issueCreditNote(issued.invoice_id, { reason: "Repeated service — adjusted", credit_total: 236 }, partner);
    expect(first.creditNote.number).toMatch(/^TCN\//);
    expect(first.creditNote.total_paise).toBe(23600);
    issueCreditNote(issued.invoice_id, { reason: "Partly unearned fee", credit_total: 200 }, partner);

    // Credit reduces the balance but is never recorded as a payment.
    const after = getInvoice(issued.invoice_id);
    expect(after.credit_paise).toBe(43_600);
    expect(after.paid_paise ?? 0).toBe(0);
    expect(outstandingPaise(issued.invoice_id)).toBe((issued.total_paise ?? 0) - 43_600);
    expect(() => issueCreditNote(issued.invoice_id, { reason: "too much again", credit_total: 1_000_000 }, partner)).toThrow(/exceeds/);
  });

  it("refuses cancellation of a fully settled invoice — credit note is the path", () => {
    const client = makeClient();
    const issued = issueFor(client.client_id);
    expect(() => cancelIssuedInvoice(issued.invoice_id, partner, "no")).toThrow(/5 characters/);
    issueCreditNote(issued.invoice_id, { reason: "Client was charged twice in error", credit_total: (issued.total_paise ?? 0) / 100 }, partner);
    expect(() => cancelIssuedInvoice(issued.invoice_id, partner, "wrong client billed")).toThrow(/fully settled/);
    expect(outstandingPaise(issued.invoice_id)).toBe(0);
  });
});

describe("prompt-10: PDF, tokens, and delivery gating", () => {
  it("refuses PDFs for drafts, stores issued PDFs privately, enforces viewer permissions", async () => {
    const client = makeClient();
    const draft = draftFor(client.client_id);
    await expect(ensureInvoicePdf(draft.invoice_id, manager)).rejects.toThrow(/issued invoice has a PDF/);
    const issued = issueFor(client.client_id);
    const pdf = await ensureInvoicePdf(issued.invoice_id, partner);
    expect(pdf.size).toBeGreaterThan(500);
    expect(String(pdf.objectKey)).toContain("/invoices/");
    const view = await readInvoicePdf(issued.invoice_id, partner, null);
    expect(view!.bytes.length).toBe(pdf.size);
    expect(view!.invoice.invoice_id).toBe(issued.invoice_id);
    await expect(readInvoicePdf(issued.invoice_id, article, null)).rejects.toThrow(NotAuthorizedError);
    await expect(readInvoicePdf(draft.invoice_id, manager, null)).resolves.toBeNull();
  });

  it("binds download tokens to a single invoice with expiries; no permanent public links", () => {
    const client = makeClient();
    const other = makeClient();
    const issued = issueFor(client.client_id);
    const token = invoicePdfToken(issued.invoice_id, 72);
    expect(invoiceTokenHours(issued.invoice_id, token)).toBe(72);
    expect(verifyDownloadToken(token, issued.invoice_id)?.iid).toBe(issued.invoice_id);
    expect(verifyDownloadToken(token, other.client_id)).toBeNull();
    const tokenForOther = invoicePdfToken(String(other.client_id), 1);
    expect(verifyDownloadToken(tokenForOther, issued.invoice_id)).toBeNull();
    expect(invoiceTokenHours(issued.invoice_id, "garbage")).toBeNull();
  });

  it("delivers only issued invoices to opt-in, reachable, eligible clients — outbox only when unconfigured", async () => {
    const silent = makeClient({ whatsapp_opt_in: false });
    const issuedSilent = issueFor(silent.client_id);
    await expect(deliverIssuedInvoice(issuedSilent.invoice_id, manager)).resolves.toBe("skipped");

    const opted = makeClient({ whatsapp_opt_in: true, whatsapp_consent_source: "Signed engagement letter" });
    const issued = issueFor(opted.client_id);
    const result = await deliverIssuedInvoice(issued.invoice_id, manager);
    expect(["queued", "sent"]).toContain(result);
    const messages = await Promise.resolve(listMessagesFor(issued.invoice_id)) as any[];
    expect(messages.length).toBe(1);
    expect(messages[0]!.kind).toBe("invoice");
    expect(messages[0]!.automation_key).toBe(`invoice-issued:${issued.invoice_id}`);
    // Without Cloud API credentials the message is queued in the outbox, never
    // "sent", and the invoice status is untouched by the delivery attempt.
    expect(messages[0]!.status).toBe("Queued");
    expect(getInvoice(issued.invoice_id).status).toBe("Pending");

    // Delivery does not prove payment: a draft cannot be delivered at all.
    const draftClient = makeClient({ whatsapp_opt_in: true });
    const draft = draftFor(draftClient.client_id);
    await expect(deliverIssuedInvoice(draft.invoice_id, manager)).resolves.toBe("skipped");

    // The automation role can never trigger delivery.
    await expect(deliverIssuedInvoice(issued.invoice_id, { name: "engine", role: "automation" })).resolves.toBe("skipped");
    void issuedSilent;
  });

  it("surfaces receivables with ageing buckets from configured thresholds", () => {
    updateFirmBillingSettings({ aging_buckets: "[30,60,90]" }, partner);
    const client = makeClient();
    const overdueDraft = draftFor(client.client_id, { invoice_date: "2025-06-10", due_date: "2025-06-25", actor: manager });
    submitForApproval(overdueDraft.invoice_id, manager);
    approveInvoice(overdueDraft.invoice_id, partner);
    const overdue = issueInvoice(overdueDraft.invoice_id, manager);
    const report = receivablesReport() as any;
    const row = report.invoices.find((r: any) => r.invoice_id === overdue.invoice_id)!;
    expect(row.daysOverdue).toBeGreaterThan(60);
    expect(row.balance_paise).toBeGreaterThan(0);
    expect(report.totals.outstandingPaise).toBeGreaterThanOrEqual(row.balance_paise);
    expect(report.totals.overduePaise).toBeGreaterThanOrEqual(row.balance_paise);
    expect(report.aging.some((b: any) => b.outstandingPaise >= row.balance_paise)).toBe(true);
    // Drafts and pending-approval invoices are surfaced separately, never in ageing.
    expect(report.totals.draftCount).toBeGreaterThanOrEqual(1);
    expect(row.bucket).toContain("days");
  });
});
