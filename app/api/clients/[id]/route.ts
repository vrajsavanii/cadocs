import { all, deleteClient, getClient, getClientDetail, updateClient } from "@/lib/db";
import { date, fail, handle, ok, pick, readBody, str } from "@/lib/api";
import { getSessionUser, isPartner } from "@/lib/auth";
import type { AuditEntry, Client } from "@/lib/types";
import {
  ENTITY_TYPES,
  OnboardingError,
  assessOnboarding,
  bulkAssignManager,
  canManageOnboarding,
  listAssignmentHistory,
  listOnboardingTasks,
  listRegistrations,
  maskClientForRole,
  validateClientProfile,
  type ProfileInput,
} from "@/lib/onboarding";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser();
    if (!user) return fail("Sign in required", 401);
    const { id } = await ctx.params;
    const detail = getClientDetail(id);
    if (!detail) return fail("Client not found", 404);
    const registrations = listRegistrations(id, user.role);
    // Audit history is record-scoped: profile changes on the client, changes
    // on its registrations, and activation/configuration of its engagements.
    const entityIds = [...(detail.services ?? []).map((service) => service.service_id), ...registrations.map((reg) => reg.registration_id)];
    const audit = all<AuditEntry>(
      `SELECT id,actor,action,entity_type,entity_id,detail,created_at FROM audit_log
       WHERE (entity_type = 'client' AND entity_id = ?)
         ${entityIds.length ? `OR (entity_type IN ('service','client_registration') AND entity_id IN (${entityIds.map(() => "?").join(",")}))` : ""}
       ORDER BY id DESC LIMIT 80`,
      id,
      ...entityIds,
    );
    return ok({
      ...detail,
      client: maskClientForRole(detail.client, user.role),
      registrations,
      onboarding: assessOnboarding(id, user.role),
      onboarding_tasks: listOnboardingTasks(id),
      assignments: listAssignmentHistory(id),
      audit,
    });
  } catch (err) {
    return handle(err);
  }
}

function profileFrom(client: Client): ProfileInput {
  return {
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
    gst_registration_type: client.gst_registration_type,
    address: client.address,
    city: client.city,
    state: client.state,
    pincode: client.pincode,
    contact_person: client.contact_person,
    primary_contact_designation: client.primary_contact_designation,
    phone: client.phone,
    whatsapp_number: client.whatsapp_number,
    email: client.email,
    billing_contact: client.billing_contact,
    authorised_representative: client.authorised_representative,
    preferred_language: client.preferred_language,
    preferred_channel: client.preferred_channel,
    notes: client.notes,
    relationship_manager: client.relationship_manager,
    whatsapp_opt_in: client.whatsapp_opt_in,
    whatsapp_consent_source: client.whatsapp_consent_source,
    engagement_letter_status: client.engagement_letter_status,
    engagement_letter_date: client.engagement_letter_date,
    contact_verification_note: client.contact_verification_note,
  };
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser();
    if (!user) return fail("Sign in required", 401);
    if (!canManageOnboarding(user.role)) return fail("Only partners and managers can edit client profiles", 403);
    const { id } = await ctx.params;
    const current = getClient(id);
    if (!current) return fail("Client not found", 404);
    const body = await readBody(req);

    const merged: ProfileInput = {
      ...profileFrom(current),
      legal_name: body.legal_name !== undefined ? str(body.legal_name, "Legal name", { max: 160 }) : profileFrom(current).legal_name,
      name: body.name !== undefined ? str(body.name, "Client name", { max: 160 }) : current.name,
      trade_name: body.trade_name !== undefined ? str(body.trade_name, "Trade name", { optional: true, max: 160 }) : current.trade_name,
      entity_type: body.entity_type !== undefined ? pick(str(body.entity_type, "Entity type"), ENTITY_TYPES, "Entity type", "Private Limited") : current.entity_type,
      pan: body.pan !== undefined ? str(body.pan, "PAN", { max: 12 }).toUpperCase() : current.pan,
      tan: body.tan !== undefined ? str(body.tan, "TAN", { optional: true, max: 12 }).toUpperCase() : current.tan,
      cin: body.cin !== undefined ? str(body.cin, "CIN / LLPIN", { optional: true, max: 30 }).toUpperCase() : current.cin,
      date_of_incorporation: body.date_of_incorporation !== undefined
        ? (body.date_of_incorporation ? date(body.date_of_incorporation, "Date of incorporation") : "")
        : current.date_of_incorporation,
      date_of_birth: body.date_of_birth !== undefined ? (body.date_of_birth ? date(body.date_of_birth, "Date of birth") : "") : current.date_of_birth,
      gst_number: body.gst_number !== undefined ? str(body.gst_number, "GSTIN", { optional: true, max: 20 }).toUpperCase() : current.gst_number,
      address: body.address !== undefined ? str(body.address, "Registered address", { optional: true, max: 400 }) : current.address,
      city: body.city !== undefined ? str(body.city, "City", { optional: true, max: 80 }) : current.city,
      state: body.state !== undefined ? str(body.state, "State", { optional: true, max: 80 }) : current.state,
      pincode: body.pincode !== undefined ? str(body.pincode, "PIN code", { optional: true, max: 6 }) : current.pincode,
      contact_person: body.contact_person !== undefined ? str(body.contact_person, "Contact person", { optional: true, max: 120 }) : current.contact_person,
      primary_contact_designation: body.primary_contact_designation !== undefined
        ? str(body.primary_contact_designation, "Designation", { optional: true, max: 80 })
        : current.primary_contact_designation,
      phone: body.phone !== undefined ? str(body.phone, "Primary mobile", { max: 20 }) : current.phone,
      whatsapp_number: body.whatsapp_number !== undefined ? str(body.whatsapp_number, "WhatsApp number", { optional: true, max: 20 }) : current.whatsapp_number,
      email: body.email !== undefined ? str(body.email, "Email", { max: 160 }) : current.email,
      billing_contact: body.billing_contact !== undefined ? str(body.billing_contact, "Billing contact", { optional: true, max: 160 }) : current.billing_contact,
      authorised_representative: body.authorised_representative !== undefined
        ? str(body.authorised_representative, "Authorised representative", { optional: true, max: 160 })
        : current.authorised_representative,
      preferred_language: body.preferred_language !== undefined
        ? str(body.preferred_language, "Preferred language", { optional: true, max: 40 })
        : current.preferred_language,
      preferred_channel: body.preferred_channel !== undefined
        ? pick(body.preferred_channel, ["WhatsApp", "Email", "Phone"] as const, "Preferred channel", "WhatsApp")
        : current.preferred_channel,
      notes: body.notes !== undefined ? str(body.notes, "Internal notes", { optional: true, max: 1000 }) : current.notes,
      relationship_manager: current.relationship_manager,
      whatsapp_opt_in: body.whatsapp_opt_in !== undefined ? Boolean(body.whatsapp_opt_in) : current.whatsapp_opt_in,
      whatsapp_consent_source: body.whatsapp_consent_source !== undefined
        ? str(body.whatsapp_consent_source, "Consent source", { optional: true, max: 120 })
        : current.whatsapp_consent_source,
      engagement_letter_status: body.engagement_letter_status !== undefined
        ? pick(body.engagement_letter_status, ["Not recorded", "Requested", "Received", "Approved"] as const, "Engagement letter", "Not recorded")
        : current.engagement_letter_status,
      engagement_letter_date: body.engagement_letter_date !== undefined
        ? (body.engagement_letter_date ? date(body.engagement_letter_date, "Engagement letter date") : "")
        : current.engagement_letter_date,
      contact_verification_note: body.contact_verification_note !== undefined
        ? str(body.contact_verification_note, "Contact verification", { optional: true, max: 200 })
        : current.contact_verification_note,
    };
    const issues = validateClientProfile(merged, id);
    if (issues.some((i) => i.severity === "error")) {
      return ok({ error: issues.find((i) => i.severity === "error")?.message, issues }, 422);
    }

    const managerChanged = body.relationship_manager !== undefined && String(body.relationship_manager ?? "").trim() !== (current.relationship_manager ?? "");
    const updated = updateClient(id, {
      name: merged.name,
      legal_name: merged.legal_name,
      trade_name: merged.trade_name,
      entity_type: merged.entity_type,
      pan: merged.pan,
      tan: merged.tan,
      cin: merged.cin,
      date_of_incorporation: merged.date_of_incorporation,
      date_of_birth: merged.date_of_birth,
      gst_number: merged.gst_number,
      gst_state_code: merged.gst_number ? merged.gst_number.slice(0, 2) : current.gst_state_code,
      address: merged.address,
      city: merged.city,
      state: merged.state,
      pincode: merged.pincode,
      contact_person: merged.contact_person,
      primary_contact_designation: merged.primary_contact_designation,
      phone: merged.phone,
      whatsapp_number: merged.whatsapp_number,
      email: merged.email,
      billing_contact: merged.billing_contact,
      authorised_representative: merged.authorised_representative,
      preferred_language: merged.preferred_language,
      preferred_channel: merged.preferred_channel,
      notes: merged.notes,
      whatsapp_opt_in: merged.whatsapp_opt_in,
      whatsapp_consent_at: merged.whatsapp_opt_in ? current.whatsapp_consent_at ?? new Date().toISOString() : null,
      whatsapp_consent_source: merged.whatsapp_opt_in ? merged.whatsapp_consent_source ?? "" : "",
      engagement_letter_status: merged.engagement_letter_status,
      engagement_letter_date: merged.engagement_letter_date,
      contact_verification_note: merged.contact_verification_note,
      updated_by: user.name,
      updated_at: new Date().toISOString(),
    });
    if (!updated) return fail("Could not update the client", 500);
    if (managerChanged) {
      const manager = String(body.relationship_manager ?? "").trim();
      try {
        if (manager) bulkAssignManager([id], manager, user.name);
        else updateClient(id, { relationship_manager: "", updated_by: user.name });
      } catch (err) {
        if (err instanceof OnboardingError) return ok({ error: err.message, issues: err.issues }, 422);
        throw err;
      }
    }
    return ok({ client: maskClientForRole(getClient(id) ?? updated, user.role), onboarding: assessOnboarding(id, user.role) });
  } catch (err) {
    if (err instanceof OnboardingError) return ok({ error: err.message, issues: err.issues }, 422);
    return handle(err);
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser();
    if (!user) return fail("Sign in required", 401);
    if (!isPartner(user)) return fail("Only a partner can delete a client", 403);
    const { id } = await ctx.params;
    const result = deleteClient(id);
    if (!result.ok) {
      if (result.blockers.includes("Client not found")) return fail("Client not found", 404);
      return fail(`Cannot delete this client while linked records exist: ${result.blockers.join(", ")}`, 409);
    }
    return ok({ deleted: id });
  } catch (err) {
    return handle(err);
  }
}
