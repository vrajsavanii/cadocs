/**
 * Client onboarding and service configuration.
 *
 * This is the working layer between the client master (`lib/db.ts`), the
 * service catalogue (`lib/services.ts`) and the engagement engine
 * (`lib/engagements-db.ts`). It owns four things:
 *
 *   1. The structured client profile and its conditional validation.
 *   2. Registrations, because one client can hold several GSTINs.
 *   3. Service configuration: frequency, fees, registration, staff ownership.
 *   4. Controlled activation, which opens the first period exactly once.
 *
 * Rules that matter:
 *   - Validation is server-side and returns field/service-specific issues.
 *   - Activation is idempotent: the same request cannot create a second
 *     engagement or a second set of documents.
 *   - Onboarding never sends a WhatsApp message. It prepares documents and
 *     communication preferences for the later messaging phase.
 *   - This install is one firm. "Firm isolation" means the data directory is
 *     the boundary (see docs/architecture/CLIENT-AND-REGISTRATION-MODEL.md);
 *     within it every assignee must be a real active user.
 */
import { createHash } from "node:crypto";
import type {
  AssignmentHistory,
  AssignmentRole,
  Client,
  ClientRegistration,
  ClientService,
  OnboardingAssessment,
  OnboardingIssue,
  OnboardingTask,
  RegistrationKind,
  RegistrationStatus,
  ServiceReadiness,
} from "./types";
import {
  all,
  createClient,
  getClient,
  getDb,
  listClients,
  listUsers,
  logAudit,
  nextId,
  one,
  updateClient,
  withTransaction,
} from "./db";
import { decryptField, encryptField } from "./crypto";
import {
  SERVICES,
  addDaysISO,
  frequencyLabel,
  getService,
  inspectGstin,
  isValidPhone,
  normalisePhone,
  panEntityWarning,
  validateCin,
  validateEmail,
  validateGstin,
  validatePan,
  validateTan,
  type ServiceDef,
} from "./services";
import {
  createClientService,
  createCycleForService,
  getClientService,
  listClientServices,
  updateClientService,
  type CycleResult,
} from "./engagements-db";
import { todayISO } from "./format";

// ── Public vocabulary ────────────────────────────────────────────────────────

export const ENTITY_TYPES = [
  "Private Limited",
  "Public Limited",
  "LLP",
  "Proprietorship",
  "Partnership",
  "Trust",
  "HUF",
  "Individual",
  "Society",
  "Other",
] as const;

export type EntityType = (typeof ENTITY_TYPES)[number];
export const REGISTRATION_KINDS: RegistrationKind[] = ["GST", "TAN", "CIN", "PAN", "Other"];
export const REGISTRATION_STATUSES: RegistrationStatus[] = ["Active", "Suspended", "Cancelled", "Needs review"];
export const FEE_MODELS = ["fixed", "recurring", "per_period", "milestone", "one_time"] as const;
export const APPROVAL_STAGES = ["none", "review", "partner"] as const;
export const SERVICE_STATUSES = ["Draft", "Active", "Paused", "Completed", "Cancelled"] as const;

export type ProfileInput = {
  legal_name: string;
  name?: string;
  trade_name?: string;
  entity_type: string;
  pan: string;
  tan?: string;
  cin?: string;
  date_of_incorporation?: string;
  date_of_birth?: string;
  gst_number?: string;
  gst_registration_type?: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  contact_person?: string;
  primary_contact_designation?: string;
  phone: string;
  whatsapp_number?: string;
  email: string;
  billing_contact?: string;
  authorised_representative?: string;
  preferred_language?: string;
  preferred_channel?: "WhatsApp" | "Email" | "Phone";
  notes?: string;
  relationship_manager?: string;
  whatsapp_opt_in?: boolean;
  whatsapp_consent_source?: string;
  engagement_letter_status?: string;
  engagement_letter_date?: string;
  contact_verification_note?: string;
};

export type RegistrationInput = {
  kind: RegistrationKind | string;
  identifier: string;
  legal_name?: string;
  state?: string;
  state_code?: string;
  status?: RegistrationStatus | string;
  effective_from?: string;
  effective_to?: string;
  place_of_business?: string;
  filing_frequency?: string;
  is_primary?: boolean;
  verification_status?: string;
};

export type ServiceInput = {
  code: string;
  /** May be a stored registration id, or `new:<index>` inside a create request. */
  registration_id?: string;
  frequency?: string;
  fee?: number;
  billing_cycle?: string;
  auto_invoice?: boolean;
  owner?: string;
  reviewer?: string;
  manager?: string;
  partner?: string;
  start_date?: string;
  end_date?: string;
  fee_model?: string;
  setup_fee?: number;
  payment_terms_days?: number;
  fee_effective_from?: string;
  approval_stage?: string;
  reminder_cap?: number;
  reminder_gap_days?: number;
};

export type OnboardInput = ProfileInput & {
  services: ServiceInput[];
  registrations?: RegistrationInput[];
  actor: string;
};

/** A validation failure that carries every issue, not just the first. */
export class OnboardingError extends Error {
  issues: OnboardingIssue[];
  constructor(issues: OnboardingIssue[], message = "Onboarding validation failed") {
    super(issues.find((i) => i.severity === "error")?.message ?? message);
    this.name = "OnboardingError";
    this.issues = issues;
  }
}

// ── Identifier handling ──────────────────────────────────────────────────────

export function canViewFullIdentifier(role: string): boolean {
  return role === "partner";
}

export function canManageOnboarding(role: string): boolean {
  return role === "partner" || role === "manager";
}

/** Masks an identifier for lists and dashboards. Never logs the real value. */
export function maskIdentifier(kind: string, value: string): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  if (kind === "GST" && raw.length >= 10) return `${raw.slice(0, 2)}••••••${raw.slice(-4)}`;
  if (raw.length <= 4) return "••••";
  return `${raw.slice(0, 2)}••••${raw.slice(-2)}`;
}

export function maskClientForRole(client: Client, role: string): Client {
  if (canViewFullIdentifier(role)) return client;
  return {
    ...client,
    pan: client.pan ? maskIdentifier("PAN", client.pan) : "",
    gst_number: client.gst_number ? maskIdentifier("GST", client.gst_number) : "",
    tan: client.tan ? maskIdentifier("TAN", client.tan) : "",
    ...(role === "article" ? { notes: "" } : {}),
  };
}

function hashIdentifier(value: string): string {
  return createHash("sha256").update(value.trim().toUpperCase()).digest("hex");
}

function identifierForKind(kind: string, raw: string): string {
  const value = raw.trim();
  return kind === "Other" ? value : value.toUpperCase().replace(/\s/g, "");
}

function validDate(value: string): boolean {
  return !value || /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * Optional API fields arrive as "" rather than undefined. Treat empty strings
 * as absent so omitted owner/reviewer/frequency/fee-model fields still receive
 * the catalogue defaults instead of failing validation.
 */
function valueOr<T>(...candidates: Array<T | undefined | null | "">): T | undefined {
  for (const candidate of candidates) {
    if (candidate !== undefined && candidate !== null && candidate !== "") return candidate as T;
  }
  return undefined;
}

// ── Profile validation ───────────────────────────────────────────────────────

const COMPANY_ENTITIES = new Set(["Private Limited", "Public Limited", "LLP"]);
const INDIVIDUAL_ENTITIES = new Set(["Individual"]);

export function validateClientProfile(input: ProfileInput, existingClientId?: string): OnboardingIssue[] {
  const issues: OnboardingIssue[] = [];
  const add = (field: string, message: string, severity: OnboardingIssue["severity"] = "error") =>
    issues.push({ scope: "client", field, message, severity });

  if (!input.legal_name || input.legal_name.trim().length < 2) add("legal_name", "Legal name is required");
  if (!ENTITY_TYPES.includes(input.entity_type as EntityType)) add("entity_type", "Choose a supported entity type");
  if (!input.pan) add("pan", "PAN is required");
  else {
    const panError = validatePan(input.pan);
    if (panError) add("pan", panError);
    else if (input.entity_type) {
      const warning = panEntityWarning(input.pan, input.entity_type);
      if (warning) add("pan", warning, "warning");
    }
  }
  if (input.tan) {
    const tanError = validateTan(input.tan);
    if (tanError) add("tan", tanError);
  }
  if (input.cin) {
    const cinError = validateCin(input.cin);
    if (cinError) add("cin", cinError);
  }
  if (input.gst_number) {
    const gstError = validateGstin(input.gst_number);
    if (gstError) add("gst_number", gstError);
    else if (input.pan) {
      const info = inspectGstin(input.gst_number);
      if (info.pan && info.pan !== input.pan.toUpperCase()) add("gst_number", "GSTIN embeds a different PAN");
    }
  }
  if (!input.phone) add("phone", "Primary mobile number is required");
  else if (!isValidPhone(input.phone)) add("phone", "Enter a valid 10-digit Indian mobile number");
  if (input.whatsapp_number && !isValidPhone(input.whatsapp_number)) add("whatsapp_number", "Enter a valid WhatsApp number");
  if (!input.email) add("email", "Email address is required");
  else {
    const emailError = validateEmail(input.email);
    if (emailError) add("email", emailError);
  }
  if (input.pincode && !/^\d{6}$/.test(input.pincode)) add("pincode", "PIN code must be 6 digits");
  if (!input.address || input.address.trim().length < 5) {
    if (!INDIVIDUAL_ENTITIES.has(input.entity_type)) add("address", "Registered address is required");
    else add("address", "Address is recommended", "warning");
  }
  if (!input.city) add("city", "City is required");
  if (!input.state) add("state", "State is required");
  if (COMPANY_ENTITIES.has(input.entity_type) && !input.date_of_incorporation) {
    add("date_of_incorporation", "Incorporation date is required for this entity type");
  }
  if (INDIVIDUAL_ENTITIES.has(input.entity_type) && !input.date_of_birth) {
    add("date_of_birth", "Date of birth is required for an individual", "warning");
  }
  if (input.date_of_incorporation && !validDate(input.date_of_incorporation)) add("date_of_incorporation", "Use YYYY-MM-DD");
  if (input.date_of_birth && !validDate(input.date_of_birth)) add("date_of_birth", "Use YYYY-MM-DD");
  if (input.preferred_channel && !["WhatsApp", "Email", "Phone"].includes(input.preferred_channel)) {
    add("preferred_channel", "Choose WhatsApp, Email or Phone");
  }
  if (input.whatsapp_opt_in && !input.whatsapp_consent_source) {
    add("whatsapp_consent_source", "Record how WhatsApp consent was obtained", "warning");
  }

  // Duplicate client masters are a real operational hazard. PAN is encrypted
  // with a random IV, so compare decrypted values rather than querying SQL.
  if (input.pan) {
    const duplicate = listClients().find(
      (client) => client.client_id !== existingClientId && client.pan?.toUpperCase() === input.pan.toUpperCase(),
    );
    if (duplicate) add("pan", `PAN already belongs to ${duplicate.name} (${duplicate.client_id})`);
  }
  return issues;
}

// ── Registration storage ─────────────────────────────────────────────────────

type RegistrationRow = Omit<ClientRegistration, "identifier" | "identifier_masked"> & { identifier_enc: string };

function readRegistration(row: RegistrationRow, reveal: boolean): ClientRegistration {
  const identifier = decryptField(row.identifier_enc);
  return {
    registration_id: row.registration_id,
    client_id: row.client_id,
    kind: row.kind,
    identifier: reveal ? identifier : undefined,
    identifier_masked: maskIdentifier(row.kind, identifier),
    legal_name: row.legal_name ?? "",
    state: row.state ?? "",
    state_code: row.state_code ?? "",
    status: (row.status as RegistrationStatus) ?? "Active",
    effective_from: row.effective_from ?? "",
    effective_to: row.effective_to ?? "",
    place_of_business: row.place_of_business ?? "",
    filing_frequency: row.filing_frequency ?? "",
    is_primary: Boolean(row.is_primary),
    verification_status: (row.verification_status as ClientRegistration["verification_status"]) ?? "User entered",
    migration_note: row.migration_note ?? "",
    created_at: row.created_at,
    updated_at: row.updated_at,
    created_by: row.created_by ?? "",
    updated_by: row.updated_by ?? "",
  };
}

/** Full identifiers — server-side only; never send this to a browser. */
export function registrationsForValidation(clientId: string): ClientRegistration[] {
  const rows = all<RegistrationRow>(
    "SELECT * FROM client_registrations WHERE client_id = ? ORDER BY is_primary DESC, created_at",
    clientId,
  );
  return rows.map((row) => readRegistration(row, true));
}

/** Safe view for APIs and the client workspace. */
export function listRegistrations(clientId: string, role = "article"): ClientRegistration[] {
  const rows = all<RegistrationRow>(
    "SELECT * FROM client_registrations WHERE client_id = ? ORDER BY is_primary DESC, created_at",
    clientId,
  );
  return rows.map((row) => readRegistration(row, canViewFullIdentifier(role)));
}

export function getRegistration(registrationId: string): ClientRegistration | null {
  const row = one<RegistrationRow>("SELECT * FROM client_registrations WHERE registration_id = ?", registrationId);
  return row ? readRegistration(row, true) : null;
}

export function validateRegistration(input: RegistrationInput, client: Client, existingId?: string): OnboardingIssue[] {
  const issues: OnboardingIssue[] = [];
  const add = (field: string, message: string, severity: OnboardingIssue["severity"] = "error") =>
    issues.push({ scope: "registration", field, message, severity });

  if (!REGISTRATION_KINDS.includes(input.kind as RegistrationKind)) {
    add("kind", "Choose GST, TAN, CIN, PAN or Other");
    return issues;
  }
  const identifier = identifierForKind(input.kind, input.identifier ?? "");
  if (!identifier) add("identifier", "Registration number is required");
  if (input.kind === "GST" && identifier) {
    const gstError = validateGstin(identifier);
    if (gstError) add("identifier", gstError);
    if (!input.legal_name) add("legal_name", "The legal name on the GST registration is required");
    if (client.pan && inspectGstin(identifier).pan && inspectGstin(identifier).pan !== client.pan.toUpperCase()) {
      add("identifier", "This GSTIN embeds a PAN that differs from the client PAN");
    }
  }
  if (input.kind === "TAN" && identifier) {
    const tanError = validateTan(identifier);
    if (tanError) add("identifier", tanError);
  }
  if (input.kind === "CIN" && identifier) {
    const cinError = validateCin(identifier);
    if (cinError) add("identifier", cinError);
  }
  if (input.kind === "PAN" && identifier) {
    const panError = validatePan(identifier);
    if (panError) add("identifier", panError);
  }
  if (input.status && !REGISTRATION_STATUSES.includes(input.status as RegistrationStatus)) {
    add("status", "Choose Active, Suspended, Cancelled or Needs review");
  }
  if (input.effective_from && !validDate(input.effective_from)) add("effective_from", "Use YYYY-MM-DD");
  if (input.effective_to && !validDate(input.effective_to)) add("effective_to", "Use YYYY-MM-DD");
  if (input.effective_from && input.effective_to && input.effective_from > input.effective_to) {
    add("effective_to", "Closure date cannot be before the effective date");
  }
  if (identifier) {
    const duplicate = registrationsForValidation(client.client_id).find(
      (reg) => reg.registration_id !== existingId && reg.kind === input.kind && (reg.identifier ?? "").toUpperCase() === identifier,
    );
    if (duplicate) add("identifier", "This registration is already recorded for the client");
  }
  return issues;
}

export function addRegistration(
  clientId: string,
  input: RegistrationInput,
  actor: string,
): ClientRegistration {
  const client = getClient(clientId);
  if (!client) throw new OnboardingError([{ scope: "client", message: "Client not found", severity: "error" }]);
  const issues = validateRegistration(input, client);
  if (issues.some((i) => i.severity === "error")) throw new OnboardingError(issues);

  const identifier = identifierForKind(input.kind, input.identifier ?? "");
  const now = new Date().toISOString();
  const info = input.kind === "GST" ? inspectGstin(identifier) : null;
  const registration: ClientRegistration = {
    registration_id: nextId("REG", "client_registrations", "registration_id"),
    client_id: clientId,
    kind: input.kind as RegistrationKind,
    identifier,
    identifier_masked: maskIdentifier(input.kind, identifier),
    legal_name: input.legal_name ?? client.legal_name ?? client.name,
    state: input.state ?? info?.state ?? client.state ?? "",
    state_code: input.state_code ?? info?.stateCode ?? "",
    status: (input.status as RegistrationStatus) ?? "Active",
    effective_from: input.effective_from ?? "",
    effective_to: input.effective_to ?? "",
    place_of_business: input.place_of_business ?? "",
    filing_frequency: input.filing_frequency ?? "",
    is_primary: Boolean(input.is_primary),
    verification_status: "User entered",
    migration_note: "",
    created_at: now,
    updated_at: now,
    created_by: actor,
    updated_by: actor,
  };

  withTransaction(() => {
    const db = getDb();
    if (registration.is_primary) {
      db.prepare("UPDATE client_registrations SET is_primary = 0 WHERE client_id = ? AND kind = ?").run(clientId, registration.kind);
    }
    db.prepare(`INSERT INTO client_registrations (registration_id,client_id,kind,identifier_enc,identifier_hash,legal_name,state,state_code,status,
      effective_from,effective_to,place_of_business,filing_frequency,is_primary,verification_status,migration_note,created_at,updated_at,created_by,updated_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      registration.registration_id,
      registration.client_id,
      registration.kind,
      encryptField(identifier),
      hashIdentifier(identifier),
      registration.legal_name,
      registration.state,
      registration.state_code,
      registration.status,
      registration.effective_from,
      registration.effective_to,
      registration.place_of_business,
      registration.filing_frequency,
      registration.is_primary ? 1 : 0,
      registration.verification_status,
      registration.migration_note,
      registration.created_at,
      registration.updated_at,
      registration.created_by,
      registration.updated_by,
    );
    if (registration.kind === "GST" && (registration.is_primary || !client.gst_number)) {
      // clients.gst_number remains the legacy mirror used by reports and
      // exports; the registration table is the structured source of truth.
      updateClient(clientId, {
        gst_number: identifier,
        gst_state_code: registration.state_code,
        gst_registration_type: input.filing_frequency || client.gst_registration_type || "Regular",
        updated_by: actor,
        updated_at: now,
      });
      db.prepare("UPDATE client_registrations SET is_primary = 1 WHERE registration_id = ?").run(registration.registration_id);
    }
    logAudit({
      actor,
      action: "REGISTRATION_ADDED",
      entity_type: "client_registration",
      entity_id: registration.registration_id,
      detail: `${registration.kind} registration for ${client.name}${registration.state ? ` · ${registration.state}` : ""}`,
    });
  });

  return { ...registration, identifier: undefined };
}

export function updateRegistration(
  registrationId: string,
  patch: Partial<RegistrationInput>,
  actor: string,
): ClientRegistration {
  const current = getRegistration(registrationId);
  if (!current) throw new OnboardingError([{ scope: "registration", message: "Registration not found", severity: "error" }]);
  const client = getClient(current.client_id);
  if (!client) throw new OnboardingError([{ scope: "client", message: "Client not found", severity: "error" }]);
  const merged: RegistrationInput = {
    kind: patch.kind ?? current.kind,
    identifier: patch.identifier ?? current.identifier ?? "",
    legal_name: patch.legal_name ?? current.legal_name,
    state: patch.state ?? current.state,
    state_code: patch.state_code ?? current.state_code,
    status: patch.status ?? current.status,
    effective_from: patch.effective_from ?? current.effective_from,
    effective_to: patch.effective_to ?? current.effective_to,
    place_of_business: patch.place_of_business ?? current.place_of_business,
    filing_frequency: patch.filing_frequency ?? current.filing_frequency,
    is_primary: patch.is_primary ?? current.is_primary,
  };
  const issues = validateRegistration(merged, client, registrationId);
  if (issues.some((i) => i.severity === "error")) throw new OnboardingError(issues);
  const identifier = identifierForKind(merged.kind!, merged.identifier!);
  const info = merged.kind === "GST" ? inspectGstin(identifier) : null;
  const now = new Date().toISOString();
  withTransaction(() => {
    const db = getDb();
    if (merged.is_primary) {
      db.prepare("UPDATE client_registrations SET is_primary = 0 WHERE client_id = ? AND kind = ?").run(current.client_id, merged.kind);
    }
    db.prepare(`UPDATE client_registrations SET kind=?,identifier_enc=?,identifier_hash=?,legal_name=?,state=?,state_code=?,status=?,
      effective_from=?,effective_to=?,place_of_business=?,filing_frequency=?,is_primary=?,updated_at=?,updated_by=? WHERE registration_id=?`).run(
      merged.kind,
      encryptField(identifier),
      hashIdentifier(identifier),
      merged.legal_name ?? "",
      merged.state ?? info?.state ?? "",
      merged.state_code ?? info?.stateCode ?? "",
      merged.status ?? "Active",
      merged.effective_from ?? "",
      merged.effective_to ?? "",
      merged.place_of_business ?? "",
      merged.filing_frequency ?? "",
      merged.is_primary ? 1 : 0,
      now,
      actor,
      registrationId,
    );
    if (merged.kind === "GST" && merged.is_primary) {
      updateClient(current.client_id, {
        gst_number: identifier,
        gst_state_code: merged.state_code ?? info?.stateCode ?? "",
        updated_by: actor,
        updated_at: now,
      });
    }
    logAudit({
      actor,
      action: "REGISTRATION_UPDATED",
      entity_type: "client_registration",
      entity_id: registrationId,
      detail: `${merged.kind} registration for ${client.name} updated${merged.state ? ` · ${merged.state}` : ""}`,
    });
  });
  return getRegistration(registrationId)!;
}

export function deleteRegistration(registrationId: string, actor: string): { ok: boolean; blockers: string[] } {
  const registration = getRegistration(registrationId);
  if (!registration) return { ok: false, blockers: ["Registration not found"] };
  const activeServices = Number(
    one<{ n: number }>("SELECT COUNT(*) AS n FROM client_services WHERE registration_id = ? AND status IN ('Draft','Active','Paused')", registrationId)?.n ?? 0,
  );
  const cycles = Number(one<{ n: number }>("SELECT COUNT(*) AS n FROM compliance WHERE registration_id = ?", registrationId)?.n ?? 0);
  if (activeServices > 0) return { ok: false, blockers: [`${activeServices} service engagement(s) use this registration`] };
  if (cycles > 0) return { ok: false, blockers: [`${cycles} filing cycle(s) reference this registration`] };
  withTransaction(() => {
    getDb().prepare("DELETE FROM client_registrations WHERE registration_id = ?").run(registrationId);
    logAudit({
      actor,
      action: "REGISTRATION_REMOVED",
      entity_type: "client_registration",
      entity_id: registrationId,
      detail: `${registration.kind} registration removed`,
    });
  });
  return { ok: true, blockers: [] };
}

// ── Staff assignment ─────────────────────────────────────────────────────────

function firmUsers() {
  return listUsers();
}

function findUser(name: string) {
  const target = name.trim().toLowerCase();
  return firmUsers().find((user) => user.name.toLowerCase() === target || user.username.toLowerCase() === target);
}

function assignmentIssue(role: string, name: string): OnboardingIssue | null {
  if (!name) {
    return { scope: "team", field: role, message: `${roleLabel(role)} is not assigned`, severity: "error" };
  }
  const user = findUser(name);
  if (!user) {
    return { scope: "team", field: role, message: `${name} is not a staff member of this firm`, severity: "error" };
  }
  if (role === "partner" && user.role !== "partner") {
    return { scope: "team", field: role, message: `${name} is not a partner and cannot be the authorised CA`, severity: "error" };
  }
  if (role === "manager" && user.role === "article") {
    return { scope: "team", field: role, message: `${name} is an article assistant and cannot be the responsible manager`, severity: "error" };
  }
  if (role === "reviewer" && user.role === "article") {
    return { scope: "team", field: role, message: `${name} is an article assistant and cannot review filings`, severity: "error" };
  }
  return null;
}

function roleLabel(role: string): string {
  return role === "owner" ? "Preparer" : role === "reviewer" ? "Reviewer" : role === "manager" ? "Manager" : role === "partner" ? "Authorised CA" : role;
}

function defaultTeam(): { owner: string; reviewer: string; manager: string; partner: string; relationship_manager: string } {
  const users = firmUsers();
  const partner = users.find((u) => u.role === "partner")?.name ?? "";
  const manager = users.find((u) => u.role === "manager")?.name ?? partner;
  const article = users.find((u) => u.role === "article")?.name ?? manager;
  const reviewer = manager && manager !== article ? manager : partner;
  return { owner: article, reviewer, manager, partner, relationship_manager: manager || partner };
}

function recordAssignment(input: {
  client_id: string;
  service_id?: string;
  role: AssignmentRole;
  assignee: string;
  assigned_by: string;
  previous?: string;
  note?: string;
}) {
  const db = getDb();
  const now = new Date().toISOString();
  if (input.previous && input.previous !== input.assignee) {
    db.prepare(
      "UPDATE client_service_assignments SET unassigned_at = ? WHERE client_id = ? AND IFNULL(service_id,'') = ? AND role = ? AND assignee = ? AND unassigned_at IS NULL",
    ).run(now, input.client_id, input.service_id ?? "", input.role, input.previous);
  }
  if (input.assignee) {
    db.prepare(
      "INSERT INTO client_service_assignments (assignment_id,client_id,service_id,role,assignee,assigned_by,assigned_at,unassigned_at,note) VALUES (?,?,?,?,?,?,?,?,?)",
    ).run(
      nextId("ASG", "client_service_assignments", "assignment_id"),
      input.client_id,
      input.service_id ?? "",
      input.role,
      input.assignee,
      input.assigned_by,
      now,
      null,
      input.note ?? "",
    );
  }
}

export function listAssignmentHistory(clientId: string): AssignmentHistory[] {
  return all<AssignmentHistory>(
    "SELECT * FROM client_service_assignments WHERE client_id = ? ORDER BY assigned_at DESC LIMIT 100",
    clientId,
  );
}

// ── Service catalogue settings ───────────────────────────────────────────────

export type CatalogueEntry = {
  code: string;
  name: string;
  short: string;
  line: string;
  frequency: string;
  default_fee: number;
  billing_cycle: string;
  enabled: boolean;
  requires_engagement_letter: boolean;
  requires_approval: boolean;
  checklist: Array<{ name: string; category: string; optional?: boolean }>;
};

type CatalogueRow = {
  service_code: string;
  enabled: number;
  default_frequency: string | null;
  default_fee: number | null;
  requires_engagement_letter: number;
  requires_approval: number;
};

export function serviceCatalogue(): CatalogueEntry[] {
  const rows = all<CatalogueRow>("SELECT * FROM service_catalogue_settings");
  const byCode = new Map(rows.map((row) => [row.service_code, row]));
  return SERVICES.map((def) => {
    const row = byCode.get(def.code);
    return {
      code: def.code,
      name: def.name,
      short: def.short,
      line: def.line,
      frequency: row?.default_frequency || def.frequency,
      default_fee: row?.default_fee ?? def.defaultFee,
      billing_cycle: def.billingCycle,
      enabled: row ? Boolean(row.enabled) : true,
      requires_engagement_letter: Boolean(row?.requires_engagement_letter),
      requires_approval: Boolean(row?.requires_approval),
      checklist: def.checklist,
    };
  });
}

function catalogueEntry(code: string): CatalogueEntry | null {
  return serviceCatalogue().find((entry) => entry.code === code) ?? null;
}

export function updateCatalogueSetting(
  code: string,
  patch: { enabled?: boolean; default_frequency?: string; default_fee?: number; requires_engagement_letter?: boolean; requires_approval?: boolean },
  actor: string,
): CatalogueEntry {
  const def = getService(code);
  const current = one<CatalogueRow>("SELECT * FROM service_catalogue_settings WHERE service_code = ?", code);
  if (!current) throw new OnboardingError([{ scope: "service", message: "Unknown service code", severity: "error" }]);
  getDb()
    .prepare(
      "UPDATE service_catalogue_settings SET enabled=?, default_frequency=?, default_fee=?, requires_engagement_letter=?, requires_approval=?, updated_at=? WHERE service_code=?",
    )
    .run(
      patch.enabled === undefined ? current.enabled : patch.enabled ? 1 : 0,
      patch.default_frequency ?? current.default_frequency ?? def.frequency,
      patch.default_fee ?? current.default_fee ?? def.defaultFee,
      patch.requires_engagement_letter === undefined ? current.requires_engagement_letter : patch.requires_engagement_letter ? 1 : 0,
      patch.requires_approval === undefined ? current.requires_approval : patch.requires_approval ? 1 : 0,
      new Date().toISOString(),
      code,
    );
  logAudit({ actor, action: "SERVICE_CATALOGUE_UPDATED", entity_type: "service", entity_id: code, detail: `${def.name} catalogue settings updated` });
  return catalogueEntry(code)!;
}

// ── Service validation and configuration ─────────────────────────────────────

function isServiceEnabled(code: string): boolean {
  const entry = catalogueEntry(code);
  return Boolean(entry?.enabled);
}

function defaultRegistrationFor(code: string, registrations: ClientRegistration[]): string {
  const line = getService(code).line;
  if (line === "gst") {
    const active = registrations.filter((r) => r.kind === "GST" && r.status === "Active");
    return (active.find((r) => r.is_primary) ?? active[0])?.registration_id ?? "";
  }
  return "";
}

export function validateServiceConfig(
  input: ServiceInput,
  ctx: { client: Client; registrations: ClientRegistration[]; existing?: ClientService },
): OnboardingIssue[] {
  const issues: OnboardingIssue[] = [];
  const add = (field: string, message: string, severity: OnboardingIssue["severity"] = "error") =>
    issues.push({ scope: "service", field, service_code: input.code, message, severity });
  const def = getService(input.code);
  const entry = catalogueEntry(input.code);
  if (!def || !entry) {
    add("code", "Unknown service code");
    return issues;
  }
  if (!entry.enabled) add("code", `${def.name} is disabled in the firm catalogue`);

  const frequency = valueOr(input.frequency, def.frequency)!;
  if (!["monthly", "quarterly", "annual", "one_time"].includes(frequency)) add("frequency", "Choose a valid frequency");

  let registration: ClientRegistration | null = null;
  if (input.registration_id) {
    registration = ctx.registrations.find((r) => r.registration_id === input.registration_id) ?? null;
    if (!registration) add("registration_id", "The selected registration does not belong to this client");
    else if (registration.status !== "Active") add("registration_id", `Registration is ${registration.status}; activate it first`);
  } else if (def.line === "gst") {
    const fallback = defaultRegistrationFor(input.code, ctx.registrations);
    if (!fallback) add("registration_id", "Add an active GST registration before configuring this service");
  }
  if (def.code === "tds_return" || def.line === "tds") {
    const hasTan = Boolean(ctx.client.tan) || ctx.registrations.some((r) => r.kind === "TAN" && r.status === "Active");
    if (!hasTan) add("registration_id", "TAN is required for TDS services", "error");
  }

  const fee = Number(input.fee ?? entry.default_fee ?? 0);
  if (!Number.isFinite(fee) || fee < 0) add("fee", "Fee must be zero or a positive number");
  const autoInvoice = input.auto_invoice ?? true;
  if (autoInvoice && fee <= 0) add("fee", "Auto-billing requires a fee greater than zero");
  const billing = valueOr(input.billing_cycle, def.billingCycle)!;
  if (!["per_cycle", "monthly", "quarterly", "annual"].includes(billing)) add("billing_cycle", "Choose a valid billing cycle");
  const feeModel = valueOr(input.fee_model, "recurring")!;
  if (!FEE_MODELS.includes(feeModel as (typeof FEE_MODELS)[number])) add("fee_model", "Choose a valid fee model");
  const paymentTerms = Number(input.payment_terms_days ?? 30);
  if (!Number.isInteger(paymentTerms) || paymentTerms < 0 || paymentTerms > 180) {
    add("payment_terms_days", "Payment terms must be between 0 and 180 days");
  }
  if (input.setup_fee !== undefined && (!Number.isFinite(Number(input.setup_fee)) || Number(input.setup_fee) < 0)) {
    add("setup_fee", "Setup fee must be zero or positive");
  }

  const start = valueOr(input.start_date, ctx.existing?.start_date, todayISO())!;
  if (!validDate(start)) add("start_date", "Use YYYY-MM-DD");
  if (input.end_date) {
    if (!validDate(input.end_date)) add("end_date", "Use YYYY-MM-DD");
    else if (start && input.end_date < start) add("end_date", "End date cannot be before the start date");
  }

  for (const role of ["owner", "reviewer"] as const) {
    const name = valueOr(input[role], ctx.existing?.[role], "")!;
    const issue = assignmentIssue(role, name);
    if (issue) issues.push({ ...issue, service_code: input.code });
  }
  const reviewer = valueOr(input.reviewer, ctx.existing?.reviewer, "")!;
  const owner = valueOr(input.owner, ctx.existing?.owner, "")!;
  const approval = valueOr(input.approval_stage, ctx.existing?.approval_stage, def.line === "audit" ? "review" : "none")!;
  if (!APPROVAL_STAGES.includes(approval as (typeof APPROVAL_STAGES)[number])) add("approval_stage", "Choose a valid approval stage");
  if (approval !== "none" && reviewer && owner && reviewer.toLowerCase() === owner.toLowerCase()) {
    add("reviewer", "Reviewer must be independent of the preparer");
  }
  if (def.line === "audit") {
    const partnerName = valueOr(input.partner, ctx.existing?.partner, "")!;
    const partnerIssue = assignmentIssue("partner", partnerName);
    if (partnerIssue) issues.push({ ...partnerIssue, service_code: input.code });
    const entryRequiresLetter = entry.requires_engagement_letter || def.line === "audit";
    if (entryRequiresLetter && !["Received", "Approved"].includes(ctx.client.engagement_letter_status ?? "Not recorded")) {
      add("engagement_letter_status", "Record the engagement letter as received or approved", "error");
    }
  }
  for (const role of ["manager", "partner"] as const) {
    const name = valueOr(input[role], ctx.existing?.[role], "")!;
    if (name) {
      const issue = assignmentIssue(role, name);
      if (issue) issues.push({ ...issue, service_code: input.code });
    }
  }
  return issues;
}

export type ResolvedService = Omit<ClientService, "service_id" | "created_at"> & {
  service_id?: string;
  created_at?: string;
};

export function resolveServiceInput(
  input: ServiceInput,
  ctx: { client: Client; registrations: ClientRegistration[]; existing?: ClientService; relationship_manager?: string },
): ResolvedService {
  const def = getService(input.code);
  const entry = catalogueEntry(input.code) ?? serviceCatalogue().find((item) => item.code === input.code);
  const team = defaultTeam();
  const existing = ctx.existing;
  const registrationId =
    input.registration_id ||
    existing?.registration_id ||
    defaultRegistrationFor(input.code, ctx.registrations);
  const owner = valueOr(input.owner, existing?.owner, team.owner)!;
  const reviewer = valueOr(
    input.reviewer,
    existing?.reviewer,
    team.reviewer === owner ? team.partner : team.reviewer,
  )!;
  return {
    service_id: existing?.service_id,
    client_id: ctx.client.client_id,
    service_code: input.code,
    service_name: def.name,
    line: def.line,
    frequency: valueOr(input.frequency, existing?.frequency, entry?.frequency, def.frequency) as ClientService["frequency"],
    fee: Number(input.fee ?? existing?.fee ?? entry?.default_fee ?? def.defaultFee),
    billing_cycle: valueOr(input.billing_cycle, existing?.billing_cycle, def.billingCycle) as ClientService["billing_cycle"],
    auto_invoice: input.auto_invoice ?? existing?.auto_invoice ?? true,
    owner,
    reviewer,
    status: existing?.status ?? "Draft",
    start_date: valueOr(input.start_date, existing?.start_date, todayISO())!,
    reminder_cap: input.reminder_cap ?? existing?.reminder_cap ?? 3,
    reminder_gap_days: input.reminder_gap_days ?? existing?.reminder_gap_days ?? 3,
    next_cycle_on: existing?.next_cycle_on ?? null,
    created_at: existing?.created_at,
    registration_id: registrationId,
    manager: valueOr(input.manager, existing?.manager, ctx.relationship_manager, team.manager)!,
    partner: valueOr(input.partner, existing?.partner, team.partner)!,
    end_date: valueOr(input.end_date, existing?.end_date, "")!,
    fee_model: valueOr(input.fee_model, existing?.fee_model, def.frequency === "one_time" ? "one_time" : "recurring") as ClientService["fee_model"],
    setup_fee: Number(input.setup_fee ?? existing?.setup_fee ?? 0),
    payment_terms_days: Number(input.payment_terms_days ?? existing?.payment_terms_days ?? 30),
    fee_effective_from: valueOr(input.fee_effective_from, existing?.fee_effective_from, todayISO())!,
    approval_stage: valueOr(input.approval_stage, existing?.approval_stage, def.line === "audit" ? "review" : "none") as ClientService["approval_stage"],
    paused_at: existing?.paused_at ?? null,
    completed_at: existing?.completed_at ?? null,
    cancelled_at: existing?.cancelled_at ?? null,
    updated_at: new Date().toISOString(),
    created_by: existing?.created_by ?? "",
    updated_by: "",
  };
}

function ensureCompanyClient(value: ResolvedService): ClientService {
  const service = createClientService(value as Omit<ClientService, "service_id" | "created_at">);
  return service;
}

export function createServiceDraft(
  clientId: string,
  input: ServiceInput,
  actor: string,
): { service: ClientService; issues: OnboardingIssue[] } {
  const client = getClient(clientId);
  if (!client) throw new OnboardingError([{ scope: "client", message: "Client not found", severity: "error" }]);
  const registrations = registrationsForValidation(clientId);
  const resolved = resolveServiceInput(input, { client, registrations, relationship_manager: client.relationship_manager });
  const issues = validateServiceConfig({ ...input, ...resolved }, { client, registrations });
  if (issues.some((i) => i.severity === "error")) throw new OnboardingError(issues);
  const service = ensureCompanyClient({ ...resolved, created_by: actor, updated_by: actor });
  recordAssignment({ client_id: clientId, service_id: service.service_id, role: "preparer", assignee: service.owner, assigned_by: actor });
  recordAssignment({ client_id: clientId, service_id: service.service_id, role: "reviewer", assignee: service.reviewer, assigned_by: actor });
  if (service.manager) recordAssignment({ client_id: clientId, service_id: service.service_id, role: "manager", assignee: service.manager, assigned_by: actor });
  if (service.partner) recordAssignment({ client_id: clientId, service_id: service.service_id, role: "partner", assignee: service.partner, assigned_by: actor });
  return { service, issues };
}

export function updateServiceConfig(
  serviceId: string,
  patch: Partial<ServiceInput> & { status?: string },
  actor: string,
): ClientService {
  const existing = getClientService(serviceId);
  if (!existing) throw new OnboardingError([{ scope: "service", message: "Service not found", severity: "error" }]);
  const client = getClient(existing.client_id);
  if (!client) throw new OnboardingError([{ scope: "client", message: "Client not found", severity: "error" }]);
  const registrations = registrationsForValidation(existing.client_id);
  const mergedInput: ServiceInput = {
    code: existing.service_code,
    registration_id: patch.registration_id ?? existing.registration_id,
    frequency: patch.frequency ?? existing.frequency,
    fee: patch.fee ?? existing.fee,
    billing_cycle: patch.billing_cycle ?? existing.billing_cycle,
    auto_invoice: patch.auto_invoice ?? existing.auto_invoice,
    owner: patch.owner ?? existing.owner,
    reviewer: patch.reviewer ?? existing.reviewer,
    manager: patch.manager ?? existing.manager,
    partner: patch.partner ?? existing.partner,
    start_date: patch.start_date ?? existing.start_date,
    end_date: patch.end_date ?? existing.end_date,
    fee_model: patch.fee_model ?? existing.fee_model,
    setup_fee: patch.setup_fee ?? existing.setup_fee,
    payment_terms_days: patch.payment_terms_days ?? existing.payment_terms_days,
    fee_effective_from: patch.fee_effective_from ?? existing.fee_effective_from,
    approval_stage: patch.approval_stage ?? existing.approval_stage,
    reminder_cap: patch.reminder_cap ?? existing.reminder_cap,
    reminder_gap_days: patch.reminder_gap_days ?? existing.reminder_gap_days,
  };
  const issues = validateServiceConfig(mergedInput, { client, registrations, existing });
  if (issues.some((i) => i.severity === "error")) throw new OnboardingError(issues);

  const feeChanged = Number(mergedInput.fee) !== Number(existing.fee) || mergedInput.fee_model !== existing.fee_model;
  const status = (patch.status as ClientService["status"]) ?? existing.status;
  if (!SERVICE_STATUSES.includes(status)) throw new OnboardingError([{ scope: "service", message: "Invalid service status", severity: "error" }]);
  const now = new Date().toISOString();
  const updated = updateClientService(serviceId, {
    service_code: mergedInput.code,
    registration_id: mergedInput.registration_id,
    frequency: mergedInput.frequency as ClientService["frequency"],
    fee: Number(mergedInput.fee) || 0,
    billing_cycle: mergedInput.billing_cycle as ClientService["billing_cycle"],
    auto_invoice: mergedInput.auto_invoice ?? existing.auto_invoice,
    owner: mergedInput.owner ?? existing.owner,
    reviewer: mergedInput.reviewer ?? existing.reviewer,
    manager: mergedInput.manager ?? existing.manager,
    partner: mergedInput.partner ?? existing.partner,
    start_date: mergedInput.start_date ?? existing.start_date,
    end_date: mergedInput.end_date ?? existing.end_date,
    fee_model: mergedInput.fee_model as ClientService["fee_model"],
    setup_fee: mergedInput.setup_fee,
    payment_terms_days: mergedInput.payment_terms_days,
    approval_stage: mergedInput.approval_stage as ClientService["approval_stage"],
    reminder_cap: mergedInput.reminder_cap ?? existing.reminder_cap,
    reminder_gap_days: mergedInput.reminder_gap_days ?? existing.reminder_gap_days,
    status,
    fee_effective_from: feeChanged ? now.slice(0, 10) : existing.fee_effective_from,
    updated_at: now,
    updated_by: actor,
  });
  if (!updated) throw new OnboardingError([{ scope: "service", message: "Could not update the service", severity: "error" }]);
  for (const [role, previous, next] of [
    ["preparer", existing.owner, updated.owner],
    ["reviewer", existing.reviewer, updated.reviewer],
    ["manager", existing.manager ?? "", updated.manager ?? ""],
    ["partner", existing.partner ?? "", updated.partner ?? ""],
  ] as Array<[AssignmentRole, string, string]>) {
    if (previous !== next) {
      recordAssignment({ client_id: existing.client_id, service_id: serviceId, role, assignee: next, assigned_by: actor, previous });
    }
  }
  logAudit({
    actor,
    action: "SERVICE_UPDATED",
    entity_type: "service",
    entity_id: serviceId,
    detail: `${updated.service_name} configuration updated for ${client.name}`,
  });
  return updated;
}

// ── Activation ───────────────────────────────────────────────────────────────

function createOnboardingTasks(clientId: string, service: ClientService, client: Client, actor: string) {
  const def = getService(service.service_code);
  const tasks: Array<{ label: string; kind: string }> = [
    { label: `Confirm ${def.short} scope and engagement letter`, kind: "engagement" },
    { label: `Verify ${def.short} opening information`, kind: "information" },
  ];
  if (service.registration_id) {
    const reg = getRegistration(service.registration_id);
    if (reg) tasks.push({ label: `Confirm ${reg.kind} registration ${reg.state || reg.state_code || ""}`.trim(), kind: "registration" });
  }
  if (service.auto_invoice) tasks.push({ label: `Confirm billing terms for ${def.short}`, kind: "billing" });
  if (!client.relationship_manager) tasks.push({ label: "Assign a relationship manager", kind: "team" });
  const db = getDb();
  const now = new Date().toISOString();
  for (const task of tasks) {
    db.prepare(
      "INSERT OR IGNORE INTO onboarding_tasks (task_id,client_id,service_id,label,kind,status,due_date,created_at,completed_at) VALUES (?,?,?,?,?,?,?,?,NULL)",
    ).run(
      nextId("OBT", "onboarding_tasks", "task_id"),
      clientId,
      service.service_id,
      task.label,
      task.kind,
      "Open",
      addDaysISO(todayISO(), 7),
      now,
    );
  }
  logAudit({ actor, action: "ONBOARDING_TASKS_CREATED", entity_type: "service", entity_id: service.service_id, detail: `${tasks.length} onboarding task(s) for ${service.service_name}` });
}

export type ActivationResult = {
  service: ClientService;
  cycle: CycleResult | null;
  created: boolean;
  issues: OnboardingIssue[];
};

/**
 * Activates a configured service. The activation record is keyed by the
 * caller's idempotency key (or by the service itself), so retrying a request
 * after a timeout can never open a second period or a second checklist.
 */
export function activateService(
  serviceId: string,
  actor: string,
  idempotencyKey?: string,
): ActivationResult {
  const existing = getClientService(serviceId);
  if (!existing) throw new OnboardingError([{ scope: "service", message: "Service not found", severity: "error" }]);
  const client = getClient(existing.client_id);
  if (!client) throw new OnboardingError([{ scope: "client", message: "Client not found", severity: "error" }]);
  const key = idempotencyKey?.trim() || `activation:${serviceId}`;
  const seen = one<{ activation_id: string }>("SELECT activation_id FROM onboarding_activations WHERE idempotency_key = ?", key);
  if (seen) {
    const cycle = createCycleForService({ client, service: existing, actor, role: "system" });
    return { service: existing, cycle, created: false, issues: [] };
  }
  if (existing.status === "Cancelled" || existing.status === "Completed") {
    throw new OnboardingError([
      { scope: "service", service_code: existing.service_code, message: `A ${existing.status.toLowerCase()} service cannot be activated`, severity: "error" },
    ]);
  }
  const registrations = registrationsForValidation(existing.client_id);
  const issues = validateServiceConfig(
    {
      code: existing.service_code,
      registration_id: existing.registration_id,
      frequency: existing.frequency,
      fee: existing.fee,
      billing_cycle: existing.billing_cycle,
      auto_invoice: existing.auto_invoice,
      owner: existing.owner,
      reviewer: existing.reviewer,
      manager: existing.manager,
      partner: existing.partner,
      start_date: existing.start_date,
      end_date: existing.end_date,
      fee_model: existing.fee_model,
      setup_fee: existing.setup_fee,
      payment_terms_days: existing.payment_terms_days,
      approval_stage: existing.approval_stage,
    },
    { client, registrations, existing },
  );
  if (issues.some((i) => i.severity === "error")) throw new OnboardingError(issues);

  let cycle: CycleResult | null = null;
  withTransaction(() => {
    const activeService = updateClientService(serviceId, {
      status: "Active",
      start_date: existing.start_date || todayISO(),
      paused_at: null,
      updated_at: new Date().toISOString(),
      updated_by: actor,
    });
    if (!activeService) throw new Error("Could not activate the service");
    cycle = createCycleForService({ client, service: activeService, actor, role: "system" });
    createOnboardingTasks(client.client_id, activeService, client, actor);
    getDb()
      .prepare("INSERT INTO onboarding_activations (activation_id,client_id,service_id,idempotency_key,detail,created_at) VALUES (?,?,?,?,?,?)")
      .run(
        nextId("ACT", "onboarding_activations", "activation_id"),
        client.client_id,
        serviceId,
        key,
        JSON.stringify({ cycle: cycle.task.compliance_id, period: cycle.task.period, documents: cycle.documents.length }),
        new Date().toISOString(),
      );
    logAudit({
      actor,
      action: "SERVICE_ACTIVATED",
      entity_type: "service",
      entity_id: serviceId,
      detail: `${activeService.service_name} activated for ${client.name} · ${cycle.task.period}`,
    });
  });
  // A service that was already active has an existing period; report that
  // truthfully so callers never claim they created work that was already there.
  const created = (cycle as CycleResult | null)?.created ?? false;
  return { service: getClientService(serviceId)!, cycle, created, issues };
}

export function setServiceStatus(
  serviceId: string,
  status: ClientService["status"],
  actor: string,
): { service: ClientService; cycle: CycleResult | null; issues: OnboardingIssue[] } {
  const existing = getClientService(serviceId);
  if (!existing) throw new OnboardingError([{ scope: "service", message: "Service not found", severity: "error" }]);
  if (!SERVICE_STATUSES.includes(status)) throw new OnboardingError([{ scope: "service", message: "Invalid status", severity: "error" }]);
  if (status === "Active" && existing.status !== "Active") {
    const result = activateService(serviceId, actor, `resume:${serviceId}:${Date.now()}`);
    return { service: result.service, cycle: result.cycle, issues: result.issues };
  }
  const now = new Date().toISOString();
  const patch: Partial<ClientService> = { status, updated_at: now, updated_by: actor };
  if (status === "Paused") patch.paused_at = now;
  if (status === "Completed") patch.completed_at = now;
  if (status === "Cancelled") patch.cancelled_at = now;
  if (status === "Active") patch.paused_at = null;
  const updated = updateClientService(serviceId, patch);
  if (!updated) throw new OnboardingError([{ scope: "service", message: "Could not update the service", severity: "error" }]);
  logAudit({
    actor,
    action: `SERVICE_${status.toUpperCase()}`,
    entity_type: "service",
    entity_id: serviceId,
    detail: `${updated.service_name} moved to ${status}`,
  });
  return { service: updated, cycle: null, issues: [] };
}

// ── Onboarding assessment ────────────────────────────────────────────────────

export function listOnboardingTasks(clientId: string): OnboardingTask[] {
  return all<OnboardingTask>(
    "SELECT * FROM onboarding_tasks WHERE client_id = ? ORDER BY CASE status WHEN 'Open' THEN 0 ELSE 1 END, due_date",
    clientId,
  );
}

function requiredRegistrations(services: ClientService[]): RegistrationKind[] {
  const needed = new Set<RegistrationKind>();
  for (const service of services) {
    const def = getService(service.service_code);
    if (def.line === "gst") needed.add("GST");
    if (def.line === "tds") needed.add("TAN");
  }
  return [...needed];
}

export function assessOnboarding(clientId: string, role = "partner"): OnboardingAssessment | null {
  const client = getClient(clientId);
  if (!client) return null;
  const services = listClientServices(clientId);
  const registrations = registrationsForValidation(clientId);
  const users = firmUsers();
  const profileIssues = validateClientProfile(
    {
      legal_name: client.legal_name || client.name,
      name: client.name,
      trade_name: client.trade_name,
      entity_type: client.entity_type,
      pan: client.pan,
      tan: client.tan,
      cin: client.cin,
      date_of_incorporation: client.date_of_incorporation,
      date_of_birth: client.date_of_birth,
      gst_number: client.gst_number,
      address: client.address,
      city: client.city,
      state: client.state,
      pincode: client.pincode,
      contact_person: client.contact_person,
      phone: client.phone,
      whatsapp_number: client.whatsapp_number,
      email: client.email,
      preferred_channel: client.preferred_channel,
      whatsapp_opt_in: client.whatsapp_opt_in,
      whatsapp_consent_source: client.whatsapp_consent_source,
    },
    clientId,
  );
  const issues: OnboardingIssue[] = [...profileIssues];
  // A cancelled or completed engagement is history. Its old configuration must
  // never keep a client permanently "incomplete" or block a new activation.
  const considered = services.filter((service) => service.status !== "Cancelled" && service.status !== "Completed");

  const serviceReadiness: ServiceReadiness[] = considered.map((service) => {
    const errors = validateServiceConfig(
      {
        code: service.service_code,
        registration_id: service.registration_id,
        frequency: service.frequency,
        fee: service.fee,
        billing_cycle: service.billing_cycle,
        auto_invoice: service.auto_invoice,
        owner: service.owner,
        reviewer: service.reviewer,
        manager: service.manager,
        partner: service.partner,
        start_date: service.start_date,
        end_date: service.end_date,
        fee_model: service.fee_model,
        setup_fee: service.setup_fee,
        payment_terms_days: service.payment_terms_days,
        approval_stage: service.approval_stage,
      },
      { client, registrations, existing: service },
    );
    issues.push(...errors);
    return {
      service_code: service.service_code,
      service_name: service.service_name,
      status: service.status,
      ready: !errors.some((e) => e.severity === "error"),
      errors,
    };
  });

  const needed = requiredRegistrations(considered);
  const missingRegistrations = needed.filter((kind) => {
    if (kind === "TAN") return !client.tan && !registrations.some((r) => r.kind === "TAN" && r.status === "Active");
    return !registrations.some((r) => r.kind === kind && r.status === "Active");
  });

  const active = services.filter((s) => s.status === "Active");
  const commercialErrors = issues.filter((i) => i.scope === "service" && ["fee", "billing_cycle", "payment_terms_days", "fee_model"].includes(i.field ?? "") && i.severity === "error");
  const teamErrors = issues.filter((i) => i.scope === "team" && i.severity === "error");
  const identityDone =
    Boolean(client.legal_name) &&
    Boolean(client.pan) &&
    Boolean(client.entity_type) &&
    Boolean(client.city) &&
    Boolean(client.state) &&
    (!COMPANY_ENTITIES.has(client.entity_type ?? "") || Boolean(client.date_of_incorporation)) &&
    !profileIssues.some((i) => i.scope === "client" && i.field !== "address" && i.field !== "date_of_birth" && i.severity === "error");
  const contactDone = Boolean(client.phone) && Boolean(client.email) && Boolean(client.contact_person);
  const registrationDone = missingRegistrations.length === 0;
  const servicesDone = considered.length > 0;
  const termsDone = considered.length > 0 && commercialErrors.length === 0;
  const teamDone =
    Boolean(client.relationship_manager) &&
    considered.length > 0 &&
    considered.every((service) => Boolean(service.owner) && Boolean(service.reviewer)) &&
    teamErrors.length === 0;
  const documentsDone = considered.length > 0 && considered.every((service) => {
    const row = one<{ n: number }>(
      `SELECT COUNT(*) AS n FROM documents d JOIN compliance c ON c.compliance_id = d.compliance_id
       WHERE c.client_id = ? AND c.service_id = ? AND c.stage <> 'done'`,
      clientId,
      service.service_id,
    );
    return Number(row?.n ?? 0) > 0;
  });
  const communicationDone =
    Boolean(client.preferred_channel) &&
    (client.whatsapp_opt_in !== true || Boolean(client.whatsapp_consent_source));
  const activationDone = considered.length > 0 && considered.every((service) => service.status === "Active");

  const checklist = [
    { key: "identity", label: "Identity and legal details", done: identityDone, required: true, detail: "Legal name, PAN, entity type, address and incorporation data where applicable" },
    { key: "contact", label: "Contact details", done: contactDone, required: true, detail: "Primary contact, mobile and email" },
    { key: "registrations", label: "Registrations captured", done: registrationDone, required: needed.length > 0, detail: needed.length ? `Required: ${needed.join(", ")}` : "No registration-dependent service selected" },
    { key: "services", label: "Services configured", done: servicesDone, required: true, detail: "At least one agreed service, at its own frequency and fee" },
    { key: "terms", label: "Commercial terms", done: termsDone, required: true, detail: "Fee, billing cycle and payment terms for every active service" },
    { key: "team", label: "Team assignments", done: teamDone, required: true, detail: "Relationship manager plus preparer and reviewer on each active service" },
    { key: "documents", label: "Document checklist generated", done: documentsDone, required: true, detail: "Checklist instances opened from the template in force" },
    { key: "communication", label: "Communication and consent", done: communicationDone, required: true, detail: "Preferred channel, WhatsApp consent source when opted in" },
    { key: "activation", label: "Service activation", done: activationDone, required: true, detail: "Activation opens engagements and stops being a draft" },
  ];
  const required = checklist.filter((item) => item.required);
  const completeness = required.length
    ? Math.round((required.filter((item) => item.done).length / required.length) * 100)
    : 100;
  const outstandingTasks = Number(
    one<{ n: number }>("SELECT COUNT(*) AS n FROM onboarding_tasks WHERE client_id = ? AND status = 'Open'", clientId)?.n ?? 0,
  );
  return {
    client_id: client.client_id,
    client_name: client.name,
    stage: client.onboarding_stage ?? "review",
    status: (client.onboarding_status as OnboardingAssessment["status"]) ?? "In progress",
    completeness,
    can_activate: issues.every((i) => i.severity !== "error") && considered.length > 0,
    checklist,
    issues,
    services: serviceReadiness,
    active_services: active.length,
    missing_registrations: missingRegistrations,
    outstanding_tasks: outstandingTasks,
  };
}

// ── Full onboarding transaction ──────────────────────────────────────────────

export type OnboardResult = {
  client: Client;
  registrations: ClientRegistration[];
  services: ClientService[];
  cycles: CycleResult[];
  documents: number;
  messages: Array<{ request_id: string; status: string; reason?: string }>;
  issues: OnboardingIssue[];
  assessment: OnboardingAssessment;
};

export function onboardClient(input: OnboardInput): OnboardResult {
  const { services: serviceInputs, registrations: registrationInputsRaw, actor, ...profileBase } = input;
  const profile: ProfileInput = {
    ...profileBase,
    phone: normalisePhone(input.phone),
    whatsapp_number: input.whatsapp_number ? normalisePhone(input.whatsapp_number) : "",
    pan: input.pan.toUpperCase().trim(),
    tan: input.tan?.toUpperCase().trim(),
    cin: input.cin?.toUpperCase().trim(),
    gst_number: input.gst_number?.toUpperCase().trim(),
  };
  const profileIssues = validateClientProfile(profile);
  if (profileIssues.some((i) => i.severity === "error")) throw new OnboardingError(profileIssues);
  if (!input.services || input.services.length === 0) {
    throw new OnboardingError([{ scope: "service", message: "Select at least one service to onboard the client", severity: "error" }]);
  }

  const team = defaultTeam();
  const relationshipManager = input.relationship_manager || team.relationship_manager;
  if (relationshipManager) {
    const issue = assignmentIssue("manager", relationshipManager);
    if (issue) throw new OnboardingError([issue]);
  }

  // Duplicate registrations inside the request are caught before any write.
  const registrationInputs = registrationInputsRaw ?? [];
  const seen = new Set<string>();
  for (const registration of registrationInputs) {
    const key = `${registration.kind}:${(registration.identifier ?? "").toUpperCase().trim()}`;
    if (seen.has(key)) throw new OnboardingError([{ scope: "registration", field: "identifier", message: "Duplicate registration in this request", severity: "error" }]);
    seen.add(key);
  }

  const result = withTransaction(() => {
    const client = createClient({
      name: input.trade_name || profile.legal_name,
      legal_name: profile.legal_name,
      trade_name: profile.trade_name ?? "",
      contact_person: profile.contact_person || profile.legal_name,
      primary_contact_designation: profile.primary_contact_designation ?? "",
      phone: profile.phone,
      whatsapp_number: profile.whatsapp_number ?? "",
      email: profile.email,
      entity_type: profile.entity_type,
      gst_number: profile.gst_number ?? "",
      gst_registration_type: profile.gst_registration_type ?? (profile.gst_number ? "Regular" : "Unregistered"),
      pan: profile.pan,
      tan: profile.tan ?? "",
      cin: profile.cin ?? "",
      date_of_incorporation: profile.date_of_incorporation ?? "",
      date_of_birth: profile.date_of_birth ?? "",
      services_opted: "",
      address: profile.address ?? "",
      city: profile.city ?? "",
      state: profile.state ?? "",
      pincode: profile.pincode ?? "",
      billing_contact: profile.billing_contact ?? "",
      authorised_representative: profile.authorised_representative ?? "",
      preferred_language: profile.preferred_language ?? "English",
      preferred_channel: profile.preferred_channel ?? "WhatsApp",
      notes: profile.notes ?? "",
      relationship_manager: relationshipManager,
      whatsapp_opt_in: profile.whatsapp_opt_in ?? false,
      whatsapp_consent_at: profile.whatsapp_opt_in ? new Date().toISOString() : null,
      whatsapp_consent_source: profile.whatsapp_opt_in ? profile.whatsapp_consent_source ?? "" : "",
      engagement_letter_status: profile.engagement_letter_status ?? "Not recorded",
      engagement_letter_date: profile.engagement_letter_date ?? "",
      contact_verification_note: profile.contact_verification_note ?? "",
      onboarding_status: "In progress",
      client_status: "Active",
      onboarding_stage: "services",
      fy_end_month: 3,
      created_by: input.actor,
      updated_by: input.actor,
    });

    const createdRegistrations: ClientRegistration[] = [];
    for (const registration of registrationInputs) {
      createdRegistrations.push(addRegistration(client.client_id, registration, input.actor));
    }
    // If the profile carried a GSTIN but no explicit registration, capture it so
    // the service configuration has a real registration to point at.
    if (createdRegistrations.every((r) => r.kind !== "GST") && profile.gst_number) {
      createdRegistrations.push(
        addRegistration(
          client.client_id,
          {
            kind: "GST",
            identifier: profile.gst_number,
            legal_name: profile.legal_name,
            state: profile.state,
            state_code: profile.gst_number.slice(0, 2),
            is_primary: true,
            filing_frequency: profile.gst_registration_type ?? "Regular",
          },
          input.actor,
        ),
      );
    }
    const allRegistrations = registrationsForValidation(client.client_id);
    const services: ClientService[] = [];
    for (const serviceInput of serviceInputs) {
      const ref = serviceInput.registration_id;
      const resolvedRef = ref?.startsWith("new:")
        ? createdRegistrations[Number(ref.slice(4))]?.registration_id ?? ""
        : ref;
      const resolved = resolveServiceInput(
        { ...serviceInput, registration_id: resolvedRef },
        { client, registrations: allRegistrations, relationship_manager: relationshipManager },
      );
      const issues = validateServiceConfig(
        { ...serviceInput, ...resolved },
        { client, registrations: allRegistrations },
      );
      if (issues.some((i) => i.severity === "error")) throw new OnboardingError(issues);
      services.push(
        ensureCompanyClient({
          ...resolved,
          created_by: input.actor,
          updated_by: input.actor,
        }),
      );
    }
    const name = profile.trade_name || profile.legal_name;
    updateClient(client.client_id, {
      services_opted: services.map((s) => s.service_name).join(", "),
      updated_by: input.actor,
      updated_at: new Date().toISOString(),
    });
    for (const service of services) {
      recordAssignment({ client_id: client.client_id, service_id: service.service_id, role: "preparer", assignee: service.owner, assigned_by: input.actor });
      recordAssignment({ client_id: client.client_id, service_id: service.service_id, role: "reviewer", assignee: service.reviewer, assigned_by: input.actor });
      if (service.manager) recordAssignment({ client_id: client.client_id, service_id: service.service_id, role: "manager", assignee: service.manager, assigned_by: input.actor });
      if (service.partner) recordAssignment({ client_id: client.client_id, service_id: service.service_id, role: "partner", assignee: service.partner, assigned_by: input.actor });
    }
    if (relationshipManager) {
      recordAssignment({ client_id: client.client_id, role: "relationship_manager", assignee: relationshipManager, assigned_by: input.actor });
    }
    logAudit({
      actor: input.actor,
      action: "CLIENT_ONBOARDING_STARTED",
      entity_type: "client",
      entity_id: client.client_id,
      detail: `${name} created with ${createdRegistrations.length} registration(s) and ${services.length} service(s)`,
    });
    return { client: getClient(client.client_id)!, registrations: createdRegistrations, services };
  });

  // Activation happens after the profile commit: each service gets its own
  // transaction and its own idempotency record. A failure here leaves a
  // truthful "In progress" client rather than a half-activated one.
  const cycles: CycleResult[] = [];
  const issues: OnboardingIssue[] = [];
  for (const service of result.services) {
    try {
      const activation = activateService(service.service_id, input.actor, `onboard:${service.service_id}`);
      if (activation.cycle) cycles.push(activation.cycle);
      issues.push(...activation.issues);
    } catch (err) {
      if (err instanceof OnboardingError) issues.push(...err.issues);
      else issues.push({ scope: "service", service_code: service.service_code, message: (err as Error).message, severity: "error" });
    }
  }
  const allActive = result.services.length > 0 && cycles.length === result.services.length && !issues.some((i) => i.severity === "error");
  const now = new Date().toISOString();
  const finalClient =
    updateClient(result.client.client_id, {
      onboarding_status: allActive ? "Active" : "In progress",
      onboarding_stage: allActive ? "complete" : "activation",
      onboarding_completed_at: allActive ? now : null,
      updated_by: input.actor,
      updated_at: now,
    }) ?? result.client;
  if (allActive) {
    logAudit({
      actor: input.actor,
      action: "CLIENT_ACTIVATED",
      entity_type: "client",
      entity_id: finalClient.client_id,
      detail: `${finalClient.name} onboarding complete — ${result.services.length} service(s) activated`,
    });
  }
  return {
    client: finalClient,
    registrations: listRegistrations(result.client.client_id, input.actor),
    services: listClientServices(result.client.client_id),
    cycles,
    documents: cycles.reduce((sum, cycle) => sum + cycle.documents.length, 0),
    messages: [],
    issues,
    assessment: assessOnboarding(result.client.client_id, input.actor)!,
  };
}

/** Legacy single-service helper used by the client workspace. */
export function addService(input: {
  clientId: string;
  code: string;
  fee?: number;
  owner?: string;
  reviewer?: string;
  manager?: string;
  partner?: string;
  auto_invoice?: boolean;
  frequency?: string;
  registration_id?: string;
  actor: string;
  idempotency_key?: string;
}): { service: ClientService; cycle: CycleResult | null; issues: OnboardingIssue[]; created: boolean } {
  const client = getClient(input.clientId);
  if (!client) throw new OnboardingError([{ scope: "client", message: "Client not found", severity: "error" }]);
  const existing = listClientServices(input.clientId).find(
    (service) =>
      service.service_code === input.code &&
      (input.registration_id ? service.registration_id === input.registration_id : true) &&
      service.status !== "Cancelled" &&
      service.status !== "Completed",
  );
  if (existing && existing.status === "Active") {
    const cycle = createCycleForService({ client, service: existing, actor: input.actor, role: "system" });
    return { service: existing, cycle, issues: [], created: false };
  }
  const created = existing ?? createServiceDraft(input.clientId, input, input.actor).service;
  const activation = activateService(created.service_id, input.actor, input.idempotency_key ?? `add:${created.service_id}`);
  return { service: activation.service, cycle: activation.cycle, issues: activation.issues, created: activation.created };
}

// ── Search, pagination and bulk assignment ───────────────────────────────────

export type ClientSearchParams = {
  q?: string;
  status?: string;
  entity_type?: string;
  service_code?: string;
  registration_state?: string;
  manager?: string;
  preparer?: string;
  reviewer?: string;
  onboarding?: string;
  missing_details?: boolean;
  unassigned?: boolean;
  upcoming_deadlines?: boolean;
  outstanding_fees?: boolean;
  page?: number;
  page_size?: number;
};

export function searchClients(params: ClientSearchParams): { items: Client[]; total: number; page: number; page_size: number; pages: number } {
  const where: string[] = ["1=1"];
  const values: Array<string | number | null> = [];
  if (params.q) {
    where.push("(c.name LIKE ? OR c.legal_name LIKE ? OR c.email LIKE ? OR c.phone LIKE ? OR c.city LIKE ?)");
    const like = `%${params.q.trim()}%`;
    values.push(like, like, like, like, like);
  }
  if (params.status) {
    where.push("c.client_status = ?");
    values.push(params.status);
  }
  if (params.entity_type) {
    where.push("c.entity_type = ?");
    values.push(params.entity_type);
  }
  if (params.manager) {
    where.push("c.relationship_manager = ?");
    values.push(params.manager);
  }
  if (params.service_code) {
    where.push("EXISTS (SELECT 1 FROM client_services s WHERE s.client_id = c.client_id AND s.service_code = ?)");
    values.push(params.service_code);
  }
  if (params.registration_state) {
    where.push("EXISTS (SELECT 1 FROM client_registrations r WHERE r.client_id = c.client_id AND r.kind = 'GST' AND (r.state = ? OR r.state_code = ?))");
    values.push(params.registration_state, params.registration_state);
  }
  if (params.preparer) {
    where.push("EXISTS (SELECT 1 FROM client_services s WHERE s.client_id = c.client_id AND s.owner = ?)");
    values.push(params.preparer);
  }
  if (params.reviewer) {
    where.push("EXISTS (SELECT 1 FROM client_services s WHERE s.client_id = c.client_id AND s.reviewer = ?)");
    values.push(params.reviewer);
  }
  if (params.onboarding === "incomplete") {
    where.push("(COALESCE(c.onboarding_status,'Active') <> 'Active' OR NOT EXISTS (SELECT 1 FROM client_services s WHERE s.client_id = c.client_id AND s.status = 'Active'))");
  } else if (params.onboarding === "active") {
    where.push("COALESCE(c.onboarding_status,'Active') = 'Active'");
  } else if (params.onboarding === "in_progress") {
    where.push("COALESCE(c.onboarding_status,'Active') = 'In progress'");
  }
  if (params.missing_details) {
    where.push("(c.legal_name IS NULL OR c.legal_name = '' OR c.pan IS NULL OR c.pan = '' OR c.relationship_manager IS NULL OR c.relationship_manager = '')");
  }
  if (params.unassigned) {
    where.push(
      "(c.relationship_manager IS NULL OR c.relationship_manager = '' OR EXISTS (SELECT 1 FROM client_services s WHERE s.client_id = c.client_id AND s.status = 'Active' AND (s.owner IS NULL OR s.owner = '' OR s.reviewer IS NULL OR s.reviewer = '')))",
    );
  }
  if (params.upcoming_deadlines) {
    where.push(
      "EXISTS (SELECT 1 FROM compliance k WHERE k.client_id = c.client_id AND k.status <> 'Filed' AND k.due_date BETWEEN date('now') AND date('now','+30 day'))",
    );
  }
  if (params.outstanding_fees) {
    where.push(
      "EXISTS (SELECT 1 FROM invoices i WHERE i.client_id = c.client_id AND i.status NOT IN ('Paid','Cancelled') AND (i.total_amount - COALESCE(i.paid_amount,0)) > 0)",
    );
  }
  const page = Math.max(1, Math.floor(params.page ?? 1));
  const pageSize = Math.min(100, Math.max(10, Math.floor(params.page_size ?? 25)));
  const clause = where.join(" AND ");
  const total = Number(one<{ n: number }>(`SELECT COUNT(*) AS n FROM clients c WHERE ${clause}`, ...values)?.n ?? 0);
  const rows = all<Client>(`SELECT c.* FROM clients c WHERE ${clause} ORDER BY c.name LIMIT ? OFFSET ?`, ...values, pageSize, (page - 1) * pageSize);
  return {
    items: rows.map((row) => getClient(row.client_id)).filter((client): client is Client => Boolean(client)),
    total,
    page,
    page_size: pageSize,
    pages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export function bulkAssignManager(
  clientIds: string[],
  manager: string,
  actor: string,
): { updated: number; skipped: Array<{ client_id: string; reason: string }> } {
  const issue = assignmentIssue("manager", manager);
  if (issue) throw new OnboardingError([issue]);
  const unique = [...new Set(clientIds)].slice(0, 200);
  const skipped: Array<{ client_id: string; reason: string }> = [];
  let updated = 0;
  withTransaction(() => {
    for (const clientId of unique) {
      const client = getClient(clientId);
      if (!client) {
        skipped.push({ client_id: clientId, reason: "Client not found" });
        continue;
      }
      if (client.relationship_manager === manager) {
        skipped.push({ client_id: clientId, reason: "Already assigned" });
        continue;
      }
      updateClient(clientId, { relationship_manager: manager, updated_by: actor, updated_at: new Date().toISOString() });
      recordAssignment({
        client_id: clientId,
        role: "relationship_manager",
        assignee: manager,
        assigned_by: actor,
        previous: client.relationship_manager,
        note: "Bulk reassignment",
      });
      logAudit({
        actor,
        action: "RELATIONSHIP_MANAGER_ASSIGNED",
        entity_type: "client",
        entity_id: clientId,
        detail: `${client.name} assigned to ${manager}`,
      });
      updated++;
    }
  });
  return { updated, skipped };
}

export function getClientMigrationReport(): {
  at: string;
  legacy_clients: number;
  gst_registrations_backfilled: number;
  flagged_for_review: number;
  ambiguous: number;
} | null {
  const row = one<{ value: string }>("SELECT value FROM settings WHERE key = 'client_migration_report_v1'");
  if (!row?.value) return null;
  try {
    return JSON.parse(row.value);
  } catch {
    return null;
  }
}

/** Service-name helper used by the UI without importing the whole catalogue. */
export function frequencyText(code: string): string {
  return frequencyLabel(getService(code).frequency);
}

export type { ServiceDef };
export type { OnboardingIssue } from "./types";
