import { getSessionUser, isPartner } from "@/lib/auth";
import {
  ENTITY_TYPES,
  OnboardingError,
  canManageOnboarding,
  maskClientForRole,
  onboardClient,
  searchClients,
  type RegistrationInput,
  type ServiceInput,
} from "@/lib/onboarding";
import { date, fail, handle, ok, pick, readBody, str } from "@/lib/api";
import { ensureEngagementData } from "@/lib/engagements-db";

export const dynamic = "force-dynamic";

/** Server-side list: filters, pagination and identifier masking per role. */
export async function GET(req: Request) {
  try {
    ensureEngagementData();
    const user = await getSessionUser();
    if (!user) return fail("Sign in required", 401);
    const sp = new URL(req.url).searchParams;
    const bool = (key: string) => ["1", "true", "yes"].includes((sp.get(key) ?? "").toLowerCase());
    const result = searchClients({
      q: sp.get("q") ?? undefined,
      status: sp.get("status") ?? undefined,
      entity_type: sp.get("entity_type") ?? undefined,
      service_code: sp.get("service_code") ?? undefined,
      registration_state: sp.get("registration_state") ?? undefined,
      manager: sp.get("manager") ?? undefined,
      preparer: sp.get("preparer") ?? undefined,
      reviewer: sp.get("reviewer") ?? undefined,
      onboarding: sp.get("onboarding") ?? undefined,
      missing_details: bool("missing_details"),
      unassigned: bool("unassigned"),
      upcoming_deadlines: bool("upcoming_deadlines"),
      outstanding_fees: bool("outstanding_fees"),
      page: Number(sp.get("page") ?? 1),
      page_size: Number(sp.get("page_size") ?? 25),
    });
    return ok({
      ...result,
      items: result.items.map((client) => maskClientForRole(client, user.role)),
    });
  } catch (err) {
    return handle(err);
  }
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error("A numeric value was expected");
  return n;
}

function parseRegistrations(body: Record<string, any>): RegistrationInput[] {
  if (!Array.isArray(body.registrations)) return [];
  return body.registrations.map((entry) => {
    if (!entry || typeof entry !== "object") throw new Error("Each registration must be an object");
    return {
      kind: str(entry.kind, "Registration kind", { max: 10 }),
      identifier: str(entry.identifier, "Registration number", { max: 40 }),
      legal_name: str(entry.legal_name, "Legal name on the registration", { optional: true, max: 160 }),
      state: str(entry.state, "State", { optional: true, max: 80 }),
      state_code: str(entry.state_code, "State code", { optional: true, max: 2 }),
      status: str(entry.status, "Registration status", { optional: true, max: 20 }) || "Active",
      effective_from: entry.effective_from ? date(entry.effective_from, "Effective from") : "",
      effective_to: entry.effective_to ? date(entry.effective_to, "Closure date") : "",
      place_of_business: str(entry.place_of_business, "Place of business", { optional: true, max: 200 }),
      filing_frequency: str(entry.filing_frequency, "Filing frequency", { optional: true, max: 40 }),
      is_primary: Boolean(entry.is_primary),
    };
  });
}

function parseServices(body: Record<string, any>): ServiceInput[] {
  if (!Array.isArray(body.services)) return [];
  return body.services.map((entry) => {
    if (!entry || typeof entry !== "object") throw new Error("Each service must be an object");
    return {
      code: str(entry.code, "Service code", { max: 40 }),
      registration_id: str(entry.registration_id, "Registration", { optional: true, max: 80 }),
      frequency: str(entry.frequency, "Frequency", { optional: true, max: 20 }),
      fee: optionalNumber(entry.fee),
      billing_cycle: str(entry.billing_cycle, "Billing cycle", { optional: true, max: 20 }),
      auto_invoice: entry.auto_invoice === undefined ? undefined : Boolean(entry.auto_invoice),
      owner: str(entry.owner, "Preparer", { optional: true, max: 80 }),
      reviewer: str(entry.reviewer, "Reviewer", { optional: true, max: 80 }),
      manager: str(entry.manager, "Manager", { optional: true, max: 80 }),
      partner: str(entry.partner, "Authorised CA", { optional: true, max: 80 }),
      start_date: entry.start_date ? date(entry.start_date, "Start date") : undefined,
      end_date: entry.end_date ? date(entry.end_date, "End date") : undefined,
      fee_model: str(entry.fee_model, "Fee model", { optional: true, max: 20 }),
      setup_fee: optionalNumber(entry.setup_fee),
      payment_terms_days: optionalNumber(entry.payment_terms_days),
      fee_effective_from: entry.fee_effective_from ? date(entry.fee_effective_from, "Fee effective from") : undefined,
      approval_stage: str(entry.approval_stage, "Approval stage", { optional: true, max: 20 }),
      reminder_cap: optionalNumber(entry.reminder_cap),
      reminder_gap_days: optionalNumber(entry.reminder_gap_days),
    };
  });
}

export async function POST(req: Request) {
  try {
    ensureEngagementData();
    const user = await getSessionUser();
    if (!user) return fail("Sign in required", 401);
    if (!canManageOnboarding(user.role)) {
      return fail("Only partners and managers can onboard clients", 403);
    }
    const body = await readBody(req);
    const services = parseServices(body);
    if (services.length === 0) return fail("Select at least one service to enrol the client in", 422);

    const result = onboardClient({
      legal_name: str(body.legal_name || body.name, "Legal name", { max: 160 }),
      name: str(body.name, "Client name", { optional: true, max: 160 }),
      trade_name: str(body.trade_name, "Trade name", { optional: true, max: 160 }),
      entity_type: pick(str(body.entity_type, "Entity type"), ENTITY_TYPES, "Entity type", "Private Limited"),
      pan: str(body.pan, "PAN", { max: 12 }),
      tan: str(body.tan, "TAN", { optional: true, max: 12 }),
      cin: str(body.cin, "CIN / LLPIN", { optional: true, max: 30 }),
      date_of_incorporation: body.date_of_incorporation ? date(body.date_of_incorporation, "Date of incorporation") : "",
      date_of_birth: body.date_of_birth ? date(body.date_of_birth, "Date of birth") : "",
      gst_number: str(body.gst_number, "GSTIN", { optional: true, max: 20 }),
      gst_registration_type: str(body.gst_registration_type, "GST registration type", { optional: true, max: 40 }),
      address: str(body.address, "Registered address", { optional: true, max: 400 }),
      city: str(body.city, "City", { optional: true, max: 80 }),
      state: str(body.state, "State", { optional: true, max: 80 }),
      pincode: str(body.pincode, "PIN code", { optional: true, max: 6 }),
      contact_person: str(body.contact_person, "Contact person", { optional: true, max: 120 }),
      primary_contact_designation: str(body.primary_contact_designation, "Designation", { optional: true, max: 80 }),
      phone: str(body.phone, "Primary mobile", { max: 20 }),
      whatsapp_number: str(body.whatsapp_number, "WhatsApp number", { optional: true, max: 20 }),
      email: str(body.email, "Email", { max: 160 }),
      billing_contact: str(body.billing_contact, "Billing contact", { optional: true, max: 160 }),
      authorised_representative: str(body.authorised_representative, "Authorised representative", { optional: true, max: 160 }),
      preferred_language: str(body.preferred_language, "Preferred language", { optional: true, max: 40 }) || "English",
      preferred_channel: pick(body.preferred_channel, ["WhatsApp", "Email", "Phone"] as const, "Preferred channel", "WhatsApp"),
      notes: str(body.notes, "Internal notes", { optional: true, max: 1000 }),
      relationship_manager: str(body.relationship_manager, "Relationship manager", { optional: true, max: 80 }),
      whatsapp_opt_in: body.whatsapp_opt_in === true,
      whatsapp_consent_source: str(body.whatsapp_consent_source, "Consent source", { optional: true, max: 120 }),
      engagement_letter_status: pick(
        body.engagement_letter_status,
        ["Not recorded", "Requested", "Received", "Approved"] as const,
        "Engagement letter",
        "Not recorded",
      ),
      engagement_letter_date: body.engagement_letter_date ? date(body.engagement_letter_date, "Engagement letter date") : "",
      contact_verification_note: str(body.contact_verification_note, "Contact verification", { optional: true, max: 200 }),
      registrations: parseRegistrations(body),
      services,
      actor: user.name,
    });

    return ok(
      {
        client: maskClientForRole(result.client, user.role),
        registrations: result.registrations,
        services: result.services,
        onboarding: result.assessment,
        issues: result.issues,
        cycles: result.cycles,
        messages: result.messages,
        summary: {
          services: result.services.length,
          active_services: result.assessment.active_services,
          cycles: result.cycles.length,
          documents: result.documents,
          messages: 0,
        },
      },
      201,
    );
  } catch (err) {
    if (err instanceof OnboardingError) {
      return ok({ error: err.message, issues: err.issues }, 422);
    }
    return handle(err);
  }
}
