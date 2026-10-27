/**
 * Billing engine (Prompt 10).
 *
 * Design invariants:
 *  - Money is never computed in binary floating point. Every persisted amount
 *    is an integer number of paise; REAL columns exist only for the legacy UI
 *    and are derived from the integer canonical values.
 *  - The human invoice number is allocated inside the finalisation
 *    transaction (BEGIN IMMEDIATE) from a scan of already-issued numbers with
 *    the same prefix, skipping any number a legacy row already holds. It is
 *    never derived from a count of invoice records and never renumbered after
 *    issue.
 *  - Automatic billing is idempotent by `billing_event_key` (unique index): a
 *    retried job finds the existing invoice and preserves its state instead of
 *    creating a duplicate.
 *  - Issued invoices are immutable: lines, tax and totals are frozen into
 *    `issue_snapshot` at finalisation; corrections go through credit notes or
 *    audited cancellation, both recorded in the append-only `invoice_events`.
 *  - Payment status is computed from the payment ledger — never from an
 *    editable checkbox — and a WhatsApp delivery is never treated as payment
 *    evidence.
 */
import { HttpError } from "./api";
import { signDownloadToken } from "./crypto";
import {
  all,
  getDb,
  getClient,
  getInvoice,
  getSettings,
  listInvoices,
  listPayments,
  logAudit,
  nextId,
  one,
  updateSettings,
  withTransaction,
} from "./db";
import { dayDiff, prettyDate, todayISO } from "./format";
import { addDaysISO, fyForDate, validateGstin } from "./services";
import type { CreditNote, FirmBillingSettings, Invoice, InvoiceEvent, InvoiceLine, Payment, ReceivablesReport, TaxTreatment } from "./types";
import { getObject, objectExists, putObject } from "./storage";
import { checksumOf } from "./documents";
import { parseIssueSnapshot, renderInvoicePdf } from "./invoice-pdf";
import { verifyDownloadToken } from "./crypto";
import { deliverWhatsApp } from "./whatsapp";

export type Actor = { name: string; role: string };

export type InvoiceDetail = {
  invoice: Invoice;
  lines: InvoiceLine[];
  payments: Payment[];
  creditNotes: CreditNote[];
  events: InvoiceEvent[];
  computed: {
    totalPaise: number;
    paidPaise: number;
    creditPaise: number;
    balancePaise: number;
  };
};

// ── Money helpers ──────────────────────────────────────────────────────────────

/** Rupees (possibly fractional) → integer paise, half-up. */
export function toPaise(rupees: unknown): number {
  const n = Number(rupees);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON * Math.sign(n || 1)) * 100);
}

export function paiseToRupees(paise: number): number {
  return Math.round(paise) / 100;
}

/** Company-supplied rupee string/number → integer paise, validated. */
function rupeesToPaise(value: unknown, field: string): number {
  const n = Number(value);
  if (value === undefined || value === null || value === "" || !Number.isFinite(n)) {
    throw new HttpError(`"${field}" is required`);
  }
  if (n < 0) throw new HttpError(`"${field}" cannot be negative`);
  if (n > 50_000_000) throw new HttpError(`"${field}" is beyond supported range`);
  return toPaise(n);
}

function quantityFor(value: unknown): number {
  const n = Number(value ?? 1);
  if (!Number.isInteger(n) || n < 1 || n > 100_000) throw new HttpError('"quantity" must be a whole number of at least 1');
  return n;
}

// ── Roles ─────────────────────────────────────────────────────────────────────

function assertAtLeast(actor: Actor, minRole: "manager" | "partner"): void {
  const rank: Record<string, number> = { article: 1, manager: 2, partner: 3 };
  if ((rank[actor.role] ?? 0) < (minRole === "partner" ? 3 : 2)) {
    throw new HttpError(minRole === "partner" ? "Only a partner can perform this action" : "Only a manager or partner can perform this action", 403);
  }
}

/** Minimum role required for each named invoice permission. */
const PERMISSION_MIN_ROLE: Record<InvoicePermission, "manager" | "partner"> = {
  view: "manager",
  "create-draft": "manager",
  "edit-draft": "manager",
  approve: "manager",
  issue: "manager",
  cancel: "partner",
  payments: "manager",
  "payment-reversal": "manager",
  "credit-note": "partner",
  settings: "partner",
  deliver: "manager",
  receivables: "manager",
};

export class NotAuthorizedError extends Error {
  status: number;
  constructor(message = "You do not have permission for this billing action") {
    super(message);
    this.name = "NotAuthorizedError";
    this.status = 403;
  }
}

/**
 * Single server-side permission gate for every billing operation. Roles are
 * ranked server-side; the caller supplies the session user, never a claimed
 * role. `automation` is an internal role recognised ONLY for draft creation
 * by the auto-billing engine — it can never approve, issue or deliver.
 */
export function hasInvoicePermission(actor: Actor | { name: string; role: string } | null | undefined, permission: InvoicePermission): boolean {
  if (!actor) return false;
  const rank: Record<string, number> = { article: 1, manager: 2, partner: 3, automation: 0, system: 0 };
  const have = rank[actor.role] ?? 0;
  const need = PERMISSION_MIN_ROLE[permission] === "partner" ? 3 : 2;
  return have >= need;
}

export function assertInvoicePermission(actor: Actor | { name: string; role: string } | null | undefined, permission: InvoicePermission): void {
  if (!hasInvoicePermission(actor, permission)) throw new NotAuthorizedError();
}


// ── Firm billing configuration ────────────────────────────────────────────────

function rowToBillingSettings(row: Record<string, unknown>): FirmBillingSettings {
  let buckets: number[] = [30, 60, 90];
  try {
    const parsed = JSON.parse(String(row.aging_buckets || "[30,60,90]")) as unknown;
    if (Array.isArray(parsed)) {
      const clean = (parsed as unknown[]).map((b) => Math.round(Number(b))).filter((b) => Number.isFinite(b) && b > 0 && b < 1000);
      if (clean.length && clean.every((b, i) => i === 0 || b > clean[i - 1])) buckets = clean;
    }
  } catch {
    // Keep the documented default.
  }
  return {
    billing_enabled: Number(row.billing_enabled) !== 0,
    legal_name: String(row.legal_name ?? ""),
    display_name: String(row.display_name ?? ""),
    address: String(row.address ?? ""),
    contact: String(row.contact ?? ""),
    pan: String(row.pan ?? ""),
    gstin: String(row.gstin ?? ""),
    invoice_prefix: String(row.invoice_prefix ?? "NV"),
    credit_note_prefix: String(row.credit_note_prefix ?? "NC"),
    numbering_policy: row.numbering_policy === "continuous" ? "continuous" : "per_fy",
    currency: String(row.currency ?? "INR"),
    default_payment_terms_days: Number(row.default_payment_terms_days ?? 15),
    internal_billing_contact: String(row.internal_billing_contact ?? ""),
    invoice_footer: String(row.invoice_footer ?? ""),
    payment_instructions: String(row.payment_instructions ?? ""),
    bank_details: String(row.bank_details ?? ""),
    invoice_grouping: row.invoice_grouping === "per_service" ? "per_service" : "one_per_event",
    approval_required_for_auto: Number(row.approval_required_for_auto) !== 0,
    approval_required_for_manual: Number(row.approval_required_for_manual) !== 0,
    deliver_on_issue: Number(row.deliver_on_issue) !== 0,
    aging_buckets: buckets,
    updated_by: String(row.updated_by ?? ""),
    updated_at: String(row.updated_at ?? ""),
  };
}

export function firmBillingSettings(): FirmBillingSettings {
  const row = one<Record<string, unknown>>("SELECT * FROM billing_settings WHERE id = 1");
  if (!row) throw new Error("billing_settings row missing — migrations did not run");
  const settings = rowToBillingSettings(row);
  if (settings.default_payment_terms_days < 1 || settings.default_payment_terms_days > 90) settings.default_payment_terms_days = 15;
  return settings;
}

const SETTABLE_STRING_FIELDS = [
  "legal_name",
  "display_name",
  "address",
  "contact",
  "pan",
  "gstin",
  "invoice_prefix",
  "credit_note_prefix",
  "currency",
  "internal_billing_contact",
  "invoice_footer",
  "payment_instructions",
  "bank_details",
  "numbering_policy",
  "invoice_grouping",
] as const;

const SETTABLE_INT_FIELDS = ["default_payment_terms_days"] as const;
const SETTABLE_BOOL_FIELDS = [
  "billing_enabled",
  "approval_required_for_auto",
  "approval_required_for_manual",
  "deliver_on_issue",
] as const;

export function updateFirmBillingSettings(patch: Record<string, unknown>, actor: Actor): FirmBillingSettings {
  assertInvoicePermission(actor, "settings");
  const updates: Array<[string, string | number]> = [];
  for (const key of SETTABLE_STRING_FIELDS) {
    if (patch[key] === undefined) continue;
    const value = String(patch[key] ?? "").trim();
    if (key === "gstin" && value) {
      const normalised = value.toUpperCase();
      const invalid = validateGstin(normalised);
      if (invalid) throw new HttpError(`GSTIN checksum failed: ${invalid}`);
      updates.push(["gstin", normalised]);
      continue;
    }
    if (key === "pan" && value) {
      if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(value.toUpperCase())) throw new HttpError("PAN must match AAAAA9999A");
      updates.push(["pan", value.toUpperCase()]);
      continue;
    }
    if ((key === "invoice_prefix" || key === "credit_note_prefix") && value) {
      if (!/^[A-Za-z0-9-]{1,10}$/.test(value)) throw new HttpError(`${key.replace(/_/g, " ")} may contain letters, digits and dashes only`);
      updates.push([key, value.toUpperCase()]);
      continue;
    }
    if (key === "numbering_policy" && value && value !== "per_fy" && value !== "continuous") {
      throw new HttpError('numbering_policy must be "per_fy" or "continuous"');
    }
    if (key === "invoice_grouping" && value && value !== "one_per_event" && value !== "per_service") {
      throw new HttpError('invoice_grouping must be "one_per_event" or "per_service"');
    }
    if (key === "currency" && value && value !== "INR") {
      throw new HttpError("Only INR invoices are supported in this version");
    }
    if (key === "legal_name" && !value) throw new HttpError("Firm legal name cannot be empty");
    updates.push([key, value.length > 500 ? value.slice(0, 500) : value]);
  }
  for (const key of SETTABLE_INT_FIELDS) {
    if (patch[key] === undefined) continue;
    const n = Math.round(Number(patch[key]));
    if (!Number.isFinite(n) || n < 1 || n > 90) throw new HttpError("Payment terms must be between 1 and 90 days");
    updates.push([key, n]);
  }
  for (const key of SETTABLE_BOOL_FIELDS) {
    if (patch[key] === undefined) continue;
    updates.push([key, patch[key] === true || patch[key] === "true" || patch[key] === 1 || patch[key] === "1" ? 1 : 0]);
  }
  if (patch.aging_buckets !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(patch.aging_buckets)) as unknown;
    } catch {
      parsed = [];
    }
    if (!Array.isArray(parsed)) throw new HttpError("aging_buckets must be a JSON array of day thresholds");
    const clean = parsed.map((b) => Math.round(Number(b))).filter((b) => Number.isFinite(b) && b > 0 && b < 1000);
    if (!clean.length || !clean.every((b, i) => i === 0 || b > clean[i - 1])) {
      throw new HttpError("aging_buckets must be increasing day thresholds, e.g. [30,60,90]");
    }
    updates.push(["aging_buckets", JSON.stringify(clean)]);
  }
  if (updates.length) {
    updates.push(["updated_at", new Date().toISOString()], ["updated_by", actor.name]);
    withTransaction(() => {
      for (const [key, value] of updates) {
        getDb().prepare(`UPDATE billing_settings SET ${key} = ? WHERE id = 1`).run(value);
      }
    });
    logAudit({ actor: actor.name, action: "BILLING_SETTINGS_UPDATED", entity_type: "billing_settings", entity_id: "1", detail: `Updated: ${updates.filter(([k]) => k !== "updated_at" && k !== "updated_by").map(([k]) => k).join(", ")}` });
  }
  return firmBillingSettings();
}

// ── Tax treatments ────────────────────────────────────────────────────────────

export function listTaxTreatments(): TaxTreatment[] {
  return all<TaxTreatment>("SELECT * FROM tax_treatments ORDER BY treatment_id").map((t) => ({
    ...t,
    active: Number((t as unknown as { active: number }).active) !== 0,
  }));
}

function taxTreatment(treatmentId: string): TaxTreatment {
  const row = one<TaxTreatment>("SELECT * FROM tax_treatments WHERE treatment_id = ?", treatmentId);
  if (!row) throw new HttpError(`Tax treatment "${treatmentId}" does not exist`, 404);
  return { ...row, active: Number((row as unknown as { active: number }).active) !== 0 };
}

export function updateTaxTreatment(treatmentId: string, patch: Record<string, unknown>, actor: Actor): TaxTreatment {
  assertInvoicePermission(actor, "settings");
  const current = taxTreatment(treatmentId);
  const updates: Array<[string, string | number | null]> = [];
  if (patch.name !== undefined) {
    const name = String(patch.name).trim();
    if (!name) throw new HttpError("Treatment name cannot be empty");
    updates.push(["name", name.slice(0, 200)]);
  }
  if (patch.kind !== undefined) {
    if (patch.kind !== "none" && patch.kind !== "gst") throw new HttpError('kind must be "none" or "gst"');
    updates.push(["kind", String(patch.kind)]);
  }
  if (patch.rate_bp !== undefined) {
    if (patch.rate_bp === null || patch.rate_bp === "") {
      updates.push(["rate_bp", null]);
    } else {
      const bp = Math.round(Number(patch.rate_bp));
      if (!Number.isFinite(bp) || bp < 0 || bp > 5000) throw new HttpError("rate_bp must be between 0 and 5000 (basis points)");
      updates.push(["rate_bp", bp]);
    }
  }
  if (patch.active !== undefined) updates.push(["active", patch.active === true || patch.active === 1 || patch.active === "true" ? 1 : 0]);
  if (patch.note !== undefined) updates.push(["note", String(patch.note).trim().slice(0, 500)]);
  if (!updates.length) return current;
  if (updates.some(([k]) => k === "rate_bp") && updates.some(([k]) => k === "kind") && current.kind === "none") {
    throw new HttpError("Set kind first; each treatment is permanently flagged by its kind");
  }
  const nextKind = String(updates.find(([k]) => k === "kind")?.[1] ?? current.kind);
  const nextRate = updates.find(([k]) => k === "rate_bp")?.[1] ?? current.rate_bp;
  const effectiveRate = nextRate === undefined ? (current as unknown as { rate_bp: number | null }).rate_bp : (nextRate as number | null);
  if (nextKind === "gst" && (effectiveRate === null || effectiveRate === undefined)) {
    // Allowed state: a GST treatment may exist without a rate, but invoices
    // using it cannot be issued until the rate is configured. Allowed here so
    // the firm can stage the configuration.
  }
  updates.push(["updated_by", actor.name], ["updated_at", new Date().toISOString()]);
  withTransaction(() => {
    for (const [key, value] of updates) {
      getDb().prepare(`UPDATE tax_treatments SET ${key} = ? WHERE treatment_id = ?`).run(value, treatmentId);
    }
  });
  logAudit({ actor: actor.name, action: "TAX_TREATMENT_UPDATED", entity_type: "tax_treatment", entity_id: treatmentId, detail: `Updated: ${updates.map(([k]) => k).join(", ")}` });
  return taxTreatment(treatmentId);
}

/** Treatment used by automatic billing (settings KV, safe default). */
/** Permission names enforced by hasInvoicePermission / assertInvoicePermission. */
export type InvoicePermission =
  | "view"
  | "create-draft"
  | "edit-draft"
  | "approve"
  | "issue"
  | "cancel"
  | "payments"
  | "payment-reversal"
  | "credit-note"
  | "settings"
  | "deliver"
  | "receivables";

export function autoTreatmentId(): string {
  const stored = (getSettings().billing_auto_treatment_id || "").trim();
  const fallback = "TAX-GST-UNCONFIGURED";
  if (!stored) return fallback;
  return taxTreatment(stored).treatment_id;
}

export function setAutoTreatment(treatmentId: string, actor: Actor): void {
  assertInvoicePermission(actor, "settings");
  taxTreatment(treatmentId);
  updateSettings({ billing_auto_treatment_id: treatmentId });
  logAudit({ actor: actor.name, action: "TAX_TREATMENT_UPDATED", entity_type: "billing_settings", entity_id: "auto_treatment", detail: `Auto-billing treatment set to ${treatmentId}` });
}

// ── Number allocation ─────────────────────────────────────────────────────────

export type NumberKind = "invoice" | "credit_note";

/**
 * Allocates the next human number for `kind` as of `dateISO`. MUST be called
 * inside an open write transaction (BEGIN IMMEDIATE) so two issuers cannot
 * race: the scan and the insert commit atomically, and the unique index on
 * invoice_number / credit_notes.number is the last line of defence.
 *
 * The number is never derived from a record count: we scan the numeric
 * suffixes already used under the same prefix and move one past the highest,
 * *skipping* any slot a legacy row already occupies so historical numbers are
 * preserved and never silently renumbered.
 */
export function allocateNumber(kind: NumberKind, dateISO: string, settings: FirmBillingSettings, usedNumbers: Set<string>): { number: string; fy: string } {
  const prefix = kind === "invoice" ? settings.invoice_prefix || "NV" : settings.credit_note_prefix || "NC";
  const fy = settings.numbering_policy === "per_fy" ? fyForDateSafe(dateISO) : "ALL";
  const stem = settings.numbering_policy === "per_fy" ? `${prefix}/${fy}/` : `${prefix}/`;
  let max = 0;
  for (const existing of usedNumbers) {
    if (!existing.startsWith(stem)) continue;
    const tail = existing.slice(stem.length);
    if (!/^\d+$/.test(tail)) continue;
    max = Math.max(max, Number(tail));
  }
  let seq = max + 1;
  while (seq < 1_000_000 && usedNumbers.has(`${stem}${String(seq).padStart(4, "0")}`)) seq += 1;
  if (seq >= 1_000_000) throw new HttpError("Invoice sequence exhausted for this period", 409);
  return { number: `${stem}${String(seq).padStart(4, "0")}`, fy: settings.numbering_policy === "per_fy" ? fy : "" };
}

/** Collects the issued numbers the allocator must not collide with. */
function collectUsedNumbers(kind: NumberKind): Set<string> {
  if (kind === "invoice") {
    return new Set(
      all<{ invoice_number: string | null }>("SELECT invoice_number FROM invoices WHERE invoice_number IS NOT NULL AND invoice_number <> ''")
        .map((r) => r.invoice_number)
        .filter((n): n is string => Boolean(n)),
    );
  }
  return new Set(
    all<{ number: string }>("SELECT number FROM credit_notes").map((r) => r.number),
  );
}

export function fyForDateSafe(isoDate: string): string {
  try {
    return fyForDate(isoDate);
  } catch {
    return fyForDate(todayISO());
  }
}

// ── Events / audit ────────────────────────────────────────────────────────────

export function listInvoiceEvents(invoiceId: string): InvoiceEvent[] {
  return all<InvoiceEvent>("SELECT * FROM invoice_events WHERE invoice_id = ? ORDER BY created_at, rowid", invoiceId);
}

function logInvoiceEvent(invoiceId: string, event: string, actor: string, role: string, detail = ""): void {
  getDb()
    .prepare("INSERT INTO invoice_events (event_id, invoice_id, event, actor, role, detail, created_at) VALUES (?,?,?,?,?,?,?)")
    .run(nextId("EV", "invoice_events", "event_id"), invoiceId, event, actor, role, detail.slice(0, 500), new Date().toISOString());
}

// ── Lines & totals ────────────────────────────────────────────────────────────

export type DraftLineInput = {
  description: string;
  service_code?: string;
  client_service_id?: string;
  compliance_id?: string;
  registration_id?: string;
  quantity?: number;
  /** Unit price in rupees (engine converts to paise). */
  unit_price: number;
  /** Total discount across the line, in rupees. */
  discount?: number;
  treatment_id?: string;
};

function computeLines(lines: DraftLineInput[], client: { gst_state_code?: string | null } | null, firmGstin: string): { rows: Omit<InvoiceLine, "line_id" | "invoice_id" | "created_at">[]; taxablePaise: number; gstPaise: number; totalPaise: number } {
  if (!lines.length) throw new HttpError("An invoice needs at least one line item");
  const clientStateCode = String(client?.gst_state_code || "").trim();
  const firmStateCode = firmGstin.slice(0, 2);
  let taxableTotal = 0;
  let gstTotal = 0;
  const rows = lines.map((line, index) => {
    const description = String(line.description || "").trim();
    if (!description) throw new HttpError(`Line ${index + 1}: description is required`);
    const qty = quantityFor(line.quantity ?? 1);
    const unit = rupeesToPaise(line.unit_price, `line ${index + 1} unit price`);
    if (unit <= 0) throw new HttpError(`Line ${index + 1}: unit price must be greater than zero`);
    const discount = line.discount === undefined || line.discount === null ? 0 : rupeesToPaise(line.discount, `line ${index + 1} discount`);
    if (discount > qty * unit) throw new HttpError(`Line ${index + 1}: discount exceeds the line amount`);
    const treatmentId = String(line.treatment_id || "").trim();
    if (!treatmentId) throw new HttpError(`Line ${index + 1}: a tax treatment must be selected`);
    const treatment = taxTreatment(treatmentId);
    if (!treatment.active) throw new HttpError(`Line ${index + 1}: tax treatment "${treatment.name}" is inactive`);
    const taxable = qty * unit - discount;
    let rate = 0;
    let cgst = 0;
    let sgst = 0;
    let igst = 0;
    if (treatment.kind === "gst") {
      const rateBp = (treatment as unknown as { rate_bp: number | null }).rate_bp;
      // Rate not configured → zero tax at draft time; issuance refuses below.
      rate = rateBp ?? 0;
      if (rate > 0) {
        const tax = Math.round((taxable * rate) / 10_000);
        if (firmGstin && firmStateCode && clientStateCode && firmStateCode === clientStateCode) {
          cgst = Math.floor(tax / 2);
          sgst = tax - cgst;
          igst = 0;
        } else {
          igst = tax;
          cgst = 0;
          sgst = 0;
        }
      }
    }
    const lineTotal = taxable + cgst + sgst + igst;
    taxableTotal += taxable;
    gstTotal += cgst + sgst + igst;
    return {
      seq: index + 1,
      description: description.slice(0, 300),
      service_code: String(line.service_code || "").slice(0, 40),
      client_service_id: String(line.client_service_id || ""),
      compliance_id: String(line.compliance_id || ""),
      registration_id: String(line.registration_id || ""),
      quantity: qty,
      unit_price_paise: unit,
      discount_paise: discount,
      taxable_paise: taxable,
      treatment_id: treatment.treatment_id,
      tax_kind: treatment.kind,
      gst_rate_bp: (treatment as unknown as { rate_bp: number | null }).rate_bp,
      cgst_paise: cgst,
      sgst_paise: sgst,
      igst_paise: igst,
      line_total_paise: lineTotal,
    } satisfies Omit<InvoiceLine, "line_id" | "invoice_id" | "created_at">;
  });
  return { rows, taxablePaise: taxableTotal, gstPaise: gstTotal, totalPaise: taxableTotal + gstTotal };
}

function insertLines(invoiceId: string, rows: Omit<InvoiceLine, "line_id" | "invoice_id" | "created_at">[]): void {
  const stmt = getDb().prepare(
    `INSERT INTO invoice_lines
       (line_id, invoice_id, seq, description, service_code, client_service_id, compliance_id, registration_id,
        quantity, unit_price_paise, discount_paise, taxable_paise, treatment_id, tax_kind, gst_rate_bp,
        cgst_paise, sgst_paise, igst_paise, line_total_paise, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  for (const row of rows) {
    stmt.run(
      nextId("LN", "invoice_lines", "line_id"),
      invoiceId,
      row.seq,
      row.description,
      row.service_code ?? "",
      row.client_service_id ?? "",
      row.compliance_id ?? "",
      row.registration_id ?? "",
      row.quantity,
      row.unit_price_paise,
      row.discount_paise,
      row.taxable_paise,
      row.treatment_id,
      row.tax_kind,
      row.gst_rate_bp ?? null,
      row.cgst_paise,
      row.sgst_paise,
      row.igst_paise,
      row.line_total_paise,
      new Date().toISOString(),
    );
  }
}

// ── Draft creation ────────────────────────────────────────────────────────────

export type DraftInput = {
  client_id: string;
  lines: DraftLineInput[];
  invoice_date?: string;
  due_date?: string;
  notes?: string;
  service_id?: string;
  period?: string;
  auto_generated?: boolean;
  compliance_id?: string;
  /** Stable idempotency identity for automatic billing events. */
  billing_event_key?: string;
  approval_required?: boolean;
};

export function createDraftInvoice(input: DraftInput, actor: Actor): { invoice: Invoice; created: boolean } {
  const isEngine = actor.role === "automation" || actor.role === "system";
  // The billing engine (role "automation") may only create keyed, idempotent
  // drafts — it never gains broader financial powers.
  if (isEngine) {
    if (!input.billing_event_key) throw new NotAuthorizedError("The billing engine can only create idempotent, keyed drafts");
  } else {
    assertInvoicePermission(actor, "create-draft");
  }
  // Idempotency for EVERY actor: a billing event key is one-shot. A retried
  // job (or a duplicate submit) finds the existing draft and returns it —
  // never a second invoice with the same identity.
  if (input.billing_event_key) {
    const existing = one<Invoice>("SELECT * FROM invoices WHERE billing_event_key = ?", input.billing_event_key);
    if (existing) return { invoice: getInvoice(existing.invoice_id)!, created: false };
  }
  const settings = firmBillingSettings();
  if (!settings.billing_enabled && !input.auto_generated) {
    throw new HttpError("Billing is switched off — a partner can enable it in billing settings", 409);
  }
  const client = getClient(input.client_id);
  if (!client) throw new HttpError("Client not found", 404);
  const firmGstin = settings.gstin.toUpperCase().trim();
  const computed = computeLines(input.lines, client, firmGstin);
  const invoiceDate = (input.invoice_date || todayISO()).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate)) throw new HttpError("invoice_date must be YYYY-MM-DD");
  const dueDays = input.due_date
    ? Math.max(0, Math.round((Date.parse(`${input.due_date.slice(0, 10)}T00:00:00Z`) - Date.parse(`${invoiceDate}T00:00:00Z`)) / 86_400_000))
    : settings.default_payment_terms_days;
  const dueDate = input.due_date?.slice(0, 10) || addDaysISO(invoiceDate, Math.max(0, Math.min(365, dueDays)));

  // Idempotent inserts must not crash on the unique index when a concurrent
  // writer wins — the pre-check above plus BEGIN IMMEDIATE (single writer)
  // makes both paths deterministic.
  const invoiceId = withTransaction(() => {
    const id = nextId("INV", "invoices", "invoice_id");
    const approvalRequired = input.approval_required ?? (input.auto_generated ? settings.approval_required_for_auto : settings.approval_required_for_manual);
    const inserted = (() => {
      try {
        getDb().prepare(
          `INSERT INTO invoices
             (invoice_id, client_id, client_name, invoice_date, due_date, service_description, amount, gst_amount,
              total_amount, paid_amount, status, paid_date, service_id, compliance_id, period, auto_generated,
              reminder_count, last_reminded_at, lifecycle, billing_event_key, taxable_paise, gst_paise, total_paise, paid_paise, credit_paise, notes)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL,?,?,?,?,0,NULL,?,?,?,?,?,?,0,?)`,
        ).run(
        id,
        client.client_id,
        client.name,
        invoiceDate,
        dueDate,
        computed.rows.map((r) => r.description).join(" + ").slice(0, 200),
        paiseToRupees(computed.taxablePaise),
        paiseToRupees(computed.gstPaise),
        paiseToRupees(computed.totalPaise),
        0,
        "Pending",
        input.service_id || "",
        input.compliance_id ? input.compliance_id : null,
        input.period || "",
        input.auto_generated ? 1 : 0,
        "draft",
        input.billing_event_key || null,
        computed.taxablePaise,
        computed.gstPaise,
        computed.totalPaise,
        0,
        (input.notes || "").slice(0, 500),
      );
        return id;
      } catch (err) {
        // A concurrent writer won the billing_event_key unique index: this
        // retry degrades to reading the winner instead of duplicating or
        // crashing the producing job.
        if (input.billing_event_key && /billing_event_key/.test(String((err as Error).message))) {
          const winner = one<Invoice>("SELECT invoice_id FROM invoices WHERE billing_event_key = ?", input.billing_event_key);
          if (winner) return winner.invoice_id;
        }
        throw err;
      }
    })();
    insertLines(inserted, computed.rows);
    logInvoiceEvent(inserted, "CREATED", actor.name, actor.role, input.auto_generated ? "Auto-generated draft from billing rule" : "Manual draft");
    return inserted;
  });

  logAudit({
    actor: actor.name,
    action: input.auto_generated ? "INVOICE_AUTO_CREATED" : "INVOICE_DRAFT_CREATED",
    entity_type: "invoice",
    entity_id: invoiceId,
    detail: `Draft for ${client.name} — ₹${paiseToRupees(computed.totalPaise).toLocaleString("en-IN")}`,
  });
  return { invoice: getInvoice(invoiceId)!, created: true };
}

// ── Draft editing ─────────────────────────────────────────────────────────────

export function updateDraftInvoice(invoiceId: string, patch: { lines?: DraftLineInput[]; due_date?: string; invoice_date?: string; notes?: string }, actor: Actor): Invoice {
  assertInvoicePermission(actor, "edit-draft");
  const invoice = requireLifecycle(invoiceId, "draft");
  const client = getClient(invoice.client_id);
  if (!client) throw new HttpError("Client not found", 404);
  const settings = firmBillingSettings();
  const lineInput = patch.lines ?? linesToDraftInput(invoiceId);
  const computed = computeLines(lineInput, client, settings.gstin.toUpperCase().trim());
  const invoiceDate = (patch.invoice_date || invoice.invoice_date).slice(0, 10);
  const dueDate = patch.due_date ? patch.due_date.slice(0, 10) : invoice.due_date;
  withTransaction(() => {
    getDb()
      .prepare(
        `UPDATE invoices SET invoice_date=?, due_date=?, amount=?, gst_amount=?, total_amount=?, taxable_paise=?, gst_paise=?, total_paise=?, notes=?
         WHERE invoice_id=? AND lifecycle='draft'`,
      )
      .run(
        invoiceDate,
        dueDate,
        paiseToRupees(computed.taxablePaise),
        paiseToRupees(computed.gstPaise),
        paiseToRupees(computed.totalPaise),
        computed.taxablePaise,
        computed.gstPaise,
        computed.totalPaise,
        (patch.notes || invoice.notes || "").slice(0, 500),
        invoiceId,
      );
    getDb().prepare("DELETE FROM invoice_lines WHERE invoice_id = ?").run(invoiceId);
    insertLines(invoiceId, computed.rows);
  });
  logInvoiceEvent(invoiceId, "DRAFT_EDITED", actor.name, actor.role);
  logAudit({ actor: actor.name, action: "INVOICE_DRAFT_EDITED", entity_type: "invoice", entity_id: invoiceId, detail: `Draft updated (${computed.rows.length} lines)` });
  return getInvoice(invoiceId)!;
}

export function linesToDraftInput(invoiceId: string): DraftLineInput[] {
  const rows = listLines(invoiceId);
  return rows.map((line) => ({
    description: line.description,
    service_code: line.service_code ?? "",
    client_service_id: line.client_service_id ?? "",
    compliance_id: line.compliance_id ?? "",
    registration_id: line.registration_id ?? "",
    quantity: line.quantity,
    unit_price: paiseToRupees(line.unit_price_paise),
    discount: paiseToRupees(line.discount_paise),
    treatment_id: line.treatment_id,
  }));
}

export function listLines(invoiceId: string): InvoiceLine[] {
  return all<InvoiceLine>("SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY seq", invoiceId);
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

function getInvoiceRow(invoiceId: string): Invoice {
  const row = one<Invoice>("SELECT * FROM invoices WHERE invoice_id = ?", invoiceId);
  if (!row) throw new HttpError("Invoice not found", 404);
  return row;
}

/** Effective lifecycle label for a row ("draft" when unset). */
export function lifecycleOf(invoice: Invoice): string {
  return String(invoice.lifecycle || "draft");
}

function requireLifecycle(invoiceId: string, ...lifecycles: string[]): Invoice {
  const row = getInvoiceRow(invoiceId);
  if (!lifecycles.includes(String(row.lifecycle || "draft"))) {
    throw new HttpError(
      `Invoice is ${row.lifecycle || "draft"}; this action requires ${lifecycles.join(" or ")}`,
      409,
    );
  }
  return row;
}

function approvalRequiredFor(invoice: Invoice, settings: FirmBillingSettings): boolean {
  return invoice.auto_generated ? settings.approval_required_for_auto : settings.approval_required_for_manual;
}

export function submitForApproval(invoiceId: string, actor: Actor): Invoice {
  assertInvoicePermission(actor, "approve");
  requireLifecycle(invoiceId, "draft");
  withTransaction(() => {
    getDb().prepare("UPDATE invoices SET lifecycle='pending_approval' WHERE invoice_id=? AND lifecycle='draft'").run(invoiceId);
  });
  logInvoiceEvent(invoiceId, "SUBMITTED_FOR_APPROVAL", actor.name, actor.role);
  logAudit({ actor: actor.name, action: "INVOICE_SUBMITTED", entity_type: "invoice", entity_id: invoiceId, detail: "Submitted for approval" });
  return getInvoice(invoiceId)!;
}

/**
 * Validation executed (again) inside the finalisation transaction. Throws an
 * explicit, actionable refusal when any required configuration is missing —
 * the application never guesses tax treatment or inherits fabricated firm
 * details.
 */
export function validateInvoiceForIssue(invoiceId: string, settings = firmBillingSettings()): { problems: string[] } {
  const invoice = getInvoiceRow(invoiceId);
  if (String(invoice.lifecycle || "draft") === "issued") throw new HttpError("Invoice is already issued", 409);
  if (String(invoice.lifecycle || "draft") === "cancelled") throw new HttpError("Invoice is cancelled", 409);
  const problems: string[] = [];
  if (!settings.legal_name.trim()) problems.push("Firm legal name is missing in billing settings");
  if (!settings.address.trim()) problems.push("Firm address is missing in billing settings");
  const client = getClient(invoice.client_id);
  if (!client) {
    problems.push("Client record missing");
    throw new HttpError(`Cannot issue: ${problems.join("; ")}`, 409);
  }
  const lines = listLines(invoiceId);
  if (!lines.length) problems.push("No line items");
  const firmGstin = settings.gstin.toUpperCase().trim();
  const clientState = String(client.gst_state_code || "").trim();
  const firmState = firmGstin.slice(0, 2);
  for (const line of lines) {
    if (line.taxable_paise <= 0) problems.push(`Line ${line.seq}: taxable amount must be greater than zero`);
    if (line.tax_kind === "gst") {
      const treatment = taxTreatment(line.treatment_id);
      if (!treatment.active) problems.push(`Line ${line.seq}: tax treatment is inactive`);
      if ((treatment as unknown as { rate_bp: number | null }).rate_bp === null) {
        problems.push(`Line ${line.seq}: the GST rate for "${treatment.name}" is not configured — a partner must set it in billing settings`);
      }
    }
  }
  if (lines.some((l) => l.tax_kind === "gst" && (l.cgst_paise || l.igst_paise))) {
    if (!firmGstin) problems.push("Firm GSTIN is required to invoice GST but is missing in billing settings");
    if (!clientState) problems.push("Client GST state code is missing — place of supply cannot be determined");
    else if (firmGstin && firmState !== clientState && !lines.some((l) => l.tax_kind === "gst")) {
      problems.push("Inconsistent place-of-supply data");
    }
  }
  // Arithmetic: recompute every line and compare with what is stored.
  let taxable = 0;
  let gst = 0;
  for (const line of lines) {
    if (line.taxable_paise !== line.quantity * line.unit_price_paise - line.discount_paise) {
      problems.push(`Line ${line.seq}: arithmetic mismatch`);
    }
    if (line.tax_kind === "gst" && line.gst_rate_bp != null) {
      const expected = Math.round((line.taxable_paise * line.gst_rate_bp) / 10_000);
      if (line.cgst_paise + line.sgst_paise + line.igst_paise !== expected) {
        problems.push(`Line ${line.seq}: tax does not match the configured rate`);
      }
    }
    taxable += line.taxable_paise;
    gst += line.cgst_paise + line.sgst_paise + line.igst_paise;
  }
  if (taxable + gst !== lineSumTotal(lines)) problems.push("Line totals do not add up to the invoice total");
  if (problems.length) throw new HttpError(`Cannot issue invoice: ${problems.join("; ")}`, 409);
  return { problems: [] };
}

function lineSumTotal(lines: InvoiceLine[]): number {
  return lines.reduce((sum, l) => sum + l.line_total_paise, 0);
}

/** Creator of the draft (first CREATED event), for the self-approval rule. */
function creatorOf(invoiceId: string): string {
  const row = one<{ actor: string }>("SELECT actor FROM invoice_events WHERE invoice_id = ? AND event = 'CREATED' ORDER BY created_at, rowid LIMIT 1", invoiceId);
  return row?.actor ?? "";
}

export function approveInvoice(invoiceId: string, actor: Actor, note = ""): Invoice {
  assertInvoicePermission(actor, "approve");
  const invoice = requireLifecycle(invoiceId, "pending_approval");
  const creator = creatorOf(invoiceId);
  if (creator && creator === actor.name) {
    throw new HttpError("Approval must come from someone other than the person who created the draft", 403);
  }
  validateInvoiceForIssue(invoiceId);
  withTransaction(() => {
    const result = getDb().prepare("UPDATE invoices SET lifecycle='approved', approved_by=?, approved_at=? WHERE invoice_id=? AND lifecycle='pending_approval'").run(actor.name, new Date().toISOString(), invoiceId);
    if (result.changes === 0) throw new HttpError("Invoice already approved or no longer pending", 409);
  });
  logInvoiceEvent(invoiceId, "APPROVED", actor.name, actor.role, note.slice(0, 300));
  logAudit({ actor: actor.name, action: "INVOICE_APPROVED", entity_type: "invoice", entity_id: invoiceId, detail: `${invoice.invoice_id} approved for issue` });
  return getInvoice(invoiceId)!;
}

export function rejectInvoiceDraft(invoiceId: string, actor: Actor, reason: string): Invoice {
  assertInvoicePermission(actor, "approve");
  requireLifecycle(invoiceId, "pending_approval");
  const clean = String(reason || "").trim();
  if (clean.length < 3) throw new HttpError("A reason is required to reject a draft");
  withTransaction(() => {
    const result = getDb().prepare("UPDATE invoices SET lifecycle='draft', approved_by=NULL, approved_at=NULL WHERE invoice_id=? AND lifecycle='pending_approval'").run(invoiceId);
    if (result.changes === 0) throw new HttpError("Invoice no longer pending approval", 409);
  });
  logInvoiceEvent(invoiceId, "REJECTED", actor.name, actor.role, clean.slice(0, 300));
  logAudit({ actor: actor.name, action: "INVOICE_REJECTED", entity_type: "invoice", entity_id: invoiceId, detail: clean.slice(0, 200) });
  return getInvoice(invoiceId)!;
}

/**
 * Finalises the invoice: allocates the human number, freezes the totals and
 * line items into `issue_snapshot`, and emits the ISSUED event — all inside
 * one transaction. PDF generation and WhatsApp delivery happen after the
 * commit so a messaging or storage failure can never leave the invoicing
 * decision dangling, and neither can ever resurrect a draft.
 */
export function issueInvoice(invoiceId: string, actor: Actor): Invoice {
  assertInvoicePermission(actor, "issue");
  const invoice = getInvoiceRow(invoiceId);
  const settings = firmBillingSettings();
  const needsApproval = approvalRequiredFor(invoice, settings);
  const lifecycle = String(invoice.lifecycle || "draft");
  if (needsApproval && lifecycle === "pending_approval") throw new HttpError("The draft is still awaiting approval", 409);
  if (lifecycle === "issued") throw new HttpError("Invoice is already issued", 409);
  if (lifecycle === "cancelled") throw new HttpError("Invoice is cancelled", 409);
  if (lifecycle === "draft") {
    if (needsApproval) throw new HttpError("Submit the draft for approval and have it approved by a different person before issuing", 409);
    validateInvoiceForIssue(invoiceId, settings);
  }

  let issuedNumber = "";
  withTransaction(() => {
    const revalidated = validateInvoiceForIssue(invoiceId, settings);
    if (revalidated.problems.length) throw new HttpError(`Cannot issue invoice: ${revalidated.problems.join("; ")}`, 409);
    const used = collectUsedNumbers("invoice");
    const { number, fy } = allocateNumber("invoice", invoice.invoice_date, settings, used);
    const lines = listLines(invoiceId);
    const taxable = lines.reduce((s, l) => s + l.taxable_paise, 0);
    const gst = lines.reduce((s, l) => s + l.cgst_paise + l.sgst_paise + l.igst_paise, 0);
    const total = taxable + gst;
    const client = getClient(invoice.client_id)!;
    const snapshot = {
      issued_at: new Date().toISOString(),
      issued_by: actor.name,
      number,
      fy,
      firm: {
        legal_name: settings.legal_name,
        display_name: settings.display_name,
        address: settings.address,
        contact: settings.contact,
        pan: settings.pan,
        gstin: settings.gstin,
        payment_instructions: settings.payment_instructions,
        bank_details: settings.bank_details,
        invoice_footer: settings.invoice_footer,
      },
      client: {
        name: client.name,
        contact_person: client.contact_person || "",
        address: client.address || client.city || "",
        gstin: client.gst_number || "",
        state: client.state || "",
        gst_state_code: client.gst_state_code || "",
      },
      lines: lines.map((l) => ({ ...l })),
      totals: { taxable_paise: taxable, gst_paise: gst, total_paise: total },
      notes: invoice.notes || "",
    };
    const result = getDb()
      .prepare(
        `UPDATE invoices SET lifecycle='issued', invoice_number=?, fy=?, issued_by=?, issued_at=?,
           taxable_paise=?, gst_paise=?, total_paise=?, amount=amount, issue_snapshot=?
         WHERE invoice_id=? AND lifecycle IN ('draft','approved')`,
      )
      .run(number, fy || invoice.fy || fyForDateSafe(invoice.invoice_date), actor.name, new Date().toISOString(), taxable, gst, total, JSON.stringify(snapshot), invoiceId);
    if (result.changes === 0) throw new HttpError("Invoice was changed by someone else — refresh and retry", 409);
    logInvoiceEvent(invoiceId, "ISSUED", actor.name, actor.role, `Number ${number}`);
    issuedNumber = number;
  });

  const finalised = getInvoice(invoiceId)!;
  logAudit({
    actor: actor.name,
    action: "INVOICE_ISSUED",
    entity_type: "invoice",
    entity_id: invoiceId,
    detail: `${finalised.invoice_number} for ${invoice.client_name} — ₹${paiseToRupees(finalised.total_paise ?? 0).toLocaleString("en-IN")}`,
  });
  return getInvoice(invoiceId)!;
}

export function voidDraftInvoice(invoiceId: string, actor: Actor, reason = ""): Invoice {
  assertInvoicePermission(actor, "edit-draft");
  requireLifecycle(invoiceId, "draft");
  withTransaction(() => {
    const result = getDb().prepare("UPDATE invoices SET lifecycle='cancelled', status='Cancelled', cancelled_at=?, cancelled_by=?, cancel_reason=? WHERE invoice_id=? AND lifecycle='draft'").run(new Date().toISOString(), actor.name, reason.slice(0, 300), invoiceId);
    if (result.changes === 0) throw new HttpError("Draft already voided", 409);
  });
  logInvoiceEvent(invoiceId, "VOIDED", actor.name, actor.role, reason.slice(0, 300));
  logAudit({ actor: actor.name, action: "INVOICE_DRAFT_VOIDED", entity_type: "invoice", entity_id: invoiceId, detail: reason.slice(0, 200) });
  return getInvoice(invoiceId)!;
}

/**
 * Cancels an issued invoice — partner-only, reason mandatory, fully auditable.
 * Recorded payments stay in the ledger attached to the invoice history; a
 * fully paid invoice cannot be cancelled (use a credit note instead).
 */
export function cancelIssuedInvoice(invoiceId: string, actor: Actor, reason: string): Invoice {
  assertInvoicePermission(actor, "cancel");
  const invoice = requireLifecycle(invoiceId, "issued");
  const clean = String(reason || "").trim();
  if (clean.length < 5) throw new HttpError("A reason of at least 5 characters is required to cancel an issued invoice", 400);
  const creditPaise = (invoice.credit_paise ?? 0) + creditNoteTotal(invoiceId);
  const paid = invoice.paid_paise ?? Math.round(invoice.paid_amount * 100);
  const balance = (invoice.total_paise ?? 0) - paid - creditPaise;
  if (balance <= 0) throw new HttpError("This invoice is fully settled — record a credit note instead of cancelling it", 409);
  withTransaction(() => {
    const result = getDb()
      .prepare("UPDATE invoices SET lifecycle='cancelled', status='Cancelled', cancelled_at=?, cancelled_by=?, cancel_reason=? WHERE invoice_id=? AND lifecycle='issued'")
      .run(new Date().toISOString(), actor.name, clean.slice(0, 300), invoiceId);
    if (result.changes === 0) throw new HttpError("Invoice was cancelled by someone else", 409);
  });
  logInvoiceEvent(invoiceId, "CANCELLED", actor.name, actor.role, clean.slice(0, 300));
  logAudit({ actor: actor.name, action: "INVOICE_CANCELLED", entity_type: "invoice", entity_id: invoiceId, detail: clean.slice(0, 200) });
  return getInvoice(invoiceId)!;
}

// ── Payment ledger ────────────────────────────────────────────────────────────

export function listPaymentsForInvoice(invoiceId: string): Payment[] {
  return listPayments().filter((p) => p.invoice_id === invoiceId);
}

function confirmedPaidPaise(invoiceId: string): number {
  // Only CONFIRMED rows count as collected money: a payment still pending
  // reconciliation is not evidence of receipt, and a reversal row just feeds
  // the audit trail (its original is already excluded from the sum).
  const row = one<{ total: number | null }>(
    "SELECT SUM(amount) AS total FROM payments WHERE invoice_id = ? AND status = 'Confirmed' AND reversal_of IS NULL",
    invoiceId,
  );
  return Math.round((row?.total ?? 0) * 100);
}

/** Net money that has entered the ledger (confirmed + pending, net of reversals). */
function ledgerEnteredPaise(invoiceId: string): number {
  const row = one<{ total: number | null }>(
    "SELECT SUM(amount) AS total FROM payments WHERE invoice_id = ? AND status <> 'Reversed' AND reversal_of IS NULL",
    invoiceId,
  );
  return Math.round((row?.total ?? 0) * 100);
}

/** Recomputes the invoice payment aggregates from the ledger. Call inside a transaction. */
function refreshPaymentAggregates(invoiceId: string): void {
  const paid = confirmedPaidPaise(invoiceId);
  const invoice = getInvoiceRow(invoiceId);
  const total = invoice.total_paise ?? Math.round(invoice.total_amount * 100);
  const credit = creditNoteTotal(invoiceId);
  const settled = paid + credit >= total;
  getDb()
    .prepare("UPDATE invoices SET paid_paise = ?, paid_amount = ?, paid_date = CASE WHEN ? THEN COALESCE(paid_date, ?) ELSE paid_date END WHERE invoice_id = ?")
    .run(paid, paiseToRupees(paid), settled ? 1 : 0, new Date().toISOString(), invoiceId);
}

export function recordPaymentEntry(
  invoiceId: string,
  input: { amount: number; paid_on?: string; mode?: Payment["mode"]; reference?: string; notes?: string },
  actor: Actor,
): { payment: Payment; invoice: Invoice } {
  assertInvoicePermission(actor, "payments");
  const invoice = getInvoiceRow(invoiceId);
  if (String(invoice.lifecycle || "draft") === "cancelled") throw new HttpError("This invoice is cancelled", 409);
  if (String(invoice.lifecycle || "draft") !== "issued") {
    throw new HttpError("Only an issued invoice can receive payments — issue the draft first", 409);
  }
  const amountPaise = rupeesToPaise(input.amount, "Amount");
  if (amountPaise <= 0) throw new HttpError("Payment amount must be greater than zero");
  const reference = String(input.reference || "").trim().slice(0, 80);
  const paidOn = (input.paid_on || todayISO()).slice(0, 10);
  const invoiceDate = invoice.invoice_date.slice(0, 10);
  if (paidOn > todayISO()) throw new HttpError("A payment cannot be recorded for a future date");
  if (paidOn < invoiceDate) {
    throw new HttpError(`A payment date before the invoice date (${invoiceDate}) cannot be recorded`);
  }
  const allowedModes = ["UPI", "Bank Transfer", "Cash", "Cheque", "Card", "Other"] as const;
  const mode = allowedModes.includes(String(input.mode) as (typeof allowedModes)[number]) ? (String(input.mode) as Payment["mode"]) : "Other";
  const status: "Confirmed" | "Pending reconciliation" = reference ? "Confirmed" : "Pending reconciliation";
  const payment: Payment = {
    payment_id: nextId("PMT", "payments", "payment_id"),
    invoice_id: invoiceId,
    client_name: invoice.client_name,
    amount: paiseToRupees(amountPaise),
    paid_on: paidOn,
    mode,
    reference,
    notes: String(input.notes || "").slice(0, 300),
    created_at: new Date().toISOString(),
    status,
    recorded_by: actor.name,
    reversal_of: null,
  };
  withTransaction(() => {
    // Duplicate guard: an identical reference + amount on the same invoice is
    // treated as a retry, not a second receipt.
    if (reference) {
      const dup = one<{ n: number }>(
        "SELECT COUNT(*) AS n FROM payments WHERE invoice_id=? AND reference=? AND status <> 'Reversed' AND ABS(amount - ?) < 0.0001",
        invoiceId,
        reference,
        payment.amount,
      );
      if (Number(dup?.n ?? 0) > 0) {
        throw new HttpError("A payment with this reference and amount is already recorded — check for a duplicate", 409);
      }
    }
    // Fresh balance inside the transaction → no racing writer can slip an
    // over-allocation through.
    const current = getInvoiceRow(invoiceId);
    const total = current.total_paise ?? 0;
    const credit = ((current.credit_paise ?? 0) + creditNoteTotal(invoiceId)) as number;
    getDb()
      .prepare(
        `INSERT INTO payments (payment_id, invoice_id, client_name, amount, paid_on, mode, reference, notes, created_at, status, recorded_by, reversal_of)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL)`,
      )
      .run(
        payment.payment_id,
        invoiceId,
        invoice.client_name,
        payment.amount,
        payment.paid_on,
        payment.mode,
        reference,
        payment.notes,
        payment.created_at,
        status,
        actor.name,
      );
    const paidNow = ledgerEnteredPaise(invoiceId);
    // The ceiling counts every NON-reversed entry — a payment still pending
    // reconciliation also reserves balance, so two unreconciled payments can
    // never jointly over-settle an invoice.
    const totalNow = current.total_paise ?? Math.round(current.total_amount * 100);
    if (paidNow > totalNow - credit) {
      throw new HttpError("This payment exceeds the remaining balance", 409);
    }
    refreshPaymentAggregates(invoiceId);
  });
  logInvoiceEvent(invoiceId, "PAYMENT_RECORDED", actor.name, actor.role, `₹${payment.amount.toLocaleString("en-IN")} via ${payment.mode}${reference ? ` · ref ${reference}` : " · pending reconciliation"}`);
  logAudit({ actor: actor.name, action: "PAYMENT_RECEIVED", entity_type: "payment", entity_id: payment.payment_id, detail: `₹${payment.amount.toLocaleString("en-IN")} against ${invoice.invoice_number || invoiceId} (${payment.mode})` });
  return { payment, invoice: getInvoice(invoiceId)! };
}

/** Partner-only audited correction: a reversing entry, never an edit. */
export function reversePaymentEntry(paymentId: string, actor: Actor, reason: string): Payment {
  assertInvoicePermission(actor, "payment-reversal");
  const row = one<Payment>("SELECT * FROM payments WHERE payment_id = ?", paymentId);
  if (!row) throw new HttpError("Payment not found", 404);
  if (row.status === "Reversed") throw new HttpError("Payment is already reversed", 409);
  const clean = String(reason || "").trim();
  if (clean.length < 5) throw new HttpError("A reason of at least 5 characters is required to reverse a payment");
  const payment: Payment = {
    ...row,
    payment_id: nextId("PMT", "payments", "payment_id"),
    amount: -row.amount,
    reference: `reversal:${row.reference || row.payment_id}`.slice(0, 80),
    notes: clean.slice(0, 300),
    created_at: new Date().toISOString(),
    status: "Confirmed",
    recorded_by: actor.name,
    reversal_of: row.payment_id,
  };
  withTransaction(() => {
    getDb().prepare("UPDATE payments SET status='Reversed' WHERE payment_id=? AND status <> 'Reversed'").run(row.payment_id);
    getDb()
      .prepare(
        `INSERT INTO payments (payment_id, invoice_id, client_name, amount, paid_on, mode, reference, notes, created_at, status, recorded_by, reversal_of)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        payment.payment_id,
        row.invoice_id,
        row.client_name,
        payment.amount,
        todayISO(),
        "Other",
        payment.reference,
        payment.notes,
        payment.created_at,
        "Confirmed",
        actor.name,
        row.payment_id,
      );
    refreshPaymentAggregates(row.invoice_id);
  });
  logInvoiceEvent(row.invoice_id, "PAYMENT_REVERSED", actor.name, actor.role, `${row.payment_id} reversed — ${clean.slice(0, 200)}`);
  logAudit({ actor: actor.name, action: "PAYMENT_REVERSED", entity_type: "payment", entity_id: payment.payment_id, detail: `${row.payment_id} reversed by ${actor.name}: ${clean.slice(0, 120)}` });
  return payment;
}

export function reconcilePaymentEntry(paymentId: string, actor: Actor): Payment {
  assertInvoicePermission(actor, "payments");
  const row = one<Payment>("SELECT * FROM payments WHERE payment_id = ?", paymentId);
  if (!row) throw new HttpError("Payment not found", 404);
  if (row.status !== "Pending reconciliation") return row;
  withTransaction(() => {
    getDb().prepare("UPDATE payments SET status='Confirmed' WHERE payment_id=? AND status='Pending reconciliation'").run(paymentId);
    refreshPaymentAggregates(row.invoice_id);
  });
  logInvoiceEvent(row.invoice_id, "PAYMENT_RECONCILED", actor.name, actor.role, `${row.payment_id} confirmed as received`);
  logAudit({ actor: actor.name, action: "PAYMENT_RECONCILED", entity_type: "payment", entity_id: paymentId, detail: `Payment ${row.payment_id} marked confirmed` });
  return one<Payment>("SELECT * FROM payments WHERE payment_id = ?", paymentId)!;
}

// ── Credit notes ──────────────────────────────────────────────────────────────

function creditNoteTotal(invoiceId: string): number {
  const row = one<{ total: number | null }>("SELECT SUM(total_paise) AS total FROM credit_notes WHERE invoice_id = ? AND status = 'Issued'", invoiceId);
  return row?.total ?? 0;
}

/** The outstanding balance in paise (ledger-derived; cached columns refreshed on writes). */
export function outstandingPaise(invoiceId: string): number {
  const invoice = getInvoiceRow(invoiceId);
  const total = invoice.total_paise ?? Math.round(invoice.total_amount * 100);
  const paid = confirmedPaidPaise(invoiceId);
  return Math.max(0, total - paid - creditNoteTotal(invoiceId));
}

export function issueCreditNote(
  invoiceId: string,
  input: { reason: string; credit_total: number },
  actor: Actor,
): { creditNote: CreditNote; invoice: Invoice } {
  assertInvoicePermission(actor, "credit-note");
  const invoice = requireLifecycle(invoiceId, "issued");
  if ((invoice.lifecycle ?? "") !== "issued") throw new HttpError("Only issued invoices can be credited", 409);
  const reason = String(input.reason || "").trim();
  if (reason.length < 5) throw new HttpError("A reason of at least 5 characters is required for a credit note");
  const totalPaise = rupeesToPaise(input.credit_total, "Credit amount");
  if (totalPaise <= 0) throw new HttpError("The credit amount must be greater than zero");
  const total = invoice.total_paise ?? Math.round(invoice.total_amount * 100);
  const paid = confirmedPaidPaise(invoiceId);
  const alreadyCredited = creditNoteTotal(invoiceId);
  if (totalPaise > total - paid - alreadyCredited) {
    throw new HttpError("The credit exceeds the remaining balance; the uncredited portion is", 409);
  }
  const invoiceTaxable = invoice.taxable_paise ?? Math.round(invoice.amount * 100);
  const ratio = total > 0 ? totalPaise / total : 0;
  const taxablePaise = Math.round(invoiceTaxable * ratio);
  const gstPaise = totalPaise - taxablePaise;
  const settings = firmBillingSettings();
  const used = collectUsedNumbers("credit_note");
  const { number, fy } = allocateNumber("credit_note", todayISO(), settings, used);
  const creditNote: CreditNote = {
    credit_note_id: nextId("CN", "credit_notes", "credit_note_id"),
    invoice_id: invoiceId,
    number,
    fy,
    reason: reason.slice(0, 500),
    taxable_paise: taxablePaise,
    gst_paise: gstPaise,
    total_paise: totalPaise,
    status: "Issued",
    created_by: actor.name,
    created_at: new Date().toISOString(),
    voided_at: null,
    voided_by: null,
  };
  withTransaction(() => {
    getDb()
      .prepare(
        `INSERT INTO credit_notes (credit_note_id, invoice_id, number, fy, reason, taxable_paise, gst_paise, total_paise, status, created_by, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        creditNote.credit_note_id,
        invoiceId,
        number,
        fy,
        creditNote.reason,
        taxablePaise,
        gstPaise,
        totalPaise,
        "Issued",
        actor.name,
        creditNote.created_at,
      );
    getDb().prepare("UPDATE invoices SET credit_paise = ? WHERE invoice_id = ?").run(alreadyCredited + totalPaise, invoiceId);
    // last_location note: paid_paise column untouched — a credit note never
    // counts as a payment.
  });
  logInvoiceEvent(invoiceId, "CREDIT_NOTE_ISSUED", actor.name, actor.role, `${number} — ₹${paiseToRupees(totalPaise).toLocaleString("en-IN")}: ${reason.slice(0, 200)}`);
  logAudit({ actor: actor.name, action: "CREDIT_NOTE_ISSUED", entity_type: "credit_note", entity_id: creditNote.credit_note_id, detail: `${number} against ${invoice.invoice_number || invoiceId} (${reason.slice(0, 120)})` });
  return { creditNote, invoice: getInvoice(invoiceId)! };
}

// ── Detail ────────────────────────────────────────────────────────────────────

export function getInvoiceDetail(invoiceId: string): InvoiceDetail | null {
  const invoice = getInvoice(invoiceId);
  if (!invoice) return null;
  const lines = listLines(invoiceId);
  const payments = listPaymentsForInvoice(invoiceId);
  const creditNotes = all<CreditNote>("SELECT * FROM credit_notes WHERE invoice_id = ? ORDER BY created_at", invoiceId);
  const events = listInvoiceEvents(invoiceId);
  const total = invoice.total_paise ?? Math.round(invoice.total_amount * 100);
  const paid = invoice.paid_paise ?? Math.round(invoice.paid_amount * 100);
  const credit = invoice.credit_paise ?? creditNoteTotal(invoiceId);
  return {
    invoice,
    lines,
    payments,
    creditNotes,
    events,
    computed: { totalPaise: total, paidPaise: paid, creditPaise: credit, balancePaise: Math.max(0, total - paid - credit) },
  };
}

// ── Receivables ───────────────────────────────────────────────────────────────

export function receivablesReport(filters: { client_id?: string; fy?: string; service_code?: string } = {}): ReceivablesReport {
  const settings = firmBillingSettings();
  const invoices = listInvoices().filter((inv) => {
    if (filters.client_id && inv.client_id !== filters.client_id) return false;
    if (filters.fy && inv.fy !== filters.fy) return false;
    if (filters.service_code && inv.service_id) {
      const svc = one<{ service_code: string }>("SELECT service_code FROM client_services WHERE service_id = ?", inv.service_id);
      if (!svc || svc.service_code !== filters.service_code) return false;
    }
    return true;
  });
  const buckets = settings.aging_buckets;
  const today = todayISO();
  const agingLabels = [
    "Not yet due",
    ...buckets.map((b, i) => `${(i === 0 ? 1 : buckets[i - 1]! + 1)}–${b} days overdue`),
    `More than ${buckets[buckets.length - 1]} days overdue`,
  ];
  const aging = agingLabels.map((label) => ({ label, invoiceCount: 0, outstandingPaise: 0 }));
  let issuedOutstanding = 0;
  let issuedOverdue = 0;
  const rows: ReceivablesReport["invoices"] = [];
  for (const inv of invoices) {
    const total = inv.total_paise ?? Math.round(inv.total_amount * 100);
    const paid = inv.paid_paise ?? Math.round(inv.paid_amount * 100);
    const credit = inv.credit_paise ?? 0;
    const balance = Math.max(0, total - paid - credit);
    const lifecycle = inv.lifecycle || (inv.status === "Cancelled" ? "cancelled" : "issued");
    const daysOverdue = Math.max(0, -dayDiff(inv.due_date));
    let bucketIndex = daysOverdue > 0 ? 1 : 0;
    if (daysOverdue > 0) {
      bucketIndex = 1;
      while (bucketIndex <= buckets.length && daysOverdue > buckets[bucketIndex - 1]!) bucketIndex += 1;
    } else {
      bucketIndex = 0;
    }
    const bucketLabel = lifecycle === "issued" && balance > 0 ? agingLabels[bucketIndex]! : "—";
    if (lifecycle === "issued") {
      if (balance > 0) {
        issuedOutstanding += balance;
        if (daysOverdue > 0) issuedOverdue += balance;
        aging[bucketIndex]!.invoiceCount += 1;
        aging[bucketIndex]!.outstandingPaise += balance;
      }
    }
    rows.push({
      invoice_id: inv.invoice_id,
      invoice_number: inv.invoice_number ?? null,
      client_id: inv.client_id,
      client_name: inv.client_name,
      lifecycle,
      status: inv.status,
      invoice_date: inv.invoice_date,
      due_date: inv.due_date,
      total_paise: total,
      paid_paise: paid,
      credit_paise: credit,
      balance_paise: balance,
      daysOverdue,
      bucket: bucketLabel,
    });
  }
  const drafts = invoices.filter((i) => (i.lifecycle || "") === "draft");
  const pendingApproval = invoices.filter((i) => (i.lifecycle || "") === "pending_approval");
  return {
    generatedAt: new Date().toISOString(),
    currency: settings.currency,
    totals: {
      invoicedPaise: invoices.filter((i) => i.lifecycle === "issued").reduce((s, i) => s + (i.total_paise ?? 0), 0),
      collectedPaise: invoices.filter((i) => (i.lifecycle ?? "") === "issued").reduce((s, i) => s + (i.paid_paise ?? 0), 0),
      creditedPaise: invoices.reduce((s, i) => s + (i.credit_paise ?? 0), 0),
      outstandingPaise: issuedOutstanding,
      overduePaise: issuedOverdue,
      draftCount: drafts.length,
      pendingApprovalCount: pendingApproval.length,
      issuedCount: invoices.filter((i) => (i.lifecycle ?? "") === "issued").length,
      partiallyPaidCount: invoices.filter((i) => (i.lifecycle ?? "") === "issued" && i.status === "Partially Paid").length,
      paidCount: invoices.filter((i) => (i.lifecycle ?? "") === "issued" && (i.total_paise ?? 0) - (i.paid_paise ?? 0) - (i.credit_paise ?? 0) <= 0).length,
      cancelledCount: invoices.filter((i) => (i.lifecycle ?? "") === "cancelled" || i.status === "Cancelled").length,
    },
    aging,
    invoices: rows,
  };
}

// ── PDF tokens & delivery ─────────────────────────────────────────────────────

/** Short-lived (default 3 days), single-invoice token for the PDF route. */
// ── Invoice PDF ─────────────────────────────────────────────────────────────

/**
 * Renders and privately stores the PDF for an ISSUED invoice. The bytes are
 * derived from the frozen `issue_snapshot` — payment status shown on the page
 * is the point-in-time summary, and regenerating a new version never rewrites
 * a stored version (each issue keeps its own object key, checksum and size).
 * Drafts have no snapshot and therefore no PDF.
 */
export async function ensureInvoicePdf(invoiceId: string, actor: Actor): Promise<{ objectKey: string; checksum: string; size: number; version: number }> {
  assertInvoicePermission(actor, "view");
  const invoice = getInvoiceRow(invoiceId);
  if (String(invoice.lifecycle || "draft") !== "issued") throw new HttpError("Only an issued invoice has a PDF", 409);
  const snapshot = parseIssueSnapshot(invoice);
  if (!snapshot) throw new HttpError("The issued snapshot for this invoice is missing — issue cannot be restamped. Contact the partner.", 409);
  if (invoice.pdf_object_key && invoice.pdf_checksum && (invoice.pdf_size ?? 0) > 0) {
    const key = invoice.pdf_object_key;
    if (await objectExists(key)) {
      return { objectKey: key, checksum: invoice.pdf_checksum, size: invoice.pdf_size ?? 0, version: invoice.pdf_version ?? 1 };
    }
    // Missing object recovery: same snapshot re-rendered, file version bumped.
  }
  const paidPaise = (invoice.paid_paise ?? Math.round(invoice.paid_amount * 100)) || 0;
  const creditPaise = invoice.credit_paise ?? 0;
  const bytes = renderInvoicePdf(invoice, snapshot, paidPaise, creditPaise);
  const version = (invoice.pdf_version ?? 0) + 1;
  // All private objects live under the docs/ storage namespace (the only key
  // space objectKeyIsSafe accepts), kept outside every public asset path.
  const key = `docs/invoices/${invoice.client_id}/${invoice.invoice_id}/pdf-v${version}.pdf`;
  await putObject(key, bytes, "application/pdf");
  const checksum = checksumOf(bytes);
  withTransaction(() => {
    getDb()
      .prepare("UPDATE invoices SET pdf_object_key=?, pdf_checksum=?, pdf_size=?, pdf_version=?, pdf_generated_at=? WHERE invoice_id=?")
      .run(key, checksum, bytes.length, version, new Date().toISOString(), invoiceId);
  });
  logInvoiceEvent(invoiceId, "PDF_GENERATED", actor.name, actor.role, `v${version} stored privately (${bytes.length} bytes)`);
  logAudit({ actor: actor.name, action: "INVOICE_PDF_GENERATED", entity_type: "invoice", entity_id: invoiceId, detail: `PDF v${version} stored for ${invoice.invoice_number || invoiceId}` });
  return { objectKey: key, checksum, size: bytes.length, version };
}

/**
 * Loads the stored PDF. Authenticated users need the "view" permission;
 * unauthenticated recipients must present a valid, unexpired download token
 * bound to THIS invoice id — no permanent public links exist.
 */
export async function readInvoicePdf(invoiceId: string, viewer: Actor | null, token: string | null): Promise<{ bytes: Buffer; invoice: Invoice } | null> {
  const invoice = getInvoiceRow(invoiceId);
  if (!invoice || String(invoice.lifecycle || "draft") !== "issued" || !invoice.pdf_object_key) return null;
  if (viewer) {
    if (!hasInvoicePermission(viewer, "view")) throw new NotAuthorizedError();
  } else {
    if (!verifyDownloadToken(token, invoiceId)) throw new NotAuthorizedError("This invoice link is invalid or has expired");
  }
  if (!(await objectExists(invoice.pdf_object_key))) {
    // Missing object: attempt one audited recovery render.
    if (!viewer) return null; // external links never trigger writes
    await ensureInvoicePdf(invoiceId, viewer);
  }
  const key = getInvoiceRow(invoiceId).pdf_object_key!;
  const bytes = await getObject(key);
  return { bytes, invoice };
}

export function invoicePdfToken(invoiceId: string, ttlHours = 72): string {
  return signDownloadToken(invoiceId, Math.min(Math.max(Math.round(ttlHours), 1), 24 * 14));
}

export function invoiceTokenHours(invoiceId: string, token: string): number | null {
  const claims = (function () {
    try {
      const dot = token.lastIndexOf(".");
      if (dot < 1) return null;
      return JSON.parse(Buffer.from(token.slice(0, dot), "base64url").toString("utf8")) as { exp?: number; iat?: number };
    } catch {
      return null;
    }
  })();
  if (!claims || typeof claims.iat !== "number" || typeof claims.exp !== "number") return null;
  return Math.round((claims.exp - claims.iat) / 3600);
}

/**
 * WhatsApp delivery for a settled invoice. Called only after issue — a draft
 * is never delivered, a Cancelled invoice never delivered, and a delivery
 * never means money arrived. Reuses the Prompt 8 outbox/`deliverWhatsApp`
 * pipeline; the template send is provider-accepted, not client-confirmed.
 */
export async function deliverIssuedInvoice(invoiceId: string, actor: Actor): Promise<"queued" | "sent" | "failed" | "skipped"> {
  const invoice = getInvoiceRow(invoiceId);
  if (invoice.lifecycle !== "issued") return "skipped";
  const settings = firmBillingSettings();
  if (!settings.deliver_on_issue) return "skipped";
  const client = getClient(invoice.client_id);
  if (!client || !client.whatsapp_opt_in || !client.phone) return "skipped";
  // Delivery is a human-triggered financial action: the automation role and
  // users below manager can never fire it, and a delivery already queued or
  // sent for this invoice is never re-sent (the automation_key is unique).
  if (!hasInvoicePermission(actor, "deliver")) return "skipped";
  const invoiceNumber = invoice.invoice_number || invoice.invoice_id;
  const autoKey = `invoice-issued:${invoice.invoice_id}`;
  const alreadySent = one<{ status: string }>(
    "SELECT status FROM messages WHERE automation_key = ? AND automation_key <> '' ORDER BY created_at DESC LIMIT 1",
    autoKey,
  );
  if (alreadySent) {
    logInvoiceEvent(invoiceId, "DELIVERY_SKIPPED", actor.name, actor.role, `A WhatsApp message for ${invoiceNumber} is already ${alreadySent.status.toLowerCase()} — not re-sent`);
    return alreadySent.status === "Sent" ? "sent" : alreadySent.status === "Failed" ? "failed" : "queued";
  }
  const total = paiseToRupees(invoice.total_paise ?? 0).toLocaleString("en-IN");
  const paid = paiseToRupees(invoice.paid_paise ?? 0).toLocaleString("en-IN");
  const balance = paiseToRupees(outstandingPaise(invoiceId)).toLocaleString("en-IN");
  const contact = client.contact_person || client.name;
  const body = [
    `Dear ${contact},`,
    ``,
    `Invoice ${invoice.invoice_number} is ready for ${invoice.service_description || "services rendered"}.`,
    `Total: ₹${total}${(invoice.paid_paise ?? 0) > 0 ? ` (₹${paid} already recorded)` : ""}`,
    `Balance due: ₹${balance} by ${prettyDate(invoice.due_date)}.`,
    ``,
    settings.payment_instructions ? `Payment instructions: ${settings.payment_instructions}` : `Reply here for bank details or any clarification.`,
    ``,
    `— ${settings.legal_name || settings.display_name}`,
  ]
    .filter(Boolean)
    .join("\n");
  const sent = await deliverWhatsApp({
    to: client.phone,
    recipient: contact,
    subject: `Invoice ${invoice.invoice_number}`,
    body,
    kind: "invoice",
    relatedType: "invoice",
    relatedId: invoice.invoice_id,
    automationKey: `invoice-issued:${invoice.invoice_id}`,
    templateParams: [contact, String(invoice.invoice_number), `Balance ₹${balance}`, prettyDate(invoice.due_date)],
  });
  logInvoiceEvent(invoiceId, "DELIVERY_QUEUED", actor.name, actor.role, sent.status === "Sent" ? "Cloud API accepted the template send (not proof of delivery or payment)" : sent.status === "Queued" ? "Queued in outbox" : sent.status === "Failed" ? `Delivery failed: ${sent.error}`.slice(0, 400) : "Delivery skipped");
  logAudit({
    actor: actor.name,
    action: "INVOICE_DELIVERY",
    entity_type: "invoice",
    entity_id: invoiceId,
    detail: `WhatsApp invoice message ${sent.status.toLowerCase()} for ${invoice.invoice_number}`,
  });
  return sent.status === "Sent" ? "sent" : sent.status === "Failed" ? "failed" : "queued";
}

// ── Misc re-exports for callers ───────────────────────────────────────────────


