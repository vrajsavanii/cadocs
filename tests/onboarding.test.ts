import { describe, expect, it } from "vitest";
import { withIsolatedDataDir } from "./helpers/setup";

withIsolatedDataDir();

const {
  OnboardingError,
  activateService,
  addRegistration,
  assessOnboarding,
  createServiceDraft,
  listAssignmentHistory,
  listRegistrations,
  maskClientForRole,
  onboardClient,
  searchClients,
  setServiceStatus,
  updateServiceConfig,
  validateClientProfile,
} = await import("../lib/onboarding");
const {
  createClient,
  getDb,
  listClients,
  listCompliance,
  listDocuments,
  listInvoices,
  listUsers,
  updateClient,
} = await import("../lib/db");
const { approveInvoice, createDraftInvoice, issueInvoice, recordPaymentEntry, submitForApproval, updateFirmBillingSettings } = await import("../lib/invoicing");
const {
  ensureCurrentCycles,
  listClientServices,
  listDocumentRequests,
} = await import("../lib/engagements-db");
const { SERVICES } = await import("../lib/services");
const { todayISO } = await import("../lib/format");

const users = listUsers();
const partner = users.find((user) => user.role === "partner")!.name;
const manager = users.find((user) => user.role === "manager")!.name;
const article = users.find((user) => user.role === "article")!.name;

// Issuing under the Prompt 10 engine requires the firm billing identity to be
// configured; the engine refuses to invent one.
updateFirmBillingSettings(
  { legal_name: "Harita & Associates LLP", address: "901, Corporate House, Mumbai", approval_required_for_manual: true },
  { name: partner, role: "partner" },
);

/** Builds a checksum-valid GSTIN from a state code and a PAN. */
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

let panSeq = 0;
function nextPan(): string {
  panSeq += 1;
  // The 4th character C marks a company; the rest is a synthetic sequence.
  return `AAPCX${String(1000 + panSeq).slice(-4)}F`;
}

const baseProfile = (overrides: Record<string, unknown> = {}) => ({
  legal_name: "Harita Textiles Private Limited",
  entity_type: "Private Limited",
  pan: nextPan(),
  date_of_incorporation: "2019-04-01",
  address: "Unit 4, Trade Centre, Andheri East",
  city: "Mumbai",
  state: "Maharashtra",
  pincode: "400069",
  contact_person: "Rahul Sharma",
  phone: "9820011223",
  email: "accounts@harita.example",
  engagement_letter_status: "Approved",
  ...overrides,
});

function onboard(overrides: Record<string, unknown> = {}) {
  const pan = String(overrides.pan ?? nextPan());
  const hasExplicitRegistrations = Array.isArray(overrides.registrations);
  const gstNumber = overrides.gst_number !== undefined
    ? String(overrides.gst_number)
    : hasExplicitRegistrations
      ? ""
      : gstin("27", pan);
  const profile = baseProfile({ ...overrides, pan });
  return onboardClient({
    ...profile,
    gst_number: gstNumber,
    services: (overrides.services as Array<{ code: string }> | undefined) ?? [{ code: "gstr3b" }],
    actor: partner,
    ...overrides,
  });
}

describe("prompt-04: client onboarding and service configuration", () => {
  it("validates profile fields conditionally by entity type", () => {
    const company = validateClientProfile({
      legal_name: "No Incorporation Pvt Ltd",
      entity_type: "Private Limited",
      pan: "AAPFC0939F",
      city: "Mumbai",
      state: "Maharashtra",
      phone: "9820011223",
      email: "a@example.com",
      address: "1 Test Road",
    });
    expect(company.some((issue) => issue.field === "date_of_incorporation" && issue.severity === "error")).toBe(true);

    const individual = validateClientProfile({
      legal_name: "Asha Rao",
      entity_type: "Individual",
      pan: "AAPFU0939F",
      date_of_birth: "1990-01-01",
      city: "Pune",
      state: "Maharashtra",
      phone: "9820011224",
      email: "asha@example.com",
    });
    expect(individual.some((issue) => issue.field === "date_of_incorporation")).toBe(false);
    expect(individual.every((issue) => issue.field !== "phone" || issue.severity !== "error")).toBe(true);
  });

  it("masks PAN, GSTIN and TAN for non-partners and hides internal notes from article assistants", () => {
    const client = createClient({
      name: "Masked Client",
      legal_name: "Masked Client",
      contact_person: "Masked",
      phone: "9820011223",
      email: "masked@example.com",
      entity_type: "Private Limited",
      gst_number: "27AAPFC0939F1ZV",
      pan: "AAPFC0939F",
      tan: "MUMS12345A",
      services_opted: "",
      city: "Mumbai",
      state: "Maharashtra",
      notes: "Sensitive internal note",
      whatsapp_opt_in: true,
    });
    const managerView = maskClientForRole(client, "manager");
    expect(managerView.pan).toContain("•");
    expect(managerView.gst_number).toContain("•");
    expect(managerView.notes).toBe("Sensitive internal note");

    const articleView = maskClientForRole(client, "article");
    expect(articleView.pan).toContain("•");
    expect(articleView.notes).toBe("");
    expect(maskClientForRole(client, "partner").pan).toBe("AAPFC0939F");
  });

  it("onboards a client with two GST registrations and one engagement per registration", () => {
    const pan = nextPan();
    const first = gstin("27", pan);
    const second = gstin("29", pan);
    const result = onboardClient({
      ...baseProfile({ pan }),
      registrations: [
        { kind: "GST", identifier: first, legal_name: "Two States Private Limited", state: "Maharashtra", is_primary: true },
        { kind: "GST", identifier: second, legal_name: "Two States Private Limited", state: "Karnataka" },
      ],
      services: [
        { code: "gstr3b", registration_id: "new:0" },
        { code: "gstr3b", registration_id: "new:1" },
      ],
      actor: partner,
    });

    expect(result.registrations).toHaveLength(2);
    expect(result.services).toHaveLength(2);
    expect(result.cycles).toHaveLength(2);
    expect(result.documents).toBeGreaterThan(0);
    expect(result.issues).toEqual([]);

    const registrationIds = new Set(result.registrations.map((registration) => registration.registration_id));
    expect(result.services.every((service) => registrationIds.has(service.registration_id ?? ""))).toBe(true);
    expect(new Set(result.cycles.map((cycle) => cycle.task.registration_id)).size).toBe(2);
    expect(result.cycles.every((cycle) => (cycle.documents[0]?.registration_id ?? "") === (cycle.task.registration_id ?? ""))).toBe(true);
    // The public result masks identifiers; only a partner can reveal them.
    expect(result.registrations.every((registration) => registration.identifier === undefined)).toBe(true);
    expect(listRegistrations(result.client.client_id, "partner").every((registration) => Boolean(registration.identifier))).toBe(true);
  });

  it("rejects a GST engagement without an active GST registration", () => {
    expect(() =>
      onboardClient({
        ...baseProfile({ gst_number: "" }),
        services: [{ code: "gstr3b" }],
        actor: partner,
      }),
    ).toThrow(/GST registration/);
  });

  it("rejects invalid and duplicate registrations, and registrations from another client", () => {
    const first = onboard();
    const registration = listRegistrations(first.client.client_id, "partner")[0]!;

    expect(() =>
      addRegistration(first.client.client_id, { kind: "GST", identifier: "27AAPFC0939F1ZZ", legal_name: "Bad" }, partner),
    ).toThrow(OnboardingError);
    expect(() =>
      addRegistration(first.client.client_id, { kind: "GST", identifier: registration.identifier!, legal_name: "Duplicate" }, partner),
    ).toThrow(OnboardingError);

    const second = onboard({ legal_name: "Other Client Private Limited", contact_person: "Other" });
    expect(() =>
      createServiceDraft(second.client.client_id, { code: "gstr3b", registration_id: registration.registration_id }, partner),
    ).toThrow(OnboardingError);
    expect(listRegistrations(second.client.client_id, "partner").some((entry) => entry.registration_id === registration.registration_id)).toBe(false);
  });

  it("activates idempotently and a retried request cannot open a second period or checklist", () => {
    const created = onboard();
    const draft = createServiceDraft(created.client.client_id, { code: "gstr1" }, partner).service;
    const first = activateService(draft.service_id, partner, "activation-request-1");
    const second = activateService(draft.service_id, partner, "activation-request-1");
    const third = activateService(draft.service_id, partner, "activation-request-2");

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(third.created).toBe(false);
    expect(first.cycle!.task.compliance_id).toBe(second.cycle!.task.compliance_id);
    expect(first.cycle!.task.compliance_id).toBe(third.cycle!.task.compliance_id);
    expect(listCompliance().filter((task) => task.service_id === draft.service_id)).toHaveLength(1);
    expect(listDocumentRequests(created.client.client_id).filter((request) => request.service_code === "gstr1")).toHaveLength(1);
    expect(listDocuments().filter((doc) => doc.compliance_id === first.cycle!.task.compliance_id)).toHaveLength(first.cycle!.documents.length);
  });

  it("pauses and cancels without deleting history and without generating future work", () => {
    const created = onboard();
    const draft = createServiceDraft(created.client.client_id, { code: "gstr1" }, partner).service;
    setServiceStatus(draft.service_id, "Paused", partner);
    ensureCurrentCycles();
    expect(listCompliance().filter((task) => task.service_id === draft.service_id)).toHaveLength(0);

    setServiceStatus(draft.service_id, "Cancelled", partner);
    expect(() => activateService(draft.service_id, partner, "cancelled-retry")).toThrow(OnboardingError);
    expect(listClientServices(created.client.client_id).find((service) => service.service_id === draft.service_id)!.status).toBe("Cancelled");
    expect(listCompliance().filter((task) => task.service_id === created.services[0]!.service_id)).toHaveLength(1);
  });

  it("rejects invalid fee, billing and payment-term configuration", () => {
    const created = onboard();
    expect(() =>
      createServiceDraft(created.client.client_id, { code: "gstr1", fee: 0, auto_invoice: true }, partner),
    ).toThrow(OnboardingError);
    expect(() =>
      createServiceDraft(created.client.client_id, { code: "gstr1", fee: -1 }, partner),
    ).toThrow(OnboardingError);
    expect(() =>
      createServiceDraft(created.client.client_id, { code: "gstr1", fee: 2000, payment_terms_days: 365 }, partner),
    ).toThrow(OnboardingError);
    expect(() =>
      createServiceDraft(created.client.client_id, { code: "gstr1", fee: 2000, billing_cycle: "weekly" }, partner),
    ).toThrow(OnboardingError);
  });

  it("records assignments, rejects outsiders and requires an independent reviewer", () => {
    const created = onboard();
    const service = createServiceDraft(created.client.client_id, { code: "gstr1", owner: article, reviewer: manager, approval_stage: "review" }, partner).service;
    expect(listAssignmentHistory(created.client.client_id).some((entry) => entry.role === "reviewer" && entry.assignee === manager)).toBe(true);

    expect(() =>
      updateServiceConfig(service.service_id, { reviewer: "Outsider" }, partner),
    ).toThrow(OnboardingError);
    expect(() =>
      updateServiceConfig(service.service_id, { reviewer: article }, partner),
    ).toThrow(OnboardingError);
    expect(() =>
      updateServiceConfig(service.service_id, { partner: article }, partner),
    ).toThrow(OnboardingError);

    const updated = updateServiceConfig(service.service_id, { owner: manager, reviewer: partner }, partner);
    expect(updated.owner).toBe(manager);
    expect(listAssignmentHistory(created.client.client_id).some((entry) => entry.role === "preparer" && entry.assignee === manager)).toBe(true);
  });

  it("generates only the selected service's document checklist", () => {
    const created = onboard({ services: [{ code: "itr" }] });
    const requests = listDocumentRequests(created.client.client_id);
    const docs = listDocuments().filter((doc) => doc.client_id === created.client.client_id);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.service_code).toBe("itr");
    expect(docs.every((doc) => doc.service_code === "itr")).toBe(true);
    expect(docs.some((doc) => doc.service_code === "gstr3b")).toBe(false);
    const itr = SERVICES.find((service) => service.code === "itr")!;
    expect(docs).toHaveLength(itr.checklist.length);
    expect(docs.every((doc) => doc.template_version === 1)).toBe(true);
  });

  it("preserves invoices, payments and historical work when the profile changes", () => {
    const created = onboard();
    const { invoice: invoice } = createDraftInvoice(
      {
        client_id: created.client.client_id,
        lines: [
          {
            description: "GSTR-3B · Sep 2026",
            quantity: 1,
            unit_price: 2000,
            treatment_id: "TAX-NONE",
          },
        ],
        invoice_date: todayISO(),
        due_date: todayISO(),
      },
      { name: manager, role: "manager" },
    );
    submitForApproval(invoice.invoice_id, { name: manager, role: "manager" });
    approveInvoice(invoice.invoice_id, { name: partner, role: "partner" });
    const issued = issueInvoice(invoice.invoice_id, { name: manager, role: "manager" });
    recordPaymentEntry(issued.invoice_id, { amount: 1000, paid_on: todayISO(), mode: "UPI", reference: "UPI-123", notes: "" }, { name: manager, role: "manager" });
    const complianceBefore = listCompliance().filter((task) => task.client_id === created.client.client_id).length;
    const documentsBefore = listDocuments().filter((doc) => doc.client_id === created.client.client_id).length;

    updateClient(created.client.client_id, { name: "Renamed Textiles Private Limited", updated_by: partner });
    expect(listInvoices().find((entry) => entry.invoice_id === invoice.invoice_id)?.client_name).toBe("Renamed Textiles Private Limited");
    expect(listCompliance().filter((task) => task.client_id === created.client.client_id)).toHaveLength(complianceBefore);
    expect(listDocuments().filter((doc) => doc.client_id === created.client.client_id)).toHaveLength(documentsBefore);
    const refreshed = listClients().find((client) => client.client_id === created.client.client_id)!;
    expect(refreshed.onboarding_completed_at).toBeTruthy();
  });

  it("never sends WhatsApp messages during onboarding", () => {
    const before = Number((getDb().prepare("SELECT COUNT(*) AS n FROM messages").get() as { n: number }).n);
    const result = onboard({ whatsapp_opt_in: true, whatsapp_consent_source: "Signed engagement letter" });
    const after = Number((getDb().prepare("SELECT COUNT(*) AS n FROM messages").get() as { n: number }).n);
    expect(result.messages).toEqual([]);
    expect(after).toBe(before);
    expect(result.client.whatsapp_consent_source).toBe("Signed engagement letter");
  });

  it("assesses completeness truthfully and ignores cancelled engagements", () => {
    const created = onboard();
    expect(created.assessment.completeness).toBe(100);
    expect(created.assessment.can_activate).toBe(true);

    const second = onboard({ services: [{ code: "itr" }] });
    createServiceDraft(second.client.client_id, { code: "gstr1" }, partner);
    expect(assessOnboarding(second.client.client_id, partner)?.completeness).toBeLessThan(100);

    const third = createClient({
      name: "Draft Only Private Limited",
      legal_name: "Draft Only Private Limited",
      contact_person: "Draft",
      phone: "9820011225",
      email: "draft@example.com",
      entity_type: "Private Limited",
      gst_number: "",
      pan: nextPan(),
      services_opted: "",
      city: "Mumbai",
      state: "Maharashtra",
      date_of_incorporation: "2021-04-01",
      address: "2 Test Road",
      whatsapp_opt_in: true,
    });
    addRegistration(third.client_id, { kind: "GST", identifier: gstin("27", third.pan), legal_name: third.name }, partner);
    const onlyDraft = createServiceDraft(third.client_id, { code: "gstr3b" }, partner).service;
    setServiceStatus(onlyDraft.service_id, "Cancelled", partner);
    const after = assessOnboarding(third.client_id, partner)!;
    expect(after.can_activate).toBe(false);
    expect(after.services).toHaveLength(0);
  });

  it("filters and paginates clients on the server", () => {
    const needle = `Searchable ${Date.now()}`;
    const created = onboard({ legal_name: needle, trade_name: needle, services: [{ code: "itr" }] });
    const page = searchClients({ q: needle, page: 1, page_size: 10 });
    expect(page.total).toBe(1);
    expect(page.items[0]!.client_id).toBe(created.client.client_id);
    expect(searchClients({ service_code: "itr", q: needle }).total).toBe(1);
    expect(searchClients({ service_code: "gstr3b", q: needle }).total).toBe(0);
    expect(searchClients({ entity_type: "Individual", q: needle }).total).toBe(0);
    expect(searchClients({ onboarding: "active", q: needle }).total).toBe(1);
    expect(page.pages).toBeGreaterThanOrEqual(1);
  });
});
